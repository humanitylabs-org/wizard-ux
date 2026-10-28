package ai.wizards.os;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.res.ColorStateList;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.text.Html;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

/**
 * Draws TailscaleGuide: a scrolling page of four steps with the Get/Open Tailscale button on the step needed now,
 * "What is Tailscale?" and "Use a different Wizard". Used by ReachScreen and ConnectActivity in their own colours.
 * The host keeps checking the Wizard and opens it by itself; this view only explains.
 */
final class TailscaleGuideView {
    /** The host's colours. */
    static final class Palette {
        final int base, text, text2, muted, accent, button, onButton, surface, line;
        Palette(int base, int text, int text2, int muted, int accent, int button, int onButton, int surface, int line) {
            this.base = base; this.text = text; this.text2 = text2; this.muted = muted; this.accent = accent;
            this.button = button; this.onButton = onButton; this.surface = surface; this.line = line;
        }
    }

    private static final int AMBER = Color.rgb(242, 181, 107), GREEN = Color.rgb(95, 211, 154);

    private final Activity a;
    private final Palette p;
    private final Runnable onOther;
    private final ScrollView scroll;
    private final LinearLayout body;
    private boolean aboutOpen;
    private String shownKey = "";

    TailscaleGuideView(Activity a, Palette p, Runnable onOther) {
        this.a = a; this.p = p; this.onOther = onOther;
        scroll = new ScrollView(a);
        scroll.setFillViewport(true);
        scroll.setClipToPadding(false);
        scroll.setPadding(0, dp(28), 0, dp(16)); // until the window's insets arrive (a parent may consume them)
        scroll.setBackgroundColor(p.base);
        scroll.setClickable(true); // nothing underneath takes taps
        scroll.setVisibility(View.GONE);
        body = new LinearLayout(a);
        body.setOrientation(LinearLayout.VERTICAL);
        body.setPadding(dp(22), dp(20), dp(22), dp(28));
        scroll.addView(body, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        scroll.setOnApplyWindowInsetsListener((v, in) -> {
            if (android.os.Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets bars = in.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                v.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            } else {
                v.setPadding(in.getSystemWindowInsetLeft(), in.getSystemWindowInsetTop(), in.getSystemWindowInsetRight(), in.getSystemWindowInsetBottom());
            }
            return in;
        });
    }

    View view() { return scroll; }
    boolean isShowing() { return scroll.getVisibility() == View.VISIBLE; }
    void hide() { scroll.setVisibility(View.GONE); }

    /** Show (or refresh) the guide for `origin` (TailscaleGuide.steps for `missing`). Redraws only when it changes. */
    void show(String origin, boolean on, Boolean missing, boolean installed) {
        String key = origin + "|" + on + "|" + missing + "|" + installed;
        if (!key.equals(shownKey)) { shownKey = key; build(origin, on, missing, installed); }
        if (!isShowing()) { scroll.setVisibility(View.VISIBLE); scroll.scrollTo(0, 0); scroll.requestApplyInsets(); }
    }

    /** Tailscale if it's installed, else its Google Play page (app, then web). Coming back retries in the host. */
    static void openTailscale(Activity a) {
        Intent launch = a.getPackageManager().getLaunchIntentForPackage(TailscaleGuide.PACKAGE);
        try {
            if (launch != null) { a.startActivity(launch); return; }
            a.startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(TailscaleGuide.PLAY_APP)));
        } catch (ActivityNotFoundException e) {
            try { a.startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(TailscaleGuide.PLAY_WEB))); }
            catch (ActivityNotFoundException e2) { Toast.makeText(a, "No app can open Google Play", Toast.LENGTH_SHORT).show(); }
        }
    }

    private void build(String origin, boolean on, Boolean missing, boolean installed) {
        body.removeAllViews();
        String net = TailscaleGuide.tailnet(origin);
        TailscaleGuide.Step[] steps = TailscaleGuide.steps(on, missing, installed);

        TextView eyebrow = text(TailscaleGuide.EYEBROW.toUpperCase(java.util.Locale.ROOT), 11, p.accent, true);
        eyebrow.setLetterSpacing(0.16f);
        body.addView(eyebrow, lp(dp(8)));
        body.addView(text(TailscaleGuide.headline(on, missing), 22, p.text, true), lp(dp(6)));

        LinearLayout pill = new LinearLayout(a);
        pill.setGravity(Gravity.CENTER_VERTICAL);
        pill.setPadding(dp(12), dp(10), dp(12), dp(10));
        pill.setBackground(round(withAlpha(AMBER, 0.14f), 12));
        View dot = new View(a); dot.setBackground(round(AMBER, 99));
        pill.addView(dot, new LinearLayout.LayoutParams(dp(8), dp(8)));
        TextView status = text(TailscaleGuide.status(on, missing), 14, p.text, false);
        status.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);
        LinearLayout.LayoutParams sl = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1); sl.leftMargin = dp(10);
        pill.addView(status, sl);
        body.addView(pill, lp(dp(14)));
        body.addView(html(TailscaleGuide.LEAD, 15, p.text2), lp(dp(14)));

        for (int n = 1; n <= 4; n++) {
            TailscaleGuide.Step s = steps[n - 1];
            if (n > 1) body.addView(line(), lp(dp(12)));
            LinearLayout row = new LinearLayout(a);
            row.setPadding(0, dp(n == 1 ? 10 : 12), 0, 0);
            if (s == TailscaleGuide.Step.TODO) row.setAlpha(0.62f);
            TextView glyph = text(s == TailscaleGuide.Step.DONE ? "✓" : String.valueOf(n), 14, s == TailscaleGuide.Step.NOW ? p.onButton : s == TailscaleGuide.Step.DONE ? GREEN : p.text2, true);
            glyph.setGravity(Gravity.CENTER);
            glyph.setBackground(round(s == TailscaleGuide.Step.NOW ? p.accent : s == TailscaleGuide.Step.DONE ? withAlpha(GREEN, 0.2f) : p.surface, 11));
            row.addView(glyph, new LinearLayout.LayoutParams(dp(32), dp(32)));
            LinearLayout col = new LinearLayout(a); col.setOrientation(LinearLayout.VERTICAL);
            col.addView(text(TailscaleGuide.title(n, on, missing), 16, p.text, true), lp(dp(4)));
            col.addView(html(TailscaleGuide.body(n, on, missing, installed, net), 14.5f, p.text2), lp(dp(3)));
            if (n == 2 && !net.isEmpty()) {
                TextView chip = text(net, 13, p.text, false);
                chip.setTypeface(Typeface.MONOSPACE);
                chip.setPadding(dp(10), dp(6), dp(10), dp(6));
                chip.setBackground(round(p.surface, 10));
                LinearLayout.LayoutParams cl = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
                cl.topMargin = dp(8);
                col.addView(chip, cl);
            }
            if (n == 2 && TailscaleGuide.removed(on, missing)) {
                TextView warn = text(TailscaleGuide.REMOVED, 14.5f, p.text, false);
                warn.setPadding(dp(10), 0, 0, 0);
                warn.setBackground(rule(AMBER));
                col.addView(warn, lp(dp(8)));
            }
            if (TailscaleGuide.hasButton(n, on, missing, installed)) {
                TextView b = text(TailscaleGuide.button(on, installed), 15, p.onButton, true);
                b.setGravity(Gravity.CENTER);
                b.setBackground(round(p.button, 14));
                b.setClickable(true); b.setFocusable(true);
                b.setContentDescription(TailscaleGuide.button(on, installed));
                b.setOnClickListener(v -> openTailscale(a));
                LinearLayout.LayoutParams bl = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(48));
                bl.topMargin = dp(10);
                col.addView(b, bl);
                String hint = TailscaleGuide.hint(on, installed);
                if (!hint.isEmpty()) col.addView(text(hint, 13, p.muted, false), lp(dp(8)));
            }
            if (n == 4) {
                LinearLayout wait = new LinearLayout(a); wait.setGravity(Gravity.CENTER_VERTICAL);
                ProgressBar spin = new ProgressBar(a, null, android.R.attr.progressBarStyleSmall);
                spin.setIndeterminateTintList(ColorStateList.valueOf(p.accent));
                wait.addView(spin, new LinearLayout.LayoutParams(dp(16), dp(16)));
                TextView w = text(TailscaleGuide.CHECKING, 14, p.muted, false);
                LinearLayout.LayoutParams wl = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT); wl.leftMargin = dp(9);
                wait.addView(w, wl);
                col.addView(wait, lp(dp(6)));
            }
            LinearLayout.LayoutParams cl = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1); cl.leftMargin = dp(12);
            row.addView(col, cl);
            body.addView(row);
        }

        body.addView(line(), lp(dp(16)));
        TextView about = text(TailscaleGuide.ABOUT, 15, p.accent, false);
        about.setPadding(0, dp(10), 0, dp(6));
        about.setClickable(true); about.setFocusable(true);
        LinearLayout aboutBody = new LinearLayout(a); aboutBody.setOrientation(LinearLayout.VERTICAL);
        for (String para : new String[]{ TailscaleGuide.ABOUT1, TailscaleGuide.ABOUT2, TailscaleGuide.ABOUT3 }) aboutBody.addView(html(para, 14.5f, p.text2), lp(dp(8)));
        aboutBody.setVisibility(aboutOpen ? View.VISIBLE : View.GONE);
        about.setOnClickListener(v -> { aboutOpen = !aboutOpen; aboutBody.setVisibility(aboutOpen ? View.VISIBLE : View.GONE); });
        body.addView(about, lp(0));
        body.addView(aboutBody, lp(0));

        TextView other = text(TailscaleGuide.OTHER, 15, p.accent, false);
        other.setPadding(0, dp(12), 0, dp(4));
        other.setClickable(true); other.setFocusable(true);
        other.setOnClickListener(v -> onOther.run());
        body.addView(other, lp(dp(6)));
        String host = Uri.parse(origin).getAuthority();
        TextView addr = text(host == null ? "" : host, 12, p.muted, false);
        addr.setTypeface(Typeface.MONOSPACE);
        body.addView(addr, lp(0));
    }

    /* ---------- pieces ---------- */
    private int dp(float v) { return Math.round(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, a.getResources().getDisplayMetrics())); }
    private LinearLayout.LayoutParams lp(int top) {
        LinearLayout.LayoutParams l = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        l.topMargin = top; return l;
    }
    private TextView text(String value, float sp, int colour, boolean bold) {
        TextView t = new TextView(a); t.setText(value); t.setTextSize(TypedValue.COMPLEX_UNIT_SP, sp); t.setTextColor(colour);
        t.setTypeface(bold ? Typeface.create("sans-serif-medium", Typeface.NORMAL) : Typeface.DEFAULT);
        t.setLineSpacing(0, 1.15f); return t;
    }
    private TextView html(String value, float sp, int colour) {
        TextView t = text("", sp, colour, false);
        t.setText(Html.fromHtml(value, Html.FROM_HTML_MODE_LEGACY));
        return t;
    }
    private View line() { View v = new View(a); v.setBackgroundColor(p.line); v.setMinimumHeight(Math.max(1, dp(1) / 2)); return v; }
    private GradientDrawable round(int fill, int r) {
        GradientDrawable g = new GradientDrawable(); g.setColor(fill); g.setCornerRadius(r >= 99 ? dp(99) : dp(r)); return g;
    }
    /** A 2dp rule on the left (the warning line). */
    private android.graphics.drawable.Drawable rule(int colour) {
        android.graphics.drawable.ShapeDrawable s = new android.graphics.drawable.ShapeDrawable(); s.getPaint().setColor(colour);
        android.graphics.drawable.LayerDrawable l = new android.graphics.drawable.LayerDrawable(new android.graphics.drawable.Drawable[]{ s });
        l.setLayerWidth(0, dp(2)); l.setLayerGravity(0, Gravity.START | Gravity.FILL_VERTICAL); return l;
    }
    static int withAlpha(int colour, float alpha) { return (Math.round(alpha * 255) << 24) | (colour & 0xFFFFFF); }
}
