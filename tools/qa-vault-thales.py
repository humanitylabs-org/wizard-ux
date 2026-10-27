#!/usr/bin/env python3
"""Thales-only isolated fingerprint-vault storage acceptance (real AndroidKeyStore + preferences). Run inside the durable heavy-worker lease.

Before invoking, stage with android-build-thales --prepare-only --gradle-dir android
and tasks :app:testDebugUnitTest :app:lintDebug :app:assembleDebug :app:assembleDebugAndroidTest.

This wrapper calls that staged worker with debug instrumentation enabled, then tests its exact APK.
No real account, phone, owner secret or owner key is used.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import runpy
import subprocess
import sys
import time


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("job_json", type=Path)
    args = parser.parse_args()
    if sys.platform != "darwin":
        raise RuntimeError("Android builds and emulators run only on Thales")
    job = args.job_json.resolve().parent
    jobs_root = Path(os.environ.get("WIZARD_ANDROID_JOBS_ROOT", "/Volumes/ThalesMedia/AndroidBuilds/jobs")).resolve()
    if not job.is_relative_to(jobs_root):
        raise RuntimeError("Expected android-build-thales prepared job")
    os.umask(0o077)
    os.environ["WIZARD_TEST_BUILD_TYPE"] = "debug"
    worker = runpy.run_path(str(job / "worker.py"))
    # Same staged worker and inherited-lock validation as android-build-thales; no custom SDK/build path.
    worker["worker"](str(args.job_json))
    receipt = json.loads((job / "receipt.json").read_text())
    assert receipt["status"] == "ok"
    with worker["shared_worker_lock"](False):
        acceptance(job, receipt)


def acceptance(job, receipt):
    source = job / "source"
    output = job / "vault-qa"
    output.mkdir(mode=0o700)
    sdk = Path(os.environ.get("ANDROID_HOME", "/opt/homebrew/share/android-commandlinetools"))
    env = os.environ.copy()
    env.update(ANDROID_HOME=str(sdk), ANDROID_SDK_ROOT=str(sdk), ANDROID_AVD_HOME=str(output / "avd-home"),
               JAVA_HOME="/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home")
    env["PATH"] = env["JAVA_HOME"] + "/bin:/opt/homebrew/bin:" + env["PATH"]
    (output / "avd-home").mkdir()
    adb = sdk / "platform-tools/adb"
    serial = "emulator-5684"
    emulator = None

    def run(argv, **kwargs):
        return subprocess.run([str(x) for x in argv], env=env, check=True, **kwargs)

    def device(*argv, **kwargs):
        return run([adb, "-s", serial, *argv], **kwargs)

    app = next(a for a in receipt["artifacts"] if a["path"].endswith("/app-debug.apk"))
    app_path = source / app["path"]
    test_path = source / "android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk"
    assert hashlib.sha256(app_path.read_bytes()).hexdigest() == app["sha256"]
    assert test_path.is_file()
    assert serial not in run([adb, "devices"], capture_output=True, text=True).stdout
    avd_name = "wizard_vault_" + job.name.replace("-", "_")
    try:
        run([sdk / "cmdline-tools/latest/bin/avdmanager", "create", "avd", "-n", avd_name,
             "-k", "system-images;android-35;google_apis;arm64-v8a", "-p", output / "device"],
            input="no\n", text=True, capture_output=True)
        with (output / "emulator.log").open("w") as log:
            emulator = subprocess.Popen([str(sdk / "emulator/emulator"), "-avd", avd_name,
                                        "-port", "5684", "-no-window", "-no-snapshot", "-no-audio",
                                        "-gpu", "swiftshader_indirect"], env=env, stdout=log, stderr=subprocess.STDOUT)
        deadline = time.monotonic() + 240
        while time.monotonic() < deadline:
            if emulator.poll() is not None:
                raise RuntimeError("Isolated emulator exited during boot")
            boot = subprocess.run([str(adb), "-s", serial, "shell", "getprop", "sys.boot_completed"],
                                  env=env, capture_output=True, text=True)
            if boot.returncode == 0 and boot.stdout.strip() == "1":
                break
            time.sleep(2)
        else:
            raise RuntimeError("Isolated emulator boot timeout")
        device("install", "-r", app_path)
        device("install", "-r", test_path)
        device("logcat", "-c")
        tests = device("shell", "am", "instrument", "-w", "-r", "-e", "class", "ai.wizards.os.vault.VaultSlotsDeviceTest",
                       "ai.wizards.os.qa.test/androidx.test.runner.AndroidJUnitRunner",
                       capture_output=True, text=True, timeout=600)
        (output / "instrumentation.txt").write_text(tests.stdout + tests.stderr)
        ok = bool(re.search(r"OK \(2 tests\)", tests.stdout)) and "FAILURES" not in tests.stdout
        crash = device("logcat", "-d", "-b", "crash", capture_output=True, text=True).stdout
        (output / "crash.txt").write_text(crash)
        assert ok, "Vault device tests did not pass; inspect instrumentation.txt"
        assert "FATAL EXCEPTION" not in crash
        result = {"status": "ok", "source_revision": receipt["source_revision"],
                  "source_manifest_sha256": receipt["source_manifest_sha256"], "apk_sha256": app["sha256"],
                  "instrumented_tests": 2, "serial": serial, "published": False, "physical_phone": False}
        (output / "receipt.json").write_text(json.dumps(result, indent=2) + "\n")
        print(json.dumps(result), flush=True)
    finally:
        if emulator is not None:
            subprocess.run([str(adb), "-s", serial, "emu", "kill"], env=env, capture_output=True)
            try:
                emulator.wait(timeout=30)
            except subprocess.TimeoutExpired:
                emulator.terminate()
                emulator.wait(timeout=20)


if __name__ == "__main__":
    main()
