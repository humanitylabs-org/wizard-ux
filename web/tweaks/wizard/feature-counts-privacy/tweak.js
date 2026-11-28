/* Share feature counts in Privacy (wizard-ux issue 2053): read by web/core/settings.js (countsInPrivacy, tweakRows) and
 * web/core/privacy.js, which move the Share feature counts row from Try new features to Settings › Privacy. Nothing runs here. */
export default function setup(api) {
  return () => {};
}
