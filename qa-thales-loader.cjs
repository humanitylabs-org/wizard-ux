// Portable QA loader: existing suites retain historical module paths but run on Thales.
const Module = require('module');
const resolve = Module._resolveFilename;
Module._resolveFilename = function (name, ...args) {
  if (name === '/home/telos/node_modules/playwright') name = process.env.PW;
  return resolve.call(this, name, ...args);
};
