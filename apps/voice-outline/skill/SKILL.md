---
name: voice-outline
description: Read or update the owner's nested outline through revision-checked API or MCP.
---

Read GET /api/document or MCP outline_read. Preserve bullet IDs and parent relationships. PUT /api/document requires {rev,document}; use the exact revision just read. A 409 is a conflict: read and reconcile, never force overwrite. Confirm mutations with GET readback. Never start recording through an agent: Live is a user-initiated shared capture action. Do not summarize or rewrite the user's speech without a separate request.
