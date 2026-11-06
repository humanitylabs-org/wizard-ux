package ai.wizards.os;

/**
 * The "can't reach your Wizard" screen (James, 12 Oct: Tailscale off on GrapheneOS left a pure black screen).
 * Pure rules, unit-tested: when the screen shows, what it says, and when the app tries again on its own.
 *
 * For tailnet-configured boxes, a connection without Tailscale can hang, so
 * with Tailscale off the old name's connection hangs with nothing on screen. Instead: a normal open paints before
 * CONNECTING_MS and never sees this screen; past that mark an open that cannot work (no network, no VPN) says why
 * at once; anything else says "Connecting…" and, at GIVE_UP_MS, that the Wizard isn't answering. The load keeps
 * going underneath and the screen leaves by itself the moment a page paints.
 */
final class ReachPolicy {
    private ReachPolicy() {}

    enum Why { NO_NETWORK, TAILSCALE_OFF, NOT_ANSWERING }

    /** A normal open paints before this, so it never flashes the screen. */
    static final long CONNECTING_MS = 1_200L;
    /** Still nothing painted: say so (the load keeps going underneath). */
    static final long GIVE_UP_MS = 10_000L;
    /** While the screen is up and the app is in front, try again on its own this often. */
    static final long RETRY_MS = 15_000L;
    /** Network changes arrive in bursts: wait this long before trying. */
    static final long NET_SETTLE_MS = 700L;

    static final String TAILSCALE_PKG = "com.tailscale.ipn";

    static Why why(boolean network, boolean vpn) { return why(network, vpn, true); }

    static Why why(boolean network, boolean vpn, boolean needsTailscale) {
        if (!network) return Why.NO_NETWORK;
        if (needsTailscale && !vpn) return Why.TAILSCALE_OFF;
        return Why.NOT_ANSWERING;
    }

    /** At the connecting mark: an open that cannot succeed (no network, Tailscale off) says why right away. */
    static boolean failNow(boolean network, boolean vpn) { return failNow(network, vpn, true); }
    static boolean failNow(boolean network, boolean vpn, boolean needsTailscale) {
        return why(network, vpn, needsTailscale) != Why.NOT_ANSWERING;
    }

    /** A gateway or server failure on the page itself (Caddy 502 while the Wizard restarts, 503, 504). */
    static boolean httpFailure(int status) {
        return status >= 500 && status <= 599;
    }

    /** A network change worth a fresh try: the reason changed, and there is now a network to try on. */
    static boolean retryOnChange(Why shown, Why now) {
        return shown != now && now != Why.NO_NETWORK;
    }

    static String title(Why w) {
        switch (w) {
            case NO_NETWORK: return "You're offline";
            case TAILSCALE_OFF: return "Tailscale is off";
            default: return "Can't reach your Wizard";
        }
    }

    static String body(Why w) {
        switch (w) {
            case NO_NETWORK: return "This phone has no connection. Wizard opens by itself when it's back.";
            case TAILSCALE_OFF: return "Wizard lives on your private network. Turn Tailscale on and Wizard opens by itself.";
            default: return "Your Wizard isn't answering yet. Check its address and connection. Wizard keeps trying by itself.";
        }
    }

    /** Offer Open Tailscale whenever there is a network and Tailscale is on this phone. */
    static boolean offerTailscale(Why w, boolean installed) {
        return installed && w != Why.NO_NETWORK;
    }

    /** The small grey line: the WebView's reason, kept short and readable. */
    static String detail(String raw) {
        if (raw == null) return "";
        String s = raw.trim();
        if (s.startsWith("net::")) s = s.substring(5);
        return s.length() > 60 ? s.substring(0, 60) : s;
    }
}
