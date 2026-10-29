#!/usr/bin/env python3
"""Cheap DOM-contract regressions. Not browser/native acceptance."""
import importlib.util
import json
from pathlib import Path
import subprocess
import unittest

ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('notification_runner', ROOT / 'qa_unified_share_android.py')
assert spec is not None and spec.loader is not None
r = importlib.util.module_from_spec(spec)
spec.loader.exec_module(r)


class NotificationPredicateTest(unittest.TestCase):
    def replay(self, mutation, expected):
        expr = r.focused_thread_snapshot_expression('new_thread', 'x.pdf')
        script = r'''
const assert=require('node:assert/strict');
global.window={__wos:{idx:0,desks:[{focus:'c1',wins:['c1']}],wins:{c1:{app:'chats',thread:'new_thread'}}}};
global.innerWidth=400;global.innerHeight=800;global.CSS={escape:x=>x};
let rect={width:300,height:600,left:0,top:0,right:300,bottom:600};
let style={display:'block',visibility:'visible',opacity:'1'};
let occluded=false,focused=true,visible='visible',comment='Synthetic comment two',filename='x.pdf';
let bodyOnly=false,owner='c1';
const e={innerText:'x.pdf Synthetic comment two',getBoundingClientRect:()=>rect,parentElement:null,
 contains:x=>[e,bub,file,p].includes(x),querySelectorAll:s=>s==='.ch-msgs .msg.u .bub'?[bub]:[],
 closest:()=>({dataset:{chats:owner}})};
const file={textContent:filename,innerText:filename,parentElement:e,getBoundingClientRect:()=>rect,contains:x=>x===file};
const p={textContent:comment,innerText:comment,parentElement:e,getBoundingClientRect:()=>rect,contains:x=>x===p};
const bub={innerText:comment,parentElement:e,getBoundingClientRect:()=>rect,
 querySelectorAll:s=>s==='.mcard .mn b'?(bodyOnly?[]:[file]):[p],contains:x=>[bub,file,p].includes(x)};
global.getComputedStyle=()=>style;
global.document={hasFocus:()=>focused,get visibilityState(){return visible},
 documentElement:{classList:{contains:()=>true}},
 querySelector:()=>e,elementFromPoint:()=>occluded?{}:file};
// Filename and comment occupy different points in a real DOM. This model maps
// hit tests to the element being measured without pretending to be Chromium.
file.getBoundingClientRect=()=>({...rect,top:10,bottom:30,height:20});
p.getBoundingClientRect=()=>({...rect,top:40,bottom:60,height:20});
document.elementFromPoint=(x,y)=>occluded?{}:(y<35?file:p);
MUTATION
const snapshot=eval(EXPRESSION);
assert.equal(snapshot.focused,focused); // diagnostic only, not visibility
assert.equal(snapshot.ready,EXPECTED);
if (!snapshot.ready) assert.ok(snapshot.rejected_reason);
'''.replace('MUTATION', mutation).replace('EXPRESSION', json.dumps(expr)).replace('EXPECTED', str(expected).lower())
        got = subprocess.run(['node', '-e', script], text=True, capture_output=True, timeout=10)
        self.assertEqual(got.returncode, 0, got.stderr)

    def test_exact_body_file_and_comment_pass(self): self.replay('', True)
    def test_occluding_old_thread_cannot_pass(self): self.replay('occluded=true;', False)
    def test_visible_webview_without_keyboard_focus_passes(self): self.replay('focused=false;', True)
    def test_hidden_document_cannot_pass(self): self.replay("visible='hidden';", False)
    def test_hidden_document_without_keyboard_focus_cannot_pass(self): self.replay("focused=false;visible='hidden';", False)
    def test_other_window_without_keyboard_focus_cannot_pass(self): self.replay("focused=false;window.__wos.desks[0].focus='old';", False)
    def test_filename_only_in_composer_cannot_pass(self): self.replay('bodyOnly=true;', False)
    def test_wrong_comment_cannot_pass(self): self.replay("p.innerText=p.textContent='Synthetic comment one';", False)
    def test_wrong_file_cannot_pass(self): self.replay("file.textContent='genuine.pdf';", False)
    def test_wrong_document_scroll_owner_cannot_pass(self): self.replay("owner='old';", False)
    def test_transparent_thread_cannot_pass(self): self.replay("style.opacity='0';", False)
    def test_wrong_thread_cannot_pass(self): self.replay("window.__wos.wins.c1.thread='old';", False)
    def test_offscreen_thread_cannot_pass(self): self.replay('rect.left=500;rect.right=800;', False)


