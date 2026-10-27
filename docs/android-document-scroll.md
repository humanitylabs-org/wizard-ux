# Android document scrolling in the combined phone build

Phone 0.10.9 / 73 integrates the native DocScroll port from `53a17436` with current main.
The WebView declares `WizardOS-DocScroll`; shared Chats already gates document scrolling on
that explicit UA capability (not a version comparison). Older APKs retain inner scrolling.

REUSE stock WebView scrolling, discovery and capture. Remove the retired custom callback,
scroll JS/proxy metrics and accessibility instrumentation; preserve text selection and native
Back. REUSE ScrollCaptureCrashGuard for the platform cancellation race. Keep the current
main reading-place/document adapter and fixed header/composer rather than replacing live web files.

The vault and Wizard ID adapters stay independent on wizardDevicePort. Navigation still
cancels pending Wizard ID approvals. No key aliases or vault preferences are renamed.

Source contracts: `node --test tests/android-document-scroll.test.mjs`.
Android unit/lint/debug compilation runs in CI; signed release and 0.10.8/72 in-place upgrade
run on Thales only. Preparation is not a built or accepted APK. Samsung Smart Capture,
hardware StrongBox, enrollment invalidation and physical-phone biometrics remain device gates.
