package ai.wizards.os.usuals;

import android.accessibilityservice.AccessibilityService;
import android.accessibilityservice.GestureDescription;
import android.content.Context;
import android.content.Intent;
import android.graphics.Path;
import android.graphics.Rect;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.util.DisplayMetrics;
import android.util.Log;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;
import android.view.accessibility.AccessibilityWindowInfo;

import java.util.ArrayList;
import java.util.List;

import ai.wizards.os.everywhere.WizardKeyboardService;

/**
 * Teaches and replays a usual inside the Grab app, through Wizard OS's accessibility service.
 *
 * Teach: Grab opens fresh; James builds his basket as usual; every tap and typed search is written down; Done.
 * Run:   Grab opens fresh under a cover; the same taps are found again by their text (not screen position), one by
 *        one; the run stops on the checkout screen with the total. Wizard never presses a button that spends money:
 *        Place order is pressed only by James's tap on the cover's Place order button.
 */
public final class UsualsRunner {
    public static final String TAG = "WizardUsuals";
    private static UsualsRunner instance;

    public static synchronized UsualsRunner get(Context c) {
        if (instance == null) instance = new UsualsRunner(c.getApplicationContext());
        return instance;
    }

    public enum Mode { IDLE, TEACHING, RUNNING, READY, ORDERING, DONE, FAILED }

    private final Context app;
    private final Handler main = new Handler(Looper.getMainLooper());
    private Mode mode = Mode.IDLE;
    private UsualsStore.Usual usual;
    private final List<UsualsPolicy.Step> recorded = new ArrayList<>();
    private int stepIdx;
    private long stepStarted;
    private int scrolls;
    private long launchedAt;
    private String status = "";
    private String total;
    private UsualsCover cover;
    /** For QA and the web panel: what the last run did, step by step. */
    private final List<String> log = new ArrayList<>();

    private UsualsRunner(Context app) { this.app = app; }

    public Mode mode() { return mode; }
    public String status() { return status; }

    public String stateJson() {
        try {
            org.json.JSONObject o = new org.json.JSONObject().put("mode", mode.name().toLowerCase(java.util.Locale.ROOT))
                    .put("status", status).put("usual", usual == null ? "" : usual.id).put("name", usual == null ? "" : usual.name)
                    .put("step", stepIdx).put("steps", usual == null ? recorded.size() : usual.steps.size())
                    .put("total", total == null ? "" : total).put("recorded", recorded.size());
            org.json.JSONArray l = new org.json.JSONArray();
            for (String s : log.subList(Math.max(0, log.size() - 40), log.size())) l.put(s);
            o.put("log", l);
            return o.toString();
        } catch (org.json.JSONException e) { return "{}"; }
    }

    private void note(String s) {
        log.add(s);
        Log.i(TAG, s);
    }

    /* ------------------------------------------------------------------ readiness */

    public static boolean grabInstalled(Context c, String pkg) {
        try { c.getPackageManager().getPackageInfo(pkg, 0); return true; }
        catch (Exception e) { return false; }
    }

    private static WizardKeyboardService svc() { return WizardKeyboardService.get(); }

    /** "" when a run can start, else the one thing missing, in words. */
    public String blocker(String pkg) {
        if (!WizardKeyboardService.enabled(app) || svc() == null) return "accessibility";
        if (!grabInstalled(app, pkg)) return "grab";
        return "";
    }

    /* ------------------------------------------------------------------ teach */

    public String teach(String name) {
        String b = blocker(UsualsPolicy.GRAB);
        if (!b.isEmpty()) return b;
        stopQuietly();
        usual = new UsualsStore.Usual();
        usual.name = name == null || name.trim().isEmpty() ? "My usual" : name.trim();
        recorded.clear(); log.clear(); total = null;
        mode = Mode.TEACHING;
        status = "Build your basket in Grab, then tap Done";
        note("teach start: " + usual.name);
        launchFresh(usual.pkg);
        cover().showTeachBar(usual.name);
        return "";
    }

