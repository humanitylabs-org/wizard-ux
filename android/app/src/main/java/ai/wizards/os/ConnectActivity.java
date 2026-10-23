package ai.wizards.os;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.text.TextUtils;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.view.inputmethod.EditorInfo;
import android.view.inputmethod.InputMethodManager;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import com.google.zxing.integration.android.IntentIntegrator;
import com.google.zxing.integration.android.IntentResult;

/**
 * Native first-run / Change Wizard screen; no remote code runs until the owner confirms a checked address.
 * Dressed like the shell's Settings (st-title, st-group, st-row, st-note, st-wide in core/settings.css) in the
 * worn skin's colours (WizardLook), with the Nebula dark fallback on first run (James 24 Oct 2026: "hideous").
 */
public final class ConnectActivity extends Activity {
    private EditText address;
    private TextView status;
    private View connect, scan;
    private boolean checking;
    private int generation;
    private WizardLook look;
    private Typeface labelFace = Typeface.DEFAULT_BOLD;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setSoftInputMode(android.view.WindowManager.LayoutParams.SOFT_INPUT_STATE_ALWAYS_HIDDEN | android.view.WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
        look = WizardLook.load(this);
        if (look.square()) labelFace = Typeface.create(Typeface.MONOSPACE, Typeface.BOLD);
        boolean switching = !ServerSettings.origin(this).isEmpty();
        getWindow().setStatusBarColor(Color.TRANSPARENT); getWindow().setNavigationBarColor(Color.TRANSPARENT);
        if (android.os.Build.VERSION.SDK_INT >= 30 && getWindow().getInsetsController() != null) {
            int lightBars = android.view.WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS | android.view.WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;
            getWindow().getInsetsController().setSystemBarsAppearance(look.isLight() ? lightBars : 0, lightBars);
        }

        FrameLayout root = new FrameLayout(this);
        // The shell's .device glow: the accent rising softly from the bottom into the skin's base.
        GradientDrawable sky = new GradientDrawable(GradientDrawable.Orientation.BOTTOM_TOP,
                new int[]{ WizardLook.over(WizardLook.withAlpha(look.accent, 0.16f), look.base), look.base, look.base });
        root.setBackground(sky);
        ScrollView scroll = new ScrollView(this); scroll.setFillViewport(true); scroll.setClipToPadding(false);
        root.addView(scroll, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        LinearLayout body = new LinearLayout(this); body.setOrientation(LinearLayout.VERTICAL);
        body.setPadding(dp(20), dp(12), dp(20), dp(24));
        scroll.addView(body, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        root.setOnApplyWindowInsetsListener((v, in) -> {
            android.graphics.Insets bars = in.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
            int ime = in.getInsets(WindowInsets.Type.ime()).bottom;
            scroll.setPadding(bars.left, bars.top, bars.right, Math.max(bars.bottom, ime));
            return WindowInsets.CONSUMED;
        });

        // Header: back (when there is a Wizard to go back to) + title, like a Settings sub-page.
        LinearLayout head = new LinearLayout(this); head.setGravity(Gravity.CENTER_VERTICAL);
        if (switching) {
            TextView back = label("‹", 26, look.text, false); back.setGravity(Gravity.CENTER);
            back.setBackground(round(look.surface(), look.border, 99)); back.setContentDescription("Back to your Wizard");
            back.setOnClickListener(v -> back());
            head.addView(back, new LinearLayout.LayoutParams(dp(40), dp(40)));
        }
        TextView title = label(switching ? "Change Wizard" : "Connect to your Wizard", 22, look.text, true);
        title.setTypeface(look.square() ? labelFace : Typeface.create("sans-serif-medium", Typeface.NORMAL));
        LinearLayout.LayoutParams tl = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1); tl.leftMargin = switching ? dp(12) : dp(4);
        head.addView(title, tl);
        body.addView(head);

        ImageView orb = new ImageView(this);
        try (java.io.InputStream in = getAssets().open("assist/robert-thread-orb.png")) { Bitmap b = BitmapFactory.decodeStream(in); orb.setImageBitmap(b); } catch (Exception ignored) { }
        orb.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
        LinearLayout.LayoutParams ol = new LinearLayout.LayoutParams(dp(96), dp(96)); ol.gravity = Gravity.CENTER_HORIZONTAL; ol.topMargin = dp(28); ol.bottomMargin = dp(8);
        body.addView(orb, ol);
        TextView lead = label(switching ? "Point this phone at another Wizard, or this one again." : "Link this phone to your Wizard.", 15, look.text2, false);
        lead.setGravity(Gravity.CENTER_HORIZONTAL);
        body.addView(lead, margins(dp(4), 0, dp(28)));

        // Scan: one Settings row.
        body.addView(groupLabel("Scan"));
        scan = row("▦", "Scan QR code", "On your computer, open Setup › Use Wizard on your phone");
        scan.setOnClickListener(v -> new IntentIntegrator(this).setDesiredBarcodeFormats(IntentIntegrator.QR_CODE)
                .setPrompt("Scan the Wizard QR in Setup").setBeepEnabled(false).setOrientationLocked(false).initiateScan());
        body.addView(scan, margins(0, 0, dp(16)));

        // Or type it.
        body.addView(groupLabel("Or enter its address"));
        address = new EditText(this); address.setTextColor(look.text); address.setHintTextColor(look.muted);
        address.setHint("https://your-wizard.ts.net"); address.setSingleLine(true); address.setTextSize(15);
        address.setInputType(android.text.InputType.TYPE_CLASS_TEXT | android.text.InputType.TYPE_TEXT_VARIATION_URI);
        address.setImeOptions(EditorInfo.IME_ACTION_GO);
        address.setOnEditorActionListener((v, id, ev) -> { if (id == EditorInfo.IME_ACTION_GO) { connect(); return true; } return false; });
        address.setBackground(round(look.surface(), look.border, 14)); address.setPadding(dp(14), 0, dp(14), 0);
        address.setMinHeight(dp(52)); address.setContentDescription("Wizard address");
        if (android.os.Build.VERSION.SDK_INT >= 29) { address.setTextCursorDrawable(null); }
        body.addView(address, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(52)));

        status = label("", 13, look.text2, false); status.setVisibility(View.GONE);
        status.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);
        body.addView(status, margins(dp(10), 0, 0));

