package ai.wizards.os;

/**
 * Rules for the "Connect to your Wizard" screen (ConnectScreen). Pure, unit-tested.
 *
 * When it shows: the phone has no Wizard address (a public build with no private address, before the owner
 * connects), or a connect link asks to switch to a different Wizard (the owner confirms with Connect).
 * Back on it never exits: with nowhere else to go it stays put; when the app already has a Wizard it closes the
 * screen and returns to that Wizard.
 */
final class ConnectPolicy {
    private ConnectPolicy() {}

    static final String TITLE = "Connect to your Wizard";
    static final String BODY = "Enter your Wizard's address. Open Setup on your Wizard and choose "
            + "\u201cUse Wizard on your phone\u201d to see it. Tailscale must be on.";
    static final String HINT = "https://wizard.your-tailnet.ts.net";
    static final String INVALID = "That isn't a Wizard address. It looks like https://wizard.your-tailnet.ts.net";
    static final String STAY = "Connect to your Wizard to continue";

    enum Back { STAY, CLOSE }

    /** Back while the connect screen shows. Never an exit. */
    static Back onBack(boolean configured) {
        return configured ? Back.CLOSE : Back.STAY;
    }

    /**
     * What to do with an address a link carried ("" for none): show the screen pre-filled when it names a
     * Wizard other than the current one (or the phone has none); otherwise nothing.
     */
    static boolean offer(String linkOrigin, String currentOrigin) {
        return linkOrigin != null && !linkOrigin.isEmpty() && !linkOrigin.equals(currentOrigin);
    }
}
