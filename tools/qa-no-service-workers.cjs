"use strict";
// Playwright 1.55's serviceWorkers:block initializer dereferences a throwing
// getter in opaque frames. Fresh QA contexts use this guarded equivalent.
function blockServiceWorkerRegistration() {
  try {
    const worker = navigator.serviceWorker;
    if (worker) worker.register = async () => { throw new DOMException('Synthetic QA disables service workers', 'NotSupportedError'); };
  } catch (error) {
    if (error.name !== 'SecurityError') throw error;
  }
}
module.exports = { blockServiceWorkerRegistration };
