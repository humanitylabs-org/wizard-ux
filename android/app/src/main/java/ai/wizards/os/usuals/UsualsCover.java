package ai.wizards.os.usuals;

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
 * The cover Grab runs under (an accessibility overlay, so no extra permission): "Ordering your … · step 3 of 6",
 * then the total with Place order / Look first. While teaching, only a small bar with Done sits at the top and every
 * other touch goes to Grab.
 */
final class UsualsCover {
    private final UsualsRunner runner;
    private WindowManager wm;
    private View view;
    private WindowManager.LayoutParams lp;
    private boolean full;
    private TextView teachCountView;

    UsualsCover(UsualsRunner runner) { this.runner = runner; }

    private Context ctx() { return runner.context(); }

    private int dp(float v) { return Math.round(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, ctx().getResources().getDisplayMetrics())); }

    private void show(View v, boolean fullScreen) {
        hide();
        Context c = ctx();
        wm = c.getSystemService(WindowManager.class);
        int type = runner.canDraw() ? WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY : WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY;
        lp = new WindowManager.LayoutParams(
                WindowManager.LayoutParams.MATCH_PARENT,
                fullScreen ? WindowManager.LayoutParams.MATCH_PARENT : WindowManager.LayoutParams.WRAP_CONTENT,
                type,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN
                        | (fullScreen ? WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON : 0),
                PixelFormat.TRANSLUCENT);
        lp.gravity = Gravity.TOP;
        if (Build.VERSION.SDK_INT >= 28) lp.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
        lp.setTitle("WizardUsualsCover");
        try { wm.addView(v, lp); view = v; full = fullScreen; qaDump(); }
        catch (Exception e) { Log.w(UsualsRunner.TAG, "cover failed", e); view = null; }
    }

    /** Debug (QA) builds: log the cover's buttons and where they are (uiautomator would knock the service off). */
    void qaDump() {
        if (!ai.wizards.os.BuildConfig.DEBUG || view == null) return;
        view.postDelayed(() -> {
            if (view == null) return;
            int[] o = new int[2]; view.getLocationOnScreen(o);
            StringBuilder sb = new StringBuilder("cover frame=" + o[0] + "," + o[1] + "," + (o[0] + view.getWidth()) + "," + (o[1] + view.getHeight()));
            walk(view, sb);
            Log.i(UsualsRunner.TAG, sb.toString());
        }, 500);
    }

    private static void walk(View v, StringBuilder sb) {
        if (v.getVisibility() != View.VISIBLE) return;
        if (v instanceof TextView) {
            CharSequence t = ((TextView) v).getText();
            int[] xy = new int[2]; v.getLocationOnScreen(xy);
            if (t != null && t.length() > 0) sb.append(" |").append(t.toString().replace('|', '/').replace('\n', ' '))
                    .append('@').append(xy[0] + v.getWidth() / 2).append(',').append(xy[1] + v.getHeight() / 2);
        }
        if (v instanceof android.view.ViewGroup) {
            android.view.ViewGroup g = (android.view.ViewGroup) v;
            for (int i = 0; i < g.getChildCount(); i++) walk(g.getChildAt(i), sb);
        }
    }

    void hide() {
        if (view != null && ai.wizards.os.BuildConfig.DEBUG) Log.i(UsualsRunner.TAG, "cover hidden");
        if (view != null && wm != null) { try { wm.removeView(view); } catch (Exception ignored) { } }
        view = null; teachCountView = null; saved = false;
    }

    /** Lets one synthetic tap through to Grab (only used when Grab ignores a direct click). */
    void passThrough(boolean on) {
        if (view == null || wm == null || lp == null) return;
        if (on) lp.flags |= WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE; else lp.flags &= ~WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE;
        if (on) view.setAlpha(0.98f); else view.setAlpha(1f);
        try { wm.updateViewLayout(view, lp); } catch (Exception ignored) { }
    }

    /* ------------------------------------------------------------------ teach bar */

    /**
     * A small card on the right edge, half way down: Grab's search bar (top) and basket/checkout buttons (bottom)
     * stay clear. It can be dragged up and down if it sits on something.
     */
    void showTeachBar(String name, boolean browsing) {
        LinearLayout card = new LinearLayout(ctx());
        card.setOrientation(LinearLayout.VERTICAL);
        card.setPadding(dp(12), dp(10), dp(12), dp(10));
        GradientDrawable bg = new GradientDrawable();
        bg.setCornerRadii(new float[]{dp(18), dp(18), 0, 0, 0, 0, dp(18), dp(18)});
        bg.setColor(Color.argb(242, 22, 14, 44));
        bg.setStroke(dp(1), Color.argb(120, 170, 130, 255));
        card.setBackground(bg);
        TextView t = text(browsing ? "Saving this order" : "Teaching", 11, Color.argb(210, 190, 170, 255), true);
        TextView n = text(name, 14, Color.WHITE, true); n.setMaxWidth(dp(150)); n.setSingleLine(true); n.setEllipsize(android.text.TextUtils.TruncateAt.END);
        // show() starts with hide(), which forgets the old card's line: keep this one in a local until it's up.
        TextView line = text(browsing ? "Saves when you order" : "0 steps", 11, Color.argb(190, 220, 210, 255), false);
        line.setMaxWidth(dp(150)); line.setMaxLines(3); line.setEllipsize(android.text.TextUtils.TruncateAt.END);
        card.addView(t); card.addView(n); card.addView(line);
        LinearLayout btns = row();
        Button cancel = button("✕", false); cancel.setContentDescription(browsing ? "Don't save this order" : "Cancel teaching");
        cancel.setOnClickListener(v -> runner.cancel());
        // Browsing: ordering in Grab saves it; Save is for "keep this basket without ordering now".
        Button done = button(browsing ? "Save" : "Done", true); done.setContentDescription(browsing ? "Save without ordering" : "Done teaching");
        done.setOnClickListener(v -> runner.finishTeach());
        btns.addView(cancel, new LinearLayout.LayoutParams(dp(40), dp(38)));
        LinearLayout.LayoutParams dl = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, dp(38)); dl.leftMargin = dp(6);
        btns.addView(done, dl);
        LinearLayout.LayoutParams bl = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT); bl.topMargin = dp(8);
        card.addView(btns, bl);
        show(card, false);
        saved = false;
        teachCountView = line;
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

    void teachCount(int n) {
        if (teachCountView != null) teachCountView.setText(n + (n == 1 ? " step" : " steps") + (n > 0 ? " · Done at checkout" : ""));
    }

    /** Browsing: the basket so far, e.g. "2× Kra pao moo saap · 1× Thai iced tea". */
    void teachLine(String s) {
        if (teachCountView != null && !s.contentEquals(teachCountView.getText())) { teachCountView.setText(s); qaDump(); }
    }

    /** Off while he's in another app (the card belongs on Grab), back when Grab is. */
    void teachVisible(boolean on) {
        if (view == null || full) return;
        view.setVisibility(on ? View.VISIBLE : View.GONE);
        if (on) qaDump();
    }

    private boolean saved;
    boolean showingSaved() { return saved && view != null; }

    /** After he ordered in Grab: a small card on Grab's tracking screen. "Saved as Kra pao · Rename". */
    void showSaved(String name) {
        LinearLayout card = new LinearLayout(ctx());
        card.setOrientation(LinearLayout.VERTICAL);
        card.setPadding(dp(14), dp(10), dp(14), dp(12));
        GradientDrawable bg = new GradientDrawable();
        bg.setCornerRadius(dp(18));
        bg.setColor(Color.argb(245, 14, 34, 22));
        bg.setStroke(dp(1), Color.argb(150, 0, 200, 95));
        card.setBackground(bg);
        card.addView(text("Saved to Usuals ✓", 12, Color.rgb(120, 230, 160), true));
        TextView n = text(name, 15, Color.WHITE, true); n.setSingleLine(true); n.setEllipsize(android.text.TextUtils.TruncateAt.END);
        card.addView(n);
        LinearLayout btns = row();
        Button ok = button("OK", false); ok.setOnClickListener(v -> hide());
        Button ren = button("Rename", true); ren.setContentDescription("Rename this usual");
        ren.setOnClickListener(v -> runner.renameSaved());
        btns.addView(ok, new LinearLayout.LayoutParams(dp(64), dp(38)));
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

    /* ------------------------------------------------------------------ run cover */

    private ProgressBar bar;
    private TextView title, sub;
    private LinearLayout actions;

    private void ensureFull() {
        if (view != null && full && title != null) return;
        FrameLayout root = new FrameLayout(ctx());
        root.setBackgroundColor(Color.rgb(9, 6, 20));
        root.setClickable(true); // swallow touches: nothing reaches Grab underneath
        LinearLayout col = new LinearLayout(ctx()); col.setOrientation(LinearLayout.VERTICAL); col.setGravity(Gravity.CENTER_HORIZONTAL);
        col.setPadding(dp(28), 0, dp(28), 0);
        TextView orb = text("◉", 64, Color.rgb(170, 130, 255), false); orb.setGravity(Gravity.CENTER);
        title = text("", 22, Color.WHITE, true); title.setGravity(Gravity.CENTER);
        sub = text("", 14, Color.argb(200, 220, 210, 255), false); sub.setGravity(Gravity.CENTER);
        bar = new ProgressBar(ctx(), null, android.R.attr.progressBarStyleHorizontal);
        bar.setMax(100);
        actions = new LinearLayout(ctx()); actions.setOrientation(LinearLayout.VERTICAL);
        col.addView(orb);
        LinearLayout.LayoutParams m = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT); m.topMargin = dp(14);
        col.addView(title, m);
        LinearLayout.LayoutParams m2 = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT); m2.topMargin = dp(8);
        col.addView(sub, m2);
        LinearLayout.LayoutParams m3 = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(10)); m3.topMargin = dp(22);
        col.addView(bar, m3);
        LinearLayout.LayoutParams m4 = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT); m4.topMargin = dp(28);
        col.addView(actions, m4);
        root.addView(col, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.WRAP_CONTENT, Gravity.CENTER));
        show(root, true);
    }

    void showRunning(String name, int step, int of, String what) {
        ensureFull();
        title.setText("Ordering your " + name);
        sub.setText(of == 0 ? what : "Step " + Math.min(step + 1, of) + " of " + of + " · " + what);
        bar.setVisibility(View.VISIBLE);
        bar.setProgress(of == 0 ? 5 : Math.max(5, step * 100 / of));
        setActions(button("Cancel", false), v -> runner.cancel());
        qaDump();
    }

    void showReady(String name, String total, boolean canOrder) {
        ensureFull();
        title.setText(canOrder ? name + (total != null ? " · " + total : "") : name + " is in your basket");
        sub.setText(canOrder ? "Everything's in the basket and Grab is on the checkout screen. Wizard won't order until you tap Place order."
                : "Grab's order button didn't show. Tap Look first to finish in Grab.");
        bar.setVisibility(View.GONE);
        actions.removeAllViews();
        if (canOrder) {
            Button place = button("Place order" + (total != null ? " · " + total : ""), true);
            place.setContentDescription("Place order");
            place.setOnClickListener(v -> runner.placeOrder());
            actions.addView(place, wide(52));
        }
        Button look = button("Look first", false); look.setOnClickListener(v -> runner.lookFirst());
        actions.addView(look, wide(46));
        Button cancel = button("Cancel", false); cancel.setOnClickListener(v -> runner.cancel());
        actions.addView(cancel, wide(46));
        qaDump();
    }

    void showOrdering(String name) {
        ensureFull();
        title.setText("Placing your order");
        sub.setText(name);
        bar.setVisibility(View.VISIBLE); bar.setIndeterminate(true);
        actions.removeAllViews();
    }

    void showDone(String name, boolean ordered) {
        ensureFull();
        bar.setIndeterminate(false); bar.setVisibility(View.GONE);
        title.setText(ordered ? "Ordered ✓" : "Check Grab");
        sub.setText(ordered ? name + " is on its way. Track it in Grab." : "Grab is still on checkout; it may want one more tap.");
        actions.removeAllViews();
        qaDump();
    }

    void showFailed(String name, String why) {
        ensureFull();
        bar.setIndeterminate(false); bar.setVisibility(View.GONE);
        title.setText("Stopped · nothing ordered");
        sub.setText(why);
        actions.removeAllViews();
        Button look = button("Show me Grab", true); look.setOnClickListener(v -> runner.lookFirst());
        actions.addView(look, wide(48));
        Button cancel = button("Close", false); cancel.setOnClickListener(v -> runner.cancel());
        actions.addView(cancel, wide(46));
        qaDump();
    }

    /* ------------------------------------------------------------------ bits */

    private interface Click { void on(View v); }

    private void setActions(Button b, Click c) {
        actions.removeAllViews();
        b.setOnClickListener(c::on);
        actions.addView(b, wide(46));
    }

    private LinearLayout.LayoutParams wide(int h) {
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(h));
        p.topMargin = dp(10);
        return p;
    }

    private LinearLayout row() {
        LinearLayout l = new LinearLayout(ctx());
        l.setOrientation(LinearLayout.HORIZONTAL);
        l.setGravity(Gravity.CENTER_VERTICAL);
        return l;
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
