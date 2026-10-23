#!/usr/bin/env python3
"""Thales-only isolated signer acceptance. Run inside the durable heavy-worker lease.

Before invoking, stage with android-build-thales --prepare-only --gradle-dir android
and tasks :app:testDebugUnitTest :app:lintDebug :app:assembleDebug :app:assembleDebugAndroidTest.
This wrapper calls that staged worker with debug instrumentation enabled, then tests its exact APK.
No real account, phone, password-manager vault, relay publication, or owner key is used.
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
    jobs_root = Path(os.environ["WIZARD_ANDROID_JOBS_ROOT"]).resolve()
    if not job.is_relative_to(jobs_root):
        raise RuntimeError("Expected android-build-thales prepared job")
    os.umask(0o077)
    os.environ["WIZARD_TEST_BUILD_TYPE"] = "debug"
    worker = runpy.run_path(str(job / "worker.py"))
    # Same staged worker and inherited-lock validation as android-build-thales; no custom SDK/build path.
    worker["worker"](str(args.job_json))
    receipt = json.loads((job / "receipt.json").read_text())
    assert receipt["status"] == "ok" and receipt["host"] == os.environ["WIZARD_BUILD_HOST"]
    with worker["shared_worker_lock"](False):
        acceptance(job, receipt)


def acceptance(job, receipt):
    source = job / "source"
    output = job / "identity-qa"
    output.mkdir(mode=0o700)
    sdk = Path(os.environ.get("ANDROID_HOME", "/opt/homebrew/share/android-commandlinetools"))
    env = os.environ.copy()
    env.update(ANDROID_HOME=str(sdk), ANDROID_SDK_ROOT=str(sdk), ANDROID_AVD_HOME=str(output / "avd-home"),
               JAVA_HOME="/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home")
    env["PATH"] = env["JAVA_HOME"] + "/bin:/opt/homebrew/bin:" + env["PATH"]
    (output / "avd-home").mkdir()
    adb = sdk / "platform-tools/adb"
    serial = "emulator-5682"
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
    avd_name = "wizard_id_" + job.name.replace("-", "_")
    try:
        run([sdk / "cmdline-tools/latest/bin/avdmanager", "create", "avd", "-n", avd_name,
             "-k", "system-images;android-35;google_apis;arm64-v8a", "-p", output / "device"],
            input="no\n", text=True, capture_output=True)
        with (output / "emulator.log").open("w") as log:
            emulator = subprocess.Popen([str(sdk / "emulator/emulator"), "-avd", avd_name,
                                        "-port", "5682", "-no-window", "-no-snapshot", "-no-audio",
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
        for setting in ("window_animation_scale", "transition_animation_scale", "animator_duration_scale"):
            device("shell", "settings", "put", "global", setting, "0")
        device("shell", "settings", "put", "system", "screen_off_timeout", "600000")
        device("shell", "input", "keyevent", "KEYCODE_WAKEUP")
        device("shell", "wm", "dismiss-keyguard")
        pin_result = device("shell", "locksettings", "set-pin", "246810", capture_output=True, text=True)
        assert "set to" in pin_result.stdout.lower(), "Synthetic device PIN was not provisioned"
        device("install", "-r", app_path)
        device("install", "-r", test_path)
        device("logcat", "-c")
        tests = device("shell", "am", "instrument", "-w", "-r", "-e", "class",
                       "ai.wizards.os.identity.CryptoContractTest,ai.wizards.os.identity.WizardIdFlowTest",
                       "ai.wizards.os.qa.test/androidx.test.runner.AndroidJUnitRunner",
                       capture_output=True, text=True, timeout=1000)
        (output / "instrumentation.txt").write_text(tests.stdout + tests.stderr)
        instrumentation_ok = bool(re.search(r"OK \(3 tests\)", tests.stdout)) and "FAILURES" not in tests.stdout
        artifacts = output / "evidence"
        artifacts.mkdir(mode=0o700)
        files = ["signed-event.json", "receipt.json", "capture.webp", "onboarding-dark.png",
                 "approval-skin-dark.png", "settings-light.png", "approval-app-light.png"]
        for name in ("pin-timeout.png", "pin-timeout.xml"):  # failure diagnostics, optional
            subprocess.run([str(adb), "-s", serial, "pull", "/sdcard/Android/data/ai.wizards.os.qa/files/identity-qa/" + name,
                            str(output / name)], env=env, capture_output=True)
        (output / "logcat.txt").write_text(device("logcat", "-d", "-t", "4000", capture_output=True, text=True).stdout)
        for name in files:
            pulled = subprocess.run([str(adb), "-s", serial, "pull",
                "/sdcard/Android/data/ai.wizards.os.qa/files/identity-qa/" + name, str(artifacts / name)],
                env=env, capture_output=True)
            if instrumentation_ok and pulled.returncode != 0:
                raise RuntimeError("Missing public acceptance evidence: " + name)
        assert instrumentation_ok, "Signer instrumentation did not pass; inspect instrumentation.txt"
        # Independent JS implementation in an isolated evidence directory, not app sources.
        verifier_dir = output / "verifier"
        run(["npm", "install", "--prefix", verifier_dir, "--no-save", "--ignore-scripts", "@noble/curves@2.0.1"], capture_output=True, text=True)
        env["WIZARD_NOBLE_SECP"] = (verifier_dir / "node_modules/@noble/curves/secp256k1.js").as_uri()
        verify = run(["node", source / "tools/verify-wizard-id-event.mjs", artifacts / "signed-event.json"],
                     cwd=source, capture_output=True, text=True)
        (output / "independent-verification.json").write_text(verify.stdout)
        verified = json.loads(verify.stdout)
        assert verified["status"] == "ok" and verified["kind"] == 30117
        crash = device("logcat", "-d", "-b", "crash", capture_output=True, text=True).stdout
        (output / "crash.txt").write_text(crash)
        assert "FATAL EXCEPTION" not in crash
        result = {"status": "ok", "host": receipt["host"], "source_revision": receipt["source_revision"],
                  "source_manifest_sha256": receipt["source_manifest_sha256"], "apk": str(app_path),
                  "apk_sha256": app["sha256"], "instrumented_tests": 3, "serial": serial,
                  "independent_verification": verified, "screenshots": [str(artifacts / n) for n in files if n.endswith(".png")],
                  "published": False, "physical_phone": False}
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
