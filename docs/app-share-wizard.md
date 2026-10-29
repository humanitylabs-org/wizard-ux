# Share to Wizard inside Wizard

REUSE: shared Chats uploads, durable send, installed-frame authorization, Back and update holds.
EXTEND: device.js Share to Wizard sheet into core/share-wizard.js, called by native imports and installed apps on both shells.
NEW: no parallel capability; share-wizard.js/css are the extracted common sheet.

`await WizardApp.share.wizard({files: File[], text: string, title: string})` opens a confirm/edit sheet. It returns `sent` after one durable Chats enqueue, `cancelled` on Back/Cancel, or `unsupported` when the host is unavailable/busy. No Android share tray. At most 10 files / 100 MB total and 100000 characters; invalid input rejects. All selected files and the edited note ride together. Existing destination drafts and files are not consumed. A stale/detached app document cannot confirm a send. Successful uploads are retained for retry; cancellation frees preview URLs. Back during sending is consumed, never app exit. The shared send path now admits 10 files instead of silently truncating to 8.

Both HTML loaders include the shared module: desktop does not load device.js or depend on WizardDevice. Old shells expose no `.wizard` method on the direct client connection, so apps may retain their legacy share fallback only when the method is absent.
