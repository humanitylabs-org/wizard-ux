"""Static: both emulator QA tools launch the shared supported graphics runtime and record the emulator's exit."""
import pathlib
import sys
import unittest

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import qa_android_connect as connect  # noqa: E402  no emulator is started at import


class Proc:
    pid = 4242

    def __init__(self, code):
        self.code = code

    def poll(self):
        return self.code


class EmulatorGraphics(unittest.TestCase):
    def test_supported_software_gl_with_vulkan_off(self):
        self.assertEqual(connect.EMULATOR_GRAPHICS, ('-gpu', 'swiftshader', '-feature', '-Vulkan'))

    def test_both_tools_use_the_shared_runtime_only(self):
        for name in ('qa_android_connect.py', 'qa_orb_screen.py'):
            src = (HERE / name).read_text()
            with self.subTest(name=name):
                self.assertFalse('swiftshader_indirect' in src, 'unsupported graphics mode still present')
                self.assertEqual(src.count("'-no-audio', *EMULATOR_GRAPHICS]"), 1)
                self.assertEqual([l for l in src.splitlines() if "'-gpu'" in l],
                                 ["EMULATOR_GRAPHICS = ('-gpu', 'swiftshader', '-feature', '-Vulkan')"] if name == 'qa_android_connect.py' else [])
                self.assertTrue('emulator_before_cleanup' in src)

    def test_exit_diagnostic_names_the_signal(self):
        argv = ['emulator', '-avd', 'q']
        self.assertEqual(connect.emulator_exit(Proc(-11), argv), dict(argv=argv, pid=4242, returncode=-11, signal='SIGSEGV'))
        self.assertEqual(connect.emulator_exit(Proc(1), argv)['signal'], None)
        self.assertEqual(connect.emulator_exit(Proc(None), argv)['returncode'], None)
        self.assertEqual(connect.emulator_exit(None, None), dict(argv=None, pid=None, returncode=None, signal=None))


if __name__ == '__main__':
    unittest.main()
