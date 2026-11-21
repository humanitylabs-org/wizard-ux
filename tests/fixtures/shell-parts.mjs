// Phone and desktop shell parts (wizard-ux issue 1665): app.js and desktop/desktop.js call parts in web/app-*.js and
// web/desktop/desktop-*.js. Tests that read either shell's text pass it through here to see the code exactly as it was
// before the move (tests/fixtures/app-parts.mjs and desktop-parts.mjs). Any other file's text comes back unchanged.
import { withAppParts } from './app-parts.mjs';
import { withDesktopParts } from './desktop-parts.mjs';

export const withShellParts = src => withDesktopParts(withAppParts(src));
