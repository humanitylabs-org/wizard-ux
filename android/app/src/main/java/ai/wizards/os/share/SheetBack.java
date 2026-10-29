package ai.wizards.os.share;

/**
 * Back on the share sheet (James's standing rule: Back never exits on a single press).
 *   - A chooser (agent or chat) is open: Back closes it and the sheet stays.
 *   - The sheet itself: the first Back only warns ("Press back again to cancel") and stays; a second Back within
 *     {@link #WINDOW_MS} cancels the share, the sheet's own cancel, which returns to the app that shared.
 */
public final class SheetBack {
    public enum Action { CLOSE_CHOOSER, WARN, CANCEL }
    public static final long WINDOW_MS = 2000;
    private int choosers;
    private long warnedAt = Long.MIN_VALUE / 2;

    public void openChooser() { choosers++; warnedAt = Long.MIN_VALUE / 2; }
    public void closeChooser() { if (choosers > 0) choosers--; }
    public boolean chooserOpen() { return choosers > 0; }

    public Action back(long now) {
        if (choosers > 0) { choosers--; return Action.CLOSE_CHOOSER; }
        if (now - warnedAt <= WINDOW_MS) return Action.CANCEL;
        warnedAt = now;
        return Action.WARN;
    }
}
