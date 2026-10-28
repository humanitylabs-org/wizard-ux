# Response style: owner choice

James approved Summary (his existing finish report with a short recovery of what we are doing) and Concise (Oscar/Miguel's service #210 prose). This is an owner setting, not a device or skin preference. Existing installs stay Summary. Fresh installs get a persisted 50/50 assignment, and owners can switch either way. Only local assignment and switch counts are retained; no message content or telemetry.

Reuse:
- settings navigation and rows: EXTEND WosSettings.register in web/core/settings.js, one Response style row on Chats & app screens; choices remain in the same shared registry.
- owner settings transport: EXTEND WizConfig in web/core/config.js with read/write/readback for the service-owned response_style field.
- skins and materials: REUSE existing Settings classes and --wz-* roles.
- new shared modules: NEW none.

| Row | Page | Choices |
| --- | --- | --- |
| Response style | Chats & app screens | Summary / Concise, each with one-line description |

Acceptance: both shells render the same owner choice; no device-local authority; failed saves retain the verified selection and offer retry; Back returns to Settings, never exits; Summary explains what we are doing and retains short/conversational exceptions; both styles reach main/profile/container/restricted run admission; synthetic phone Nebula and Signal evidence; service and UX live branches prepared but never deployed.
