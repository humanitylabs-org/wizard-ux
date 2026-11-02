"""Synthetic controller regressions only, never native accessibility acceptance."""
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch
import qa_dictation_insertion_native as native
from test_qa_dictation_insertion_native import record

READY = ('11-02 04:15:00.664 594 673 I UiAutomationManager: Registering '
         'UiTestAutomationService (id=com.android.server.accessibility/UiAutomation, flags=0x1) when called by user 0')


class AccessibilityLifecycleTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def test_real_framework_registration_is_ready(self):
        self.assertTrue(native.automation_ready(READY))

    def test_default_automation_suppresses(self):
        self.assertFalse(native.automation_ready(READY.replace('0x1','0x0')))

    def test_stale_nonsuppressing_registration_cannot_hide_later_suppression(self):
        self.assertFalse(native.automation_ready(READY+'\n'+READY.replace('0x1','0x0')))

    def test_similar_nonframework_text_is_not_ready(self):
        for text in ('flags=1','',READY.replace('UiAutomationManager','other'),READY.replace('/UiAutomation','/Wizard')):
            self.assertFalse(native.automation_ready(text))

    def test_all_original_method_names_and_lane_selected(self):
        for lane in ('baseline','rejected','candidate'):
            methods = ['one','two']
            argv = native.instrumentation_argv(['adb','-s','synthetic'],methods,lane)
            self.assertIn(native.CLASS+'#one,'+native.CLASS+'#two',argv)
            self.assertEqual('candidate' if lane=='candidate' else 'control',argv[argv.index('lane')+1])
            self.assertNotIn('--no-restart',argv)

    def fixture_process(self, events, payload, *, polls=None, failure=None):
        class Process:
            returncode = None
            def __init__(self, argv, **kwargs):
                events.append(('spawn',argv)); kwargs['stdout'].write(payload); kwargs['stdout'].flush()
                self.polls = iter(polls or [None])
            def poll(self):
                return next(self.polls,None) if self.returncode is None else self.returncode
            def wait(self,timeout):
                if failure and self.returncode is None: raise failure
                self.returncode=0; return 0
            def terminate(self): events.append(('terminate',)); self.returncode=-15
            def kill(self): events.append(('kill',)); self.returncode=-9
        return Process

    def test_disable_then_instrument_then_ready_then_enable_no_apk_rebuild(self):
        events=[]; logs=iter(['',READY])
        def command(argv,**kwargs):
            events.append(('command',argv))
            if 'logcat' in argv and '-d' in argv: return next(logs)
            return 'synthetic diagnostic'
        with patch.object(native.subprocess,'Popen',self.fixture_process(events,record('a'))), patch.object(native.time,'sleep'):
            error=native.instrument(command,['adb'],['a'],'baseline',self.root,{})
        self.assertIsNone(error)
        spawn=next(i for i,e in enumerate(events) if e[0]=='spawn')
        enable=next(i for i,e in enumerate(events) if e[0]=='command' and e[1][-2:]==['enabled_accessibility_services',native.PKG+'/ai.wizards.os.everywhere.WizardKeyboardService'])
        reads=[i for i,e in enumerate(events) if e[0]=='command' and 'logcat' in e[1] and '-d' in e[1]]
        self.assertLess(spawn,reads[0]); self.assertLess(reads[1],enable)
        self.assertTrue(any(e[0]=='command' and e[1][-2:]==['enabled_accessibility_services','null'] for e in events[:spawn]))
        self.assertEqual(record('a'),(self.root/'baseline-instrumentation.txt').read_text())

    def test_early_exit_keeps_protocol_and_never_enables(self):
        events=[]
        def command(argv,**kwargs): events.append(('command',argv)); return ''
        with patch.object(native.subprocess,'Popen',self.fixture_process(events,record('a',-2,'service missing'),polls=[0])):
            error=native.instrument(command,['adb'],['a'],'baseline',self.root,{})
        self.assertIn('exited before',error)
        self.assertFalse(any(e[0]=='command' and e[1][-1]==native.PKG+'/ai.wizards.os.everywhere.WizardKeyboardService' for e in events))
        self.assertIn('service missing',(self.root/'baseline-instrumentation.txt').read_text())

    def test_timeout_stops_device_instrumentation_and_host_child(self):
        events=[]
        def command(argv,**kwargs): events.append(('command',argv)); return READY
        with patch.object(native.subprocess,'Popen',self.fixture_process(events,record('a'),failure=subprocess.TimeoutExpired('synthetic',1))):
            error=native.instrument(command,['adb'],['a'],'baseline',self.root,{})
        self.assertIn('TimeoutExpired',error)
        self.assertTrue(any(e[0]=='command' and 'force-stop' in e[1] for e in events))
        self.assertIn(('terminate',),events)

    def collect(self, text, *, lane='baseline', transport=None):
        def instrument(*args,**kwargs):
            (self.root/(lane+'-instrumentation.txt')).write_text(text)
            return transport
        def command(argv,**kwargs):
            if argv[-1]=='files/dictation-fixture.json': raise RuntimeError('optional missing')
            return b'png' if kwargs.get('binary') else 'synthetic'
        with patch.object(native,'instrument',instrument):
            return native.collect_lane(command,['adb'],lane,['a'],self.root,{})

    def test_missing_optional_editor_cannot_hide_primary_assertion(self):
        result=self.collect(record('a',-2,'real accessibility service connected fixture=missing'))
        self.assertEqual('failed',result['status'])
        self.assertIn('real accessibility service connected',result['validation_error'])
        self.assertIn('optional missing',result['diagnostic_errors']['editor.json'])
        self.assertIn('real accessibility',result['records'][0]['stack'])
        self.assertTrue((self.root/'baseline-accessibility.txt').is_file())

    def test_optional_diagnostic_failure_does_not_turn_valid_protocol_into_test_failure(self):
        result=self.collect(record('a'))
        self.assertEqual('ok',result['status'])
        self.assertIn('editor.json',result['diagnostic_errors'])

    def test_setup_failure_is_never_expected_negative_control(self):
        self.assertEqual('failed',self.collect(record('a',-2,'real accessibility service connected'),lane='rejected')['status'])

    def test_decisive_negative_assertion_unchanged(self):
        self.assertEqual('ok',self.collect(record('a',-2,'java.lang.AssertionError: exact field text'),lane='rejected')['status'])

    def test_good_protocol_cannot_hide_transport_error(self):
        result=self.collect(record('a'),transport='synthetic timeout')
        self.assertEqual('failed',result['status']); self.assertEqual('synthetic timeout',result['transport_error'])

    def test_each_diagnostic_continues_after_failure(self):
        calls=[]
        def command(argv,**kwargs): calls.append(argv); raise RuntimeError('synthetic')
        errors=native.diagnostics(command,['adb'],'baseline',self.root)
        self.assertEqual(7,len(calls)); self.assertEqual(7,len(errors))

    def test_aggregate_requires_all_lanes_and_does_not_accept_failed_baseline(self):
        cases={lane:{'status':'ok'} for lane in ('baseline','rejected','candidate')}
        native.require_lanes(cases)
        cases['baseline']['status']='failed'
        with self.assertRaisesRegex(AssertionError,'baseline'): native.require_lanes(cases)
        del cases['baseline']
        with self.assertRaisesRegex(AssertionError,'baseline'): native.require_lanes(cases)


    def test_baseline_failure_still_executes_both_other_lanes_and_stops_guest(self):
        from unittest.mock import MagicMock
        config={'source_revision':'synthetic','candidate_cases':['a'],'emulator_port':5756}
        for lane in ('baseline','rejected','candidate'):
            path=self.root/(lane+'.json')
            path.write_text(json.dumps({'status':'ok','source_revision':lane,'job':str(self.root)}))
            config[lane]={'receipt':str(path),'revision':lane}
        cfg=self.root/'packet.json'; cfg.write_text(json.dumps(config))
        lint=self.root/'source/android/app/build/reports/lint-results-debug.xml'
        lint.parent.mkdir(parents=True); lint.write_text('<issues/>')
        lanes=[]
        def collect(module,command,adb,lane,*args,**kwargs):
            lanes.append(lane); return {'status':'failed' if lane=='baseline' else 'ok'}
        def command(argv,**kwargs):
            return type('Result',(),{'returncode':0,'stdout':'1' if 'getprop' in argv else '', 'stderr':''})()
        emulator=MagicMock(); emulator.poll.side_effect=[None,0]
        out=self.root/'native'
        with patch.object(native,'BASE',self.root), patch.object(native,'validated_queue_fd',return_value=3), \
             patch.object(native.shutil,'disk_usage',return_value=type('Disk',(),{'free':300*1024**3})()), \
             patch.object(native.socket,'socket'), patch.object(native.subprocess,'run',side_effect=command), \
             patch.object(native.subprocess,'Popen',return_value=emulator), \
             patch.object(native,'artifact',return_value=(self.root/'not-an-apk',{})), \
             patch.object(native,'collect_isolated_lane',side_effect=collect), \
             patch.object(native,'editor_contract',return_value={}), \
             patch.object(native,'unit_census',return_value={'tests':410}):
            with self.assertRaisesRegex(AssertionError,'baseline'): native.run(cfg,out)
        self.assertEqual(['baseline','rejected','candidate'],lanes)
        receipt=json.loads((out/'receipt.json').read_text())
        self.assertTrue(receipt['stopped_emulator'])
        self.assertEqual('failed',receipt['status'])
        self.assertEqual(3,len(receipt['cases']))


