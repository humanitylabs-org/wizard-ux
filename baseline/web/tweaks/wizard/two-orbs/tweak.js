/* Wrap the existing layout host, including its async generation/disposal guards. */
export default function setup(api) {
  return api.layout.use('two-orb');
}
