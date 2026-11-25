package ai.wizards.os.assist;

import android.content.Context;
import android.content.Intent;
import android.util.Log;

/**
 * The switch for "Side button opens the Agent chat" (wizard-ux issue 1528, switch wizard/assist-agent-note, off by
 * default). The switch lives in the shell (look.json); the WizardOS app's main page copies it here through
 * WizardOSNative.assistNoteSwitch, because the side button is answered by the corner orb before any shell page runs.
 *
 * With it on, holding the side button on an unlocked phone opens WizardOS on Messenger's Agent chat (the shell's
 * "agent-note" handoff) instead of starting a voice take for a new Wizard chat. The lock screen keeps its own surface.
 */
public final class AssistNote {
    /** MainActivity hands this to the shell as {"action":"agent-note"}. Explicit intents only: no intent filter. */
    public static final String ACTION = "ai.wizards.os.action.AGENT_NOTE";
    private static final String PREFS = "assist", KEY = "agent-note";

    private AssistNote() { }

    public static boolean on(Context c) {
        return c.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(KEY, false);
    }

    public static void setOn(Context c, boolean on) {
        if (on(c) == on) return;
        c.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean(KEY, on).apply();
        Log.i(AssistLockActivity.TAG, "agent chat switch " + (on ? "on" : "off"));
    }

    /**
     * Does this side-button press open the Agent chat? Only with the switch on, on an unlocked phone, for a fresh press:
     * never a hand-over from the lock screen or Camera / Attach, and never while a take is still open (that press sends
     * it, as before). Everything else keeps the orb exactly as it is today.
     */
    public static boolean opensAgentChat(boolean on, boolean locked, boolean handoff, boolean listening) {
        return on && !locked && !handoff && !listening;
    }

    /** WizardOS on top, asked to open the Agent chat (the shell finds Messenger; without it the orb listens as before). */
    public static Intent intent(Context c) {
        return new Intent(ACTION)
                .setClassName(c.getPackageName(), "ai.wizards.os.MainActivity")
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
    }
}
