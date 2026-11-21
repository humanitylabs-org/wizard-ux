// Every split shell file at once (wizard-ux issue 1665): the phone and desktop shells and the AI apps view
// (tests/fixtures/shell-parts.mjs), core/skin-host.js (skin-host-parts.mjs) and core/chats.js (chats-parts.mjs).
// A test that reads any of them passes the text through here to see the code exactly as it was before the move.
// Any other file's text comes back unchanged.
import { withShellParts } from './shell-parts.mjs';
import { withSkinHostParts } from './skin-host-parts.mjs';
import { withParts } from './chats-parts.mjs';

export const withWebParts = src => withParts(withSkinHostParts(withShellParts(String(src))));
