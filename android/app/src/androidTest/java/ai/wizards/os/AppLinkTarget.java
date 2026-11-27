package ai.wizards.os;

import android.app.Activity;
import android.os.Bundle;
import android.widget.TextView;

/** Test APK only: an "installed app" owning https://applink-1948.wizard.test (AppLinkScenario, wizard-ux issue 1948). */
public class AppLinkTarget extends Activity {
    @Override protected void onCreate(Bundle b) {
        super.onCreate(b);
        TextView t = new TextView(this);
        t.setTextSize(24);
        t.setPadding(40, 200, 40, 40);
        t.setText("Opened in the app: " + getIntent().getDataString());
        setContentView(t);
    }
}
