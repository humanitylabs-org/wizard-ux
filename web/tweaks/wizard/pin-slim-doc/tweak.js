// Pinned apps load a slim page (wizard-ux issue 1584): the work is in core/pin-doc.js (first script of index.html),
// core/single-app-session.js and core/config.js. They read this switch from this device's worn tweak list.
export default function setup(api) { return () => {}; }
