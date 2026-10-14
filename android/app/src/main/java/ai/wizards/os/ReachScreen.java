package ai.wizards.os;

import android.app.Activity;
import android.content.Context;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.ImageView;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;

/**
 * The native "can't reach your Wizard" screen (rules in ReachPolicy). A plain Android view over the WebView, so it
 * shows even while the WebView sits on a connection that never answers (Tailscale off: the black screen).
 * Two looks: Connecting (orb + one line) and Offline (why, what to do, Try again, Open Tailscale).
 */
final class ReachScreen {
    private static final int BG = Color.rgb(5, 3, 12);
    private static final int INK = Color.rgb(233, 228, 255);
    private static final int VIOLET = Color.rgb(155, 123, 255);

    private final Activity a;
    private final FrameLayout view;
    private final TextView title, body, status, detail, retry, tailscale;
    private boolean offline;
    private ReachPolicy.Why shown;

    ReachScreen(Activity a, FrameLayout parent, Runnable onRetry, Runnable onTailscale) {
        this.a = a;
        view = new FrameLayout(a);
        view.setBackgroundColor(BG);
        view.setClickable(true); // nothing reaches the error page underneath
        view.setVisibility(View.GONE);
        view.setContentDescription("Wizard connection");

        LinearLayout col = new LinearLayout(a);
        col.setOrientation(LinearLayout.VERTICAL);
        col.setGravity(Gravity.CENTER_HORIZONTAL);
        col.setPadding(dp(32), 0, dp(32), 0);

        ImageView orb = new ImageView(a);
        orb.setImageResource(R.drawable.wizard_mark_white);
        orb.setScaleType(ImageView.ScaleType.FIT_CENTER);
        orb.setContentDescription("Wizard");
        orb.setLayoutParams(new LinearLayout.LayoutParams(dp(48), dp(64)));
        title = text(22, INK, true);
        body = text(16, INK, false);
        body.setAlpha(0.78f);
        status = text(13, INK, false);
        status.setAlpha(0.55f);
        retry = pill("Try again", true);
        tailscale = pill("Open Tailscale", false);
        detail = text(12, INK, false);
        detail.setAlpha(0.35f);
        retry.setOnClickListener(v -> onRetry.run());
        tailscale.setOnClickListener(v -> onTailscale.run());

        col.addView(orb);
        col.addView(title, lp(dp(12)));
        col.addView(body, lp(dp(10)));
        col.addView(retry, lp(dp(26)));
        col.addView(tailscale, lp(dp(12)));
        col.addView(status, lp(dp(18)));
        col.addView(detail, lp(dp(6)));
        view.addView(col, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.CENTER));
        parent.addView(view, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
    }

    /** Keep the screen above a rebuilt WebView. */
    void toFront() { view.bringToFront(); }

    boolean isOffline() { return offline; }
    boolean isShowing() { return view.getVisibility() == View.VISIBLE; }
    ReachPolicy.Why shown() { return shown; }

    /** Past the connecting mark with nothing painted yet. Never replaces the offline look. */
    void connecting() {
        if (offline) return;
        title.setVisibility(View.GONE);
        body.setVisibility(View.GONE);
        retry.setVisibility(View.GONE);
        tailscale.setVisibility(View.GONE);
        detail.setVisibility(View.GONE);
        status.setVisibility(View.VISIBLE);
        status.setText("Connecting to your Wizard…");
        view.setVisibility(View.VISIBLE);
    }

    void offline(ReachPolicy.Why why, String raw, boolean tailscaleInstalled) {
        offline = true;
        shown = why;
        title.setText(ReachPolicy.title(why));
        body.setText(ReachPolicy.body(why));
        title.setVisibility(View.VISIBLE);
        body.setVisibility(View.VISIBLE);
        retry.setVisibility(View.VISIBLE);
        retry.setEnabled(true);
        retry.setAlpha(1f);
        tailscale.setVisibility(ReachPolicy.offerTailscale(why, tailscaleInstalled) ? View.VISIBLE : View.GONE);
        status.setVisibility(View.GONE);
        String d = ReachPolicy.detail(raw);
        detail.setText(d);
        detail.setVisibility(d.isEmpty() ? View.GONE : View.VISIBLE);
        view.setVisibility(View.VISIBLE);
    }

    /** A retry is under way: keep the explanation up, say it's trying. */
    void trying() {
        if (!offline) return;
        retry.setEnabled(false);
        retry.setAlpha(0.5f);
        status.setText("Trying again…");
        status.setVisibility(View.VISIBLE);
        // Re-enable after a moment so a hanging attempt never leaves a dead button.
        retry.postDelayed(() -> { retry.setEnabled(true); retry.setAlpha(1f); }, 2500);
    }

    void hide() {
        offline = false;
        shown = null;
        view.setVisibility(View.GONE);
    }

    /* ---------------- the phone's network, as the screen needs it ---------------- */

    /** {network, vpn} for this app's default network. Debug builds can force the VPN answer (files/qa_vpn.txt). */
    static boolean[] net(Context c) {
        boolean network = false, vpn = false;
        try {
            ConnectivityManager cm = (ConnectivityManager) c.getSystemService(Context.CONNECTIVITY_SERVICE);
            Network n = cm == null ? null : cm.getActiveNetwork();
            NetworkCapabilities nc = n == null ? null : cm.getNetworkCapabilities(n);
            network = nc != null;
            vpn = nc != null && nc.hasTransport(NetworkCapabilities.TRANSPORT_VPN);
        } catch (RuntimeException ignored) {}
        String qa = qaVpn(c);
        if (network && qa != null) vpn = qa.equals("on");
        return new boolean[]{network, vpn};
    }

    static ReachPolicy.Why why(Context c) {
        boolean[] n = net(c);
        return ReachPolicy.why(n[0], n[1]);
    }

    static boolean tailscaleInstalled(Context c) {
        try { return c.getPackageManager().getLaunchIntentForPackage(ReachPolicy.TAILSCALE_PKG) != null; }
        catch (RuntimeException e) { return false; }
    }

    private static String qaVpn(Context c) {
        if (!BuildConfig.DEBUG) return null;
        File f = new File(c.getFilesDir(), "qa_vpn.txt");
        if (!f.isFile()) return null;
        try { return new String(Files.readAllBytes(f.toPath()), StandardCharsets.UTF_8).trim(); }
        catch (Exception e) { return null; }
    }

    /* ---------------- views ---------------- */

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
