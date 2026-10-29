#!/usr/bin/env python3
"""Small controller unit tests; no SDK, builds, browser or emulator is started."""
import hashlib
import importlib.util
import inspect
import io
import json
import os
import re
from pathlib import Path
import shutil
import subprocess
import tarfile
import tempfile
import unittest
import urllib.error
import xml.etree.ElementTree as ET
from unittest.mock import Mock, patch
from typing import Any

HERE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location('unified_android_runner', HERE / 'qa_unified_share_android.py')
assert SPEC is not None and SPEC.loader is not None
runner = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(runner)


class ControllerTest(unittest.TestCase):
    def test_boot_exit_is_terminal_before_adb_or_sleep(self):
        for code in (0, 1, -9):
            emulator = Mock(); emulator.poll.return_value = code
            read = Mock()
            with patch.object(runner.time, 'sleep') as pause:
                with self.assertRaisesRegex(runner.EmulatorExited, 'returncode=' + str(code)):
                    runner.wait_for_emulator_boot(emulator, read)
            read.assert_not_called(); pause.assert_not_called()

    def test_boot_transient_adb_error_still_retries(self):
        emulator = Mock(); emulator.poll.return_value = None
        read = Mock(side_effect=[RuntimeError('adb not ready'), '0', '1\n'])
        with patch.object(runner.time, 'sleep') as pause:
            self.assertTrue(runner.wait_for_emulator_boot(emulator, read, 2))
        self.assertEqual(read.call_count, 3); self.assertEqual(pause.call_count, 2)

    def test_boot_exit_after_pending_read_is_terminal(self):
        emulator = Mock(); emulator.poll.side_effect = [None, 1]
        read = Mock(return_value='0')
        with patch.object(runner.time, 'sleep') as pause:
            with self.assertRaises(runner.EmulatorExited):
                runner.wait_for_emulator_boot(emulator, read)
        read.assert_called_once(); pause.assert_called_once()

    def test_kvm_probe_only_opens_and_reads_api_then_closes(self):
        with patch.object(runner.os, 'open', return_value=77) as opened, \
                patch.object(runner.fcntl, 'ioctl', return_value=12) as ioctl, \
                patch.object(runner.os, 'close') as closed:
            result = runner.kvm_preflight()
        opened.assert_called_once_with('/dev/kvm', os.O_RDWR | os.O_CLOEXEC)
        ioctl.assert_called_once_with(77, 0xAE00, 0); closed.assert_called_once_with(77)
        self.assertEqual(result['api'], 12); self.assertTrue(result['open'])

    def test_kvm_permission_denial_stops_before_avd_creation(self):
        rig = runner.Rig.__new__(runner.Rig); rig.run = Mock(); rig.save = Mock(); rig.report = {}
        with patch.object(runner.os, 'open', side_effect=PermissionError(13, 'denied')):
            with self.assertRaises(PermissionError):
                rig.boot()
        rig.run.assert_not_called()

    def test_kvm_wrong_api_or_ioctl_failure_still_closes(self):
        for result in (11, OSError('ioctl refused')):
            with patch.object(runner.os, 'open', return_value=77), \
                    patch.object(runner.fcntl, 'ioctl', side_effect=result if isinstance(result, Exception) else None,
                                 return_value=result), patch.object(runner.os, 'close') as closed:
                with self.assertRaises((RuntimeError, OSError)):
                    runner.kvm_preflight()
            closed.assert_called_once_with(77)

    def test_send_logpoints_are_source_bound_nonpausing_and_do_not_replace_bridge(self):
        rig = runner.Rig.__new__(runner.Rig)
        rig.source = HERE.parent; rig.page = Mock()
        with tempfile.TemporaryDirectory() as td:
            rig.out = Path(td)
            rig.page.call.return_value = {'result': {'locations': [{'lineNumber': 1}]}}
            rig.install_send_observation()
            calls = rig.page.call.call_args_list
            self.assertEqual([x.args[0] for x in calls], ['Debugger.enable'] + ['Debugger.setBreakpointByUrl'] * 3)
            for call in calls[1:]:
                self.assertTrue(call.kwargs['condition'].endswith(',false)'))
                for forbidden in ('postMessage(', 'shareRequest(', 'WosDevicePort.call(', 'reject(', 'resolve(', '.click(', 'preventDefault('):
                    self.assertNotIn(forbidden, call.kwargs['condition'])
            receipt = json.loads((rig.out / 'send-observation-logpoints.json').read_text())
            self.assertEqual(len(receipt), 3)
            for row in receipt:
                self.assertEqual(row['source_sha256'], runner.sha(rig.source / row['source']))
            # A second send resets observations, never duplicates breakpoint IDs.
            rig.install_send_observation()
            self.assertEqual(rig.page.call.call_count, 4)
            self.assertEqual(rig.page.ev.call_count, 2)

    def test_unbound_send_logpoint_fails_before_any_send(self):
        rig = runner.Rig.__new__(runner.Rig)
        rig.source = HERE.parent; rig.page = Mock(); rig.tap = Mock()
        with tempfile.TemporaryDirectory() as td:
            rig.out = Path(td)
            rig.page.call.return_value = {'result': {}}
            with self.assertRaisesRegex(RuntimeError, 'logpoint did not bind'):
                rig.send_once('existing-delivery')
            rig.tap.assert_not_called()
            self.assertTrue((rig.out / 'send-observation-logpoints.json').exists())

    def test_send_failure_observes_custody_without_retry_or_extended_timeout(self):
        rig = runner.Rig.__new__(runner.Rig)
        rig.install_send_observation = Mock(); rig.observe_send_boundary = Mock()
        rig.tap = Mock(); rig.sheet = Mock(return_value=True)
        def fail(predicate, seconds):
            self.assertEqual(seconds, 5)
            self.assertFalse(predicate())
            raise RuntimeError('same original bounded failure')
        with patch.object(runner, 'wait', side_effect=fail):
            with self.assertRaisesRegex(RuntimeError, 'same original bounded failure'):
                rig.send_once('existing-delivery')
        rig.tap.assert_called_once_with('[data-sharesend]')
        self.assertEqual([x.args[0] for x in rig.observe_send_boundary.call_args_list],
                         ['existing-delivery-before','existing-delivery-after'])

    def test_send_observation_reads_only_synthetic_metadata_and_custody(self):
        rig = runner.Rig.__new__(runner.Rig)
        rig.page = Mock(); rig.page.ev.return_value = {'observations': {'errors': [{'message':'native refused'}]}}
        rig.sx = Mock(return_value='files/share/synthetic/meta.json\n{}')
        with tempfile.TemporaryDirectory() as td:
            rig.out = Path(td); rig.observe_send_boundary('existing-delivery-after')
            self.assertIn('native refused', (rig.out / 'existing-delivery-after-bridge.json').read_text())
            self.assertIn('meta.json', (rig.out / 'existing-delivery-after-native-custody.txt').read_text())
        expr = rig.page.ev.call_args.args[0]
        for forbidden in ('.call(', 'postMessage', 'shareRead', 'shareMeta', 'shareDone'):
            self.assertNotIn(forbidden, expr)
        command = rig.sx.call_args.args[0]
        self.assertIn('stat -c', command)
        self.assertNotIn('cat "$f"; fi; done; rm', command)
        self.assertNotIn('rm ', command)

    def mock_sender_receipt(self, rig):
        # UI/hash regressions isolate the independently tested native receipt seam.
        rig.read_sender_intent = Mock(side_effect=lambda launch_id, seconds: {
            'event': 'onCreate' if not rig.report['external_intents'] else 'onNewIntent',
            'case': rig.report['sender_attempts'][-1]['requested_case'],
            'launch_id': launch_id})

    def test_post_tap_domain_wait_accepts_delayed_change_without_repeating_input(self):
        rig = runner.Rig.__new__(runner.Rig)
        rig.page = Mock(); rig.page.ev.side_effect = [False, False, True]
        expression = "document.querySelector('.dv-chat strong')?.textContent==='Trip planning' && !document.querySelector('.dv-picker-wrap')"
        with patch.object(runner.time, 'monotonic', side_effect=[0, 0, .4, .8]), patch.object(runner.time, 'sleep') as pause:
            self.assertTrue(rig.wait_dom(expression, 1))
        self.assertEqual(rig.page.ev.call_count, 3)
        self.assertTrue(all(c.args == (expression,) for c in rig.page.ev.call_args_list))
        self.assertEqual(pause.call_count, 2)
        rig.page.call.assert_not_called()
        self.assertIn('assert rig.wait_dom(' + json.dumps(expression) + ')',
                      (HERE / 'qa_unified_share_android.py').read_text())

    def test_post_tap_domain_wait_rejects_permanently_wrong_state_at_deadline(self):
        rig = runner.Rig.__new__(runner.Rig)
        rig.page = Mock(); rig.page.ev.return_value = False
        rig.report = {}
        with patch.object(runner.time, 'monotonic', side_effect=[0, 0, .4, .8, 1.2]), patch.object(runner.time, 'sleep'):
            with self.assertRaisesRegex(RuntimeError, 'bounded wait failed: False'):
                rig.wait_dom("document.querySelector('.dv-chat strong')?.textContent==='Trip planning'", 1)
        self.assertEqual(rig.page.ev.call_count, 3)
        rig.page.call.assert_not_called()

    def tap_rig(self, response=None, prepared=None, snapshot=None):
        rig = runner.Rig.__new__(runner.Rig)
        rig.page = Mock(); rig.report = {}; rig.save_tap = Mock(); rig.sx = Mock()
        prepared = prepared if prepared is not None else {'ready': True, 'point': [123.5,245.5],
            'evidence': {'viewport': {'width': 400, 'height': 800}}}
        snapshot = snapshot if snapshot is not None else {'events': [
            {'type': kind, 'trusted': True, 'intended': True} for kind in ('touchstart','touchend','click')]}
        rig.page.ev.side_effect = lambda expr: (True if expr == runner.TAP_OBSERVER or expr.startswith('!!document.querySelector')
            else prepared if expr == runner.stable_tap_expression('.dv-chat') else snapshot)
        rig.page.call.return_value = response if response is not None else {'id': 1, 'result': {}}
        return rig

    def test_web_tap_uses_compositor_once_and_requires_observed_touch_click(self):
        rig = self.tap_rig()
        rig.tap('.dv-chat')
        rig.page.call.assert_called_once_with('Input.synthesizeTapGesture', x=123.5, y=245.5,
            duration=50, tapCount=1, gestureSourceType='touch')
        r = rig.report['web_taps'][0]
        self.assertEqual(r['status'], 'TRUSTED_TOUCH_AND_CLICK_OBSERVED')
        self.assertEqual(r['response'], {'id':1,'result':{}})
        self.assertEqual(len(r['after']['events']), 3)
        rig.sx.assert_not_called()

    def test_web_tap_refuses_errors_unstable_or_offscreen_without_bypass(self):
        good = {'ready':True,'point':[10,20],'evidence':{'viewport':{'width':400,'height':800}}}
        for prepared, response, message in ((good, {'error': {'message': 'unsupported'}}, 'compositor tap failed'),
                (good, {}, 'compositor tap failed'),
                ({**good, 'point':[10,900]}, {'result':{}}, 'out of viewport'),
                ({'ready':False,'reason':'moving'}, {'result':{}}, 'not stable')):
            rig = self.tap_rig(response=response, prepared=prepared)
            with self.subTest(prepared=prepared, response=response), self.assertRaisesRegex(RuntimeError, message):
                rig.tap('.dv-chat')
            self.assertEqual(rig.report['web_taps'][0]['status'], 'FAIL')
            self.assertIn('after',rig.report['web_taps'][0])
            self.assertLessEqual(rig.page.call.call_count, 1)
            if message in ('out of viewport','not stable'): rig.page.call.assert_not_called()
            rig.sx.assert_not_called()

    def test_ack_without_real_events_fails_early_and_preserves_evidence(self):
        rig = self.tap_rig(snapshot={'events': [], 'viewport': {'dpr': 2.625}})
        original_wait = runner.wait
        def bounded(predicate, seconds=30):
            if seconds == 3:
                self.assertFalse(predicate())
                raise RuntimeError('bounded wait failed: False')
            return original_wait(predicate, seconds)
        with patch.object(runner, 'wait', side_effect=bounded):
            with self.assertRaisesRegex(RuntimeError, 'bounded wait failed'):
                rig.tap('.dv-chat')
        r = rig.report['web_taps'][0]
        self.assertEqual(r['response']['result'], {})
        self.assertEqual(r['after']['events'], [])
        self.assertEqual(r['status'], 'FAIL')
        rig.page.call.assert_called_once();rig.sx.assert_not_called()

    def test_observed_input_refuses_untrusted_wrong_target_and_incomplete_chain(self):
        good = [{'type':k,'trusted':True,'intended':True} for k in ('touchstart','touchend','click')]
        self.assertTrue(runner.observed_tap({'events':good}))
        for events in ([],good[:2],list(reversed(good)),good+[{'type':'touchcancel'}],
                [{**e,'trusted':False} for e in good],[{**e,'intended':False} for e in good]):
            self.assertFalse(runner.observed_tap({'events':events}))

    def test_domain_failure_keeps_late_events_without_repeating_input(self):
        rig = self.tap_rig();rig.report = {'web_taps':[{'index':1}]}
        rig.page.ev.return_value = False;rig.page.ev.side_effect = None
        with patch.object(runner, 'wait', side_effect=RuntimeError('deadline')):
            with self.assertRaisesRegex(RuntimeError, 'deadline'):
                rig.wait_dom('exact domain')
        self.assertEqual(rig.report['web_taps'][0]['failed_domain_expression'], 'exact domain')
        rig.page.call.assert_not_called();rig.save_tap.assert_called_once()

    def test_tap_receipt_is_on_disk_before_input_can_block(self):
        with tempfile.TemporaryDirectory(prefix='tap-receipt-', dir=os.environ['TMPDIR']) as d:
            rig = self.tap_rig();rig.out = Path(d);rig.save = Mock()
            rig.save_tap = runner.Rig.save_tap.__get__(rig)
            def dispatch(*args, **kwargs):
                r = json.loads((rig.out/'web-tap-001.json').read_text())
                self.assertEqual(r['status'], 'DISPATCHING')
                self.assertEqual(r['x'],123.5)
                raise RuntimeError('transport stalled')
            rig.page.call.side_effect = dispatch
            with self.assertRaisesRegex(RuntimeError,'transport stalled'):rig.tap('.dv-chat')
            self.assertEqual(json.loads((rig.out/'web-tap-001.json').read_text())['status'],'FAIL')

    @unittest.skipUnless(shutil.which('node'), 'Node needed for bounded observer contract replay')
    def test_passive_observer_and_stability_gate_replay(self):
        # Pure JS replay, not browser evidence: deterministic frames move the target,
        # then settle it; wrong-hit/disabled/replaced/active-animation cases time out.
        script = r"""
        const assert=require('node:assert/strict');
        let t=0,mode='settle',scrolled=0,frames=[],timers=new Map(),next=1;
        global.window=global;global.innerWidth=400;global.innerHeight=800;global.devicePixelRatio=2.625;
        global.scrollX=0;global.scrollY=0;global.visualViewport={offsetLeft:0,offsetTop:0,scale:1,width:400,height:800};
        global.performance={now:()=>t};global.getComputedStyle=()=>({visibility:'visible',display:'block'});
        global.requestAnimationFrame=f=>frames.push(f);
        global.setTimeout=(f,ms)=>{const id=next++;timers.set(id,{f,at:t+ms});return id};
        global.clearTimeout=id=>timers.delete(id);
        const listeners=[];global.addEventListener=(type,fn,opts)=>listeners.push({type,fn,opts});
        const e={tagName:'BUTTON',id:'',className:'dv-chat',isConnected:true,
          get disabled(){return mode==='disabled'},parentElement:null,
          contains:target=>target===e,scrollIntoView:()=>scrolled++,
          getAnimations:()=>mode==='animation'?[{playState:'running'}]:[],
          getBoundingClientRect:()=>({x:10,y:mode==='moving'?t/2:mode==='settle'&&t<240?t/2:120,width:200,height:48})};
        const other={};
        global.document={hasFocus:()=>true,visibilityState:'visible',querySelector:s=>s==='.dv-chat'?(mode==='replaced'&&t>0?other:e):null,
          elementFromPoint:()=>mode==='occluded'?other:e};
        eval(OBSERVER);assert.equal(listeners.length,20);
        assert.ok(listeners.every(l=>l.opts.passive===true));
        async function check(m){
          mode=m;t=0;frames=[];timers.clear();let answer;
          eval(STABLE).then(r=>answer=r);
          for(let i=0;i<200&&!answer;i++){
            t+=20;const batch=frames.splice(0);batch.forEach(f=>f());
            for(const [id,a] of [...timers])if(t>=a.at){timers.delete(id);a.f()}
            await Promise.resolve();
          }
          assert.ok(answer,'bounded completion');return answer;
        }
        (async()=>{
          let a=await check('settle');assert.equal(a.ready,true);assert.ok(t>=360);
          assert.equal(scrolled,0);assert.deepEqual(a.point,[110,144]);
          for(const m of ['moving','occluded','disabled','replaced','animation']){
            a=await check(m);assert.equal(a.ready,false,m);assert.ok(t>=3000);assert.ok(a.evidence.samples.length<=64);
          }
          mode='settle';const probe=window.__shareTapProbe;probe.element=e;probe.point=[110,144];
          const event={target:e,changedTouches:[{clientX:110,clientY:144}],isTrusted:true,
            type:'touchstart',timeStamp:100,defaultPrevented:false};
          let canceled=false;event.preventDefault=()=>{canceled=true};event.stopPropagation=()=>{throw Error('must not stop')};
          listeners.filter(l=>l.type==='touchstart').forEach(l=>l.fn(event));
          assert.equal(canceled,false);assert.ok(probe.events.every(r=>r.intended&&r.trusted));
          assert.equal(probe.events.at(-1).x,110);assert.equal(probe.snapshot().viewport.dpr,2.625);
          for(let i=0;i<200;i++)listeners[0].fn({...event,type:'pointerdown',clientX:110,clientY:144});
          assert.equal(probe.events.length,128);
        })().catch(e=>{console.error(e);process.exitCode=1});
        """.replace('OBSERVER',json.dumps(runner.TAP_OBSERVER)).replace('STABLE',json.dumps(runner.stable_tap_expression('.dv-chat')))
        for text in (runner.TAP_OBSERVER,runner.stable_tap_expression('.dv-chat')):
            for bypass in ('.click(', 'dispatchEvent(', '.preventDefault(', '.stopPropagation('):self.assertNotIn(bypass,text)
        result=subprocess.run(['node','-e',script],capture_output=True,text=True,timeout=15)
        self.assertEqual(result.returncode,0,result.stderr)

    def test_sender_manifest_explicitly_allows_independent_source_hash(self):
        manifest = ET.parse(HERE / 'unified-share-sender/AndroidManifest.xml').getroot()
        android = '{http://schemas.android.com/apk/res/android}'
        self.assertEqual(manifest.attrib['package'], runner.SENDER)
        app = manifest.find('application')
        self.assertIsNotNone(app)
        assert app is not None
        self.assertEqual(app.attrib.get(android + 'debuggable'), 'true')
        provider = app.find('provider')
        assert provider is not None
        self.assertEqual(provider.attrib[android + 'authorities'], runner.SENDER + '.files')

    def test_sender_run_as_preflight_is_sender_scoped_and_fails_closed(self):
        rig = runner.Rig.__new__(runner.Rig)
        rig.sx = Mock(return_value='10123\n')
        rig.verify_sender_debug_access()
        rig.sx.assert_called_once_with('run-as qa.unifiedshare.sender id -u')
        for value in ('', '0', '2000', 'run-as: package not debuggable: qa.unifiedshare.sender'):
            rig.sx = Mock(return_value=value)
            with self.subTest(value=value), self.assertRaisesRegex(AssertionError, 'sender run-as'):
                rig.verify_sender_debug_access()
        rig.sx = Mock(side_effect=RuntimeError('package not debuggable'))
        with self.assertRaisesRegex(RuntimeError, 'not debuggable'):
            rig.verify_sender_debug_access()

    def test_fixture_startup_wait_already_retries_connection_refusal(self):
        state = Mock(side_effect=[urllib.error.URLError(ConnectionRefusedError()), {'shares': []}])
        with patch.object(runner.time, 'sleep'):
            self.assertEqual(runner.wait(state, 20), {'shares': []})
        self.assertEqual(state.call_count, 2)

    @unittest.skipUnless(shutil.which('node'), 'Node needed for focused DOM contract replay')
    def test_notification_dom_readback_rejects_background_wrong_thread_and_missing_file(self):
        expression = runner.focused_thread_expression('qa_private_thread', 'genuine.pdf')
        # A small DOM-contract replay, NOT browser/emulator/end-to-end evidence.
        script = """
        const assert = require('node:assert/strict');
        global.window = {__wos:{idx:0,desks:[{focus:'c1',wins:['c1']}],wins:{c1:{app:'chats',thread:'qa_private_thread'}}}};
        global.CSS = {escape:x=>x}; global.innerWidth=400; global.innerHeight=800;
        let box={width:300,height:600,left:0,top:0,right:300,bottom:600};
        let e={innerText:'Synthetic comment one genuine.pdf',getBoundingClientRect:()=>box};
        global.getComputedStyle=()=>({display:'block',visibility:'visible'});
        global.document={querySelector:s=>{assert.equal(s,'[data-chats="c1"] .ch-thread');return e}};
        const check = () => eval(EXPRESSION);
        assert.equal(check(),true);
        window.__wos.wins.c1.thread='wrong';assert.equal(check(),false);
        window.__wos.wins.c1.thread='qa_private_thread';
        window.__wos.desks[0].wins=[];assert.equal(check(),false);
        window.__wos.desks[0].wins=['c1'];
        box={...box,left:500,right:800};assert.equal(check(),false);
        box={...box,left:0,right:300}; e.innerText='different.pdf';assert.equal(check(),false);
        e=null;assert.equal(check(),false);
        """.replace('EXPRESSION', json.dumps(expression))
        result = subprocess.run(['node', '-e', script], capture_output=True, text=True, timeout=15)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_notification_readback_requires_foreground_native_log_and_focused_dom(self):
        for component in ('ai.wizards.os.MainActivity', '.MainActivity'):
            rig = runner.Rig.__new__(runner.Rig)
            rig.sx = Mock(side_effect=[f'topResumedActivity=ActivityRecord{{123 u0 ai.wizards.os.qa/{component} t3}}',
                                      'WizardHandoff: open thread qa_private_thread'])
            rig.page = Mock(); rig.page.ev.return_value = True
            rig.ui = Mock(side_effect=AssertionError('WebView file text is not native XML'))
            self.assertTrue(rig.notification_thread('qa_private_thread', 'genuine.pdf'))
            rig.page.ev.assert_called_once_with(runner.focused_thread_expression('qa_private_thread', 'genuine.pdf'))
            rig.ui.assert_not_called()

    def test_shared_orb_assets_match_canonical_web_bytes(self):
        for name in ('orb.js', 'robert-thread-orb.png', 'robert-listening-galaxy.png'):
            self.assertEqual((HERE.parent / 'web' / name).read_bytes(),
                             (HERE.parent / 'android/app/src/main/assets/assist' / name).read_bytes(), name)

    def test_actual_android_requires_verified_boot(self):
        report = runner.initial_report(dict(revision='unit-only', manifest_sha256='unit-only'), 'unit-only')
        self.assertFalse(report['actual_android'])
        report['emulator'] = {'started': True}
        self.assertFalse(report['actual_android'])
        for sdk, users in [('35', 'RUNNING_LOCKED'), ('34', 'RUNNING_UNLOCKED')]:
            with self.assertRaisesRegex(RuntimeError, 'runtime not ready'):
                runner.record_android_boot(report, sdk, users)
            self.assertFalse(report['actual_android'])
        runner.record_android_boot(report, '35\n', 'User #0: state=RUNNING_UNLOCKED')
        self.assertTrue(report['actual_android'])
        self.assertEqual(report['emulator']['sdk'], '35')

    def test_junit_failure_is_collected_before_build_refusal(self):
        with tempfile.TemporaryDirectory(prefix='unified-junit-', dir=os.environ['TMPDIR']) as d:
            root = Path(d)
            junit = root / 'source/android/app/build/test-results/testDebugUnitTest'
            junit.mkdir(parents=True)
            xml = junit / 'TEST-fixture.xml'
            xml.write_text('<testsuite name="unit.fixture" tests="2" failures="1" errors="0" skipped="0">'
                           '<testcase name="pass"/><testcase name="androidOrbIsTheAppOrb">'
                           '<failure type="ArrayComparisonFailure" message="orb.js differs">stack</failure>'
                           '</testcase></testsuite>')
            counts, failures, hashes = runner.collect_junit(root)
            self.assertEqual(counts, dict(tests=2, failures=1, errors=0, skipped=0))
            self.assertEqual(hashes[str(xml.relative_to(root))], runner.sha(xml))
            self.assertEqual(failures[0]['type'], 'ArrayComparisonFailure')
            with self.assertRaisesRegex(RuntimeError, 'androidOrbIsTheAppOrb: orb.js differs'):
                runner.require_build(1, {'status': 'failed'}, {}, counts, failures)

    def test_build_failure_without_junit_still_has_diagnostic(self):
        with self.assertRaisesRegex(RuntimeError, 'worker exit=1, status=failed'):
            runner.require_build(1, {'status': 'failed', 'error': 'route failed'}, {},
                                 dict(tests=0, failures=0, errors=0, skipped=0), [])

    def test_message_less_assertion_still_has_diagnostic(self):
        self.assertEqual(runner.exception_detail(AssertionError()), 'AssertionError: AssertionError()')
        self.assertEqual(runner.exception_detail(RuntimeError('detail')), 'RuntimeError: detail')

    def test_successful_build_requires_source_identity_and_nonempty_passing_junit(self):
        cfg = dict(revision='unit-only', manifest_sha256='unit-manifest')
        build = dict(status='ok', source_revision=cfg['revision'], source_manifest_sha256=cfg['manifest_sha256'])
        counts = dict(tests=2, failures=0, errors=0, skipped=0)
        runner.require_build(0, build, cfg, counts, [])
        for altered in (dict(tests=0, failures=0, errors=0, skipped=0), dict(counts, failures=1)):
            with self.assertRaisesRegex(RuntimeError, 'JUnit did not pass'):
                runner.require_build(0, build, cfg, altered, [])
        with self.assertRaisesRegex(RuntimeError, 'source identity mismatch'):
            runner.require_build(0, dict(build, source_revision='wrong'), cfg, counts, [])

    def test_full_native_fix_requires_all_tests_and_named_custody_regressions(self):
        with tempfile.TemporaryDirectory(prefix='native-fix-junit-', dir=os.environ['TMPDIR']) as d:
            root = Path(d)
            path = root / 'source/android/app/build/test-results/testDebugUnitTest/TEST-ai.wizards.os.share.UnifiedShareStoreTest.xml'
            path.parent.mkdir(parents=True)
            source = (Path(__file__).resolve().parents[1] / 'android/app/src/test/java/ai/wizards/os/share/UnifiedShareStoreTest.java').read_text()
            names = re.findall(r'@Test public void (\w+)\(', source)
            self.assertEqual(len(names), 6)
            xml = '<testsuite>' + ''.join('<testcase name="%s"/>' % n for n in names) + '</testsuite>'
            path.write_text(xml)
            good = dict(tests=384, failures=0, errors=0, skipped=0)
            runner.require_full_native_fix_junit(root, good)
            for counts in (dict(good, tests=381), dict(good, skipped=1), dict(good, failures=1), dict(good, errors=1)):
                with self.assertRaisesRegex(RuntimeError, 'Full native-fix JUnit mismatch'):
                    runner.require_full_native_fix_junit(root, counts)
            path.write_text(xml.replace('<testcase name="%s"/>' % names[0], ''))
            with self.assertRaisesRegex(RuntimeError, 'custody regression cases missing'):
                runner.require_full_native_fix_junit(root, good)
            path.write_text(xml.replace('</testsuite>', '<testcase name="%s"/></testsuite>' % names[0]))
            with self.assertRaisesRegex(RuntimeError, 'custody regression cases missing'):
                runner.require_full_native_fix_junit(root, good)

    def test_native_promotion_uses_atomic_directory_custody_not_selinux_denied_links(self):
        base = Path(__file__).resolve().parents[1] / 'android/app/src/main/java/ai/wizards/os/share'
        store = (base / 'ShareStore.java').read_text()
        queue = (base / 'ShareQueue.java').read_text()
        self.assertNotIn('Files.createLink(', store + queue)
        self.assertNotIn('Files.copy(', store + queue)
        self.assertIn('queue.promote(new File(root, id), it)', store)
        self.assertIn('Files.move(staged.toPath(), target.toPath(), StandardCopyOption.ATOMIC_MOVE)', queue)
        self.assertLess(queue.index('saveIn(staged, item)'), queue.index('Files.move(staged.toPath()'))
        self.assertIn('require_full_native_fix_junit(root, report[\'junit\'])', inspect.getsource(runner.main))

    # Exact UIAutomator capture from the failed external-boilerplate phase.
    # Embedded to preserve the sealed QA-only source membership; no SDK needed.
    SENDER_XML = '<?xml version=\'1.0\' encoding=\'UTF-8\' standalone=\'yes\' ?><hierarchy rotation="0"><node index="0" text="" resource-id="" class="android.widget.FrameLayout" package="qa.unifiedshare.sender" content-desc="" checkable="false" checked="false" clickable="false" enabled="true" focusable="false" focused="false" scrollable="false" long-clickable="false" password="false" selected="false" bounds="[0,0][1080,2400]"><node index="0" text="" resource-id="" class="android.widget.LinearLayout" package="qa.unifiedshare.sender" content-desc="" checkable="false" checked="false" clickable="false" enabled="true" focusable="false" focused="false" scrollable="false" long-clickable="false" password="false" selected="false" bounds="[0,0][1080,2400]"><node index="0" text="" resource-id="android:id/content" class="android.widget.FrameLayout" package="qa.unifiedshare.sender" content-desc="" checkable="false" checked="false" clickable="false" enabled="true" focusable="false" focused="false" scrollable="false" long-clickable="false" password="false" selected="false" bounds="[0,0][1080,2400]"><node index="0" text="" resource-id="" class="android.widget.LinearLayout" package="qa.unifiedshare.sender" content-desc="" checkable="false" checked="false" clickable="false" enabled="true" focusable="false" focused="false" scrollable="false" long-clickable="false" password="false" selected="false" bounds="[0,0][1080,2400]"><node index="0" text="Synthetic external PDF sender&#10;x.pdf&#10;No owner files or accounts" resource-id="" class="android.widget.TextView" package="qa.unifiedshare.sender" content-desc="" checkable="false" checked="false" clickable="false" enabled="true" focusable="false" focused="false" scrollable="false" long-clickable="false" password="false" selected="false" bounds="[30,150][1050,287]" /><node index="1" text="SHARE SYNTHETIC PDF" resource-id="" class="android.widget.Button" package="qa.unifiedshare.sender" content-desc="" checkable="false" checked="false" clickable="true" enabled="true" focusable="true" focused="false" scrollable="false" long-clickable="false" password="false" selected="false" bounds="[30,287][1050,413]" /></node></node></node></node></hierarchy>'
    SENDER_XML_SHA256 = '520e6150fa7bb2ce13693cac756473e88d6336e283083d16d12106296d482fac'

    def test_sender_saved_real_xml_selects_rendered_uppercase_button(self):
        self.assertEqual(hashlib.sha256(self.SENDER_XML.encode()).hexdigest(), self.SENDER_XML_SHA256)
        self.assertIsNone(runner.native_bounds(self.SENDER_XML, 'Share synthetic PDF'))
        self.assertEqual(runner.native_sender_bounds(self.SENDER_XML), [540, 350])

    def test_sender_saved_real_xml_rejects_wrong_package_and_invisible_controls(self):
        for before, after in (
                ('package="qa.unifiedshare.sender"', 'package="ai.wizards.os.qa"'),
                ('text="SHARE SYNTHETIC PDF"', 'text="SHARE SYNTHETIC PDF EXTRA"'),
                ('class="android.widget.Button"', 'class="android.widget.TextView"'),
                ('clickable="true"', 'clickable="false"'),
                ('enabled="true"', 'enabled="false"'),
                ('text="SHARE SYNTHETIC PDF"', 'visible-to-user="false" text="SHARE SYNTHETIC PDF"'),
                ('text="SHARE SYNTHETIC PDF"', 'displayed="false" text="SHARE SYNTHETIC PDF"'),
                ('bounds="[30,287][1050,413]"', 'bounds="[0,0][0,0]"')):
            with self.subTest(after=after):
                self.assertIsNone(runner.native_sender_bounds(self.SENDER_XML.replace(before, after)))

    def test_sender_casefold_is_exact_and_does_not_weaken_other_native_selectors(self):
        mixed = self.SENDER_XML.replace('SHARE SYNTHETIC PDF', 'Share synthetic PDF')
        self.assertEqual(runner.native_sender_bounds(mixed), [540, 350])
        self.assertIsNone(runner.native_bounds(self.SENDER_XML, 'share synthetic pdf'))

    def test_native_ui_failed_dump_never_reads_preexisting_stale_file(self):
        with tempfile.TemporaryDirectory(prefix='ui-fresh-', dir=os.environ['TMPDIR']) as d:
            rig = runner.Rig.__new__(runner.Rig)
            rig.root = rig.out = Path(d); rig.adb = Path('/unused/adb')
            rig.serial = 'emulator-test'; rig.env = {}
            stale = {'/sdcard/unified-share-ui.xml': self.SENDER_XML}
            reads = []
            def shell(command, **kwargs):
                if command.startswith('test ! -e '):
                    self.assertNotIn(command.removeprefix('test ! -e '), stale)
                    return ''
                reads.append(command)
                return self.SENDER_XML  # old implementation could pass on this
            rig.sx = Mock(side_effect=shell)
            failure = subprocess.CompletedProcess([], 1, 'dump failed', 'UiAutomation: Bad file descriptor')
            with patch.object(runner.subprocess, 'run', return_value=failure) as dump, \
                    patch.object(runner.time, 'sleep'):
                with self.assertRaisesRegex(RuntimeError, 'fresh UIAutomator snapshot unavailable'):
                    rig.ui()
            self.assertEqual(dump.call_count, 3)
            paths = [c.args[0][-1] for c in dump.call_args_list]
            self.assertEqual(len(set(paths)), 3)
            self.assertNotIn('/sdcard/unified-share-ui.xml', paths)
            self.assertEqual(reads, [])
            self.assertIsNone(rig.last_ui_snapshot)
            receipts = [json.loads(x) for x in (rig.out / 'native-ui-observations.jsonl').read_text().splitlines()]
            self.assertEqual(len(receipts), 3)
            self.assertTrue(all(x['status'] == 'FAILED' and x['returncode'] == 1 and
                                x['stderr'] == failure.stderr for x in receipts))

    def test_native_ui_missing_or_malformed_new_file_refuses_despite_dump_exit_zero(self):
        for bad in (RuntimeError('test -s failed'), 'not XML', '<?xml version="1.0"?><hierarchy>'):
            with self.subTest(bad=bad), tempfile.TemporaryDirectory(prefix='ui-invalid-', dir=os.environ['TMPDIR']) as d:
                rig = runner.Rig.__new__(runner.Rig)
                rig.root = rig.out = Path(d); rig.adb = Path('/unused/adb'); rig.serial = 'unit'; rig.env = {}
                def shell(command, **kwargs):
                    if command.startswith('test ! -e '): return ''
                    self.assertTrue(command.startswith('test -s ') and ' && cat ' in command)
                    if isinstance(bad, Exception): raise bad
                    return bad
                rig.sx = Mock(side_effect=shell)
                with patch.object(runner.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0, 'ok', '')), \
                        patch.object(runner.time, 'sleep'), \
                        self.assertRaisesRegex(RuntimeError, 'fresh UIAutomator snapshot unavailable'):
                    rig.ui()
                self.assertIsNone(rig.last_ui_snapshot)
                self.assertEqual(list(rig.out.glob('native-ui-*.xml')), [])

    def test_native_ui_retry_reads_only_successful_unique_path_and_hashes_exact_xml(self):
        with tempfile.TemporaryDirectory(prefix='ui-retry-', dir=os.environ['TMPDIR']) as d:
            rig = runner.Rig.__new__(runner.Rig)
            rig.root = rig.out = Path(d); rig.adb = Path('/unused/adb'); rig.serial = 'unit'; rig.env = {}
            rig.sx = Mock(side_effect=['', '', self.SENDER_XML])
            results = [subprocess.CompletedProcess([], 1, '', 'first failed'),
                       subprocess.CompletedProcess([], 0, 'new dump saved', 'second stderr retained')]
            with patch.object(runner.subprocess, 'run', side_effect=results) as dump, patch.object(runner.time, 'sleep'):
                self.assertEqual(rig.ui(), self.SENDER_XML)
            failed, fresh = [c.args[0][-1] for c in dump.call_args_list]
            self.assertNotEqual(failed, fresh)
            self.assertEqual(rig.sx.call_args_list[-1].args, ('test -s ' + fresh + ' && cat ' + fresh,))
            receipts = [json.loads(x) for x in (rig.out / 'native-ui-observations.jsonl').read_text().splitlines()]
            self.assertEqual([x['status'] for x in receipts], ['FAILED', 'FRESH'])
            self.assertEqual(receipts[-1]['xml_sha256'], self.SENDER_XML_SHA256)
            self.assertEqual(runner.sha(rig.out / receipts[-1]['xml_file']), self.SENDER_XML_SHA256)
            self.assertEqual(rig.last_ui_snapshot['remote_path'], fresh)

    def test_native_ui_collision_and_timeout_cannot_read_stale_xml(self):
        for fail in (RuntimeError('existing path'), subprocess.TimeoutExpired('dump', 1, stderr=b'timeout stderr')):
            with self.subTest(fail=fail), tempfile.TemporaryDirectory(prefix='ui-timeout-', dir=os.environ['TMPDIR']) as d:
                rig = runner.Rig.__new__(runner.Rig)
                rig.root = rig.out = Path(d); rig.adb = Path('/unused/adb'); rig.serial = 'unit'; rig.env = {}
                rig.sx = Mock(side_effect=fail if isinstance(fail, RuntimeError) else None)
                with patch.object(runner.subprocess, 'run', side_effect=fail) as dump, \
                        patch.object(runner.time, 'sleep'), \
                        self.assertRaisesRegex(RuntimeError, 'fresh UIAutomator snapshot unavailable'):
                    rig.ui()
                self.assertTrue(all(c.args[0].startswith('test ! -e ') for c in rig.sx.call_args_list))
                if isinstance(fail, RuntimeError): dump.assert_not_called()
                self.assertIsNone(rig.last_ui_snapshot)
                rows = [json.loads(x) for x in (rig.out / 'native-ui-observations.jsonl').read_text().splitlines()]
                self.assertEqual(len(rows), 3)
                if isinstance(fail, subprocess.TimeoutExpired):
                    self.assertTrue(all('timeout stderr' in row['stderr'] for row in rows))

    def test_sender_waits_for_delayed_requested_case_without_relaunch_or_repeat_tap(self):
        with tempfile.TemporaryDirectory(prefix='sender-delayed-', dir=os.environ['TMPDIR']) as d:
            rig = runner.Rig.__new__(runner.Rig)
            rig.out = Path(d); rig.save = Mock(); rig.report = {'external_intents': []}; self.mock_sender_receipt(rig)
            rig.sx = Mock(return_value='reused activity'); rig.screenshot = Mock()
            rig.ui = Mock(side_effect=[self.SENDER_XML, self.SENDER_XML,
                                      self.SENDER_XML.replace('x.pdf', 'genuine.pdf')])
            rig.connect_page = Mock(side_effect=RuntimeError('after single matching tap'))
            with patch.object(runner.time, 'sleep'), self.assertRaisesRegex(RuntimeError, 'after single matching tap'):
                rig.share('genuine')
            self.assertEqual(rig.ui.call_count, 3)
            self.assertEqual(rig.sx.call_count, 2)  # one launch, one tap
            self.assertEqual(rig.sx.call_args_list[-1].args, ('input tap 540 350',))
            case = json.loads((rig.out / 'sender-0-genuine-case.json').read_text())
            self.assertEqual([x['actual_case'] for x in case['case_observations']],
                             ['boilerplate', 'boilerplate', 'genuine'])
            self.assertEqual(case['status'], 'PRE_TAP')

    def test_sender_permanent_wrong_case_and_snapshot_failure_refuse_at_deadline(self):
        for outcome in (self.SENDER_XML, RuntimeError('fresh UIAutomator snapshot unavailable')):
            with self.subTest(outcome=type(outcome).__name__), \
                    tempfile.TemporaryDirectory(prefix='sender-refuse-', dir=os.environ['TMPDIR']) as d:
                rig = runner.Rig.__new__(runner.Rig)
                rig.out = Path(d); rig.save = Mock(); rig.report = {'external_intents': []}; self.mock_sender_receipt(rig)
                rig.sx = Mock(return_value='reused activity'); rig.screenshot = Mock(); rig.connect_page = Mock()
                rig.ui = Mock(side_effect=outcome) if isinstance(outcome, Exception) else Mock(return_value=outcome)
                times = [0, 0, .1, .4, .4, .5, 30, 30] if isinstance(outcome, str) else [0, 0, .4, .4, 30, 30]
                with patch.object(runner.time, 'monotonic', side_effect=times), \
                        patch.object(runner.time, 'sleep'), \
                        self.assertRaisesRegex(RuntimeError, 'sender case deadline'):
                    rig.share('genuine')
                self.assertEqual(rig.ui.call_count, 2)
                rig.sx.assert_called_once(); rig.connect_page.assert_not_called()
                case = json.loads((rig.out / 'sender-0-genuine-case.json').read_text())
                self.assertEqual(case['status'], 'CASE_WAIT_FAILED')
                self.assertEqual(len(case['case_observations']), 2)
                rig.screenshot.assert_called_once()

    def test_share_taps_saved_sender_button_before_connecting_receiver(self):
        with tempfile.TemporaryDirectory(prefix='sender-tap-', dir=os.environ['TMPDIR']) as d:
            rig = runner.Rig.__new__(runner.Rig)
            rig.out = Path(d); rig.save = Mock()
            rig.report = {'external_intents': []}
            self.mock_sender_receipt(rig)
            rig.sx = Mock(return_value='delivered to existing top-most instance')
            rig.screenshot = Mock(); rig.ui = Mock(return_value=self.SENDER_XML)
            rig.connect_page = Mock(side_effect=RuntimeError('stop after native sender tap'))
            rig.tap_text = Mock(side_effect=AssertionError('generic text selector must not select sender'))
            with self.assertRaisesRegex(RuntimeError, 'stop after native sender tap'):
                rig.share('boilerplate')
            self.assertEqual(rig.sx.call_args_list[0].args,
                             (runner.sender_launch_command('boilerplate', rig.report['sender_attempts'][0]['launch_id']),))
            self.assertEqual(rig.sx.call_args_list[1].args, ('input tap 540 350',))
            self.assertEqual(json.loads((rig.out / 'sender-0-boilerplate-case.json').read_text())['actual_case'], 'boilerplate')
            rig.tap_text.assert_not_called()

    def test_sender_rendered_case_scopes_exact_title_and_visibility(self):
        self.assertEqual(runner.sender_case(self.SENDER_XML), 'boilerplate')
        self.assertEqual(runner.sender_case(self.SENDER_XML.replace('x.pdf', 'genuine.pdf')), 'genuine')
        for before, after in (
                ('package="qa.unifiedshare.sender"', 'package="wrong.package"'),
                ('text="Synthetic external PDF sender', 'visible-to-user="false" text="Synthetic external PDF sender'),
                ('text="Synthetic external PDF sender', 'displayed="false" text="Synthetic external PDF sender'),
                ('x.pdf', 'other.pdf'),
                ('bounds="[30,150][1050,287]"', 'bounds="[0,0][0,0]"')):
            self.assertIsNone(runner.sender_case(self.SENDER_XML.replace(before, after)))

    def test_sender_case_transition_uses_actual_ui_and_refuses_stale_before_tap(self):
        with tempfile.TemporaryDirectory(prefix='sender-transition-', dir=os.environ['TMPDIR']) as d:
            rig = runner.Rig.__new__(runner.Rig)
            rig.out = Path(d); rig.save = Mock(); rig.report = {'external_intents': []}; self.mock_sender_receipt(rig)
            rig.screenshot = Mock(); rig.ui = Mock()
            rig.connect_page = Mock(side_effect=RuntimeError('after real tap seam'))
            # Pure controller replay, no native evidence: initial case, forward,
            # reverse, then a genuine request with the old boilerplate UI.
            for requested, actual in (('boilerplate','boilerplate'), ('genuine','genuine'),
                                      ('boilerplate','boilerplate'), ('genuine','boilerplate')):
                rig.sx = Mock(return_value='Warning: delivered to currently running top-most instance.')
                rig.ui.return_value = self.SENDER_XML.replace('x.pdf', 'genuine.pdf') if actual == 'genuine' else self.SENDER_XML
                if requested == actual:
                    with self.assertRaisesRegex(RuntimeError, 'after real tap seam'):
                        rig.share(requested)
                    self.assertEqual(rig.sx.call_count, 2)
                    rig.report['external_intents'].append({'case':requested})
                else:
                    with patch.object(runner.time, 'monotonic', side_effect=[0, 0, .1, 30, 30]), \
                            patch.object(runner.time, 'sleep'), \
                            self.assertRaisesRegex(RuntimeError, 'sender case deadline'):
                        rig.share(requested)
                    rig.sx.assert_called_once()  # launch only, never a wrong-case tap
                    case = json.loads((rig.out / 'sender-3-genuine-case.json').read_text())
                    self.assertEqual((case['requested_case'],case['actual_case']), ('genuine','boilerplate'))
                    self.assertTrue((rig.out / 'sender-3-genuine.xml').is_file())
                attempt = rig.report['sender_attempts'][-1]
                self.assertEqual((attempt['requested_case'],attempt['actual_case']), (requested,actual))
            self.assertEqual(rig.connect_page.call_count, 3)

    def test_staged_payload_is_saved_before_wrong_subject_refusal(self):
        with tempfile.TemporaryDirectory(prefix='sender-staged-', dir=os.environ['TMPDIR']) as d:
            rig = runner.Rig.__new__(runner.Rig)
            rig.out = Path(d); rig.save = Mock(); rig.report = {'external_intents': []}; self.mock_sender_receipt(rig)
            rig.ui = Mock(return_value=self.SENDER_XML.replace('x.pdf','genuine.pdf'))
            rig.screenshot = Mock(); rig.connect_page = Mock(); rig.sheet = Mock(return_value=True)
            rig.page = Mock(); rig.page.ev.return_value = True
            stale = {'subject':'x.pdf','text':'Emailing x.pdf','items':[{'name':'x.pdf','sha256':'a'*64}]}
            rig.sx = Mock(side_effect=['reused activity','',json.dumps(stale)])
            with self.assertRaises(AssertionError):
                rig.share('genuine')
            self.assertEqual(json.loads((rig.out / 'staged-0-genuine.json').read_text()), stale)
            self.assertEqual(rig.report['external_intents'], [])
            self.assertEqual(rig.report['sender_attempts'][0]['staged_subject'], 'x.pdf')
            self.assertEqual(rig.sx.call_count, 3)  # no hash or send after failure

    def test_sender_launch_flags_and_receipt_parser_contract(self):
        token = 'a' * 32
        command = runner.sender_launch_command('genuine', token)
        self.assertEqual(command, 'am start -W --activity-clear-top --activity-single-top -n '
                         'qa.unifiedshare.sender/.SenderActivity --es fixture_case genuine --es fixture_launch ' + token)
        for mode, launch in [('wrong', token), ('genuine', 'x'), ('genuine', token + ';id')]:
            with self.assertRaises(ValueError): runner.sender_launch_command(mode, launch)
        line = 'event=onNewIntent case=genuine launch=' + token
        self.assertEqual(runner.sender_intent_receipt(line, token),
                         {'event':'onNewIntent','case':'genuine','launch_id':token})
        for log in ('', line.replace(token, 'b'*32), line+'\n'+line,
                    line.replace('onNewIntent','onResume'), line+' extra=owner-data'):
            self.assertIsNone(runner.sender_intent_receipt(log, token))

    def test_explicit_sender_launch_transitions_through_real_controller_and_receipt_parser(self):
        # Controller transport replay, NOT Android execution. Models standard
        # root task bring-forward without claiming that was the prior native cause.
        with tempfile.TemporaryDirectory(prefix='sender-flags-', dir=os.environ['TMPDIR']) as d:
            rig = runner.Rig.__new__(runner.Rig); rig.out = Path(d)
            rig.save = Mock(); rig.screenshot = Mock(); rig.report = {'external_intents': []}
            rig.connect_page = Mock(side_effect=RuntimeError('after verified native tap'))
            state = {'case': None, 'log': '', 'recreate': False}; commands = []
            def transport(command, **kwargs):
                commands.append(command)
                if command.startswith('am start '):
                    parts = command.split(); mode = parts[parts.index('fixture_case')+1]
                    launch = parts[parts.index('fixture_launch')+1]
                    if state['case'] is None or ('--activity-clear-top' in parts and '--activity-single-top' in parts):
                        event = 'onCreate' if state['case'] is None or state['recreate'] else 'onNewIntent'
                        state.update(case=mode, log=f'event={event} case={mode} launch={launch}')
                    return 'Warning: intent has been delivered to currently running top-most instance.'
                if command.startswith('logcat '): return state['log']
                self.assertEqual(command, 'input tap 540 350')
                return ''
            rig.sx = Mock(side_effect=transport)
            rig.ui = Mock(side_effect=lambda **k: self.SENDER_XML.replace('x.pdf','genuine.pdf')
                          if state['case'] == 'genuine' else self.SENDER_XML)
            for mode, event in [('boilerplate','onCreate'), ('genuine','onNewIntent'), ('boilerplate','onNewIntent')]:
                with self.assertRaisesRegex(RuntimeError, 'after verified native tap'): rig.share(mode)
                attempt = rig.report['sender_attempts'][-1]
                self.assertEqual(attempt['native_intent'], {'event':event,'case':mode,'launch_id':attempt['launch_id']})
                self.assertEqual(attempt['actual_case'], mode)
                rig.report['external_intents'].append({'case': mode})
            # A matching UI and misleading shell ACK are insufficient: an old
            # receipt (even the same case) cannot authorize a new launch's tap.
            before = commands.count('input tap 540 350')
            real_command = runner.sender_launch_command
            for broken in ('missing_flags', 'wrong_event', 'wrong_case'):
                state['recreate'] = broken == 'wrong_event'
                def broken_launch(mode, token):
                    if broken == 'missing_flags':
                        return real_command(mode, token).replace('--activity-clear-top --activity-single-top ', '')
                    return real_command('genuine' if broken == 'wrong_case' else mode, token)
                with patch.object(runner, 'sender_launch_command', side_effect=broken_launch), \
                        patch.object(runner.time, 'monotonic', side_effect=[0,0,.1,30,30]), \
                        patch.object(runner.time, 'sleep'), self.assertRaisesRegex(RuntimeError, 'sender case deadline'):
                    rig.share('boilerplate')
                self.assertEqual(commands.count('input tap 540 350'), before)
            self.assertEqual(rig.connect_page.call_count, 3)

    def test_lifecycle_receipt_reads_stored_intent_and_logs_only_synthetic_allowlist(self):
        source = (HERE/'unified-share-sender/SenderActivity.java').read_text()
        body = source.split('private void recordIntent(String event)',1)[1].split('private void renderCase()',1)[0]
        self.assertIn('getIntent().getStringExtra("fixture_case")', body)
        self.assertIn('getIntent().getStringExtra("fixture_launch")', body)
        self.assertIn('launch.matches("[0-9a-f]{32}")', body)
        self.assertIn('"boilerplate".equals(mode) || "genuine".equals(mode)', body)
        self.assertNotIn('toString()', body)
        self.assertIn('android/util/Log.java', runner.sender_lifecycle_sources())

    def test_lifecycle_replay_stages_real_activity_and_bounded_java_commands_only(self):
        # Mock command transport only: never compile on the VPS. The parent's
        # forum run executes these exact sources and the real fixture Activity.
        with tempfile.TemporaryDirectory(prefix='sender-jvm-stage-', dir=os.environ['TMPDIR']) as d:
            rig = runner.Rig.__new__(runner.Rig)
            rig.out = Path(d); work = rig.out / 'sender'; work.mkdir()
            rig.report = {}; rig.save = Mock()
            rig.run = Mock(side_effect=['', 'PASS sender lifecycle boilerplate -> genuine -> boilerplate; title/listener/Intent/URI/grant\n'])
            inputs = HERE / 'unified-share-sender'
            rig.replay_sender_lifecycle(inputs, work)
            self.assertIn(inputs / 'SenderActivity.java', rig.run.call_args_list[0].args[0])
            self.assertEqual(rig.run.call_args_list[0].kwargs['timeout'], 60)
            self.assertEqual(rig.run.call_args_list[1].kwargs['timeout'], 30)
            self.assertEqual(rig.report['sender_lifecycle_replay']['status'], 'PASS_HOST_JVM_SEAM_ONLY')
            self.assertEqual(rig.report['sender_lifecycle_replay']['source_sha256'], runner.sha(inputs/'SenderActivity.java'))
            self.assertEqual(len(list((work/'lifecycle-replay').rglob('*.java'))), len(runner.sender_lifecycle_sources()))

    def test_lifecycle_replay_refuses_compile_and_runtime_failures_with_log(self):
        for outputs in ([RuntimeError('javac failure')], ['', RuntimeError('stale title')], ['', 'wrong success marker']):
            with tempfile.TemporaryDirectory(prefix='sender-jvm-fail-', dir=os.environ['TMPDIR']) as d:
                rig = runner.Rig.__new__(runner.Rig); rig.out = Path(d)
                work = rig.out/'sender'; work.mkdir(); rig.report = {}; rig.save = Mock()
                rig.run = Mock(side_effect=outputs)
                with self.assertRaises((RuntimeError,AssertionError)):
                    rig.replay_sender_lifecycle(HERE/'unified-share-sender',work)
                self.assertNotIn('sender_lifecycle_replay',rig.report)
                self.assertTrue((rig.out/'sender-lifecycle-replay.log').read_text())

    def test_share_keeps_independent_sender_hash_assertion(self):
        with tempfile.TemporaryDirectory(prefix='unified-hash-', dir=os.environ['TMPDIR']) as d:
            for source_hash in ('a' * 64, 'b' * 64):
                rig = runner.Rig.__new__(runner.Rig)
                rig.report = {'external_intents': []}; rig.out = Path(d)
                self.mock_sender_receipt(rig)
                rig.screenshot = Mock(); rig.ui = Mock(return_value=self.SENDER_XML)
                rig.connect_page = Mock(); rig.sheet = Mock(return_value=True); rig.save = Mock()
                rig.page = Mock(); rig.page.ev.return_value = True
                staged = {'subject':'x.pdf', 'text':'Emailing x.pdf',
                          'items':[{'name':'x.pdf','sha256':'a' * 64}]}
                rig.sx = Mock(side_effect=['', '', json.dumps(staged), source_hash + '  files/x.pdf'])
                if source_hash == 'a' * 64:
                    rig.share('boilerplate')
                    self.assertEqual(len(rig.report['external_intents']), 1)
                else:
                    with self.assertRaises(AssertionError):
                        rig.share('boilerplate')
                    self.assertEqual(rig.report['external_intents'], [])
                self.assertEqual(rig.sx.call_args_list[-1].args,
                                 ('run-as qa.unifiedshare.sender sha256sum files/x.pdf',))

    def test_bounds(self):
        xml = '<hierarchy><node text="Share synthetic PDF" bounds="[10,20][110,80]"/></hierarchy>'
        self.assertEqual(runner.native_bounds(xml, 'Share synthetic PDF'), [60, 50])
        self.assertIsNone(runner.native_bounds(xml, 'Private'))

    def test_content_description(self):
        xml = '<hierarchy><node content-desc="Close" bounds="[0,0][20,20]"/></hierarchy>'
        self.assertEqual(runner.native_bounds(xml, 'Close'), [10, 10])

    def test_zero_size_not_tappable(self):
        self.assertIsNone(runner.native_bounds('<hierarchy><node text="Hidden" bounds="[0,0][0,0]"/></hierarchy>', 'Hidden'))

    def prepared(self, root):
        payload = (HERE / 'qa_unified_share_android.py').read_bytes()
        files = {'tools/qa_unified_share_android.py': {'sha256': hashlib.sha256(payload).hexdigest(), 'mode': 420}}
        cfg = dict(host='forum', java='21', cap_sync=False, signing_env=None, expected_signer=None,
                   tasks=[':app:testDebugUnitTest', ':app:assembleDebug'], revision='synthetic-unit-source-only',
                   manifest_sha256=hashlib.sha256(json.dumps(files, sort_keys=True).encode()).hexdigest(), files=files)
        with tarfile.open(root / 'source.tar.gz', 'w:gz') as tf:
            item = tarfile.TarInfo('tools/qa_unified_share_android.py'); item.size = len(payload)
            tf.addfile(item, io.BytesIO(payload))
        (root / 'job.json').write_text(json.dumps(cfg))
        (root / 'worker.py').write_text('# unit fixture only\n')
        return cfg

    def seal(self, root, cfg):
        data = {'revision': cfg['revision'], 'source_manifest_sha256': cfg['manifest_sha256'],
                'files': {n: runner.sha(root / n) for n in ('source.tar.gz', 'job.json', 'worker.py')}}
        p = root / 'seal.json'; p.write_text(json.dumps(data))
        return p, runner.sha(p)

    def case(self, mutation=None, rebuild=False):
        with tempfile.TemporaryDirectory(prefix='unified-controller-', dir=os.environ['TMPDIR']) as d:
            root = Path(d); cfg = self.prepared(root); path, digest = self.seal(root, cfg)
            if mutation:
                mutation(root, cfg)
            if rebuild:
                path, digest = self.seal(root, cfg)
            return runner.verify_seal(root, path, digest)

    def test_good_seal(self):
        _, cfg = self.case()
        self.assertEqual(cfg['host'], 'forum')

    def test_changed_worker_refused(self):
        with self.assertRaisesRegex(RuntimeError, 'staged input drift'):
            self.case(lambda r, c: (r / 'worker.py').write_text('# changed'))

    def test_signing_refused(self):
        def mutate(r, c):
            c['signing_env'] = '/never/read/owner.env'; (r / 'job.json').write_text(json.dumps(c))
        with self.assertRaisesRegex(RuntimeError, 'debug-only'):
            self.case(mutate, rebuild=True)

    def test_release_task_refused(self):
        def mutate(r, c):
            c['tasks'] = [':app:assembleRelease']; (r / 'job.json').write_text(json.dumps(c))
        with self.assertRaisesRegex(RuntimeError, 'Gradle scope'):
            self.case(mutate, rebuild=True)

    def test_archive_drift_refused(self):
        def mutate(r, c):
            with tarfile.open(r / 'source.tar.gz', 'w:gz') as tf:
                item = tarfile.TarInfo('extra'); item.size = 1; tf.addfile(item, io.BytesIO(b'x'))
        with self.assertRaisesRegex(RuntimeError, 'archive/member'):
            self.case(mutate, rebuild=True)

    def test_seal_digest_refused(self):
        with tempfile.TemporaryDirectory(prefix='unified-controller-', dir=os.environ['TMPDIR']) as d:
            root = Path(d); cfg = self.prepared(root); p, _ = self.seal(root, cfg)
            with self.assertRaisesRegex(RuntimeError, 'seal digest'):
                runner.verify_seal(root, p, '0' * 64)

    def test_fixture_thread_contract(self):
        text = (HERE / 'share-fixture.mjs').read_text()
        for name in ('qa_private_thread', 'qa_existing_thread', 'qa_second_thread'):
            self.assertIn('S.sessions.' + name, text)
            self.assertIn(name, (HERE / 'qa_unified_share_android.py').read_text())

    def test_external_sender_native_contract(self):
        text = (HERE / 'unified-share-sender/SenderActivity.java').read_text()
        for token in ('Intent.ACTION_SEND', 'Intent.EXTRA_STREAM', 'Intent.EXTRA_TEXT', 'Emailing x.pdf',
                      'FLAG_GRANT_READ_URI_PERMISSION', 'ai.wizards.os.share.ShareActivity'):
            self.assertIn(token, text)
        manifest = (HERE / 'unified-share-sender/AndroidManifest.xml').read_text()
        self.assertIn('android:exported="false" android:grantUriPermissions="true"', manifest)
        self.assertIn('send.setClipData(ClipData.newRawUri("Synthetic PDF", uri));', text)
        self.assertIn('send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);', text)
        self.assertNotRegex(text, r'\.setClipData\([^;]+\)\s*\.')

    def reuse_fixture(self, base):
        # Synthetic controller inputs only, never an APK or Android acceptance claim.
        old, root = base / 'old', base / 'qa'
        old.mkdir(); root.mkdir()
        cfg = self.prepared(old)
        payloads = {'tools/qa_unified_share_android.py': (HERE / 'qa_unified_share_android.py').read_bytes() + b'\n# old fixture\n',
                    'android/source-marker': b'unit-only native source'}
        cfg['files'] = {n: {'sha256': hashlib.sha256(v).hexdigest(), 'mode': 420} for n, v in payloads.items()}
        cfg['manifest_sha256'] = hashlib.sha256(json.dumps(cfg['files'], sort_keys=True).encode()).hexdigest()
        with tarfile.open(old / 'source.tar.gz', 'w:gz') as tf:
            for n, v in payloads.items():
                entry = tarfile.TarInfo(n); entry.size = len(v); tf.addfile(entry, io.BytesIO(v))
                p = old / 'source' / n; p.parent.mkdir(parents=True, exist_ok=True); p.write_bytes(v)
        (old / 'qa_unified_share_android.py').write_bytes(payloads['tools/qa_unified_share_android.py'])
        (old / 'job.json').write_text(json.dumps(cfg))
        old_seal, digest = self.seal(old, cfg); old_seal.rename(old / 'android-seal.json')
        for n, v in payloads.items():
            p = root / 'source' / n; p.parent.mkdir(parents=True, exist_ok=True); p.write_bytes(v)
        (root / 'source/tools/qa_unified_share_android.py').write_bytes((HERE / 'qa_unified_share_android.py').read_bytes())
        (root / 'qa_unified_share_android.py').write_bytes((HERE / 'qa_unified_share_android.py').read_bytes())
        candidate: dict[str, Any] = dict(cfg, revision='unit-only-qa-repair', files={n: dict(v) for n, v in cfg['files'].items()})
        candidate['files']['tools/qa_unified_share_android.py']['sha256'] = runner.sha(HERE / 'qa_unified_share_android.py')
        candidate['manifest_sha256'] = hashlib.sha256(json.dumps(candidate['files'], sort_keys=True).encode()).hexdigest()
        (root / 'reuse-job.json').write_text(json.dumps(candidate))
        apk = old / 'source' / runner.APK_PATH; apk.parent.mkdir(parents=True); apk.write_bytes(b'NOT-AN-APK-unit-only')
        junit = old / 'source/android/app/build/test-results/testDebugUnitTest/TEST-fixture.xml'
        junit.parent.mkdir(parents=True); junit.write_text('<testsuite tests="381" failures="0" errors="0" skipped="0"/>')
        config = old / 'source/android/app/build/generated/source/buildConfig/debug/BuildConfig.java'
        config.parent.mkdir(parents=True); config.write_text('ORIGIN = ""')
        build = dict(status='ok', source_revision=cfg['revision'], source_manifest_sha256=cfg['manifest_sha256'],
                     artifacts=[dict(path=runner.APK_PATH, sha256=runner.sha(apk), aapt2=dict(package=runner.PKG))])
        (old / 'receipt.json').write_text(json.dumps(build))
        evidence = old / 'android-evidence'; evidence.mkdir(); (evidence / 'build.log').write_text('unit only')
        counts, _, hashes = runner.collect_junit(old)
        prior = dict(build=build, junit=counts, junit_xml_sha256=hashes, apk_sha256=runner.sha(apk),
                     failure_phase='fixture-and-boot', error='void cannot be dereferenced',
                     phases=dict(build=dict(status='PASS', log_sha256=runner.sha(evidence / 'build.log'))))
        (evidence / 'acceptance.json').write_text(json.dumps(prior))
        seal = dict(mode='reuse-build', revision=candidate['revision'], build_revision=cfg['revision'],
                    build_root=str(old), build_seal_sha256=digest, apk_sha256=runner.sha(apk),
                    files={n: runner.sha(root / n) for n in ('reuse-job.json', 'qa_unified_share_android.py')},
                    build_files={n: runner.sha(old / n) for n in ['receipt.json', 'android-evidence/acceptance.json',
                                 'android-evidence/build.log', str(config.relative_to(old)), *hashes]})
        return old, root, seal

    def reuse_case(self, mutate=None):
        with tempfile.TemporaryDirectory(prefix='unified-reuse-', dir=os.environ['TMPDIR']) as d:
            old, root, seal = self.reuse_fixture(Path(d))
            if mutate:
                mutate(old, root, seal)
            p = root / 'reuse-seal.json'; p.write_text(json.dumps(seal))
            # Reuse validation must remain read-only with no Gradle, SDK or subprocess work.
            with patch.object(runner.subprocess, 'run', side_effect=AssertionError('unexpected execution')):
                return runner.verify_reuse_build(root, p, runner.sha(p))

    def test_reuse_good_preserves_381_and_apk(self):
        _, _, build, junit, hashes, _ = self.reuse_case()
        self.assertEqual(build['status'], 'ok')
        self.assertEqual(junit, dict(tests=381, failures=0, errors=0, skipped=0))
        self.assertEqual(len(hashes), 1)

    def test_reuse_missing_receipt_fails_closed(self):
        with self.assertRaises(FileNotFoundError):
            self.reuse_case(lambda o, r, s: (o / 'receipt.json').unlink())

    def test_reuse_changed_receipt_fails_closed(self):
        with self.assertRaisesRegex(RuntimeError, 'reused evidence drift: receipt.json'):
            self.reuse_case(lambda o, r, s: (o / 'receipt.json').write_text('{}'))

    def test_reuse_wrong_receipt_identity_fails_even_when_bound(self):
        def mutate(o, r, s):
            p = o / 'receipt.json'; b = json.loads(p.read_text()); b['source_revision'] = 'wrong'
            p.write_text(json.dumps(b)); s['build_files']['receipt.json'] = runner.sha(p)
        with self.assertRaisesRegex(RuntimeError, 'source identity mismatch'):
            self.reuse_case(mutate)

    def test_reuse_missing_receipt_binding_fails_closed(self):
        with self.assertRaisesRegex(RuntimeError, 'missing reused evidence binding'):
            self.reuse_case(lambda o, r, s: s['build_files'].pop('receipt.json'))

    def test_reuse_changed_apk_fails_closed(self):
        with self.assertRaisesRegex(RuntimeError, 'APK identity mismatch'):
            self.reuse_case(lambda o, r, s: (o / 'source' / runner.APK_PATH).write_bytes(b'changed'))

    def test_reuse_changed_junit_fails_closed(self):
        with self.assertRaisesRegex(RuntimeError, 'reused evidence drift'):
            self.reuse_case(lambda o, r, s: (o / next(n for n in s['build_files'] if n.endswith('.xml'))).write_text('<testsuite tests="381" skipped="1"/>'))

    def test_reuse_changed_old_android_source_fails_closed(self):
        with self.assertRaisesRegex(RuntimeError, 'source drift: android'):
            self.reuse_case(lambda o, r, s: (o / 'source/android/source-marker').write_bytes(b'changed'))

    def test_reuse_candidate_android_change_refused_even_when_bound(self):
        def mutate(o, r, s):
            p = r / 'source/android/source-marker'; p.write_bytes(b'changed')
            c = json.loads((r / 'reuse-job.json').read_text()); c['files']['android/source-marker']['sha256'] = runner.sha(p)
            c['manifest_sha256'] = hashlib.sha256(json.dumps(c['files'], sort_keys=True).encode()).hexdigest()
            (r / 'reuse-job.json').write_text(json.dumps(c)); s['files']['reuse-job.json'] = runner.sha(r / 'reuse-job.json')
        with self.assertRaisesRegex(RuntimeError, 'non-QA source delta'):
            self.reuse_case(mutate)

    def test_reuse_candidate_source_drift_refused(self):
        with self.assertRaisesRegex(RuntimeError, 'source drift'):
            self.reuse_case(lambda o, r, s: (r / 'source/tools/qa_unified_share_android.py').write_bytes(b'changed'))

    def test_reuse_unmanifested_candidate_file_refused(self):
        with self.assertRaisesRegex(RuntimeError, 'unmanifested'):
            self.reuse_case(lambda o, r, s: (r / 'source/extra').write_bytes(b'changed'))

    def test_cleanup_waits_for_owned_serial_but_preserves_foreign(self):
        rig = runner.Rig.__new__(runner.Rig)
        rig.page = rig.fixture = rig.proxy = None
        rig.emulator = Mock(); rig.emulator.poll.return_value = 0
        rig.serial = 'emulator-5580'; rig.adb = 'unit-only-adb'; rig.devtools = 12345
        rig.report = {'emulator': {}}; rig.save = Mock(); rig.adb_cmd = Mock()
        rig.run = Mock(side_effect=['emulator-5580 offline\nemulator-5582 device', 'emulator-5582 device', ''])
        with patch.object(runner.time, 'sleep'):
            rig.close()
        self.assertTrue(rig.report['emulator']['serial_absent'])
        self.assertEqual(rig.report['cleanup_errors'], [])
        rig.adb_cmd.assert_not_called()
        self.assertTrue(rig.report['emulator']['kill_skipped_already_exited'])
        rig.emulator.wait.assert_called_once_with(30)
        self.assertEqual(rig.run.call_count, 3)

    def test_cleanup_running_owned_emulator_still_kills_and_keeps_errors(self):
        rig = runner.Rig.__new__(runner.Rig)
        rig.page = rig.fixture = rig.proxy = None
        rig.emulator = Mock(); rig.emulator.poll.side_effect = [None, 0]
        rig.serial = 'emulator-5580'; rig.adb = 'unit-only-adb'; rig.devtools = 12345
        rig.report = {'emulator': {}}; rig.save = Mock(); rig.run = Mock(return_value='emulator-5582 device')
        rig.adb_cmd = Mock(side_effect=RuntimeError('owned kill refused'))
        rig.close()
        rig.adb_cmd.assert_called_once_with('emu', 'kill', timeout=20)
        self.assertEqual(rig.report['cleanup_errors'], ['owned kill refused'])
        self.assertTrue(rig.report['emulator']['serial_absent'])

    def test_cleanup_serial_timeout_is_failure(self):
        rig = runner.Rig.__new__(runner.Rig)
        rig.page = rig.fixture = rig.proxy = None
        rig.emulator = Mock(); rig.emulator.poll.return_value = 0
        rig.serial = 'emulator-5580'; rig.adb = 'unit-only-adb'; rig.devtools = 12345
        rig.report = {'emulator': {}}; rig.save = Mock(); rig.adb_cmd = Mock(); rig.run = Mock()
        with patch.object(runner, 'wait', side_effect=RuntimeError('deadline')) as bounded:
            rig.close()
        self.assertFalse(rig.report['emulator']['serial_absent'])
        self.assertIn('bounded wait', rig.report['cleanup_errors'][0])
        self.assertEqual(bounded.call_args.args[1], 30)

    def test_both_native_origin_hooks_before_first_launch(self):
        text = (HERE / 'qa_unified_share_android.py').read_text()
        install = text.index("rig.adb_cmd('install', '-r', '-g', apk)")
        launch = text.index("rig.sx('am start -W -n ' + PKG", install)
        configure = text[install:launch]
        self.assertIn('files/qa_home.txt', configure)
        self.assertIn('files/qa_origin.txt', configure)

    def test_host_guard_refuses_vps(self):
        import subprocess
        result = subprocess.run(['python3', str(HERE / 'qa_unified_share_android.py'), '--seal', '/unused', '--seal-sha256', '0' * 64], capture_output=True, text=True)
        if os.uname().nodename != 'forum':
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('forum staged runner only', result.stderr)


if __name__ == '__main__':
    unittest.main()
