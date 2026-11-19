package ai.wizards.os;

import android.content.Context;

/**
 * Connecting only while the Wizard hasn't answered (wizard-ux issue 1607, switch wizard/pin-reach-answer, off by
 * default). Today the "Connecting to your Wizard…" screen leaves only when a page paints, so a home-screen app that
 * the box answers in milliseconds but that paints late still shows it. With the switch on, the first answer from the
 * Wizard for the page being loaded (the main frame commits: doUpdateVisitedHistory) stops the
 * connecting mark; the give-up mark stays until a page paints, so a Wizard that answers but never paints still ends
 * on the offline screen with Retry. The rules are in {@link ReachPolicy#answerDisarms}.
 *
 * The switch lives in the shell (look.json); the main page copies it here (WizardOSNative.reachAnswerSwitch), because
 * a home-screen app window's page never sees the shell's switches.
 */
public final class ReachAnswer {
    private static final String PREFS = "reach-answer", KEY = "on";

    private ReachAnswer() { }

    public static boolean on(Context c) {
        return c.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(KEY, false);
    }

    public static void setOn(Context c, boolean on) {
        if (on(c) == on) return;
        c.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean(KEY, on).apply();
        android.util.Log.i("WizardOSReach", "reach-answer switch " + (on ? "on" : "off"));
    }
}
