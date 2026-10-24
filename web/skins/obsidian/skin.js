// Obsidian (Miguel's skin): the skin-switch intro only (look). His behaviour and layout live in
// the My release layer (web/mine/, wizard-os#186) and apply on every skin.
import { playIntro, noteSkin, toHome } from './intro.js';

export default function setup(api) {
  // Skin-switch transition (web/skins/obsidian/intro.js): plays when this skin is picked, not when the app simply reopens on it.
  // 'live' is set while this skin is the chosen one and cleared only when the owner switches away.
  let intro = null;
  if (!api.storage.get('live')) {
    api.storage.set('live', true);
    intro = playIntro({ listen: api.listen });
    toHome(api);
  } else noteSkin();
  return reason => { intro?.stop(); if (reason === 'switch') api.storage.set('live', false); };
}