class PacketSealTest(unittest.TestCase):
    def setUp(self):
        import tempfile
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        spec = importlib.util.spec_from_file_location('focused_packet', ROOT / 'qa_share_notification.py')
        assert spec is not None and spec.loader is not None
        self.packet = importlib.util.module_from_spec(spec); spec.loader.exec_module(self.packet)
        (self.root / 'source/android').mkdir(parents=True)
        (self.root / 'source/android/input').write_text('native')
        for name in ('app.apk', 'sender.apk'): (self.root / name).write_text(name)
        acceptance = {'junit': {'tests': 384, 'failures': 0, 'errors': 0, 'skipped': 0},
                      'apk_sha256': self.packet.sha(self.root / 'app.apk'),
                      'sender_apk_sha256': self.packet.sha(self.root / 'sender.apk')}
        (self.root / 'old.json').write_text(json.dumps(acceptance))
        self.seal = {'root': str(self.root), 'runner_sha256': self.packet.sha(ROOT / 'qa_share_notification.py'),
                     'source_files': self.packet.inventory(self.root / 'source'), 'inherited_files': {},
                     'old_acceptance': str(self.root / 'old.json'), 'old_job': str(self.root / 'job.json'),
                     'apk': str(self.root / 'app.apk'), 'sender_apk': str(self.root / 'sender.apk'),
                     'android_tree': 'abc', 'inherited_android_tree': 'abc'}
        (self.root / 'job.json').write_text(json.dumps({'files': self.seal['source_files']}))
        self.seal['inherited_files'] = {str(self.root / name): self.packet.sha(self.root / name)
                                        for name in ('old.json', 'job.json', 'app.apk', 'sender.apk')}
        self.freeze()

    def freeze(self):
        (self.root / 'seal.json').write_text(json.dumps(self.seal))
        self.digest = self.packet.sha(self.root / 'seal.json')

    def test_valid_reuse(self): self.packet.verify(self.root, self.digest)
    def test_changed_apk_refused(self):
        (self.root / 'app.apk').write_text('changed')
        with self.assertRaisesRegex(ValueError, 'evidence drift'): self.packet.verify(self.root, self.digest)
    def test_new_unbound_source_refused(self):
        (self.root / 'source/extra').write_text('unexpected')
        with self.assertRaisesRegex(ValueError, 'export drift'): self.packet.verify(self.root, self.digest)
    def test_bound_native_delta_still_refused(self):
        (self.root / 'source/android/input').write_text('changed')
        self.seal['source_files'] = self.packet.inventory(self.root / 'source'); self.freeze()
        with self.assertRaisesRegex(ValueError, 'native member'): self.packet.verify(self.root, self.digest)
    def test_tree_id_mismatch_refused(self):
        self.seal['android_tree'] = 'different'; self.freeze()
        with self.assertRaisesRegex(ValueError, 'native tree'): self.packet.verify(self.root, self.digest)
    def test_seal_drift_refused(self):
        (self.root / 'seal.json').write_text('{}')
        with self.assertRaisesRegex(ValueError, 'seal hash'): self.packet.verify(self.root, self.digest)

    def test_capture_has_no_blind_preliminary_wait_or_input_after_open(self):
        from unittest.mock import Mock, patch
        events = []
        rig = Mock(); rig.out = self.root
        rig.ui.return_value = 'Sent · tap to open the chat'
        rig.page.call.return_value = {'result': {'data': ''}}
        rig.adb_cmd.return_value = ''
        rig.notification_thread.side_effect = AssertionError('blind boolean pre-wait')
        rig.tap_text.side_effect = lambda text: events.append('tap-notification')
        rig.screenshot.side_effect = lambda label: events.append(label)
        def saved_snapshot(rig, thread, filename, label):
            events.append(label)
            return {'ready': True, 'focused': label.endswith('before')}
        with patch.object(self.packet, 'stable_snapshot', side_effect=saved_snapshot):
            result = self.packet.capture_notification(rig, 'new_thread', 'x.pdf', 'new')
        self.assertTrue(result['snapshot']['ready'])
        self.assertEqual(events, ['new-before-tap', 'tap-notification', 'new-before', 'new-opened', 'new-after', 'new-settled'])
        rig.tap_text.assert_called_once_with('Sent · tap to open the chat')
        rig.tap.assert_not_called()

    def test_stable_capture_delegates_to_persisted_native_and_dom_wait(self):
        from unittest.mock import Mock
        rig = Mock()
        result = self.packet.stable_snapshot(rig, 'new_thread', 'x.pdf', 'new-before')
        rig.notification_thread.assert_called_once_with('new_thread', 'x.pdf', 'new-before', stable_seconds=.8)
        self.assertIs(result, rig.notification_thread.return_value)


if __name__ == '__main__': unittest.main()
