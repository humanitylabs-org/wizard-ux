"""Control-plane tests: run without Android SDK, Gradle, or an emulator."""
import json
import os
import pathlib
import subprocess
import tempfile
import unittest
from unittest.mock import patch

from qa_device_packages import Port, worker_lock


class NodePage:
    def __init__(self, mutate=''):
        self.mutate = mutate
    def ev(self, expression):
        source = """
        const window = {};
        const port = {postMessage(s) {
          const req = JSON.parse(s);
          if (!req.id || typeof req.id !== 'string') throw Error('missing id');
          if (req.method.startsWith('device.') && req.v !== 1) throw Error('missing v1');
          let reply = {v:1, id:req.id, ok:true, result:{method:req.method, params:req.params}};
          %s
          this.onmessage({data:JSON.stringify({id:'unrelated',ok:false})});
          this.onmessage({data:JSON.stringify(reply)});
        }};
        window.wizardDevicePort = window.wizardAppsPort = port;
        (%s).then(x => console.log(JSON.stringify(x)));
        """ % (self.mutate, expression)
        return json.loads(subprocess.check_output(['node', '-e', source], text=True, timeout=15))


class ProtocolTest(unittest.TestCase):
    def test_new_envelope_and_params(self):
        receipt = {}
        result = Port(NodePage(), receipt).rpc('install', {'package': 'example.app'})
        self.assertEqual(result, {'method': 'device.packages.install', 'params': {'package': 'example.app'}})
        self.assertEqual(receipt['rpc'][0]['request']['id'], receipt['rpc'][0]['reply']['id'])
        self.assertEqual(receipt['rpc'][0]['request']['v'], 1)
    def test_capabilities_is_not_prefixed(self):
        self.assertEqual(Port(NodePage(), {}).rpc('device.capabilities')['method'], 'device.capabilities')
    def test_legacy_shape(self):
        r = {}; Port(NodePage(), r, 'legacy').rpc('status')
        self.assertNotIn('v', r['rpc'][0]['request'])
        self.assertEqual(r['rpc'][0]['request']['method'], 'status')
    def test_bad_version(self):
        with self.assertRaisesRegex(AssertionError, 'version'):
            Port(NodePage('reply.v=2;'), {}).rpc('status')
    def test_error_response(self):
        with self.assertRaisesRegex(AssertionError, 'ok/result'):
            Port(NodePage("reply.ok=false; reply.error='refused'; delete reply.result;"), {}).rpc('status')
    def test_missing_result(self):
        with self.assertRaisesRegex(AssertionError, 'ok/result'):
            Port(NodePage('delete reply.result;'), {}).rpc('status')
    def test_success_cannot_also_carry_error(self):
        with self.assertRaisesRegex(AssertionError, 'ok/result'):
            Port(NodePage("reply.error='wrong';"), {}).rpc('status')
    def test_inherited_worker_lease(self):
        with tempfile.TemporaryDirectory() as d:
            path = pathlib.Path(d) / 'worker.lock'
            with path.open('a') as f, patch.dict(os.environ, WIZARD_HEAVY_LOCK_FD=str(f.fileno())):
                with worker_lock(path): pass
    def test_reject_wrong_inherited_lease(self):
        with tempfile.TemporaryDirectory() as d:
            path = pathlib.Path(d) / 'worker.lock'; path.touch()
            with (path.parent / 'other').open('a') as f, patch.dict(os.environ, WIZARD_HEAVY_LOCK_FD=str(f.fileno())):
                with self.assertRaisesRegex(RuntimeError, 'identity'):
                    with worker_lock(path): pass


if __name__ == '__main__': unittest.main()
