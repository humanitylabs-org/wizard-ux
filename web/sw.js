// One scoped, opt-in shell cache for offline-capable pins and the main Chats shell.
// All data/attachments/files remain network-only. Reading replicas use WizOffline.collection.
importScripts('core/offline-shell-manifest.js');
self.WIZ_OFFLINE_CONFIG={prefix:'wizard-os-home-',version:self.WIZ_SHELL_MANIFEST.version,
  shell:self.WIZ_SHELL_MANIFEST.shell,optIn:true,navigationKeys:{'':'chats',wisdom:'wisdom'}};
importScripts('core/offline-sw.js');
