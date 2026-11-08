// Production boot dependency for VM fixtures, not a second implementation.
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../../web/core/chats-list-model.js', import.meta.url), 'utf8');
export function modelContext(context = {}) {
  const ctx = vm.isContext(context) ? context : vm.createContext(context);
  vm.runInContext(source, ctx);
  if (ctx.window) ctx.window.WizChatsListModel = ctx.WizChatsListModel;
  return ctx;
}
export function runWithChatsModel(code, context = {}) {
  return vm.runInContext(code, modelContext(context));
}
