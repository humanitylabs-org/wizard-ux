'use strict';
const assert = require('node:assert/strict');
// Attempts are not mutations. Only these exact shell bootstrap requests may be
// attempted, and only when the synthetic origin refuses them before handlers.
const SHELL_BOOTSTRAP = new Set([
 'POST /wizard/v1/ui-preferences/seed',
 'PUT /wizard/thread-seen',
]);
function classifyWrites(requests) {
 const attempted = requests.filter(r => r.method !== 'GET');
 const refusedShellBootstrap = attempted.filter(r => SHELL_BOOTSTRAP.has(`${r.method} ${r.path}`) && r.status === 405 && r.refusedBeforeHandlers === true);
 const acceptedMutations = attempted.filter(r => Number.isInteger(r.status) && r.status >= 200 && r.status < 300);
 const unexpected = attempted.filter(r => !refusedShellBootstrap.includes(r));
 return { attempted, refusedShellBootstrap, acceptedMutations, unexpected };
}
function assertReadOnlyFixture(requests) {
 const result = classifyWrites(requests);
 assert.equal(result.acceptedMutations.length, 0, 'synthetic origin accepted no mutations');
 assert.equal(result.unexpected.length, 0, 'only exact refused shell bootstrap attempts are permitted');
 return result;
}
module.exports = { classifyWrites, assertReadOnlyFixture };
