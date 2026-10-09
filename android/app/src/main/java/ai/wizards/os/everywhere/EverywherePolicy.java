package ai.wizards.os.everywhere;

/**
 * Pure decisions for Wizard Everywhere, kept free of Android types so they are unit-tested off-device.
 * Retry timing and error wording match the web outbox (web/outbox.js) so both buttons behave the same.
 */
public final class EverywherePolicy {
    /** Same schedule as the web outbox: 2 s, 5 s, 15 s, 30 s, 1 min, 2 min, then it waits for James. */
    static final long[] BACKOFF_MS = {2000, 5000, 15000, 30000, 60000, 120000};
    static final int AUTO_TRIES = BACKOFF_MS.length;

    private EverywherePolicy() {}

    /** Network trouble, gateway restarts and overload are retried; anything else needs a human. */
    static boolean transientFailure(int status) {
        return status == 0 || status == 408 || status == 425 || status == 429 || status >= 500;
    }

    /** Delay before the next automatic try after {@code attempts} failures, or -1 when it should stop. */
    static long nextDelay(int attempts, int status) {
        if (!transientFailure(status) || attempts >= AUTO_TRIES) return -1;
        return BACKOFF_MS[Math.max(0, attempts - 1)];
    }

    static String reason(int status, String message) {
        if (status == 0) return "Couldn’t reach Wizard";
        if (status == 403) return "Wizard sign-in needed";
        if (status == 413) return "Too large for Wizard";
        if (status >= 500) return "Wizard was unavailable (" + status + ")";
        return message == null || message.isEmpty() ? "Wizard refused it (" + status + ")" : message;
    }

    /** The floating button shows only when it is switched on, Android allows it, and Wizard OS is not in front. */
    public static boolean bubbleVisible(boolean enabled, boolean overlayAllowed, boolean appInFront) {
        return enabled && overlayAllowed && !appInFront;
    }

    /** Clamp a dragged position on screen. Returns {x, y}. */
    static int[] clamp(int x, int y, int size, int screenW, int screenH, int margin) {
        int maxX = Math.max(margin, screenW - size - margin);
        int maxY = Math.max(margin, screenH - size - margin);
        return new int[]{Math.max(margin, Math.min(maxX, x)), Math.max(margin, Math.min(maxY, y))};
    }

    /** Snap to the nearer side edge after a drag, keeping the height James chose. */
    static int[] snap(int x, int y, int size, int screenW, int screenH, int margin) {
        int[] c = clamp(x, y, size, screenW, screenH, margin);
        int centre = c[0] + size / 2;
        c[0] = centre < screenW / 2 ? margin : Math.max(margin, screenW - size - margin);
        return c;
    }

    /** Default: lower right, above the dock and search bar, like Archimedes Anywhere. */
    static int[] defaultPosition(int size, int screenW, int screenH, int margin) {
        return snap(screenW, Math.round(screenH * 0.70f) - size / 2, size, screenW, screenH, margin);
    }

    static String clip(String s, int n) {
        if (s == null) return "";
        String t = s.trim().replaceAll("\\s+", " ");
        return t.length() <= n ? t : t.substring(0, Math.max(0, n - 1)).trim() + "…";
    }
}