class NativeResumeCustodyTests(unittest.TestCase):
    def setUp(self):
        import qa_dictation_native_resume as resume
        self.resume=resume
        self.temp=tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.base=Path(self.temp.name); self.root=self.base/'qa/new'; self.root.mkdir(parents=True)
        self.old=self.base/'qa/old'; self.old.mkdir()
        self.packet={'source_revision':resume.PRODUCT,'candidate_cases':['case'+str(i) for i in range(27)],
                     'baseline':{'revision':'baseline'},'rejected':{'revision':'rejected'},'candidate':{'revision':resume.PRODUCT},
                     'control_overlay':{'unchanged':'sha'},'workers':{'candidate':'old-only'}}
        (self.old/'packet.json').write_text(json.dumps(self.packet)); (self.old/'seal.json').write_text('{"files":{}}')
        original=self.old/'evidence'; original.write_text('original failure')
        self.originals={str(original):resume.digest(original)}
        for name in resume.MEMBERS: (self.root/name).write_text('synthetic sealed controller')
        packet=dict(self.packet,workers={})
        (self.root/'packet.json').write_text(json.dumps(packet))
        self.custody={'old_root':str(self.old),'product_revision':resume.PRODUCT,'fresh_builds':[],
                      'apk_count':6,'preserved_originals':self.originals}
        (self.root/'custody.json').write_text(json.dumps(self.custody))
        (self.root/'diagnosis.json').write_text('{}')
        self.reseal()
        patched=patch.object(resume,'closure',return_value=self.originals); patched.start(); self.addCleanup(patched.stop)

    def reseal(self):
        files=dict(self.originals)
        files.update({str(p):self.resume.digest(p) for p in self.root.iterdir() if p.is_file() and p.name!='seal.json'})
        self.resume.write(self.root/'seal.json',{'worker_base':str(self.base),'files':files})

    def test_exact_native_only_packet_preserves_methods_overlay_and_revisions(self):
        self.assertEqual({},self.resume.verify(self.root)['workers'])

    def test_old_failure_log_drift_refused(self):
        Path(next(iter(self.originals))).write_text('lost root failure')
        with self.assertRaisesRegex(ValueError,'drift'): self.resume.verify(self.root)

    def test_product_revision_drift_refused_even_when_resealed(self):
        p=self.root/'packet.json'; obj=json.loads(p.read_text()); obj['candidate']['revision']='different'; p.write_text(json.dumps(obj))
        (self.root/'seal.json').unlink(); self.reseal()
        with self.assertRaisesRegex(ValueError,'changed'): self.resume.verify(self.root)

    def test_controller_not_in_seal_refused(self):
        p=self.root/'seal.json'; obj=json.loads(p.read_text()); del obj['files'][str(self.root/'qa_dictation_insertion_native.py')]
        p.write_text(json.dumps(obj))
        with self.assertRaisesRegex(ValueError,'incomplete'): self.resume.verify(self.root)

    def test_rebuild_worker_injection_refused(self):
        p=self.root/'packet.json'; obj=json.loads(p.read_text()); obj['workers']={'candidate':'rebuild'}; p.write_text(json.dumps(obj))
        (self.root/'seal.json').unlink(); self.reseal()
        with self.assertRaisesRegex(ValueError,'changed'): self.resume.verify(self.root)


if __name__ == '__main__': unittest.main()
