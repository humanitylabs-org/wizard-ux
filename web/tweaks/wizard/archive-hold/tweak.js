/* Archive stays archived (wizard-ux issue 2063): read by web/live.js (holdOn: the archive hold, the reply of a run that
 * was going stays archived, the "Back: <agent> wrote" mark), web/core/chats-inboxrows.js (the row tag) and
 * web/core/chats-rowacts.js (the toast). Nothing runs here. */
export default function setup(api) {
  return () => {};
}
