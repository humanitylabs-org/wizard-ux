package ai.wizards.os;

import java.net.URI;
import java.util.Locale;

/**
 * "Your phone isn't on your Wizard's private network": what the step-by-step Tailscale guide says. Pure rules and
 * words, unit-tested (TailscaleGuideTest); TailscaleGuideView draws them. The iPhone app shows the same steps and words
 * (ios/www/tailscale-guide.js; tests/connect-tailscale-guide.test.mjs checks they match). Strings may hold <b>.
 *
 * Shown only when a Wizard on a Tailscale address (*.ts.net) can't be reached: by the "can't reach your Wizard" screen
 * (ReachScreen) and when connecting to a new address fails (ConnectActivity).
 */
final class TailscaleGuide {
    private TailscaleGuide() {}

    static final String PACKAGE = ReachPolicy.TAILSCALE_PKG;
    static final String PLAY_APP = "market://details?id=" + PACKAGE;
    static final String PLAY_WEB = "https://play.google.com/store/apps/details?id=" + PACKAGE;

    static final String EYEBROW = "Can’t reach your Wizard";
    static final String TITLE = "Your phone isn’t on your Wizard’s private network", TITLE_AWAY = "Your Wizard isn’t answering",
            TITLE_CHECKING = "Connecting to your Wizard";
    static final String OFF = "Tailscale isn’t running on this phone yet.";
    static final String WRONG = "Tailscale is on, but this phone isn’t on your Wizard’s network.";
    static final String QUIET = "Tailscale is on, but your Wizard isn’t answering this phone.";
    static final String UNSURE = "Tailscale is on. Checking that this phone is on your Wizard’s network…";
    static final String WAKE = "Check your Wizard is on";
    static final String STUCK = "Open Tailscale and check it’s connected with that account. If this phone was removed from Tailscale, or it looks stuck, turn Tailscale off and on again and log in if it asks.";
    static final String WAKE_BODY = "Make sure the computer running your Wizard is on and awake, with Wizard open. This phone connects by itself.";
    static final String LEAD = "Your Wizard is private. Only your own devices can reach it, through <b>Tailscale</b>, a free app that links them securely.";
    static final String GET = "Get Tailscale", SIGN_IN = "Sign in with your Wizard’s account", BACK = "Come back here";
    static final String FREE = "Free, from Tailscale Inc.", INSTALLED = "Installed.";
    static final String SAME = "Use the same Tailscale account as on your computer.", NETWORK = "Your Wizard is on this network:";
    static final String REMOVED = "This phone is on a different Tailscale network, or it was removed from yours. In Tailscale, switch account or sign in again.";
    static final String VPN = "The first time, Android asks to set up a VPN connection. Tap <b>OK</b>.";
    static final String AUTO = "Wizard connects by itself.", CHECKING = "Checking…";
    static final String ABOUT = "What is Tailscale?";
    static final String ABOUT1 = "<b>Tailscale</b> is a free app that links your own devices into a private network, wherever they are: at home, at work, on mobile data.";
    static final String ABOUT2 = "Your Wizard joined that network when you set up your phone on your computer. Only devices signed in to <b>your</b> Tailscale account can reach it; nothing is opened to the internet, and Wizard still asks who you are.";
    static final String ABOUT3 = "It runs in the background as a VPN. You can leave it on.";
    static final String OTHER = "Use a different Wizard";
    static final String OPEN = "Open Tailscale", PLAY_HINT = "Opens Google Play.";

    /** CHECKING: the app is verifying this step now (its own spinner). Steps complete in order. */
    enum Step { DONE, CHECKING, NOW, TODO }

    /** Only Wizards on a Tailscale address get the guide. */
    static boolean applies(String origin) { return !tailnet(origin).isEmpty(); }

    /** "tail1234.ts.net" from "https://wizard.tail1234.ts.net[:port]", else "". */
    static String tailnet(String origin) {
        String host;
        try { host = new URI(origin == null ? "" : origin.trim()).getHost(); } catch (Exception e) { return ""; }
        if (host == null) return "";
        host = host.toLowerCase(Locale.ROOT);
        if (!host.matches("[a-z0-9-]+(\\.[a-z0-9-]+)+\\.ts\\.net")) return "";
        return host.substring(host.indexOf('.') + 1);
    }

