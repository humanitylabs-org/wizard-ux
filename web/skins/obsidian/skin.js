// Obsidian (Miguel's skin): skin-switch intro and behaviour. Swipe right in a thread to go back is now every skin's
// (web/core/thread-swipe-back.js, James 23 Oct 2026), so it no longer lives here.
import { playIntro, noteSkin, toHome } from './intro.js';

import { setupBehaviour } from './behaviour.js';

export default function setup(api) {
  const behaviour = setupBehaviour(api);
  // Skin-switch transition (web/skins/obsidian/intro.js): plays when this skin is picked, not when the app simply reopens on it.
  // 'live' is set while this skin is the chosen one and cleared only when the owner switches away.
  let intro = null;
  if (!api.storage.get('live')) {
    api.storage.set('live', true);
    intro = playIntro({ listen: api.listen });
    toHome(api);
  } else noteSkin();
  return reason => { behaviour(); intro?.stop(); if (reason === 'switch') api.storage.set('live', false); };
}
