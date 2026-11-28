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

    /** Wizard-ux issue 2008: waits before each quiet try after a fast failure (then the last one, until GIVE_UP_MS). */
    static final long[] QUIET_RETRY_MS = { 400L, 800L, 1_500L, 2_500L };

    /** Wizard-ux issue 2008: a load that failed fast (an error or a 5xx) while the phone has a network and Tailscale is
     *  on (or not needed) is not yet a Wizard that can't be reached: right after a network change or a resume, the
     *  Tailscale tunnel and its names are still waking and the first try fails in milliseconds. It tries again quietly
     *  (Connecting at most) until GIVE_UP_MS after the load began. No network and Tailscale off still say so at once, and
     *  once the offline screen is up its own retries keep it as it is. */
    static boolean retryQuietly(Why why, long sinceLoadMs, boolean offlineShowing) {
        return why == Why.NOT_ANSWERING && !offlineShowing && sinceLoadMs >= 0 && sinceLoadMs < GIVE_UP_MS;
    }

    /** Wizard-ux issue 2054: a page already painted, nothing on the connection screen, and Tailscale goes off (or is
     *  off when the owner comes back). No page load is under way, so none of the marks above ever run: the app checks
     *  for itself on a network change, a return to the app and a paint. Only with a network, a Tailscale address and
     *  no VPN; Tailscale on never asks (wizard-ux issue 2008). */
    static boolean checkUnderPage(boolean painted, boolean showing, boolean network, boolean vpn, boolean needsTailscale) {
        return painted && !showing && why(network, vpn, needsTailscale) == Why.TAILSCALE_OFF;
    }

    /** Wizard-ux issue 2054: the box's own health check didn't answer and Tailscale is still off: the guide shows at
     *  once. A box that answers anyway (Tailscale Funnel, another route) keeps the page as it is. */
    static boolean tailscaleOffUnderPage(int health, Why now) {
        return now == Why.TAILSCALE_OFF && !(health >= 200 && health < 500);
    }

    /** Wizard-ux issue 2054: a page painted while the Tailscale guide is up and Tailscale is still off (the shell from
     *  its cache on a retry): the guide stays, so it doesn't leave and come back on every retry. */
    static boolean keepOnPaint(boolean offline, Why shown, Why now) {
        return offline && shown == Why.TAILSCALE_OFF && now == Why.TAILSCALE_OFF;
    }

    /** The wait before quiet try number `tries` (0 first). */
    static long quietRetryDelay(int tries) {
        return QUIET_RETRY_MS[Math.max(0, Math.min(tries, QUIET_RETRY_MS.length - 1))];
    }

    /** A gateway or server failure on the page itself (Caddy 502 while the Wizard restarts, 503, 504). */
    static boolean httpFailure(int status) {
        return status >= 500 && status <= 599;
    }

    /** Wizard-ux issue 1607: the Wizard answered the load being watched (its main frame committed, same host, not
     *  already failed), so the connecting mark stops. The give-up mark is not part of this: it stays armed until a
     *  page paints. */
    static boolean answerDisarms(boolean web, boolean failed, boolean sameHost) {
        return web && !failed && sameHost;
    }

    /** After an answer, a Connecting screen already up leaves; the offline screen (and its Retry) stays until a paint. */
    static boolean answerHides(boolean showing, boolean offline) {
        return showing && !offline;
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