    /**
     * Steps 1–3, completed in order: 1 Get Tailscale (done once it's running, or installed), 2 sign in with the Wizard's
     * account (and allow the VPN), 3 come back / is the Wizard on. `missing` (with Tailscale on): true when the Wizard's
     * name doesn't exist from this phone (another Tailscale account, or removed from the network); false when it exists
     * but nothing answers (the Wizard's computer is off or asleep: Tailscale still knows an offline Wizard's name); null
     * when not known yet.
     */
    static Step[] steps(boolean on, Boolean missing, boolean installed) {
        // Name resolves, nothing answers: the Wizard's computer is off, or Tailscale on this phone is stale (removed phones
        // keep their old network list until Tailscale reconnects). The phone can't tell which: check both.
        if (on && Boolean.FALSE.equals(missing)) return new Step[]{ Step.DONE, Step.NOW, Step.TODO }; // only the current step is active
        if (on && Boolean.TRUE.equals(missing)) return new Step[]{ Step.DONE, Step.NOW, Step.TODO };
        if (on) return new Step[]{ Step.DONE, Step.CHECKING, Step.TODO };
        if (installed) return new Step[]{ Step.DONE, Step.NOW, Step.TODO };
        return new Step[]{ Step.NOW, Step.TODO, Step.TODO };
    }

    /** The headline: "isn't on your network" only once that's confirmed; a Wizard that's off is said as such. */
    static String headline(boolean on, Boolean missing) {
        if (on && Boolean.FALSE.equals(missing)) return TITLE_AWAY;
        return on && missing == null ? TITLE_CHECKING : TITLE;
    }

    static String status(boolean on, Boolean missing) {
        if (!on) return OFF;
        return Boolean.TRUE.equals(missing) ? WRONG : Boolean.FALSE.equals(missing) ? QUIET : UNSURE;
    }

    /** The phone is fine; the Wizard isn't answering. Step 3 then asks to check the Wizard's computer. */
    static boolean away(boolean on, Boolean missing) { return on && Boolean.FALSE.equals(missing); }

    /** From the WebView's error text: the name didn't resolve (true), anything else, including a hang (false). */
    static boolean missingFrom(String webError) { return webError != null && webError.contains("NAME_NOT_RESOLVED"); }

    /** Installed (or on): open it. Otherwise: Google Play. */
    static String button(boolean on, boolean installed) { return on || installed ? OPEN : GET; }
    static String hint(boolean on, boolean installed) { return on || installed ? "" : PLAY_HINT; }

    /** The step titles, 1–3. */
    static String title(int step, boolean on, Boolean missing) {
        switch (step) {
            case 1: return GET;
            case 2: return SIGN_IN;
            default: return away(on, missing) ? WAKE : BACK;
        }
    }

    /** The text under a step's title. Step 2's network chip, VPN tip and warning follow it (TailscaleGuideView). */
    static String body(int step, boolean on, Boolean missing, boolean installed, String tailnet) {
        switch (step) {
            case 1: return steps(on, missing, installed)[0] == Step.DONE ? INSTALLED : FREE;
            case 2: return tailnet.isEmpty() ? SAME : SAME + " " + NETWORK;
            default: return away(on, missing) ? WAKE_BODY : AUTO;
        }
    }

    /** Step 2's first-time VPN tip, until step 2 is done. */
    static boolean vpnTip(boolean on, Boolean missing, boolean installed) { return steps(on, missing, installed)[1] != Step.DONE && !away(on, missing); }

    /** Step 2's "check Tailscale is really connected" line, while the Wizard isn't answering. */
    static boolean stuckTip(boolean on, Boolean missing) { return away(on, missing); }

    /** The warning under step 2: only when this phone isn't on the Wizard's network. */
    static boolean removed(boolean on, Boolean missing) { return on && Boolean.TRUE.equals(missing); }

    /** Which step carries the Get/Open Tailscale button: the one the owner needs now (step 3 never does). */
    static boolean hasButton(int step, boolean on, Boolean missing, boolean installed) {
        return step < 3 && steps(on, missing, installed)[step - 1] == Step.NOW;
    }
}
