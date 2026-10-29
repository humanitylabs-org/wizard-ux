"""Portable roots shared by device QA tools; no build or emulator is started here."""
import os
from pathlib import Path
import tempfile
from urllib.parse import urlsplit


def work_root():
    root = Path(os.environ.get('WIZARD_WORK_ROOT') or Path(os.environ.get('TMPDIR') or tempfile.gettempdir()) / 'wizard-work').expanduser().resolve()
    root.mkdir(parents=True, exist_ok=True)
    return root


def origin():
    return os.environ.get('WIZARD_ORIGIN', 'http://127.0.0.1:9371').rstrip('/')


def origin_host():
    if not os.environ.get('WIZARD_ORIGIN'):
        raise SystemExit('Set WIZARD_ORIGIN for remote reachability QA')
    return urlsplit(origin()).hostname


def android_sdk():
    value = os.environ.get('ANDROID_HOME') or os.environ.get('ANDROID_SDK_ROOT')
    if not value:
        raise SystemExit('Set ANDROID_HOME or ANDROID_SDK_ROOT to the worker Android SDK')
    return Path(value).expanduser().resolve()


def java_home():
    value = os.environ.get('JAVA_HOME')
    if not value:
        raise SystemExit('Set JAVA_HOME to the JDK required by this QA suite')
    return str(Path(value).expanduser().resolve())


def required_work_root():
    if not os.environ.get('WIZARD_WORK_ROOT'):
        raise SystemExit('Set WIZARD_WORK_ROOT to the remote worker work volume')
    return work_root()