    /** Done on the teach bar: keep what was recorded and go back to Wizard OS. */
    public void finishTeach() {
        if (mode != Mode.TEACHING) return;
        List<UsualsPolicy.Step> steps = UsualsPolicy.tidy(recorded);
        cover().hide();
        if (steps.isEmpty()) {
            mode = Mode.IDLE; status = "Nothing was recorded";
            note("teach: nothing recorded");
            backToWizard("usuals");
            return;
        }
        // The checkout screen at the end of teaching tells us what it cost.
        String seen = UsualsPolicy.total(screenTexts(usual.pkg));
        if (seen != null) usual.lastTotal = seen;
        usual.steps = steps;
        UsualsStore.put(app, usual);
        note("teach saved " + steps.size() + " steps: " + UsualsPolicy.write(steps).replace('\n', '|'));
        mode = Mode.IDLE; status = "Saved " + usual.name;
        backToWizard("usuals");
    }

    public void cancel() {
        note("cancel in " + mode);
        stopQuietly();
        status = "Cancelled";
        backToWizard("usuals");
    }

    private void stopQuietly() {
        main.removeCallbacks(tick);
        if (cover != null) cover.hide();
        mode = Mode.IDLE;
    }

    /**
     * The accessibility service (re)connected: Android drops its overlay windows when it rebinds the service, so
     * whatever was on screen comes back.
     */
    public void serviceConnected() {
        if (cover != null) { cover.hide(); cover = null; }
        if (usual == null) return;
        switch (mode) {
            case TEACHING: cover().showTeachBar(usual.name); cover().teachCount(UsualsPolicy.tidy(recorded).size()); break;
            case RUNNING: cover().showRunning(usual.name, stepIdx, usual.steps.size(), status); break;
            case READY: cover().showReady(usual.name, total, true); break;
            default: break;
        }
        note("service reconnected: cover back for " + mode);
    }

    /** Every accessibility event from the service; only taps and typing inside Grab, and only while teaching. */
    public void onEvent(AccessibilityEvent e) {
        if (mode != Mode.TEACHING || e == null || usual == null) return;
        CharSequence pkg = e.getPackageName();
        if (pkg == null || !usual.pkg.contentEquals(pkg)) return;
        int t = e.getEventType();
        if (t == AccessibilityEvent.TYPE_VIEW_CLICKED) {
            AccessibilityNodeInfo n = e.getSource();
            String label = n != null ? labelOf(n) : "";
            if (label.isEmpty() && e.getText() != null && !e.getText().isEmpty()) label = String.valueOf(e.getText().get(0));
            if (label.isEmpty() && e.getContentDescription() != null) label = e.getContentDescription().toString();
            if (n != null && n.isEditable()) return; // tapping the search box: the typing step finds it again
            if (UsualsPolicy.isCommit(label)) { note("teach: ignored a commit tap “" + label + "”"); return; }
            String id = n != null && n.getViewIdResourceName() != null ? n.getViewIdResourceName() : "";
            String near = n != null && UsualsPolicy.isGeneric(label) ? nearText(n, label) : "";
            float x = -1, y = -1;
            if (n != null) {
                Rect r = new Rect(); n.getBoundsInScreen(r);
                DisplayMetrics dm = app.getResources().getDisplayMetrics();
                x = r.exactCenterX() / dm.widthPixels; y = r.exactCenterY() / dm.heightPixels;
            }
            recorded.add(new UsualsPolicy.Step("tap", label, id, near, x, y));
            note("teach tap “" + label + "”" + (near.isEmpty() ? "" : " @ " + near) + (id.isEmpty() ? "" : " #" + id));
            cover().teachCount(UsualsPolicy.tidy(recorded).size());
        } else if (t == AccessibilityEvent.TYPE_VIEW_TEXT_CHANGED) {
            AccessibilityNodeInfo n = e.getSource();
            String text = n != null && n.getText() != null ? n.getText().toString()
                    : e.getText() != null && !e.getText().isEmpty() ? String.valueOf(e.getText().get(0)) : "";
            if (n != null && n.getHintText() != null && text.contentEquals(n.getHintText())) text = "";
            recorded.add(new UsualsPolicy.Step("type", text, "", "", -1, -1));
            cover().teachCount(UsualsPolicy.tidy(recorded).size());
        }
    }

