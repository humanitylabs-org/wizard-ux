package ai.wizards.os.automation;

import android.graphics.Rect;
import android.os.Build;
import android.view.accessibility.AccessibilityNodeInfo;
import android.view.accessibility.AccessibilityWindowInfo;

import java.util.ArrayList;
import java.util.List;

import ai.wizards.os.everywhere.WizardKeyboardService;

/** Reading another app's screen through the Wizard OS accessibility service. No feature rules here. */
final class A11yNodes {
    private A11yNodes() { }

    static WizardKeyboardService svc() { return WizardKeyboardService.get(); }

    /**
     * Android caches the target's nodes and only refreshes them on the event types our service listens to (not
     * scrolling). Before reading positions: drop the cache (Android 14+); callers also refresh each node they measure.
     */
    static void fresh() {
        WizardKeyboardService s = svc();
        if (s != null && Build.VERSION.SDK_INT >= 34) { try { s.clearCache(); } catch (Throwable ignored) { } }
    }

    /** False when the node's view is gone (the app rebuilt its screen): callers keep the node's last known state. */
    static boolean refresh(AccessibilityNodeInfo n) { try { return n.refresh(); } catch (Throwable ignored) { return false; } }

    /** The target app's window root, or null when it is not on screen. */
    static AccessibilityNodeInfo root(WizardKeyboardService s, String pkg) {
        if (s == null) return null;
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

    static AccessibilityNodeInfo clickable(AccessibilityNodeInfo n) {
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

    static void textsInto(AccessibilityNodeInfo n, List<String> out, int depth, int max) {
        if (n == null || depth > 30 || out.size() >= max) return;
        CharSequence t = n.getText();
        if (t != null && t.toString().trim().length() > 0) out.add(t.toString().trim());
        else {
            CharSequence d = n.getContentDescription();
            if (d != null && d.toString().trim().length() > 0) out.add(d.toString().trim());
        }
        for (int i = 0; i < n.getChildCount() && out.size() < max; i++) textsInto(n.getChild(i), out, depth + 1, max);
    }

    static List<String> texts(AccessibilityNodeInfo root) {
        List<String> t = new ArrayList<>();
        textsInto(root, t, 0, AutomationPolicy.MAX_TEXTS);
        return t;
    }

    static void collect(AccessibilityNodeInfo n, List<AccessibilityNodeInfo> out, int depth) {
        if (n == null || depth > 40 || out.size() > 1500) return;
        out.add(n);
        for (int i = 0; i < n.getChildCount(); i++) collect(n.getChild(i), out, depth + 1);
    }

    /** A visible, clickable control whose own text is a commit (money) button. */
    static AccessibilityNodeInfo findCommit(AccessibilityNodeInfo root) {
        List<AccessibilityNodeInfo> all = new ArrayList<>();
        collect(root, all, 0);
        for (AccessibilityNodeInfo n : all) {
            if (!n.isVisibleToUser()) continue;
            CharSequence t = n.getText(), d = n.getContentDescription();
            String own = t != null ? t.toString() : d != null ? d.toString() : "";
            if (AutomationPolicy.isCommit(own) && clickable(n) != null) return n;
        }
        return null;
    }

    /** Would pressing {@code click} (or anything it wraps) spend money? Checked on every automated tap. */
    static boolean spends(AccessibilityNodeInfo click, AccessibilityNodeInfo matched) {
        if (AutomationPolicy.isCommit(labelOf(click)) || AutomationPolicy.isCommit(labelOf(matched))) return true;
        List<String> inside = new ArrayList<>();
        textsInto(click, inside, 0, 12);
        for (String s : inside) if (AutomationPolicy.isCommit(s)) return true;
        return false;
    }

    /**
     * The text next to a control, by position: among texts under the nearest few ancestors, the one whose vertical
     * centre is closest, preferring above/level over below. Menus are often flattened, so the parent alone is useless.
     */
    static String rowText(AccessibilityNodeInfo n, String own, List<String> ambiguous) {
        refresh(n);
        Rect me = new Rect(); n.getBoundsInScreen(me);
        int cy = me.centerY(), h = Math.max(me.height(), 40);
        int band = Math.max(220, h * 3);
        AccessibilityNodeInfo p = n.getParent();
        for (int d = 0; d < 6 && p != null; d++) {
            List<AccessibilityNodeInfo> nodes = new ArrayList<>();
            collect(p, nodes, 0);
            String best = null; int bestCost = Integer.MAX_VALUE;
            for (AccessibilityNodeInfo t : nodes) {
                if (t.getText() == null && t.getContentDescription() == null) continue;
                refresh(t);
                if (!t.isVisibleToUser()) continue;
                CharSequence cs = t.getText() != null ? t.getText() : t.getContentDescription();
                if (cs == null) continue;
                String x = cs.toString().trim();
                if (x.length() < 3 || x.equalsIgnoreCase(own) || AutomationPolicy.isAmbiguous(x, ambiguous)
                        || (AutomationPolicy.money(x) != null && x.length() < 14) || x.length() > 80) continue;
                Rect r = new Rect(); t.getBoundsInScreen(r);
                if (r.isEmpty()) continue;
                int dy = r.centerY() - cy;
                if (Math.abs(dy) > band) continue;
                if (r.top >= me.bottom + h) continue;        // a row further down
                int cost = Math.abs(dy) + (dy > 0 ? h : 0);  // below the control costs a bit more than above
                if (cost < bestCost) { bestCost = cost; best = x; }
            }
            if (best != null) return best.length() > 60 ? best.substring(0, 60) : best;
            p = p.getParent();
        }
        return "";
    }

    static AccessibilityNodeInfo focusedEditable(AccessibilityNodeInfo root) {
        AccessibilityNodeInfo f = root.findFocus(AccessibilityNodeInfo.FOCUS_INPUT);
        return f != null && f.isEditable() ? f : null;
    }

    static AccessibilityNodeInfo firstEditable(AccessibilityNodeInfo n, int depth) {
        if (n == null || depth > 40) return null;
        if (n.isEditable() && n.isVisibleToUser()) return n;
        for (int i = 0; i < n.getChildCount(); i++) {
            AccessibilityNodeInfo r = firstEditable(n.getChild(i), depth + 1);
            if (r != null) return r;
        }
        return null;
    }

    static boolean imeEnter(AccessibilityNodeInfo f) {
        if (Build.VERSION.SDK_INT < 30) return false;
        return f.performAction(AccessibilityNodeInfo.AccessibilityAction.ACTION_IME_ENTER.getId());
    }

    /** Closes a pop-up in the way (never a commit button: dismiss words and commit words don't overlap). */
    static boolean dismissPopup(AccessibilityNodeInfo root) {
        List<AccessibilityNodeInfo> all = new ArrayList<>();
        collect(root, all, 0);
        for (AccessibilityNodeInfo n : all) {
            if (!n.isVisibleToUser()) continue;
            String l = labelOf(n);
            if (AutomationPolicy.isDismiss(l) && l.length() < 16) {
                AccessibilityNodeInfo c = clickable(n);
                if (c != null && !spends(c, n) && c.performAction(AccessibilityNodeInfo.ACTION_CLICK)) return true;
            }
        }
        return false;
    }

    static boolean scroll(AccessibilityNodeInfo root, boolean down) {
        List<AccessibilityNodeInfo> all = new ArrayList<>();
        collect(root, all, 0);
        AccessibilityNodeInfo big = null; int area = 0;
        for (AccessibilityNodeInfo n : all) {
            if (!n.isScrollable() || !n.isVisibleToUser()) continue;
            Rect r = new Rect(); n.getBoundsInScreen(r);
            int a = r.width() * r.height();
            if (a > area) { area = a; big = n; }
        }
        return big != null && big.performAction(down ? AccessibilityNodeInfo.ACTION_SCROLL_FORWARD : AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD);
    }

    /**
     * One pass over the target's screen: fixed parts (outside scrolling lists, not typed text) for the fingerprint,
     * all texts, and whether a commit button is showing.
     */
    static void walkScreen(AccessibilityNodeInfo n, int depth, boolean inList, List<String> parts, List<String> all, boolean[] commit) {
        if (n == null || depth > 40 || all.size() > 600) return;
        if (!n.isVisibleToUser()) return;
        CharSequence cs = n.getText() != null && n.getText().length() > 0 ? n.getText() : n.getContentDescription();
        String txt = cs == null ? "" : cs.toString().trim();
        if (!txt.isEmpty()) {
            all.add(txt);
            if (!commit[0] && AutomationPolicy.isCommit(txt) && clickable(n) != null) commit[0] = true;
        }
        if (!inList) {
            String id = n.getViewIdResourceName();
            if (id != null && !id.isEmpty()) parts.add("#" + id.substring(id.indexOf('/') + 1));
            if (!txt.isEmpty() && !n.isEditable()) parts.add(txt);
        }
        boolean list = inList || n.isScrollable();
        for (int i = 0; i < n.getChildCount(); i++) walkScreen(n.getChild(i), depth + 1, list, parts, all, commit);
    }
}
