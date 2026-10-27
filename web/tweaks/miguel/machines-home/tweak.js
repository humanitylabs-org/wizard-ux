/* Miguel's Home = his Machines map (owner-approved Machines mockup v2, Backup app 0.5.4). One implementation: the
 * map is the Wizard team package wizard/machines-home; this package keeps Miguel's own look (tweak.css) and his one
 * difference: a failed Backup read says "unavailable" instead of offering an empty Storage slot.
 * Nothing about the owner's network is written here: roles and managed Wizards come from his own devices registry
 * (~/.wizard-os/devices.json), served read-only by the shell's Devices feed. */
import { machinesHome } from '../../wizard/machines-home/tweak.js';

export default function setup(api) { return machinesHome(api, { missingBackup: 'unavailable' }); }
