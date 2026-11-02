"""Small real-process, synthetic-lock checks; no production lock or Android workload."""
import fcntl
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
import qa_queue_lease as lease
import qa_dictation_packet as packet

CHILD = "import os,json; f=int(os.environ['WIZARD_HEAVY_LOCK_FD']); s=os.fstat(f); print(json.dumps([f,s.st_dev,s.st_ino]))"


class LeaseTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.lock = self.root/'synthetic.lock'
        self.file = self.lock.open('w+')
        self.addCleanup(self.file.close)
        self.fd = self.file.fileno()
        fcntl.flock(self.fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        self.env = patch.dict(os.environ, WIZARD_HEAVY_LOCK_FD=str(self.fd))
        self.env.start(); self.addCleanup(self.env.stop)
        validator = lease.validated_queue_fd
        self.validate = lambda: validator(self.lock)

    def test_child_fstat_preserves_exact_descriptor_and_inode(self):
        with patch.object(lease, 'validated_queue_fd', self.validate):
            child = lease.run_with_queue_lease([sys.executable,'-c',CHILD], capture_output=True,text=True,check=True)
        s = os.fstat(self.fd)
        self.assertEqual([self.fd,s.st_dev,s.st_ino],json.loads(child.stdout))

    def test_default_close_fds_reproduces_failure_despite_environment(self):
        child = subprocess.run([sys.executable,'-c',CHILD], capture_output=True,text=True)
        self.assertNotEqual(0,child.returncode)
        self.assertIn('Bad file descriptor',child.stderr)

    def test_real_child_validation_and_nested_worker_transport(self):
        code = ("import sys; sys.path.insert(0,sys.argv[1]); import qa_queue_lease as q; "
                "from pathlib import Path; "
                "v=q.validated_queue_fd; q.validated_queue_fd=lambda:v(Path(sys.argv[2])); "
                "q.run_with_queue_lease([sys.executable,'-c',sys.argv[3]],check=True)")
        with patch.object(lease,'validated_queue_fd',self.validate):
            child = lease.run_with_queue_lease([sys.executable,'-c',code,str(Path(lease.__file__).parent),str(self.lock),CHILD],capture_output=True,text=True,check=True)
        s = os.fstat(self.fd)
        self.assertEqual([self.fd,s.st_dev,s.st_ino],json.loads(child.stdout))

    def test_native_runner_rejects_unrelated_descriptor_before_output(self):
        import qa_dictation_insertion_native as native
        config = self.root/'packet.json'; config.write_text('{}')
        with (self.root/'unrelated').open('w+') as other:
            with patch.object(native,'validated_queue_fd',self.validate), patch.dict(os.environ,WIZARD_HEAVY_LOCK_FD=str(other.fileno())):
                with self.assertRaisesRegex(RuntimeError,'identity'):
                    native.run(config,self.root/'native')
        self.assertFalse((self.root/'native').exists())

    def test_missing_and_malformed_descriptor_rejected(self):
        for value in ('','abc','-1','0','1','2','03',' 3','3 '):
            with self.subTest(value=value), patch.dict(os.environ,WIZARD_HEAVY_LOCK_FD=value):
                with self.assertRaises(RuntimeError): self.validate()

    def test_closed_descriptor_rejected(self):
        fd = os.dup(self.fd); os.close(fd)
        with patch.dict(os.environ,WIZARD_HEAVY_LOCK_FD=str(fd)):
            with self.assertRaises(OSError): self.validate()

    def test_unrelated_locked_inode_rejected(self):
        with (self.root/'unrelated').open('w+') as other:
            fcntl.flock(other.fileno(),fcntl.LOCK_EX | fcntl.LOCK_NB)
            with patch.dict(os.environ,WIZARD_HEAVY_LOCK_FD=str(other.fileno())):
                with self.assertRaisesRegex(RuntimeError,'identity'): self.validate()

    def test_same_inode_new_unlocked_description_rejected(self):
        with self.lock.open('r') as other:
            with patch.dict(os.environ,WIZARD_HEAVY_LOCK_FD=str(other.fileno())):
                with self.assertRaisesRegex(RuntimeError,'exclusive'): self.validate()

    def test_shared_lock_rejected(self):
        fcntl.flock(self.fd,fcntl.LOCK_SH)
        with self.assertRaisesRegex(RuntimeError,'exclusive'): self.validate()

    def test_invalid_descriptor_never_spawns(self):
        with patch.object(lease,'validated_queue_fd',self.validate), patch.dict(os.environ,WIZARD_HEAVY_LOCK_FD='invalid'), patch.object(lease.subprocess,'run') as spawn:
            with self.assertRaises(RuntimeError): lease.run_with_queue_lease(['never'])
            spawn.assert_not_called()

    def test_all_three_workers_and_native_receive_live_descriptor(self):
        # Real child fstat at every coordinator edge. Synthetic children replace
        # workloads, not subprocess.run; no Gradle, SDK or emulator involved.
        script = self.root/'child.py'
        script.write_text("import os,json,sys\nfrom pathlib import Path\nf=int(os.environ['WIZARD_HEAVY_LOCK_FD']); s=os.fstat(f)\np=Path(sys.argv[1]); p.write_text(json.dumps({'status':'ok','stopped_emulator':True,'identity':[f,s.st_dev,s.st_ino]}))\n")
        config = {'source_revision':'synthetic','workers':{}}
        for lane in ('baseline','rejected','candidate'):
            receipt = self.root/(lane+'.json')
            config[lane] = {'receipt':str(receipt)}
            config['workers'][lane] = {'argv':[sys.executable,str(script),str(receipt)],'cwd':str(self.root)}
        native = self.root/'qa_dictation_insertion_native.py'
        native.write_text("import os,json,sys\nfrom pathlib import Path\nf=int(os.environ['WIZARD_HEAVY_LOCK_FD']); s=os.fstat(f)\np=Path(sys.argv[2]); p.mkdir(); (p/'receipt.json').write_text(json.dumps({'status':'ok','stopped_emulator':True,'identity':[f,s.st_dev,s.st_ino]}))\n")
        with patch.object(packet,'verify',return_value=config), patch.object(packet,'validated_queue_fd',self.validate), patch.object(lease,'validated_queue_fd',self.validate), patch.object(packet.shutil,'disk_usage',return_value=type('Disk',(),{'free':300*1024**3})()):
            result = packet.execute(self.root)
        self.assertEqual('ok',result['status'])
        s = os.fstat(self.fd)
        paths = [self.root/(x+'.json') for x in ('baseline','rejected','candidate')] + [self.root/'native/receipt.json']
        for path in paths:
            self.assertEqual([self.fd,s.st_dev,s.st_ino],json.loads(path.read_text())['identity'])


if __name__ == '__main__': unittest.main()
