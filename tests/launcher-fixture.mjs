import vm from 'node:vm';
import { readFileSync } from 'node:fs';
// Run the real shared launcher policy (offline/old-service path), not a second hard-coded list.
export function launcherFixture(context) {
  context.addEventListener ||= () => {};
  context.window.dispatchEvent ||= () => {};
  context.Event ||= Event;
  context.localStorage ||= { getItem: () => null, setItem() {} };
  context.fetch ||= async () => ({ ok: false, status: 404 });
  context.AbortSignal ||= AbortSignal;
  for (const file of ['launcher-defaults.js', 'launcher.js']) vm.runInNewContext(readFileSync(new URL('../web/core/' + file, import.meta.url), 'utf8'), context);
  return context.window.WizLauncher;
}
