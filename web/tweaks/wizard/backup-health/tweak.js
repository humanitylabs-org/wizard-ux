/* Backup health in Resources (wizard-ux issue 1743): core/resources.js reads the switch from data-tweaks and the
 * App Manager (wam/backup_health.py) reads it from the Look file. Nothing to set up here. */
export default function setup(api) {
  return () => {};
}
