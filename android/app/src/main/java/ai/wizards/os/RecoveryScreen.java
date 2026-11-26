package ai.wizards.os;

import android.content.Context;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;

import org.json.JSONObject;

/**
 * The recovery-mode card (wizard-ux issue 1775, switch wizard/phone-recovery-mode): a plain Android view over the
 * shell, so its buttons answer even when the page does not. Three one-tap actions: check for an update (and install
 * it, through the normal updater), send the diagnostics (with the freeze stack) to the Wizard, and start normally.
 * Words come from {@link StartPolicy}; the caller does the work.
 */
final class RecoveryScreen {
    interface Actions {
        void update(boolean install);
        void diagnostics();
        void startNormally();
    }

    private static final int CARD = Color.rgb(20, 15, 38);
    private static final int INK = Color.rgb(233, 228, 255);

    private final Context c;
    private final LinearLayout card;
    private final TextView body, update, diag, normal, status;
    private JSONObject uState;
    private boolean updateInstalls, checking;

    RecoveryScreen(Context c, FrameLayout parent, Actions act) {
        this.c = c;
        card = new LinearLayout(c);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setPadding(dp(20), dp(18), dp(20), dp(16));
        card.setClickable(true); // taps on the card never reach the shell underneath
        card.setContentDescription("Recovery mode");
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(CARD);
        bg.setCornerRadius(dp(22));
        bg.setStroke(dp(1), Color.argb(90, 155, 123, 255));
        card.setBackground(bg);
        card.setElevation(dp(12));
        card.setVisibility(View.GONE);

        TextView title = text(19, INK, true);
        title.setText(StartPolicy.title());
        body = text(14, INK, false);
        body.setAlpha(0.8f);
        update = pill("Check for update", true);
        diag = pill("Send diagnostics", false);
        normal = pill("Start normally", false);
        status = text(13, INK, false);
        status.setAlpha(0.65f);
        status.setVisibility(View.GONE);
        update.setOnClickListener(v -> { if (!checking) act.update(updateInstalls); });
        diag.setOnClickListener(v -> { diag.setEnabled(false); diag.setAlpha(0.5f); act.diagnostics(); });
        normal.setOnClickListener(v -> act.startNormally());

        card.addView(title);
        card.addView(body, lp(dp(6)));
        card.addView(update, lp(dp(16)));
        card.addView(diag, lp(dp(10)));
        card.addView(normal, lp(dp(10)));
        card.addView(status, lp(dp(12)));

        FrameLayout.LayoutParams at = new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM);
        at.setMargins(dp(12), 0, dp(12), dp(12));
        parent.addView(card, at);
    }

    View view() { return card; }
    boolean isShowing() { return card.getVisibility() == View.VISIBLE; }
    void toFront() { card.bringToFront(); }

    void show(String why) {
        body.setText(StartPolicy.body(why));
        card.setVisibility(View.VISIBLE);
        card.bringToFront();
    }

    void hide() { card.setVisibility(View.GONE); }

    /** A check was asked for: say so until the updater answers. */
    void checking(boolean on) { checking = on; paintUpdate(); }

    /** The updater's state ({@code Updater.state()}) changed or was read again. */
    void updateState(JSONObject u) { uState = u; paintUpdate(); }

    private void paintUpdate() {
        JSONObject u = uState;
        String st = u == null ? "" : u.optString("state");
        String line = checking && !StartPolicy.updateBusy(u) && !"current".equals(st) && !"available".equals(st) && !"ready".equals(st)
                ? StartPolicy.updateLine(stateOf("checking")) : StartPolicy.updateLine(u);
        String label = StartPolicy.updateButton(u);
        update.setText(label);
        update.setContentDescription(label);
        updateInstalls = StartPolicy.updateInstalls(u);
        boolean busy = checking || StartPolicy.updateBusy(u);
        update.setEnabled(!busy);
        update.setAlpha(busy ? 0.5f : 1f);
        say(line);
    }

    /** Diagnostics answered: sent or not. The button can be tapped again either way. */
    void diagnosticsSent(boolean ok) {
        diag.setEnabled(true);
        diag.setAlpha(1f);
        say(ok ? "Diagnostics sent to your Wizard." : "Couldn’t reach your Wizard. Try again in a moment.");
    }

    private void say(String line) {
        status.setText(line);
        status.setVisibility(line == null || line.isEmpty() ? View.GONE : View.VISIBLE);
    }

    private static JSONObject stateOf(String s) {
        JSONObject o = new JSONObject();
        try { o.put("state", s); } catch (org.json.JSONException ignored) { }
        return o;
    }

    /* ---------------- views ---------------- */

    private int dp(int v) {
        return Math.round(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, c.getResources().getDisplayMetrics()));
    }

    private LinearLayout.LayoutParams lp(int top) {
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        p.topMargin = top;
        return p;
    }

    private TextView text(int sp, int color, boolean bold) {
        TextView t = new TextView(c);
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, sp);
        t.setTextColor(color);
        t.setGravity(Gravity.CENTER);
        if (bold) t.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
        return t;
    }

    private TextView pill(String label, boolean primary) {
        TextView b = text(16, Color.WHITE, true);
        b.setText(label);
        b.setPadding(dp(20), dp(12), dp(20), dp(12));
        GradientDrawable g = new GradientDrawable();
        g.setCornerRadius(dp(999));
        if (primary) g.setColor(Color.rgb(91, 61, 214));
        else { g.setColor(Color.TRANSPARENT); g.setStroke(dp(1), Color.argb(140, 155, 123, 255)); }
        b.setBackground(g);
        b.setClickable(true);
        b.setFocusable(true);
        b.setContentDescription(label);
        return b;
    }
}
