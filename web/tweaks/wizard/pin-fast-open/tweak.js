// Pinned apps open at once (wizard-ux issue 1558): the work is in core/single-app-session.js (mount from the last-known
// app list) and core/launcher.js (ui-preferences beside bootstrap), both read this switch from <html data-tweaks>.
export default function setup(api) { return () => {}; }
