package ai.wizards.os;

import android.app.Activity;
import android.content.Context;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.ConnectivityManager;
import android.net.LinkAddress;
import android.net.LinkProperties;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;

/**
 * The native "can't reach your Wizard" screen (rules in ReachPolicy). A plain Android view over the WebView, so it
 * shows even while the WebView sits on a connection that never answers (Tailscale off: the black screen).
 * Two looks: Connecting (orb + one line) and Offline (why, what to do, Try again, Open Tailscale), both with the
 * Wizard logo row top-left.
 */
final class ReachScreen {
    private static final int BG = Color.rgb(5, 3, 12);
    private static final int INK = Color.rgb(233, 228, 255);
    private static final int VIOLET = Color.rgb(155, 123, 255);

    private final Activity a;
    private final FrameLayout view;
    private final TextView title, body, status, detail, retry, tailscale, server;
    private final LinearLayout col, brand;
    private final TailscaleGuideView guide;
    private boolean offline;
    private ReachPolicy.Why shown;
    /**
     * The WebView's name-not-found errors in a row under the reason shown (kept when a network change redraws without
     * an error): "not on your network" needs two (TailscaleGuide.missingAfter).
     */
    private int notFound;

    ReachScreen(Activity a, FrameLayout parent, Runnable onRetry, Runnable onTailscale) {
        this.a = a;
        view = new FrameLayout(a);
        view.setBackgroundColor(BG);
        view.setClickable(true); // nothing reaches the error page underneath
        view.setVisibility(View.GONE);
        view.setContentDescription("Wizard connection");

        col = new LinearLayout(a);
        col.setOrientation(LinearLayout.VERTICAL);
        col.setGravity(Gravity.CENTER_HORIZONTAL);
        col.setPadding(dp(32), 0, dp(32), 0);

        TextView orb = text(48, VIOLET, false);
        orb.setText("◉");
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
        // The address it is trying, quiet, with a way to fix a wrong one. Not a peer of Try again: a stuck owner
        // should never read "Change Wizard" as the cure for a box that is merely down (James, 24 Oct 2026).
        server = text(13, INK, false);
        server.setAlpha(0.55f);
        server.setPadding(dp(16), dp(10), dp(16), dp(10));
        server.setClickable(true);
        server.setFocusable(true);
        server.setOnClickListener(v -> a.startActivity(new android.content.Intent(a, ConnectActivity.class)));
        col.addView(status, lp(dp(18)));
        col.addView(detail, lp(dp(6)));
        col.addView(server, lp(dp(28)));
        view.addView(col, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.CENTER));
        // The Wizard logo row top-left (under the guide, which draws its own); placeBrand() clears the status bar.
        brand = BrandRow.build(a, TailscaleGuideView.withAlpha(INK, 0.6f));
        FrameLayout.LayoutParams bl = new FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.TOP | Gravity.START);
        bl.leftMargin = dp(20); bl.topMargin = dp(40);
        view.addView(brand, bl);
        // A Wizard on Tailscale: the step-by-step guide instead (TailscaleGuide), in this screen's colours.
        guide = new TailscaleGuideView(a, new TailscaleGuideView.Palette(BG, INK, TailscaleGuideView.withAlpha(INK, 0.78f),
                TailscaleGuideView.withAlpha(INK, 0.5f), VIOLET, Color.rgb(91, 61, 214), Color.WHITE,
                TailscaleGuideView.withAlpha(INK, 0.1f), TailscaleGuideView.withAlpha(INK, 0.13f)),
                () -> a.startActivity(new android.content.Intent(a, ConnectActivity.class)));
        view.addView(guide.view(), new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
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
        guide.hide(); col.setVisibility(View.VISIBLE);
        title.setVisibility(View.GONE);
        body.setVisibility(View.GONE);
        retry.setVisibility(View.GONE);
        tailscale.setVisibility(View.GONE);
        detail.setVisibility(View.GONE);
        server.setVisibility(View.GONE);
        status.setVisibility(View.VISIBLE);
        status.setText("Connecting to your Wizard…");
        placeBrand();
        view.setVisibility(View.VISIBLE);
    }

    void offline(ReachPolicy.Why why, String raw, boolean tailscaleInstalled) {
        // A reason found under another state (e.g. no ts.net name resolves while Tailscale is off) no longer applies.
        if (shown != why) notFound = 0;
        offline = true;
        shown = why;
        String origin = ai.wizards.os.device.AppState.origin(a);
        // A refusal (401/403) answered: the plain look says so; the guide is only for a Wizard that doesn't answer.
        if (why != ReachPolicy.Why.NO_NETWORK && why != ReachPolicy.Why.REFUSED && TailscaleGuide.applies(origin)) {
            // On a Tailscale address with a network: the guide. NOT_ANSWERING here means Tailscale is on.
            col.setVisibility(View.GONE);
            if (raw != null) notFound = TailscaleGuide.missingFrom(raw) ? notFound + 1 : 0;
            // Tailscale on: a name that doesn't resolve (twice in a row) means another network; a hang means the Wizard is off.
            guide.show(origin, why == ReachPolicy.Why.NOT_ANSWERING, TailscaleGuide.missingAfter(notFound), tailscaleInstalled);
            view.setVisibility(View.VISIBLE);
            return;
        }
        guide.hide(); col.setVisibility(View.VISIBLE);
        title.setText(ReachPolicy.title(why));
        body.setText(ReachPolicy.body(why));
        title.setVisibility(View.VISIBLE);
        body.setVisibility(View.VISIBLE);
        retry.setVisibility(View.VISIBLE);
        retry.setEnabled(true);
        retry.setAlpha(1f);
        tailscale.setVisibility(ReachPolicy.offerTailscale(why, tailscaleInstalled) ? View.VISIBLE : View.GONE);
        status.setVisibility(View.GONE);
        // The address actually being tried (QA override included), with any port: a wrong port is a real cause.
        String where = android.net.Uri.parse(ai.wizards.os.device.AppState.origin(a)).getAuthority();
        server.setText(where == null || where.isEmpty() ? "Edit address" : where + "  ·  Edit address");
        server.setContentDescription("Edit Wizard address");
        server.setVisibility(View.VISIBLE);
        String d = ReachPolicy.detail(raw);
        detail.setText(d);
        detail.setVisibility(d.isEmpty() ? View.GONE : View.VISIBLE);
        placeBrand();
        view.setVisibility(View.VISIBLE);
    }

    /** The load hung past the give-up mark: the name resolved, so a not-found streak ends. */
    void hung() { notFound = 0; }

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
        notFound = 0;
        shown = null;
        view.setVisibility(View.GONE);
    }

    /* ---------------- the phone's network, as the screen needs it ---------------- */

    /**
     * {network, vpn}: a default network, and Tailscale on (a VPN holding a Tailscale address, so another VPN doesn't
     * count). Debug builds can force the VPN answer (files/qa_vpn.txt).
     */
    static boolean[] net(Context c) {
        boolean network = false, vpn = false;
        try {
            ConnectivityManager cm = (ConnectivityManager) c.getSystemService(Context.CONNECTIVITY_SERVICE);
            Network n = cm == null ? null : cm.getActiveNetwork();
            NetworkCapabilities nc = n == null ? null : cm.getNetworkCapabilities(n);
            network = nc != null;
            vpn = network && tailscaleUp(cm);
        } catch (RuntimeException ignored) {}
        String qa = qaVpn(c);
        if (network && qa != null) vpn = qa.equals("on");
        return new boolean[]{network, vpn};
    }

    /** Any VPN network with an IPv4 in Tailscale's 100.64.0.0/10 (ReachPolicy.tailscaleAddress). */
    private static boolean tailscaleUp(ConnectivityManager cm) {
        for (Network n : cm.getAllNetworks()) {
            NetworkCapabilities nc = cm.getNetworkCapabilities(n);
            if (nc == null || !nc.hasTransport(NetworkCapabilities.TRANSPORT_VPN)) continue;
            LinkProperties lp = cm.getLinkProperties(n);
            if (lp == null) continue;
            for (LinkAddress la : lp.getLinkAddresses()) {
                java.net.InetAddress ip = la.getAddress();
                if (ip != null && ReachPolicy.tailscaleAddress(ip.getAddress())) return true;
            }
        }
        return false;
    }

    static ReachPolicy.Why why(Context c) {
        boolean[] n = net(c);
        return ReachPolicy.why(n[0], n[1], ServerOrigin.needsTailscale(ai.wizards.os.device.AppState.origin(c)));
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

    /**
     * The logo row 12dp below the status bar. MainActivity's root consumes the insets (this screen runs under the
     * status bar, like the page), so read the window's own; API 28-29 don't draw edge to edge.
     */
    private void placeBrand() {
        int top = 0;
        WindowInsets in = view.getRootWindowInsets();
        if (in != null && android.os.Build.VERSION.SDK_INT >= 30) {
            top = in.getInsets(WindowInsets.Type.statusBars() | WindowInsets.Type.displayCutout()).top;
        }
        FrameLayout.LayoutParams l = (FrameLayout.LayoutParams) brand.getLayoutParams();
        if (l.topMargin != top + dp(12)) { l.topMargin = top + dp(12); brand.setLayoutParams(l); }
    }

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
