package ai.wizards.os.assist;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;

import ai.wizards.os.MainActivity;

/**
 * Android's assistant settings gear (and anything else that asks for the assistant's settings) lands here.
 * The side-button switch lives inside Wizard OS itself, so this just opens Wizard OS on that switch.
 */
public class AssistSetupActivity extends Activity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        startActivity(new Intent(MainActivity.ACTION_SIDE_BUTTON)
                .setClass(this, MainActivity.class)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP));
        finish();
    }
}
