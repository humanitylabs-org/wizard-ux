package ai.wizards.shell.orb;

/**
 * Pure touch rules for the floating orb (JVM-tested): a short press without movement is a tap, movement past the
 * slop is a drag, a still press held past {@link #HOLD_MS} hides the orb. Plus where a dropped orb comes to rest.
 */
public final class OrbGesture {
    public static final long HOLD_MS = 700;
    public enum Kind { NONE, TAP, DRAG, HOLD }

    private final float slop;
    private float x0, y0;
    private long t0;
    private boolean dragging, down;

    public OrbGesture(float slopPx) { slop = slopPx; }

    public void down(float x, float y, long now) { x0 = x; y0 = y; t0 = now; dragging = false; down = true; }

    /** True once the finger has moved far enough to be a drag (from then on the orb follows it). */
    public boolean move(float x, float y) {
        if (down && !dragging && Math.hypot(x - x0, y - y0) > slop) dragging = true;
        return dragging;
    }

    /** Still pressed without moving for the hold time: hide. Checked by the host's timer. */
    public boolean held(long now) { return down && !dragging && now - t0 >= HOLD_MS; }

    public Kind up(float x, float y, long now) {
        if (!down) return Kind.NONE;
        move(x, y);
        down = false;
        if (dragging) return Kind.DRAG;
        return now - t0 >= HOLD_MS ? Kind.HOLD : Kind.TAP;
    }

    public void cancel() { down = false; }

    /** Snap to the nearer side edge and keep the whole orb on screen. Returns {x, y} of its top-left corner. */
    public static int[] rest(int x, int y, int size, int screenW, int screenH, int margin) {
        int left = margin, right = Math.max(margin, screenW - size - margin);
        int nx = x + size / 2 < screenW / 2 ? left : right;
        int ny = Math.max(margin, Math.min(y, Math.max(margin, screenH - size - margin)));
        return new int[]{nx, ny};
    }
}
