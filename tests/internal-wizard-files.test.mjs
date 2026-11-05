// Wizard Files is the active backend. When the separate owner-facing Files screen exists,
// launchers hide the duplicate provider while direct app lookup remains available.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const apps = readFileSync(process.env.APPS_FILE || new URL('../web/core/apps.js', import.meta.url), 'utf8');
const kindsJs = readFileSync(new URL('../web/core/app-kinds.js', import.meta.url), 'utf8');

async function shell(installed, nativeLinks = []) {
  const storage = new Map();
  const window = {
    WizCore: { norm: s => s.toLowerCase() },
    WizConfig: { endpoint: () => '/apps' },
    WizLauncher: {
      ready: Promise.resolve(),
      get: key => key === 'nativeLinks' ? nativeLinks : [],
      onChange() {},
    },
    dispatchEvent() {},
  };

  const ctx = {
    window,
    document: { hidden: false, addEventListener() {} },
    CustomEvent: class {},
    URL,
    location: new URL('https://wizard.test/'),
    localStorage: {
      getItem: key => storage.get(key) || null,
      setItem: (key, value) => storage.set(key, value),
    },
    addEventListener() {},
    fetch: async () => ({ ok: true, json: async () => ({ apps: installed }) }),
  };
  vm.runInNewContext(apps, ctx);
  vm.runInNewContext(kindsJs, ctx);
  await window.WizCore.appsLoaded();
  const mobile = window.WizCore.apps('mobile');
  const desktop = window.WizCore.apps('desktop');
  return {
    window,
    mobile: { APP: mobile.APP, groups: window.WosAppKinds.kinds(mobile.APPS, mobile.APP, 'mobile') },
    desktop: { APP: desktop.APP, groups: window.WosAppKinds.kinds(desktop.APPS, desktop.APP, 'desktop') },
  };
}

const files = {
  id: 'files', name: 'Files', url: '/files/', source: 'apps.json',
  type: 'view', category: 'system', provides: ['files'],
};
const provider = {
  id: 'wizard-files', name: 'Wizard Files', url: '/wizard-files/', source: 'apps.json',
  type: 'service', category: 'system', provides: ['files'],
};
const nativeFiles = {
  id: 'files', name: 'Files', href: 'intent://files',
};

test('owner-facing Files hides Wizard Files from launchers without disabling it', async () => {
  const { window, mobile: { APP, groups } } = await shell([files, provider]);
  assert.equal(APP['wizard-files'].url, '/wizard-files/');
  assert.equal(window.WizCore.isMaintenanceApp(APP['wizard-files'], 'mobile'), true);
  assert.ok(groups.apps.some(a => a.id === 'files'));
  assert.ok(!groups.apps.some(a => a.id === 'wizard-files'));
});

test('Wizard Files returns to launchers when no separate Files screen is installed', async () => {
  const { window, mobile: { APP, groups } } = await shell([provider]);
  assert.equal(window.WizCore.isMaintenanceApp(APP['wizard-files'], 'mobile'), false);
  assert.ok(groups.apps.some(a => a.id === 'wizard-files'));
});

for (const [name, availability, target, available] of [
  ['phone-only Files', { phone_only: true }, 'desktop', 'mobile'],
  ['desktop-only Files', { desktop_only: true }, 'mobile', 'desktop'],
]) {
  test(`${name} cannot hide the available provider on the other shell`, async () => {
    const state = await shell([{ ...files, ...availability }, provider]);
    assert.equal(state[target].APP.files, undefined);
    assert.ok(state[target].groups.apps.some(a => a.id === 'wizard-files'));
    assert.equal(state[available].APP.files.url, '/files/');
    assert.ok(!state[available].groups.apps.some(a => a.id === 'wizard-files'));
    assert.equal(state[target].APP['wizard-files'].url, '/wizard-files/');
    assert.equal(state[available].APP['wizard-files'].url, '/wizard-files/');
  });
}

test('a native Files link suppressed by a remote desktop-only record cannot hide the phone fallback', async () => {
  const { mobile, desktop } = await shell([{ ...files, desktop_only: true }, provider], [nativeFiles]);
  assert.equal(mobile.APP.files, undefined);
  assert.ok(mobile.groups.apps.some(a => a.id === 'wizard-files'));
  assert.equal(mobile.APP['wizard-files'].url, '/wizard-files/');
  assert.equal(desktop.APP.files.url, '/files/');
  assert.ok(!desktop.groups.apps.some(a => a.id === 'wizard-files'));
});

test('native Files supersedes Wizard Files only on the shell where it is available', async () => {
  const { window, mobile, desktop } = await shell([provider], [nativeFiles]);
  assert.equal(mobile.APP.files.href, 'intent://files');
  assert.equal(mobile.APP['wizard-files'].url, '/wizard-files/');
  assert.equal(window.WizCore.isMaintenanceApp(mobile.APP['wizard-files'], 'mobile'), true);
  assert.ok(!mobile.groups.apps.some(a => a.id === 'wizard-files'));
  assert.equal(desktop.APP.files, undefined);
  assert.equal(window.WizCore.isMaintenanceApp(desktop.APP['wizard-files'], 'desktop'), false);
  assert.ok(desktop.groups.apps.some(a => a.id === 'wizard-files'));
});
