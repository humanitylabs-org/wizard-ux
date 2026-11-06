package ai.wizards.os.assist;

import android.os.Bundle;
import android.service.voice.VoiceInteractionService;
import android.util.Log;

/**
 * The always-bound assistant service. Android binds it while Wizard OS is the digital
 * assistant; it lets the lock-screen surface hand a live recording over to the corner orb.
 */
public class WizardVoiceService extends VoiceInteractionService {
    private static WizardVoiceService ready;

    @Override
    public void onReady() {
        super.onReady();
        ready = this;
        Log.i(AssistLockActivity.TAG, "voice service ready");
    }

    @Override
    public void onShutdown() {
        if (ready == this) ready = null;
        super.onShutdown();
    }

    /** Show the corner orb with these args. False when the service is not bound (not the assistant). */
    static boolean showCorner(Bundle args) {
        WizardVoiceService s = ready;
        if (s == null) return false;
        s.showSession(args, 0);
        return true;
    }
}
