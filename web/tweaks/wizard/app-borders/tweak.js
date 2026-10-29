/* Borrow the shared frame foundation; disposal returns to borderless. */
export default function setup(api) {
  return api.layout.foundation('framed');
}
