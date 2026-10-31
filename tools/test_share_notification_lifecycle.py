#!/usr/bin/env python3
"""Controller seams only: reconnect ownership, obsolete Debugger fault, no input retry.

The injected Debugger close matches the retained failure boundary; it does not
claim to reproduce Chromium's unknown reason for closing its real websocket.
"""
import importlib.util
from pathlib import Path
import tempfile
from types import SimpleNamespace
from typing import Any
import unittest
from unittest.mock import Mock, patch

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('notification_lifecycle', HERE / 'qa_unified_share_android.py')
assert spec is not None and spec.loader is not None
q = importlib.util.module_from_spec(spec)
spec.loader.exec_module(q)


class NotificationLifecycleTest(unittest.TestCase):
    def test_second_send_after_notification_reconnect_needs_no_debugger(self):
        events = []
        pages = []

        class Page:
            def __init__(self, rig, port):
                # Exercise actual connect_page's close-before-create, not a mock
                # that silently permits overlapping session owners.
                if pages:
                    self_test.assertTrue(pages[-1].closed)
                self.closed = False
                self.number = len(pages) + 1
                pages.append(self)
                events.append(('open', self.number))

            def close(self):
                self.closed = True
                events.append(('close', self.number))

            def ev(self, expression):
                self_test.assertFalse(self.closed)
                events.append(('read', self.number))
                return True

            def call(self, method, **params):
                self_test.assertFalse(self.closed)
                events.append((method, self.number))
                if method == 'Debugger.enable' and self.number == 3:
                    raise RuntimeError('ws closed')
                return {'result': {'locations': [{'lineNumber': 1}]}}

        self_test = self
        rig: Any = q.Rig.__new__(q.Rig)
        rig.page = None; rig.source = HERE.parent; rig.devtools = 12345
        rig.sx = Mock(return_value='synthetic queue metadata')
        rig.tap = Mock(side_effect=lambda selector: events.append(('Send', len(pages))))
        rig.sheet = Mock(return_value=False)
        loader = Mock()
        with tempfile.TemporaryDirectory() as td, \
                patch.object(q.importlib.util, 'spec_from_file_location', return_value=SimpleNamespace(loader=loader)), \
                patch.object(q.importlib.util, 'module_from_spec', return_value=SimpleNamespace(Page=Page)):
            rig.out = Path(td)
            rig.connect_page()  # first share
            rig.send_once('existing')
            rig.connect_page()  # notification capture replaces the first CDP owner
            rig.page.ev('read-only notification snapshot')
            rig.connect_page()  # second external share replaces notification owner
            rig.send_once('new')
            for name in ('existing', 'new'):
                for boundary in ('before', 'after'):
                    self.assertTrue((rig.out / (name + '-' + boundary + '-bridge.json')).is_file())
                    self.assertTrue((rig.out / (name + '-' + boundary + '-native-custody.txt')).is_file())
            rig.page.close()
        self.assertEqual([e for e in events if e[0] in ('open', 'close', 'Send')],
                         [('open', 1), ('Send', 1), ('close', 1), ('open', 2),
                          ('close', 2), ('open', 3), ('Send', 3), ('close', 3)])
        self.assertFalse(any(e[0].startswith('Debugger.') for e in events))
        self.assertEqual(rig.tap.call_count, 2)
        self.assertTrue(all(c.args == ('[data-sharesend]',) for c in rig.tap.call_args_list))

    def test_pre_send_observation_failure_never_dispatches(self):
        rig: Any = q.Rig.__new__(q.Rig)
        rig.install_send_observation = Mock()  # isolate input-safety checks on the old head too
        rig.observe_send_boundary = Mock(side_effect=RuntimeError('read failed'))
        rig.tap = Mock()
        with self.assertRaisesRegex(RuntimeError, 'read failed'):
            rig.send_once('new')
        rig.tap.assert_not_called()

    def test_input_transport_failure_never_reconnects_or_retries_send(self):
        rig: Any = q.Rig.__new__(q.Rig)
        rig.install_send_observation = Mock()  # isolate input-safety checks on the old head too
        rig.observe_send_boundary = Mock()
        rig.tap = Mock(side_effect=RuntimeError('ws closed'))
        rig.connect_page = Mock()
        with self.assertRaisesRegex(RuntimeError, 'ws closed'):
            rig.send_once('new')
        rig.tap.assert_called_once_with('[data-sharesend]')
        rig.connect_page.assert_not_called()
        self.assertEqual([c.args[0] for c in rig.observe_send_boundary.call_args_list],
                         ['new-before', 'new-after'])


if __name__ == '__main__':
    unittest.main()
