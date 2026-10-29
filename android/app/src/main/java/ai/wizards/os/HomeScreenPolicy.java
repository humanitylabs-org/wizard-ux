package ai.wizards.os;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;

/** Identity is box origin + stable registered app ID; routes resolve in the shell. */
public final class HomeScreenPolicy {
    private HomeScreenPolicy() {}
    public static boolean validId(String id) { return id != null && id.matches("[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}"); }
    public static String displayName(String id, String registeredName) {
        return "wizard-signal".equals(id) ? "Signal" : registeredName;
    }
    /** Refresh and re-add share this decision. Never update an unowned/unpinned shortcut. */
    public static boolean needsUpdate(boolean ownPinned, String oldName, String oldIcon, String name, String icon) {
        return ownPinned && (!java.util.Objects.equals(oldName,name) || !java.util.Objects.equals(oldIcon,icon));
    }
    /** One intentional tap, not a scroll/cancel/multi-touch or reused activation. */
    public static final class TapGate {
        private float x, y;
        private final float slop;
        private boolean down;
        private long up = -1, generation = 0;
        public TapGate(float slop) { this.slop = slop; }
        public void down(float x, float y) { this.x=x; this.y=y; down=true; up=-1; generation++; }
        public void move(float x, float y) { if (Math.hypot(x-this.x,y-this.y)>slop) cancel(); }
        public void cancel() { down=false; up=-1; generation++; }
        public void up(long now) { up=down ? now : -1; down=false; }
        public long claim(long now) {
            if (up<0 || now<up || now-up>1500) return -1;
            up=-1; return generation;
        }
        public boolean current(long claim) { return claim>=0 && claim==generation; }
    }
    public static String identity(String origin, String id) {
        if (!validId(id) || origin == null || origin.isEmpty()) throw new IllegalArgumentException("invalid app identity");
        try {
            byte[] bytes = MessageDigest.getInstance("SHA-256").digest((origin + "\n" + id).getBytes(StandardCharsets.UTF_8));
            StringBuilder out = new StringBuilder("homeapp-");
            for (byte b : bytes) out.append(String.format(java.util.Locale.ROOT, "%02x", b & 255));
            return out.toString();
        } catch (java.security.NoSuchAlgorithmException e) { throw new IllegalStateException(e); }
    }
}
