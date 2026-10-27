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
    static final String TITLE = "Your phone isn’t on your Wizard’s private network";
    static final String OFF = "Tailscale isn’t running on this phone yet.";
    static final String WRONG = "Tailscale is on, but this phone isn’t on your Wizard’s network.";
    static final String LEAD = "Your Wizard is private. Only your own devices can reach it, through <b>Tailscale</b>, a free app that links them securely.";
    static final String GET = "Get Tailscale", SIGN_IN = "Sign in with your Wizard’s account", TURN_ON = "Turn it on", BACK = "Come back here";
    static final String FREE = "Free, from Tailscale Inc.", INSTALLED_ON = "Installed and on.", INSTALLED = "Installed.", IS_ON = "Tailscale is on.";
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

    enum Step { DONE, NOW, TODO }

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

    /** Steps 1–4. The first one that isn't done is the one the owner needs now. */
    static Step[] steps(boolean on, boolean installed) {
        if (on) return new Step[]{ Step.DONE, Step.NOW, Step.DONE, Step.TODO };
        if (installed) return new Step[]{ Step.DONE, Step.TODO, Step.NOW, Step.TODO };
        return new Step[]{ Step.NOW, Step.TODO, Step.TODO, Step.TODO };
    }

    static String status(boolean on) { return on ? WRONG : OFF; }

    /** Installed (or on): open it. Otherwise: Google Play. */
    static String button(boolean on, boolean installed) { return on || installed ? OPEN : GET; }
    static String hint(boolean on, boolean installed) { return on || installed ? "" : PLAY_HINT; }

    /** The text under a step's title. */
    static String body(int step, boolean on, boolean installed, String tailnet) {
        switch (step) {
            case 1: return on ? INSTALLED_ON : installed ? INSTALLED : FREE;
            case 2: return tailnet.isEmpty() ? SAME : SAME + " " + NETWORK;
            case 3: return on ? IS_ON : VPN;
            default: return AUTO;
        }
    }

    /** Which step carries the Get/Open Tailscale button: the one the owner needs now (step 4 never does). */
    static boolean hasButton(int step, boolean on, boolean installed) {
        return step < 4 && steps(on, installed)[step - 1] == Step.NOW;
    }
}
