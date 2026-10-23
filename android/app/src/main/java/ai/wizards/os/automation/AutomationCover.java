package ai.wizards.os.automation;

import android.content.Context;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.util.Log;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;

/**
 * The overlay a target app runs under (an accessibility overlay, so no extra permission). Generic: every word comes
 * from the caller (web) through {@link AutomationEngine}; this class only lays them out. States: a small draggable
 * recording card (touches reach the target app), a small "saved" card, and a full cover (touches are swallowed)
 * with progress, confirm, done and failed states.
 *
 * The confirm state's primary button is the ONLY path in the app that presses a commit (money) button, and only
 * from a real touch on this view; no bridge method reaches {@link Listener#confirm()}.
 */
final class AutomationCover {
    interface Listener {
        void cancel();
        void finishRecording();
        void confirm();
        void leave();
        void openWizard();
        Context context();
        boolean canDraw();
    }

    private final Listener l;
    private WindowManager wm;
    private View view;
    private WindowManager.LayoutParams lp;
    private boolean full;
    private TextView recordLine;
    private boolean saved;

    AutomationCover(Listener l) { this.l = l; }

    private Context ctx() { return l.context(); }

    private int dp(float v) { return Math.round(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, ctx().getResources().getDisplayMetrics())); }

    private void show(View v, boolean fullScreen) {
        hide();
        Context c = ctx();
        wm = c.getSystemService(WindowManager.class);
        int type = l.canDraw() ? WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY : WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY;
        lp = new WindowManager.LayoutParams(
                WindowManager.LayoutParams.MATCH_PARENT,
                fullScreen ? WindowManager.LayoutParams.MATCH_PARENT : WindowManager.LayoutParams.WRAP_CONTENT,
                type,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN
                        | (fullScreen ? WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON : 0),
                PixelFormat.TRANSLUCENT);
        lp.gravity = Gravity.TOP;
        if (Build.VERSION.SDK_INT >= 28) lp.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
        lp.setTitle("WizardAutomationCover");
        try { wm.addView(v, lp); view = v; full = fullScreen; }
        catch (Exception e) { Log.w(AutomationEngine.TAG, "cover failed", e); view = null; }
    }

    void hide() {
        if (view != null && wm != null) { try { wm.removeView(view); } catch (Exception ignored) { } }
        view = null; recordLine = null; saved = false; title = null;
    }

    boolean showing() { return view != null; }
    boolean showingSaved() { return saved && view != null; }

    /** Lets one synthetic tap through to the target (only when it ignores a direct click). */
    void passThrough(boolean on) {
        if (view == null || wm == null || lp == null) return;
        if (on) lp.flags |= WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE; else lp.flags &= ~WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE;
        view.setAlpha(on ? 0.98f : 1f);
        try { wm.updateViewLayout(view, lp); } catch (Exception ignored) { }
    }

    /* ------------------------------------------------------------------ recording card */

    /** A small card on the right edge, part way down, draggable; every other touch goes to the target app. */
    void showRecording(String label, String name, String line, String cancelDesc, String done, String doneDesc) {
        LinearLayout card = new LinearLayout(ctx());
        card.setOrientation(LinearLayout.VERTICAL);
        card.setPadding(dp(12), dp(10), dp(12), dp(10));
        GradientDrawable bg = new GradientDrawable();
        bg.setCornerRadii(new float[]{dp(18), dp(18), 0, 0, 0, 0, dp(18), dp(18)});
        bg.setColor(Color.argb(242, 22, 14, 44));
        bg.setStroke(dp(1), Color.argb(120, 170, 130, 255));
        card.setBackground(bg);
        TextView t = text(label, 11, Color.argb(210, 190, 170, 255), true);
        TextView n = text(name, 14, Color.WHITE, true); n.setMaxWidth(dp(150)); n.setSingleLine(true); n.setEllipsize(android.text.TextUtils.TruncateAt.END);
        TextView ln = text(line, 11, Color.argb(190, 220, 210, 255), false);
        ln.setMaxWidth(dp(150)); ln.setMaxLines(3); ln.setEllipsize(android.text.TextUtils.TruncateAt.END);
        card.addView(t); card.addView(n); card.addView(ln);
        LinearLayout btns = row();
        Button cancel = button("✕", false); cancel.setContentDescription(cancelDesc);
        cancel.setOnClickListener(v -> l.cancel());
        Button d = button(done, true); d.setContentDescription(doneDesc);
        d.setOnClickListener(v -> l.finishRecording());
        btns.addView(cancel, new LinearLayout.LayoutParams(dp(40), dp(38)));
        LinearLayout.LayoutParams dl = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, dp(38)); dl.leftMargin = dp(6);
        btns.addView(d, dl);
        LinearLayout.LayoutParams bl = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT); bl.topMargin = dp(8);
        card.addView(btns, bl);
        show(card, false);
        recordLine = ln;
        if (lp != null && view != null) {
            lp.width = WindowManager.LayoutParams.WRAP_CONTENT;
            lp.gravity = Gravity.END | Gravity.TOP;
            lp.y = ctx().getResources().getDisplayMetrics().heightPixels * 2 / 5;
            try { wm.updateViewLayout(view, lp); } catch (Exception ignored) { }
            draggable(card);
        }
    }

    private void draggable(View card) {
        final float[] down = new float[2];
        card.setOnTouchListener((v, e) -> {
            switch (e.getActionMasked()) {
                case android.view.MotionEvent.ACTION_DOWN: down[0] = e.getRawY(); down[1] = lp.y; return true;
                case android.view.MotionEvent.ACTION_MOVE:
                    lp.y = Math.max(dp(40), Math.round(down[1] + e.getRawY() - down[0]));
                    try { wm.updateViewLayout(view, lp); } catch (Exception ignored) { }
                    return true;
                default: return true;
            }
        });
    }

    void recordingLine(String s) {
        if (recordLine != null && !s.contentEquals(recordLine.getText())) recordLine.setText(s);
    }

    /** Off while the user is in another app (the card belongs on the target), back when the target is. */
    void recordingVisible(boolean on) {
        if (view == null || full) return;
        view.setVisibility(on ? View.VISIBLE : View.GONE);
    }

    /** After the user committed in the target app himself: a small card over its next screen. */
    void showSaved(String title, String name, String ok, String open, String openDesc) {
        LinearLayout card = new LinearLayout(ctx());
        card.setOrientation(LinearLayout.VERTICAL);
        card.setPadding(dp(14), dp(10), dp(14), dp(12));
        GradientDrawable bg = new GradientDrawable();
        bg.setCornerRadius(dp(18));
        bg.setColor(Color.argb(245, 14, 34, 22));
        bg.setStroke(dp(1), Color.argb(150, 0, 200, 95));
        card.setBackground(bg);
        card.addView(text(title, 12, Color.rgb(120, 230, 160), true));
        if (!name.isEmpty()) {
            TextView n = text(name, 15, Color.WHITE, true); n.setSingleLine(true); n.setEllipsize(android.text.TextUtils.TruncateAt.END);
            card.addView(n);
        }
        LinearLayout btns = row();
        Button okb = button(ok, false); okb.setOnClickListener(v -> hide());
        Button ren = button(open, true); ren.setContentDescription(openDesc);
        ren.setOnClickListener(v -> { hide(); l.openWizard(); });
        btns.addView(okb, new LinearLayout.LayoutParams(dp(64), dp(38)));
        LinearLayout.LayoutParams rl = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, dp(38)); rl.leftMargin = dp(8);
        btns.addView(ren, rl);
        LinearLayout.LayoutParams bl = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT); bl.topMargin = dp(8);
        card.addView(btns, bl);
        show(card, false);
        if (lp != null && view != null) {
            lp.width = WindowManager.LayoutParams.WRAP_CONTENT;
            lp.gravity = Gravity.CENTER_HORIZONTAL | Gravity.TOP;
            lp.y = dp(64);
            try { wm.updateViewLayout(view, lp); } catch (Exception ignored) { }
        }
        saved = true;
    }

    /* ------------------------------------------------------------------ full cover */

    private ProgressBar bar;
    private TextView title, sub;
    private LinearLayout actions;

    private void ensureFull() {
        if (view != null && full && title != null) return;
        FrameLayout root = new FrameLayout(ctx());
        root.setBackgroundColor(Color.rgb(9, 6, 20));
        root.setClickable(true); // swallow touches: nothing reaches the target app underneath
        LinearLayout col = new LinearLayout(ctx()); col.setOrientation(LinearLayout.VERTICAL); col.setGravity(Gravity.CENTER_HORIZONTAL);
        col.setPadding(dp(28), 0, dp(28), 0);
        TextView orb = text("◉", 64, Color.rgb(170, 130, 255), false); orb.setGravity(Gravity.CENTER);
        TextView tt = text("", 22, Color.WHITE, true); tt.setGravity(Gravity.CENTER);
        sub = text("", 14, Color.argb(200, 220, 210, 255), false); sub.setGravity(Gravity.CENTER);
        bar = new ProgressBar(ctx(), null, android.R.attr.progressBarStyleHorizontal);
        bar.setMax(100);
        actions = new LinearLayout(ctx()); actions.setOrientation(LinearLayout.VERTICAL);
        col.addView(orb);
        LinearLayout.LayoutParams m = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT); m.topMargin = dp(14);
        col.addView(tt, m);
        LinearLayout.LayoutParams m2 = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT); m2.topMargin = dp(8);
        col.addView(sub, m2);
        LinearLayout.LayoutParams m3 = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(10)); m3.topMargin = dp(22);
        col.addView(bar, m3);
        LinearLayout.LayoutParams m4 = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT); m4.topMargin = dp(28);
        col.addView(actions, m4);
        root.addView(col, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.WRAP_CONTENT, Gravity.CENTER));
        show(root, true);
        title = tt;
    }

    void showProgress(String t, String s, int step, int of, String cancel) {
        ensureFull();
        if (title == null) return;
        title.setText(t);
        sub.setText(s);
        bar.setIndeterminate(false);
        bar.setVisibility(View.VISIBLE);
        bar.setProgress(of == 0 ? 5 : Math.max(5, step * 100 / of));
        actions.removeAllViews();
        Button c = button(cancel, false); c.setOnClickListener(v -> l.cancel());
        actions.addView(c, wide(46));
    }

    /** {@code confirm} null: no commit button showed, so there is nothing to confirm (leave/cancel only). */
    void showConfirm(String t, String s, String confirm, String confirmDesc, String leave, String cancel) {
        ensureFull();
        if (title == null) return;
        title.setText(t);
        sub.setText(s);
        bar.setVisibility(View.GONE);
        actions.removeAllViews();
        if (confirm != null) {
            Button place = button(confirm, true);
            place.setContentDescription(confirmDesc);
            place.setOnClickListener(v -> l.confirm());
            actions.addView(place, wide(52));
        }
        Button look = button(leave, false); look.setOnClickListener(v -> l.leave());
        actions.addView(look, wide(46));
        Button c = button(cancel, false); c.setOnClickListener(v -> l.cancel());
        actions.addView(c, wide(46));
    }

    void showBusy(String t, String s) {
        ensureFull();
        if (title == null) return;
        title.setText(t);
        sub.setText(s);
        bar.setVisibility(View.VISIBLE); bar.setIndeterminate(true);
        actions.removeAllViews();
    }

    void showDone(String t, String s) {
        ensureFull();
        if (title == null) return;
        bar.setIndeterminate(false); bar.setVisibility(View.GONE);
        title.setText(t);
        sub.setText(s);
        actions.removeAllViews();
    }

    void showFailed(String t, String s, String leave, String close) {
        ensureFull();
        if (title == null) return;
        bar.setIndeterminate(false); bar.setVisibility(View.GONE);
        title.setText(t);
        sub.setText(s);
        actions.removeAllViews();
        Button look = button(leave, true); look.setOnClickListener(v -> l.leave());
        actions.addView(look, wide(48));
        Button c = button(close, false); c.setOnClickListener(v -> l.cancel());
        actions.addView(c, wide(46));
    }

    /* ------------------------------------------------------------------ bits */

    private LinearLayout.LayoutParams wide(int h) {
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(h));
        p.topMargin = dp(10);
        return p;
    }

    private LinearLayout row() {
        LinearLayout r = new LinearLayout(ctx());
        r.setOrientation(LinearLayout.HORIZONTAL);
        r.setGravity(Gravity.CENTER_VERTICAL);
        return r;
    }

    private TextView text(String s, int sp, int color, boolean bold) {
        TextView t = new TextView(ctx());
        t.setText(s); t.setTextSize(TypedValue.COMPLEX_UNIT_SP, sp); t.setTextColor(color);
        if (bold) t.setTypeface(Typeface.DEFAULT_BOLD);
        return t;
    }

    private Button button(String s, boolean primary) {
        Button b = new Button(ctx());
        b.setText(s); b.setAllCaps(false); b.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16);
        b.setTextColor(primary ? Color.rgb(10, 18, 12) : Color.WHITE);
        GradientDrawable g = new GradientDrawable();
        g.setCornerRadius(dp(14));
        g.setColor(primary ? Color.rgb(0, 200, 95) : Color.argb(40, 255, 255, 255));
        b.setBackground(g);
        b.setPadding(dp(16), 0, dp(16), 0);
        return b;
    }
}
