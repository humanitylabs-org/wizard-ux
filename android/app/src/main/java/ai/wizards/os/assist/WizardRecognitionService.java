package ai.wizards.os.assist;

import android.content.Intent;
import android.os.RemoteException;
import android.speech.RecognitionService;
import android.speech.SpeechRecognizer;

/** Present because Android requires it for an assistant; Wizard OS offers no system dictation. */
public class WizardRecognitionService extends RecognitionService {
    @Override
    protected void onStartListening(Intent intent, Callback listener) {
        try {
            listener.error(SpeechRecognizer.ERROR_RECOGNIZER_BUSY);
        } catch (RemoteException ignored) {
        }
    }

    @Override
    protected void onCancel(Callback listener) { }

    @Override
    protected void onStopListening(Callback listener) { }
}
