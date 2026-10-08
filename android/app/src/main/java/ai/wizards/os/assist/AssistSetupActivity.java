package ai.wizards.os.assist;

import android.Manifest;
import android.app.Activity;
import android.app.role.RoleManager;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

/** One screen: allow the mic, make Wizard the side-button assistant, try it. */
public class AssistSetupActivity extends Activity {
    private static final int REQ_MIC = 7;
    private TextView micState;
    private TextView roleState;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        ScrollView scroll = new ScrollView(this);
        scroll.setBackgroundColor(Color.parseColor("#05040A"));
        LinearLayout col = new LinearLayout(this);
        col.setOrientation(LinearLayout.VERTICAL);
        int pad = dp(26);
        col.setPadding(pad, dp(64), pad, dp(40));
        scroll.addView(col);

        col.addView(text("WIZARD LOCK · TEST BUILD", 12, "#B99BFF", true));
        col.addView(space(10));
        col.addView(text("Hold the side button and talk.", 26, "#F3EFFF", false));
        col.addView(space(8));
        col.addView(text("The Wizard lights up over your lock screen. Your PIN and fingerprint stay exactly as they are.", 15, "#B9B0D8", false));
        col.addView(space(28));

        col.addView(text("1 · Microphone", 13, "#B99BFF", true));
        micState = text("", 15, "#F3EFFF", false);
        col.addView(micState);
        col.addView(button("Allow microphone", v -> requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, REQ_MIC)));
        col.addView(space(22));

        col.addView(text("2 · Side button", 13, "#B99BFF", true));
        roleState = text("", 15, "#F3EFFF", false);
        col.addView(roleState);
        col.addView(text("Pick Wizard OS as the digital assistant app. Then in Settings → System → Gestures → Press & hold power button, choose Digital assistant.", 14, "#B9B0D8", false));
        col.addView(button("Choose the assistant app", v -> openAssistantSettings()));
        col.addView(space(22));

        col.addView(text("3 · Try it", 13, "#B99BFF", true));
        col.addView(text("Lock the phone, then hold the side button and talk. Or try it here first.", 14, "#B9B0D8", false));
        col.addView(button("Try it now", v -> startActivity(new Intent(this, AssistLockActivity.class)
                .setAction(Intent.ACTION_ASSIST).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))));
        col.addView(space(26));
        col.addView(text("Needs Tailscale on for transcription. What you say is saved on this phone for now; sending it to Archimedes comes next.", 12, "#7D74A3", false));

        setContentView(scroll);
    }

    @Override
    protected void onResume() {
        super.onResume();
        boolean mic = checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED;
        micState.setText(mic ? "✓ allowed" : "not yet");
        micState.setTextColor(Color.parseColor(mic ? "#4FF0B0" : "#FFBE55"));
        boolean held = false;
        if (Build.VERSION.SDK_INT >= 29) {
            RoleManager rm = getSystemService(RoleManager.class);
            held = rm != null && rm.isRoleAvailable(RoleManager.ROLE_ASSISTANT) && rm.isRoleHeld(RoleManager.ROLE_ASSISTANT);
        }
        roleState.setText(held ? "✓ Wizard OS is the assistant" : "not the assistant yet");
        roleState.setTextColor(Color.parseColor(held ? "#4FF0B0" : "#FFBE55"));
    }

    private void openAssistantSettings() {
        // ROLE_ASSISTANT is not requestable by apps; the user picks it in Settings.
        String[] actions = {Settings.ACTION_VOICE_INPUT_SETTINGS, Settings.ACTION_MANAGE_DEFAULT_APPS_SETTINGS, Settings.ACTION_SETTINGS};
        for (String a : actions) {
            try {
                startActivity(new Intent(a));
                return;
            } catch (ActivityNotFoundException ignored) {
                // try the next one
            }
        }
    }

    private TextView text(String s, int sp, String color, boolean bold) {
        TextView t = new TextView(this);
        t.setText(s);
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, sp);
        t.setTextColor(Color.parseColor(color));
        t.setLineSpacing(0, 1.2f);
        if (bold) {
            t.setTypeface(Typeface.DEFAULT_BOLD);
            t.setLetterSpacing(0.12f);
        }
        t.setPadding(0, dp(3), 0, dp(3));
        return t;
    }

    private Button button(String s, View.OnClickListener l) {
        Button b = new Button(this);
        b.setText(s);
        b.setAllCaps(false);
        b.setTextColor(Color.parseColor("#F3EFFF"));
        b.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
        GradientDrawable bg = new GradientDrawable();
        bg.setCornerRadius(dp(24));
        bg.setColor(Color.parseColor("#1E1446"));
        bg.setStroke(dp(1), Color.parseColor("#5C4BA8"));
        b.setBackground(bg);
        b.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(50));
        lp.topMargin = dp(10);
        b.setLayoutParams(lp);
        b.setOnClickListener(l);
        return b;
    }

    private View space(int h) {
        View v = new View(this);
        v.setLayoutParams(new LinearLayout.LayoutParams(1, dp(h)));
        return v;
    }

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }
}
