# Pages bridge v1

`WosPages` is shared by phone and desktop. The shell and Agent Service are served on the same origin. Pages are untrusted agent-authored documents, **not installed apps**: do not attach WizardApp, Appearance, storage, credentials or hosted-app bridge services to their frames.

## Isolation

The viewer uses `/pages/<slug>/` and exactly:

```html
sandbox="allow-scripts allow-forms allow-popups allow-downloads"
```

Never add `allow-same-origin`. Agent Service independently sends the equivalent sandbox CSP on every page response. Container nginx forwards `/pages/` via its existing root API proxy and preserves that header. `tools/qa-origin.cjs` also proxies page reads without replacing headers; opaque-origin API requests keep `Origin: null` so the service can refuse them.

The owner API is `/wizard/v1/pages`. A page cannot fetch it directly: Agent Service rejects `Origin: null` with `403 opaque_origin`. Browser storage access throws. The parent shell performs only the operations below.

## Messages

A page sends to its parent (the target origin is the shell's known origin, or `*`):

```js
parent.postMessage({type: 'wizard-page:feedback', id: 'feedback-1', text: 'Please update the chart.'}, '*');
parent.postMessage({type: 'wizard-page:save', id: 'save-1', file: 'doc.md', text: '# Revised', version: 'sha256-from-editor'}, '*');
```

The listener requires **both** `event.source === thisViewerIframe.contentWindow` and `event.origin === 'null'`. Wrong windows, other opaque frames, same-origin windows and detached viewers are ignored. The shell obtains the slug from its own viewer state; a message cannot choose a slug, thread, agent or API URL. IDs are bounded strings/numbers. Feedback is capped at 16,000 characters, saves at 2 MiB; API byte limits still apply.

Save paths must be relative plain segments, at most eight levels. Reject empty segments, leading `/`, any `..`, backslash, NUL, dotfiles, encoded path syntax and any `page.json` segment. `version` is the SHA-256 version the page started editing, or `null` for a new file. Saves use the same optimistic PUT as the owner editor. An open dirty editor or in-flight write returns `editor_busy`; a stale write returns `stale_version`, never a silent overwrite.

Replies go **only to the sending frame**:

```js
{type: 'wizard-page:result', id: 'save-1', ok: true, version: 'new-sha256'}
{type: 'wizard-page:result', id: 'save-1', ok: false, error: 'stale_version'}
```

`postMessage(result, '*')` is required because the sandbox has an opaque origin. Replies carry no owner data, tokens, thread IDs or other secrets.

## Feedback consent and durability

Feedback requests show an owner confirmation card with the exact text, page title and destination thread from `page.json`. Only the owner's **Send feedback** tap calls `WosOutbox.enqueue`. One consent card may be pending across all viewers. Additional requests receive `feedback_pending`; Back/cancel/closing the viewer returns `cancelled`. No request auto-sends.

The durable outbox sends a reply in the page's thread, or creates a new thread when the metadata has none. The first line labels the source as machine-originated context:

```text
[Page feedback · Quarterly report · /pages/quarterly-report/]
Please update the chart.
```

A successful feedback reply means **queued durably**, not that the model has finished. The existing outbox owns retry, offline custody and model locking.

## Owner editor and navigation

The textarea keeps its starting version. A 409 retains both texts and offers **Keep mine** (save against the server's new version) and **Use theirs**. In-flight typing remains unsaved rather than being marked as the saved snapshot. History is newest-first; Restore creates a new commit and refreshes the document/frame. Back peels editor/history → page → list → prior shell screen; a dirty editor asks before discard. Closing a window also guards dirty edits.

The Pages system tile appears only after a successful list request. 404, 503 and network failures are silent; `/pages/<slug>/` chat links then retain the ordinary link sheet. Markdown-only pages use `WosChat.md` in the shell.

## Reproduce QA without touching a real agent

With a checkout of Agent Service `feature/pages-api` and its dependencies:

```sh
QA_SERVICE_DIR=/path/to/agent-service TMPDIR=/your/scratch PORT=8994 \
  QA_EVIDENCE=/your/evidence node tools/qa-pages-server.mjs
QA_OUT=/your/evidence node qa-pages.cjs http://127.0.0.1:8994
node --test tests/*.test.mjs
```

The fixture binds loopback only, creates a synthetic home/media/settings/state/queue/history under `TMPDIR`, imports the real service without modifying it, and points its only Hermes upstream at a recording stub. No live sessions or runs are used. Its `/__qa/` routes are fixture-only and must never be deployed.

**Transport detail:** current Agent Service turns model-locked `/wizard/hermes/v1/runs` requests into `/api/sessions/<thread>/chat/stream` upstream. QA records the real run ingress and the real stub stream receipt separately; it does not pretend the stub received an untransformed `/v1/runs`. Screenshots cover both shells on Nebula and the actual `obsidian-light` palette (Light), with API readback for every write/restore and recorded opaque-origin refusals.
