/* My release behaviour (wizard-os#186): Miguel's gestures and small layout moves (web/mine/behaviour.js), on every
 * skin. Runs as a WosSkinHost built-in, so it gets the skin hook API (web/skins/README.md) with its guards and
 * cleanup, and keeps running across skin switches. Only when the release flag is set (web/mine/mine-flag.js). */
import { setupBehaviour } from './behaviour.js';

if (window.WosMine?.on()) window.WosSkinHost?.builtin('mine-behaviour', setupBehaviour, { when: 'always', label: 'My release' });