    /* ------------------------------------------------------------------ run */

    public String run(String id) {
        UsualsStore.Usual u = UsualsStore.get(app, id);
        if (u == null) return "missing";
        String b = blocker(u.pkg);
        if (!b.isEmpty()) return b;
        if (mode == Mode.TEACHING) return "busy";
        stopQuietly();
        usual = u; log.clear(); total = null;
        stepIdx = 0; scrolls = 0; stepStarted = SystemClock.uptimeMillis();
        mode = Mode.RUNNING;
        status = "Opening Grab";
        note("run start: " + u.name + " (" + u.steps.size() + " steps)");
        cover().showRunning(u.name, 0, u.steps.size(), status);
        launchFresh(u.pkg);
        launchedAt = SystemClock.uptimeMillis();
        main.postDelayed(tick, 1500);
        return "";
    }

    private final Runnable tick = this::step;

    private void step() {
        if (mode != Mode.RUNNING || usual == null) return;
        WizardKeyboardService s = svc();
        if (s == null) { fail("Wizard OS accessibility was switched off"); return; }
        if (stepIdx >= usual.steps.size()) { reachCheckout(); return; }
        UsualsPolicy.Step st = usual.steps.get(stepIdx);
        long waited = SystemClock.uptimeMillis() - stepStarted;
        cover().showRunning(usual.name, stepIdx, usual.steps.size(), st.describe());
        AccessibilityNodeInfo root = grabRoot(s, usual.pkg);
        if (root == null) {
            if (waited > 20000) { fail("Grab didn't open"); return; }
            again(500); return;
        }
        switch (st.type) {
            case "wait": next(Math.min(10000, parse(st.label))); return;
            case "enter": {
                AccessibilityNodeInfo f = focusedEditable(s, root);
                if (f != null && imeEnter(f)) { note("step " + stepIdx + " search key"); next(1200); return; }
                note("step " + stepIdx + " search key: no field, skipped"); next(300); return;
            }
            case "type": {
                AccessibilityNodeInfo f = focusedEditable(s, root);
                if (f == null) f = firstEditable(root, 0);
                if (f == null) {
                    if (waited > UsualsPolicy.stepBudgetMs(st)) { fail("Couldn't find the search box"); return; }
                    again(500); return;
                }
                f.performAction(AccessibilityNodeInfo.ACTION_FOCUS);
                Bundle a = new Bundle();
                a.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, st.label);
                boolean ok = f.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, a);
                note("step " + stepIdx + " typed “" + st.label + "” " + (ok ? "ok" : "refused"));
                if (!ok) { fail("Grab didn't take the search text"); return; }
                // Searches that need the keyboard's search key: pressed if the next tap's target doesn't show up.
                pendingEnter = f;
                next(1500);
                return;
            }
            default: break;
        }
        // tap
        Match m = find(root, st);
        if (m != null) {
            String lbl = labelOf(m.click);
            if (UsualsPolicy.isCommit(lbl) || UsualsPolicy.isCommit(labelOf(m.node))) { fail("Stopped before a payment button (“" + lbl + "”)"); return; }
            boolean ok = m.click.performAction(AccessibilityNodeInfo.ACTION_CLICK);
            if (!ok) ok = tapAt(s, m.click);
            note("step " + stepIdx + " tap “" + st.label + "” → " + (ok ? "ok" : "refused") + " (score " + m.score + ")");
            pendingEnter = null;
            if (!ok) { fail("Grab didn't take the tap on “" + st.label + "”"); return; }
            next(900);
            return;
        }
        if (pendingEnter != null && waited > 1200) {
            AccessibilityNodeInfo f = pendingEnter; pendingEnter = null;
            if (imeEnter(f)) { note("step " + stepIdx + " pressed search to show results"); again(1500); return; }
        }
        if (st.optional() && waited > UsualsPolicy.stepBudgetMs(st)) { note("step " + stepIdx + " optional “" + st.label + "” not there, skipped"); next(200); return; }
        // Not on screen yet: a pop-up in the way, or further down the menu.
        if (waited > 3000 && dismissPopup(root)) { again(900); return; }
        if (waited > 4000 && scrolls < 10 && scrollDown(root)) { scrolls++; again(900); return; }
        if (waited > UsualsPolicy.stepBudgetMs(st)) { fail("Couldn't find “" + st.label + "”" + (st.near.isEmpty() ? "" : " by “" + st.near + "”")); return; }
        again(500);
    }

    private AccessibilityNodeInfo pendingEnter;

    private void again(long ms) { main.removeCallbacks(tick); main.postDelayed(tick, ms); }

    private void next(long ms) {
        stepIdx++; scrolls = 0; stepStarted = SystemClock.uptimeMillis() + ms;
        again(ms);
    }

    private static int parse(String s) { try { return Integer.parseInt(s.trim()); } catch (Exception e) { return 1000; } }

    private void reachCheckout() {
        // Give the checkout screen a moment to settle, then read the total and look for the order button.
        WizardKeyboardService s = svc();
        AccessibilityNodeInfo root = s == null ? null : grabRoot(s, usual.pkg);
        List<String> texts = root == null ? new ArrayList<>() : texts(root);
        String t = UsualsPolicy.total(texts);
        AccessibilityNodeInfo commit = root == null ? null : findCommit(root);
        long waited = SystemClock.uptimeMillis() - stepStarted;
        if ((commit == null || t == null) && waited < 6000) { again(600); return; }
        total = t;
        mode = Mode.READY;
        status = commit == null ? "Basket built · open Grab to check out" : "Ready to order";
        note("ready: total=" + t + " commit=" + (commit != null ? "“" + labelOf(commit) + "”" : "none"));
        usual.lastRunAt = System.currentTimeMillis();
        usual.lastResult = "ready";
        if (t != null) usual.lastTotal = t;
        UsualsStore.put(app, usual);
        cover().showReady(usual.name, t, commit != null);
    }

    /** James's tap on the cover's Place order: the only path that presses Grab's order button. */
    public void placeOrder() {
        if (mode != Mode.READY || usual == null) return;
        WizardKeyboardService s = svc();
        AccessibilityNodeInfo root = s == null ? null : grabRoot(s, usual.pkg);
        AccessibilityNodeInfo commit = root == null ? null : findCommit(root);
        if (commit == null) { fail("The order button is gone. Nothing was ordered."); return; }
        AccessibilityNodeInfo c = clickable(commit);
        boolean ok = c.performAction(AccessibilityNodeInfo.ACTION_CLICK) || tapAt(s, c);
        note("place order (James tapped) → " + (ok ? "pressed" : "refused"));
        if (!ok) { fail("Grab didn't take the order tap. Nothing was ordered."); return; }
        mode = Mode.ORDERING;
        status = "Placing order";
        cover().showOrdering(usual.name);
        main.postDelayed(() -> {
            if (mode != Mode.ORDERING) return;
            WizardKeyboardService s2 = svc();
            AccessibilityNodeInfo r2 = s2 == null ? null : grabRoot(s2, usual.pkg);
            boolean stillThere = r2 != null && findCommit(r2) != null;
            mode = Mode.DONE;
            usual.lastResult = stillThere ? "check" : "ordered";
            UsualsStore.put(app, usual);
            status = stillThere ? "Check Grab: it may need one more step" : "Ordered";
            note("after order: " + status);
            cover().showDone(usual.name, !stillThere);
            main.postDelayed(() -> { if (mode == Mode.DONE) { cover().hide(); mode = Mode.IDLE; } }, stillThere ? 600 : 2200);
        }, 3500);
    }

    /** "Look first": leave Grab on checkout, uncovered. */
    public void lookFirst() {
        note("look first");
        main.removeCallbacks(tick);
        if (cover != null) cover.hide();
        mode = Mode.IDLE;
        status = "Left on Grab's checkout";
    }

    private void fail(String why) {
        main.removeCallbacks(tick);
        mode = Mode.FAILED;
        status = why;
        note("failed at step " + stepIdx + ": " + why);
        if (usual != null) { usual.lastResult = "failed: " + why; UsualsStore.put(app, usual); }
        cover().showFailed(usual == null ? "" : usual.name, why);
    }

    /* ------------------------------------------------------------------ finding things */

    static final class Match { AccessibilityNodeInfo node, click; int score; }

    private Match find(AccessibilityNodeInfo root, UsualsPolicy.Step st) {
        List<AccessibilityNodeInfo> all = new ArrayList<>();
        collect(root, all, 0);
        Match best = null;
        for (AccessibilityNodeInfo n : all) {
            if (!n.isVisibleToUser()) continue;
            String id = n.getViewIdResourceName() == null ? "" : n.getViewIdResourceName();
            int sc = UsualsPolicy.score(st.label, st.id, labelOf(n), id);
            if (sc == 0) continue;
            AccessibilityNodeInfo c = clickable(n);
            if (c == null) continue;
            if (!st.near.isEmpty()) {
                int d = nearDistance(n, st.near);
                if (d < 0) continue;
                sc = sc * 10 + (10 - d);
            } else sc *= 10;
            if (best == null || sc > best.score) { best = new Match(); best.node = n; best.click = c; best.score = sc; }
        }
        return best;
    }

    /** 0 when the item name next to {@code n} is {@code near}, else -1. */
    private static int nearDistance(AccessibilityNodeInfo n, String near) {
        String want = UsualsPolicy.norm(near), got = UsualsPolicy.norm(rowText(n, ""));
        if (got.isEmpty()) return -1;
        return got.equals(want) || (want.length() >= 5 && (got.contains(want) || want.contains(got))) ? 0 : -1;
    }

    /** The item name next to a generic "Add"/"+": the meaningful text on the same row (by position on screen). */
    private static String nearText(AccessibilityNodeInfo n, String own) { return rowText(n, own); }

    /**
     * Menus are often flattened in the accessibility tree (the row itself isn't a node), so "the text in my parent"
     * is the whole menu. Use geometry: among texts under the nearest few ancestors, the one whose vertical centre is
     * closest to the button's, preferring the name above or level with it over the price below.
     */
    static String rowText(AccessibilityNodeInfo n, String own) {
        Rect me = new Rect(); n.getBoundsInScreen(me);
        int cy = me.centerY(), h = Math.max(me.height(), 40);
        int band = Math.max(220, h * 3);
        AccessibilityNodeInfo p = n.getParent();
        for (int d = 0; d < 6 && p != null; d++) {
            List<AccessibilityNodeInfo> nodes = new ArrayList<>();
            collect(p, nodes, 0);
            String best = null; int bestCost = Integer.MAX_VALUE;
            for (AccessibilityNodeInfo t : nodes) {
                CharSequence cs = t.getText() != null ? t.getText() : t.getContentDescription();
                if (cs == null) continue;
                String x = cs.toString().trim();
                if (x.length() < 3 || x.equalsIgnoreCase(own) || UsualsPolicy.isGeneric(x) || UsualsPolicy.isPrice(x)
                        || (UsualsPolicy.money(x) != null && x.length() < 14) || x.length() > 80) continue;
                Rect r = new Rect(); t.getBoundsInScreen(r);
                if (r.isEmpty()) continue;
                int dy = r.centerY() - cy;
                if (Math.abs(dy) > band) continue;
                if (r.top >= me.bottom + h) continue;        // a row further down
                int cost = Math.abs(dy) + (dy > 0 ? h : 0);  // below the button costs a bit more than above
                if (cost < bestCost) { bestCost = cost; best = x; }
            }
            if (best != null) return best.length() > 60 ? best.substring(0, 60) : best;
            p = p.getParent();
        }
        return "";
    }

    private static AccessibilityNodeInfo clickable(AccessibilityNodeInfo n) {
        AccessibilityNodeInfo p = n;
        for (int d = 0; d < 6 && p != null; d++) {
            if (p.isClickable() && p.isEnabled()) return p;
            p = p.getParent();
        }
        return null;
    }

    /** What a person would call this control: its own text or description, else the first text inside it. */
    static String labelOf(AccessibilityNodeInfo n) {
        if (n == null) return "";
        CharSequence t = n.getText();
        if (t != null && t.toString().trim().length() > 0) return t.toString().trim();
        CharSequence d = n.getContentDescription();
        if (d != null && d.toString().trim().length() > 0) return d.toString().trim();
        List<String> in = new ArrayList<>();
        textsInto(n, in, 0, 3);
        return in.isEmpty() ? "" : in.get(0).trim();
    }

    private static void textsInto(AccessibilityNodeInfo n, List<String> out, int depth, int max) {
        if (n == null || depth > 30 || out.size() >= max) return;
        CharSequence t = n.getText();
        if (t != null && t.toString().trim().length() > 0) out.add(t.toString().trim());
        else {
            CharSequence d = n.getContentDescription();
            if (d != null && d.toString().trim().length() > 0) out.add(d.toString().trim());
        }
        for (int i = 0; i < n.getChildCount() && out.size() < max; i++) textsInto(n.getChild(i), out, depth + 1, max);
    }

    private static List<String> texts(AccessibilityNodeInfo root) {
        List<String> t = new ArrayList<>();
        textsInto(root, t, 0, 400);
        return t;
    }

    private List<String> screenTexts(String pkg) {
        WizardKeyboardService s = svc();
        AccessibilityNodeInfo r = s == null ? null : grabRoot(s, pkg);
        return r == null ? new ArrayList<>() : texts(r);
    }

    private static void collect(AccessibilityNodeInfo n, List<AccessibilityNodeInfo> out, int depth) {
        if (n == null || depth > 40 || out.size() > 1500) return;
        out.add(n);
        for (int i = 0; i < n.getChildCount(); i++) collect(n.getChild(i), out, depth + 1);
    }

    private static AccessibilityNodeInfo findCommit(AccessibilityNodeInfo root) {
        List<AccessibilityNodeInfo> all = new ArrayList<>();
        collect(root, all, 0);
        for (AccessibilityNodeInfo n : all) {
            if (!n.isVisibleToUser()) continue;
            CharSequence t = n.getText(), d = n.getContentDescription();
            String own = t != null ? t.toString() : d != null ? d.toString() : "";
            if (UsualsPolicy.isCommit(own) && clickable(n) != null) return n;
        }
        return null;
    }

    private static AccessibilityNodeInfo grabRoot(WizardKeyboardService s, String pkg) {
        try {
            for (AccessibilityWindowInfo w : s.getWindows()) {
                if (w.getType() != AccessibilityWindowInfo.TYPE_APPLICATION) continue;
                AccessibilityNodeInfo r = w.getRoot();
                if (r != null && r.getPackageName() != null && pkg.contentEquals(r.getPackageName())) return r;
            }
        } catch (Exception ignored) { }
        AccessibilityNodeInfo r = s.getRootInActiveWindow();
        return r != null && r.getPackageName() != null && pkg.contentEquals(r.getPackageName()) ? r : null;
    }

    private static AccessibilityNodeInfo focusedEditable(WizardKeyboardService s, AccessibilityNodeInfo root) {
        AccessibilityNodeInfo f = root.findFocus(AccessibilityNodeInfo.FOCUS_INPUT);
        return f != null && f.isEditable() ? f : null;
    }

    private static AccessibilityNodeInfo firstEditable(AccessibilityNodeInfo n, int depth) {
        if (n == null || depth > 40) return null;
        if (n.isEditable() && n.isVisibleToUser()) return n;
        for (int i = 0; i < n.getChildCount(); i++) {
            AccessibilityNodeInfo r = firstEditable(n.getChild(i), depth + 1);
            if (r != null) return r;
        }
        return null;
    }

    private static boolean imeEnter(AccessibilityNodeInfo f) {
        if (Build.VERSION.SDK_INT < 30) return false;
        return f.performAction(AccessibilityNodeInfo.AccessibilityAction.ACTION_IME_ENTER.getId());
    }

    private static boolean dismissPopup(AccessibilityNodeInfo root) {
        List<AccessibilityNodeInfo> all = new ArrayList<>();
        collect(root, all, 0);
        for (AccessibilityNodeInfo n : all) {
            if (!n.isVisibleToUser()) continue;
            if (UsualsPolicy.isDismiss(labelOf(n)) && labelOf(n).length() < 16) {
                AccessibilityNodeInfo c = clickable(n);
                if (c != null && c.performAction(AccessibilityNodeInfo.ACTION_CLICK)) { Log.i(TAG, "closed pop-up “" + labelOf(n) + "”"); return true; }
            }
        }
        return false;
    }

    private static boolean scrollDown(AccessibilityNodeInfo root) {
        List<AccessibilityNodeInfo> all = new ArrayList<>();
        collect(root, all, 0);
        AccessibilityNodeInfo big = null; int area = 0;
        for (AccessibilityNodeInfo n : all) {
            if (!n.isScrollable() || !n.isVisibleToUser()) continue;
            Rect r = new Rect(); n.getBoundsInScreen(r);
            int a = r.width() * r.height();
            if (a > area) { area = a; big = n; }
        }
        return big != null && big.performAction(AccessibilityNodeInfo.ACTION_SCROLL_FORWARD);
    }

    /** Last resort for controls that ignore ACTION_CLICK: a real tap at their centre (the cover lets it through). */
    private boolean tapAt(AccessibilityService s, AccessibilityNodeInfo n) {
        Rect r = new Rect(); n.getBoundsInScreen(r);
        if (r.isEmpty()) return false;
        Path p = new Path(); p.moveTo(r.exactCenterX(), r.exactCenterY());
        GestureDescription g = new GestureDescription.Builder().addStroke(new GestureDescription.StrokeDescription(p, 0, 60)).build();
        cover().passThrough(true);
        boolean sent = s.dispatchGesture(g, new AccessibilityService.GestureResultCallback() {
            @Override public void onCompleted(GestureDescription d) { main.postDelayed(() -> cover().passThrough(false), 150); }
            @Override public void onCancelled(GestureDescription d) { main.post(() -> cover().passThrough(false)); }
        }, main);
        if (!sent) cover().passThrough(false);
        return sent;
    }

    /* ------------------------------------------------------------------ apps */

    /** Grab from its front door, every time: the same starting screen the usual was taught on. */
    private void launchFresh(String pkg) {
        Intent i = app.getPackageManager().getLaunchIntentForPackage(pkg);
        if (i == null) return;
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
        Context from = svc() != null ? svc() : app; // a bound accessibility service may open apps from the background
        try { from.startActivity(i); } catch (Exception e) { Log.w(TAG, "launch " + pkg + " failed", e); }
    }

    private void backToWizard(String action) {
        Intent i = new Intent(app, ai.wizards.os.MainActivity.class);
        i.setAction(ai.wizards.os.MainActivity.ACTION_USUALS);
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
        Context from = svc() != null ? svc() : app;
        try { from.startActivity(i); } catch (Exception e) { Log.w(TAG, "back to Wizard OS failed", e); }
    }

    private UsualsCover cover() {
        if (cover == null) cover = new UsualsCover(this);
        return cover;
    }

    Context context() { WizardKeyboardService s = svc(); return s != null ? s : app; }

    boolean canDraw() { return svc() != null; }
}
