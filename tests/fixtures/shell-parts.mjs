// Phone and desktop shell parts (wizard-ux issue 1665): app.js and desktop/desktop.js call parts in web/app-*.js and
// web/desktop/desktop-*.js, and the AI apps view's layouts/ai-apps/desktop.js calls its layouts/ai-apps/desktop-*.js
// modules. Tests that read any of these files' text pass it through here to see the code exactly as it was before the
// move (tests/fixtures/app-parts.mjs, desktop-parts.mjs and aad-parts.mjs). Any other file's text comes back unchanged.
import { withAppParts } from './app-parts.mjs';
import { withDesktopParts } from './desktop-parts.mjs';
import { withAadParts } from './aad-parts.mjs';

export const withShellParts = src => withAadParts(withDesktopParts(withAppParts(src)));
