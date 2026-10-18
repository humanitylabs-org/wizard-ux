package ai.wizards.os;

/** The retired origin can contain device-local state only when an existing install was upgraded. */
final class LegacyCarryPolicy {
    private LegacyCarryPolicy() {}

    static boolean upgradedInstall(long firstInstallTime, long lastUpdateTime) {
        return firstInstallTime > 0L && lastUpdateTime > firstInstallTime;
    }
}
