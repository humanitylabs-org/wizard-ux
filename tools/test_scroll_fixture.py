"""Lightweight fixture-server checks. No SDK, emulator, or live service access."""
import http.client
import json
import unittest
from qa_scroll_fixture import serve

class FixtureTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls): cls.server = serve(0); cls.port = cls.server.server_address[1]
    @classmethod
    def tearDownClass(cls): cls.server.shutdown(); cls.server.server_close()
    def request(self, method, path):
        c = http.client.HTTPConnection('127.0.0.1',self.port)
        c.request(method,path);r=c.getresponse();data=r.read();status=r.status;c.close()
        return status,data
    def test_real_shell_assets(self):
        for p,marker in [('index.html',b'core/chats.js'),('core/chats.js',b'wos-doc-scroll'),('core/chats.css',b'overflow-y: auto')]:
            status,body=self.request('GET','/wizard-os-home/'+p)
            self.assertEqual(status,200);self.assertIn(marker,body)
    def test_every_unsafe_method_blocked(self):
        for method in ('POST','PUT','PATCH','DELETE','OPTIONS'):
            self.assertEqual(self.request(method,'/wizard/hermes/api/sessions')[0],403)
    def test_head_has_no_body(self): self.assertEqual(self.request('HEAD','/wizard-os-home/index.html'),(200,b''))
    def test_long_and_short_synthetic_history(self):
        for sid,n in [('qa_doc_0',28),('qa_doc_1',2)]:
            status,body=self.request('GET','/wizard/hermes/api/sessions/'+sid+'/messages')
            self.assertEqual(status,200);rows=json.loads(body)['data'];self.assertEqual(len(rows),n)
            self.assertEqual(rows[-1]['content'],'ROW '+str(n//2-1).zfill(2))
    def test_traversal_never_serves_repo_files(self):
        status,body=self.request('GET','/wizard-os-home/../package.json')
        self.assertEqual(status,200);self.assertEqual(json.loads(body),{})

if __name__=='__main__':unittest.main()
