package ai.wizards.os;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.os.Bundle;
import android.view.View;
import android.view.inputmethod.InputMethodManager;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import com.google.zxing.integration.android.IntentIntegrator;
import com.google.zxing.integration.android.IntentResult;

/** Native first-run screen; no remote code runs until the owner confirms a checked address. */
public final class ConnectActivity extends Activity {
    private EditText address;
    private TextView status;
    private Button connect, scan;
    private boolean checking;
    private int generation;
    private int ink = Color.rgb(241, 240, 245), accent = Color.rgb(184, 156, 255);

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        // Appearance v1 standalone dark fallback; settings passes the current shell's validated colour tokens.
        int base = colour("base", Color.rgb(15, 14, 20));
        ink = colour("ink", ink); accent = colour("accent", accent);
        getWindow().setStatusBarColor(base); getWindow().setNavigationBarColor(base);
        ScrollView scroll = new ScrollView(this); scroll.setBackgroundColor(base);
        LinearLayout body = new LinearLayout(this); body.setOrientation(LinearLayout.VERTICAL);
        int pad = (int) (24 * getResources().getDisplayMetrics().density); body.setPadding(pad, pad * 2, pad, pad);
        scroll.addView(body);
        TextView title = text("Connect to your Wizard", 28); body.addView(title);
        body.addView(text("On your Mac or box, open Setup → Use Wizard on your phone. Sign in to Tailscale on this phone with the same account, then scan the Wizard QR or paste its HTTPS address.", 17));
        scan = new Button(this); scan.setText("Scan QR code"); body.addView(scan);
        scan.setOnClickListener(v -> new IntentIntegrator(this).setDesiredBarcodeFormats(IntentIntegrator.QR_CODE)
                .setPrompt("Scan the Wizard connection QR in Setup").setBeepEnabled(false).setOrientationLocked(false).initiateScan());
        address = new EditText(this); address.setTextColor(ink); address.setHintTextColor(ink);
        address.setHint("https://your-box.example.ts.net"); address.setSingleLine(true);
        address.setInputType(android.text.InputType.TYPE_CLASS_TEXT | android.text.InputType.TYPE_TEXT_VARIATION_URI);
        address.setContentDescription("Wizard address"); body.addView(address);
        connect = new Button(this); connect.setBackgroundTintList(android.content.res.ColorStateList.valueOf(accent)); connect.setTextColor(base); connect.setText("Connect"); body.addView(connect); connect.setOnClickListener(v -> connect());
        if (!ServerSettings.origin(this).isEmpty()) {
            Button cancel = new Button(this); cancel.setText("Keep current Wizard"); body.addView(cancel); cancel.setOnClickListener(v -> returnToWizard());
            address.setText(ServerSettings.origin(this));
        }
        status = text("Only the selected Wizard receives native requests. A QR code does not grant sign-in.", 15); status.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE); body.addView(status);
        setContentView(scroll);
        if (state != null) address.setText(state.getString("address", "")); else prefill(getIntent());
        if (android.os.Build.VERSION.SDK_INT >= 33) getOnBackInvokedDispatcher().registerOnBackInvokedCallback(android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::back);
    }

    private int colour(String key, int fallback) {
        String v = getIntent().getStringExtra(key);
        if (v == null || !v.matches("#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})")) return fallback;
        if (v.length() == 4) v = "#" + v.charAt(1) + v.charAt(1) + v.charAt(2) + v.charAt(2) + v.charAt(3) + v.charAt(3);
        return Color.parseColor(v);
    }
    private TextView text(String value, int size) {
        TextView t = new TextView(this); t.setText(value); t.setTextSize(size); t.setTextColor(ink); t.setPadding(0, 12, 0, 20); return t;
    }
    private void prefill(Intent intent) {
        if (intent.getData() == null) return;
        String origin = ServerOrigin.parse(intent.getData().toString());
        if (origin == null) status.setText("Invalid connection QR. Use the Wizard QR, not the Tailscale sign-in QR.");
        else { address.setText(origin); status.setText("Check this Wizard address, then tap Connect."); }
    }
    @Override protected void onNewIntent(Intent intent) { super.onNewIntent(intent); setIntent(intent); if (!checking) prefill(intent); }
    @Override protected void onSaveInstanceState(Bundle out) { out.putString("address", address.getText().toString()); super.onSaveInstanceState(out); }
    @Override protected void onActivityResult(int request, int result, Intent data) {
        IntentResult qr = IntentIntegrator.parseActivityResult(request, result, data);
        if (qr == null) { super.onActivityResult(request, result, data); return; }
        if (qr.getContents() == null) { status.setText("Scan cancelled. You can paste the address instead."); return; }
        String origin = ServerOrigin.parse(qr.getContents());
        if (origin == null) status.setText("Not a Wizard connection QR. Scan the box address in Setup.");
        else { address.setText(origin); status.setText("QR scanned. Check the address, then tap Connect."); }
    }
    private void connect() {
        if (checking) return;
        final String origin = ServerOrigin.parse(address.getText().toString(), BuildConfig.DEBUG);
        if (origin == null) { status.setText("Enter an HTTPS box address without credentials, query or fragment."); return; }
        final int attempt = ++generation;
        checking = true; connect.setEnabled(false); scan.setEnabled(false); address.setEnabled(false);
        status.setText("Checking your Wizard…");
        InputMethodManager keyboard = getSystemService(InputMethodManager.class); if (keyboard != null) keyboard.hideSoftInputFromWindow(address.getWindowToken(), 0);
        new Thread(() -> {
            String error = null;
            try { WizardProbe.check(origin); } catch (Exception e) { error = "Could not verify this Wizard. Check the address, Tailscale, HTTPS certificate and owner access, then retry."; }
            final String failure = error;
            runOnUiThread(() -> {
                if (isFinishing() || isDestroyed() || generation != attempt) return;
                checking = false; connect.setEnabled(true); scan.setEnabled(true); address.setEnabled(true);
                if (failure != null) { status.setText(failure); return; }
                if (!ServerSettings.save(this, origin)) { status.setText("Could not change Wizard. Finish any native recordings/uploads first, or retry saving."); return; }
                returnToWizard();
            });
        }, "WizardConnect").start();
    }
    private void returnToWizard() {
        // App-session document tasks from the old box must not keep privileged bridges alive after a switch.
        android.app.ActivityManager am = getSystemService(android.app.ActivityManager.class);
        if (am != null) for (android.app.ActivityManager.AppTask task : am.getAppTasks()) {
            if (task.getTaskInfo().taskId != getTaskId()) task.finishAndRemoveTask();
        }
        startActivity(new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK)); finish();
    }
    private void back() {
        if (checking) { generation++; checking = false; connect.setEnabled(true); scan.setEnabled(true); address.setEnabled(true); }
        if (!ServerSettings.origin(this).isEmpty()) returnToWizard();
        // Unconfigured root stays open. Camera/keyboard Back are consumed by their own nested surfaces first.
    }
    @Override public void onBackPressed() { back(); }
    @Override protected void onDestroy() { generation++; super.onDestroy(); }
}
