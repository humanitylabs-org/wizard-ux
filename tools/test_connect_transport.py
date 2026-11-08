"""Connect harness transport regressions only; no emulator or phone acceptance."""
import ast
from pathlib import Path
import unittest
from unittest.mock import patch
import qa_android_connect as qa


class ConnectTransportTest(unittest.TestCase):
    def test_spare_recommended_console_and_adb_ports(self):
        bound = []
        class Socket:
            def __enter__(self): return self
            def __exit__(self, *args): pass
            def bind(self, address):
                bound.append(address[1])
                if address[1] == 5583: raise OSError('occupied ADB socket')
        with patch.object(qa.socket, 'socket', side_effect=lambda: Socket()):
            port = qa.choose_emulator_port('List of devices attached\nemulator-5584\tdevice\n')
        self.assertEqual(port, 5580)
        self.assertEqual(bound, [5582, 5583, 5580, 5581])

    def test_all_registered_recommended_ports_refuse_without_foreign_cleanup(self):
        devices = '\n'.join('emulator-' + str(p) + '\tdevice' for p in range(5554, 5586, 2))
        with patch.object(qa.socket, 'socket') as socket:
            with self.assertRaisesRegex(RuntimeError, 'recommended range'):
                qa.choose_emulator_port(devices)
            socket.assert_not_called()

    def test_occupied_sockets_cannot_escape_recommended_range(self):
        with patch.object(qa.socket, 'socket', side_effect=OSError('occupied')):
            with self.assertRaisesRegex(RuntimeError, 'recommended range'):
                qa.choose_emulator_port('')

    def test_no_connect_verdict_uses_one_top_snapshot_and_retains_evidence(self):
        source = Path(qa.__file__).read_text()
        tree = ast.parse(source)
        checks = [n for n in ast.walk(tree) if isinstance(n, ast.Call) and isinstance(n.func, ast.Name)
                  and n.func.id == 'check' and n.args and isinstance(n.args[0], ast.Constant)
                  and 'no Connect after offline upgrade' in str(n.args[0].value)]
        self.assertEqual(len(checks), 1)
        self.assertFalse(any(isinstance(n, ast.Call) and isinstance(n.func, ast.Name) and n.func.id == 'top'
                             for n in ast.walk(checks[0])))
        self.assertIn('activity = top()', source)
        self.assertIn("'post-upgrade-top.txt'", source)
        self.assertIn("'adb-failure.json'", source)
        self.assertNotIn("'5686'", source)


if __name__ == '__main__': unittest.main()
