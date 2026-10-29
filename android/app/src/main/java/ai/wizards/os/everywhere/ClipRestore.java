package ai.wizards.os.everywhere;

/** When the paste fallback may put the owner's previous clip back (pure, unit-tested). */
final class ClipRestore {
    private ClipRestore() {}

    /** Only a successful paste gives the old clip back; a failed one keeps the words on top for the owner to paste. */
    static boolean shouldRestore(boolean pasted, boolean hadOldClip) {
        return pasted && hadOldClip;
    }

    /** Never clobber something copied after us: restore only while our words are still the primary clip. */
    static boolean stillOurs(String current, String ours) {
        return current != null && current.equals(ours);
    }
}