        View spacer = new View(this); body.addView(spacer, new LinearLayout.LayoutParams(1, 0, 1));

        TextView go = label("Connect", 16, look.onAccent(), true); go.setGravity(Gravity.CENTER);
        go.setBackground(round(look.accent, 0, 16)); go.setOnClickListener(v -> connect()); connect = go;
        body.addView(go, sized(ViewGroup.LayoutParams.MATCH_PARENT, dp(52), dp(24), 0));
        if (switching) {
            TextView keep = label("Keep current Wizard", 15, look.text2, true); keep.setGravity(Gravity.CENTER);
            keep.setOnClickListener(v -> returnToWizard());
            body.addView(keep, sized(ViewGroup.LayoutParams.MATCH_PARENT, dp(48), dp(4), 0));
            address.setText(ServerSettings.origin(this));
        }
        TextView note = label("A QR code only fills in the address. Your Wizard still asks you to sign in.", 12, look.muted, false);
        note.setGravity(Gravity.CENTER_HORIZONTAL);
        body.addView(note, margins(dp(8), dp(4), 0));

        setContentView(root);
        if (state != null) address.setText(state.getString("address", "")); else prefill(getIntent());
        if (android.os.Build.VERSION.SDK_INT >= 33) getOnBackInvokedDispatcher().registerOnBackInvokedCallback(android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::back);
    }

    /* ---------- Settings-styled pieces ---------- */
    private int dp(float v) { return Math.round(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, getResources().getDisplayMetrics())); }
    private int radius(int r) { return look.square() ? dp(2) : dp(r); }
    private GradientDrawable round(int fill, int stroke, int r) {
        GradientDrawable g = new GradientDrawable(); g.setColor(fill); g.setCornerRadius(r >= 99 ? dp(99) : radius(r));
        if (stroke != 0) g.setStroke(Math.max(1, dp(1)), stroke);
        return g;
    }
    private TextView label(String value, float sp, int colour, boolean bold) {
        TextView t = new TextView(this); t.setText(value); t.setTextSize(sp); t.setTextColor(colour);
        t.setTypeface(bold ? Typeface.create("sans-serif-medium", Typeface.NORMAL) : Typeface.DEFAULT);
        t.setLineSpacing(0, 1.15f); return t;
    }
    /** .st-group h4: small, heavy, tracked, uppercase, muted. */
    private TextView groupLabel(String value) {
        TextView t = label(value.toUpperCase(java.util.Locale.ROOT), 11, look.muted, true);
        t.setTypeface(labelFace); t.setLetterSpacing(0.12f); t.setPadding(dp(4), 0, dp(4), dp(8)); return t;
    }
    /** .st-row: surface card, accent-soft icon tile, title + muted sub, chevron. */
    private LinearLayout row(String icon, String title, String sub) {
        LinearLayout r = new LinearLayout(this); r.setGravity(Gravity.CENTER_VERTICAL); r.setPadding(dp(12), dp(12), dp(12), dp(12));
        r.setBackground(round(look.surface(), look.border, 18)); r.setClickable(true); r.setFocusable(true);
        r.setContentDescription(title);
        TextView ic = label(icon, 17, look.accent, false); ic.setGravity(Gravity.CENTER); ic.setBackground(round(look.accentSoft(), 0, 12));
        r.addView(ic, new LinearLayout.LayoutParams(dp(34), dp(34)));
        LinearLayout tx = new LinearLayout(this); tx.setOrientation(LinearLayout.VERTICAL);
        TextView b = label(title, 15, look.text, true); TextView s = label(sub, 12.5f, look.muted, false);
        s.setEllipsize(TextUtils.TruncateAt.END);
        tx.addView(b); tx.addView(s, margins(dp(2), 0, 0));
        LinearLayout.LayoutParams txl = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1); txl.leftMargin = dp(12); txl.rightMargin = dp(8);
        r.addView(tx, txl);
        r.addView(label("›", 22, look.muted, false));
        return r;
    }
    private LinearLayout.LayoutParams margins(int top, int sides, int bottom) {
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        p.topMargin = top; p.bottomMargin = bottom; p.leftMargin = sides; p.rightMargin = sides; return p;
    }
    private LinearLayout.LayoutParams sized(int w, int h, int top, int bottom) {
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(w, h); p.topMargin = top; p.bottomMargin = bottom; return p;
    }
    private void say(String text, boolean problem) {
        status.setText(text); status.setVisibility(text.isEmpty() ? View.GONE : View.VISIBLE);
        status.setTextColor(problem ? look.text : look.text2);
        status.setPadding(problem ? dp(10) : dp(4), 0, dp(4), 0);
        if (problem) status.setBackground(accentBar());
        else status.setBackground(null);
    }
    /** .sc-error: a 2px accent rule on the left. */
    private android.graphics.drawable.Drawable accentBar() {
        android.graphics.drawable.ShapeDrawable line = new android.graphics.drawable.ShapeDrawable(); line.getPaint().setColor(look.accent);
        android.graphics.drawable.LayerDrawable l = new android.graphics.drawable.LayerDrawable(new android.graphics.drawable.Drawable[]{ line });
        l.setLayerWidth(0, dp(2)); l.setLayerGravity(0, Gravity.START | Gravity.FILL_VERTICAL); return l;
    }
    private void busy(boolean on) {
        connect.setEnabled(!on); scan.setEnabled(!on); address.setEnabled(!on);
        connect.setAlpha(on ? 0.5f : 1f); scan.setAlpha(on ? 0.5f : 1f);
    }

    private void prefill(Intent intent) {
        if (intent.getData() == null) return;
        String origin = ServerOrigin.parse(intent.getData().toString());
        if (origin == null) say("That QR isn't a Wizard address. Scan the QR in Setup, not the Tailscale sign-in one.", true);
        else { address.setText(origin); say("Check the address, then tap Connect.", false); }
    }
    @Override protected void onNewIntent(Intent intent) { super.onNewIntent(intent); setIntent(intent); if (!checking) prefill(intent); }
    @Override protected void onSaveInstanceState(Bundle out) { out.putString("address", address.getText().toString()); super.onSaveInstanceState(out); }
    @Override protected void onActivityResult(int request, int result, Intent data) {
        IntentResult qr = IntentIntegrator.parseActivityResult(request, result, data);
        if (qr == null) { super.onActivityResult(request, result, data); return; }
        if (qr.getContents() == null) { say("", false); return; }
        String origin = ServerOrigin.parse(qr.getContents());
        if (origin == null) say("That QR isn't a Wizard address. Scan the QR in Setup › Use Wizard on your phone.", true);
        else { address.setText(origin); say("Scanned. Check the address, then tap Connect.", false); }
    }
    private void connect() {
        if (checking) return;
        final String origin = ServerOrigin.parse(address.getText().toString(), BuildConfig.DEBUG);
        if (origin == null) { say("Enter your Wizard's https:// address, like https://wizard.your-tailnet.ts.net", true); return; }
        final int attempt = ++generation;
        checking = true; busy(true);
        say("Checking your Wizard…", false);
        InputMethodManager keyboard = getSystemService(InputMethodManager.class); if (keyboard != null) keyboard.hideSoftInputFromWindow(address.getWindowToken(), 0);
        new Thread(() -> {
            String error = null;
            try { WizardProbe.check(origin); } catch (Exception e) { error = "Couldn't reach that Wizard. Check the address and that Tailscale is on, then try again."; }
            final String failure = error;
            runOnUiThread(() -> {
                if (isFinishing() || isDestroyed() || generation != attempt) return;
                checking = false; busy(false);
                if (failure != null) { say(failure, true); return; }
                if (!ServerSettings.save(this, origin)) { say("Couldn't switch yet. Let any recording or upload finish, then try again.", true); return; }
                returnToWizard();
            });
        }, "WizardConnect").start();
    }
    private void returnToWizard() {
        // App-session document tasks from the old box must not keep privileged bridges alive after a switch.
        android.app.ActivityManager am = getSystemService(android.app.ActivityManager.class);
        if (am != null) for (android.app.ActivityManager.AppTask task : am.getAppTasks()) {
            if (task.getTaskInfo().id != getTaskId()) task.finishAndRemoveTask();
        }
        startActivity(new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK)); finish();
    }
    private void back() {
        if (checking) { generation++; checking = false; busy(false); say("", false); }
        if (!ServerSettings.origin(this).isEmpty()) returnToWizard();
        // Unconfigured root stays open. Camera/keyboard Back are consumed by their own nested surfaces first.
    }
    @Override public void onBackPressed() { back(); }
    @Override protected void onDestroy() { generation++; super.onDestroy(); }
}
