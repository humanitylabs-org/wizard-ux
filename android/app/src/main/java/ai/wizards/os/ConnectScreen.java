package ai.wizards.os;

import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.text.InputType;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.inputmethod.EditorInfo;
import android.view.inputmethod.InputMethodManager;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;

import ai.wizards.os.device.WizardAddress;

/**
 * "Connect to your Wizard": the first screen of a build that carries no address (rules in ConnectPolicy).
 * A plain native view over the WebView. The owner pastes or types the address their Wizard's Setup app shows
 * (https://<machine>.<tailnet>.ts.net), or arrives here from a connect link with it filled in; Connect saves it
 * (device/WizardAddress) and the app opens their Wizard. Back never leaves the app from here.
 */
final class ConnectScreen {
    private static final int BG = Color.rgb(5, 3, 12);
    private static final int INK = Color.rgb(233, 228, 255);
    private static final int VIOLET = Color.rgb(155, 123, 255);

    interface Done { void connected(String origin); }

    private final Activity a;
    private final FrameLayout view;
    private final EditText field;
    private final TextView error;

    ConnectScreen(Activity a, FrameLayout parent, Done done) {
        this.a = a;
        view = new FrameLayout(a);
        view.setBackgroundColor(BG);
        view.setClickable(true);
        view.setVisibility(View.GONE);
        view.setContentDescription("Connect to your Wizard");

        LinearLayout col = new LinearLayout(a);
        col.setOrientation(LinearLayout.VERTICAL);
        col.setGravity(Gravity.CENTER_HORIZONTAL);
        col.setPadding(dp(32), 0, dp(32), 0);

        TextView orb = text(48, VIOLET, false);
        orb.setText("◉");
        TextView title = text(22, INK, true);
        title.setText(ConnectPolicy.TITLE);
        TextView body = text(16, INK, false);
        body.setAlpha(0.78f);
        body.setText(ConnectPolicy.BODY);

        field = new EditText(a);
        field.setSingleLine(true);
        field.setHint(ConnectPolicy.HINT);
        field.setHintTextColor(Color.argb(90, 233, 228, 255));
        field.setTextColor(INK);
        field.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16);
        field.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        field.setImeOptions(EditorInfo.IME_ACTION_GO);
        field.setContentDescription("Wizard address");
        GradientDrawable box = new GradientDrawable();
        box.setCornerRadius(dp(14));
        box.setColor(Color.argb(28, 155, 123, 255));
        box.setStroke(dp(1), Color.argb(90, 155, 123, 255));
        field.setBackground(box);
        field.setPadding(dp(16), dp(12), dp(16), dp(12));

        error = text(13, Color.rgb(255, 150, 170), false);
        error.setVisibility(View.GONE);

        TextView connect = pill("Connect", true);
        TextView paste = pill("Paste address", false);
        Runnable submit = () -> {
            String o = WizardAddress.normalize(field.getText().toString());
            if (o.isEmpty()) { error.setText(ConnectPolicy.INVALID); error.setVisibility(View.VISIBLE); return; }
            error.setVisibility(View.GONE);
            hideKeyboard();
            done.connected(o);
        };
        connect.setOnClickListener(v -> submit.run());
        field.setOnEditorActionListener((v, id, ev) -> { submit.run(); return true; });
        paste.setOnClickListener(v -> {
            String clip = clipboard();
            if (!clip.isEmpty()) { field.setText(clip); field.setSelection(field.getText().length()); }
        });

        col.addView(orb);
        col.addView(title, lp(dp(12)));
        col.addView(body, lp(dp(10)));
        LinearLayout.LayoutParams fl = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        fl.topMargin = dp(22);
        col.addView(field, fl);
        col.addView(error, lp(dp(8)));
        col.addView(connect, lp(dp(18)));
        col.addView(paste, lp(dp(12)));
        view.addView(col, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.CENTER));
        parent.addView(view, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
    }

    boolean isShowing() { return view.getVisibility() == View.VISIBLE; }

    /** Show, with {@code prefill} ("https://host" from a link) in the field, or empty. */
    void show(String prefill) {
        if (prefill != null && !prefill.isEmpty()) field.setText(prefill);
        error.setVisibility(View.GONE);
        view.setVisibility(View.VISIBLE);
        view.bringToFront();
    }

    void hide() {
        hideKeyboard();
        view.setVisibility(View.GONE);
    }

    void toFront() { if (isShowing()) view.bringToFront(); }

    private String clipboard() {
        try {
            ClipboardManager cm = (ClipboardManager) a.getSystemService(Context.CLIPBOARD_SERVICE);
            ClipData d = cm == null ? null : cm.getPrimaryClip();
            if (d == null || d.getItemCount() == 0) return "";
            CharSequence t = d.getItemAt(0).coerceToText(a);
            return t == null ? "" : t.toString().trim();
        } catch (RuntimeException e) { return ""; }
    }

    private void hideKeyboard() {
        InputMethodManager imm = (InputMethodManager) a.getSystemService(Context.INPUT_METHOD_SERVICE);
        if (imm != null) imm.hideSoftInputFromWindow(field.getWindowToken(), 0);
    }

    /* ---------------- views (same look as ReachScreen) ---------------- */

    private int dp(int v) {
        return Math.round(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, a.getResources().getDisplayMetrics()));
    }

    private LinearLayout.LayoutParams lp(int top) {
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        p.topMargin = top;
        p.gravity = Gravity.CENTER_HORIZONTAL;
        return p;
    }

    private TextView text(int sp, int color, boolean bold) {
        TextView t = new TextView(a);
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, sp);
        t.setTextColor(color);
        t.setGravity(Gravity.CENTER);
        if (bold) t.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
        return t;
    }

    private TextView pill(String label, boolean primary) {
        TextView b = text(16, Color.WHITE, true);
        b.setText(label);
        b.setMinWidth(dp(200));
        b.setPadding(dp(24), dp(13), dp(24), dp(13));
        GradientDrawable g = new GradientDrawable();
        g.setCornerRadius(dp(999));
        if (primary) g.setColor(Color.rgb(91, 61, 214));
        else { g.setColor(Color.TRANSPARENT); g.setStroke(dp(1), Color.argb(110, 155, 123, 255)); }
        b.setBackground(g);
        b.setClickable(true);
        b.setFocusable(true);
        b.setContentDescription(label);
        return b;
    }
}
