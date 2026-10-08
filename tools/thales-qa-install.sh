#!/bin/bash
# Run on Thales: reinstall the Wizard OS QA build and fire the two assistant handoff intents.
export PATH=$PATH:$HOME/Library/Android/sdk/platform-tools
export ANDROID_SERIAL=emulator-5554
set -u
adb uninstall ai.wizards.os.qa >/dev/null 2>&1
adb install /tmp/wos-qa.apk | tail -1
adb shell pm grant ai.wizards.os.qa android.permission.RECORD_AUDIO
adb shell am start -W -n ai.wizards.os.qa/ai.wizards.os.MainActivity | tail -1
sleep 10
P=$(adb shell pidof ai.wizards.os.qa); echo "pid $P"
adb forward tcp:9334 localabstract:webview_devtools_remote_$P >/dev/null
