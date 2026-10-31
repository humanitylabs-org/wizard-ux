'use strict';
// Shared QA geometry/path predicates. Dimension-only visibility treats a closed,
// translated phone sheet as open; the desktop entrypoint is still Wizard.
function shellPath(pathname) {
  return ['/wizard-os-home/', '/wizard-os-home/index.html', '/wizard-os-home/desktop.html'].includes(pathname);
}
function inViewport(rect, width, height) {
  return rect.width > 0 && rect.height > 0 && rect.right > 0 && rect.bottom > 0 && rect.left < width && rect.top < height;
}
module.exports = { shellPath, inViewport };
