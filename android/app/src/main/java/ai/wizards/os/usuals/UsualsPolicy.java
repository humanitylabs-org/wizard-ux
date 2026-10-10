package ai.wizards.os.usuals;

import java.text.Normalizer;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Pure rules for Usuals (re-ordering James's regular Grab food), unit-tested off-device.
 *
 * The one hard rule lives here: Wizard never taps a button that spends money. {@link #isCommit} names those
 * buttons; the runner stops when one is on screen, and only James's tap on the Place order card presses it.
 */
public final class UsualsPolicy {
    private UsualsPolicy() { }

    public static final String GRAB = "com.grabtaxi.passenger";

    /** Buttons that place an order or take payment, in English and Thai. Never tapped by a recipe step. */
    private static final String[] COMMIT = {
            "place order", "place my order", "place delivery order", "order now", "confirm order", "confirm and pay",
            "confirm payment", "pay now", "pay ฿", "pay thb", "pay $", "checkout and pay", "book and pay", "swipe to order",
            "ยืนยันคำสั่งซื้อ", "ยืนยันการสั่งซื้อ", "สั่งอาหาร", "สั่งเลย", "สั่งซื้อ", "ชำระเงิน"
    };

    /** Pop-ups worth closing when a step's target is not on screen (promos, ratings, tips). */
    private static final String[] DISMISS = {
            "not now", "maybe later", "no thanks", "no, thanks", "skip", "close", "later", "dismiss", "got it", "ok", "okay",
            "ไม่ใช่ตอนนี้", "ไว้ทีหลัง", "ข้าม", "ปิด", "ตกลง"
    };

    private static final Pattern MONEY = Pattern.compile("(฿|THB|\\$|RM|S\\$|Rp)\\s?([0-9][0-9,]*(\\.[0-9]{1,2})?)|([0-9][0-9,]*(\\.[0-9]{1,2})?)\\s?(฿|THB|บาท)");

    public static String norm(String s) {
        if (s == null) return "";
        String n = Normalizer.normalize(s, Normalizer.Form.NFKC).toLowerCase(Locale.ROOT);
        n = n.replace('\u00a0', ' ').replaceAll("\\s+", " ").trim();
        return n;
    }

    public static boolean isCommit(String label) {
        String n = norm(label);
        if (n.isEmpty() || n.length() > 60) return false;
        for (String c : COMMIT) {
            if (!n.startsWith(c)) continue;
            if (n.length() == c.length()) return true;
            char next = n.charAt(c.length());
            // "Place order ฿245" / "Place order · ฿245" yes; "Order nowhere" no.
            if (!Character.isLetter(next) || c.endsWith(" ") || c.endsWith("฿") || c.endsWith("$")) return true;
        }
        return false;
    }

    public static boolean isDismiss(String label) {
        String n = norm(label);
        for (String d : DISMISS) if (n.equals(d)) return true;
        return false;
    }

    /** A label that names nothing in particular ("Add", "+"): the step also remembers the text beside it. */
    public static boolean isGeneric(String label) {
        String n = norm(label);
        if (n.length() <= 2) return true;
        return n.equals("add") || n.equals("add to basket") || n.equals("add to cart") || n.equals("เพิ่ม") || n.equals("plus")
                || n.equals("increase") || n.equals("more") || n.equals("select") || n.equals("เลือก") || isPrice(n);
    }

    public static boolean isPrice(String label) {
        String n = norm(label);
        Matcher m = MONEY.matcher(n.toUpperCase(Locale.ROOT).replace("฿", "฿"));
        return m.find() && m.start() == 0 && n.length() <= 16;
    }

    /**
     * How well a node on screen matches a recorded step: 0 none, higher better. Exact text beats prefix beats
     * contains; the same view id adds one. A step with no label matches by view id alone.
     */
    public static int score(String stepLabel, String stepId, String nodeLabel, String nodeId) {
        String a = norm(stepLabel), b = norm(nodeLabel);
        boolean sameId = stepId != null && !stepId.isEmpty() && stepId.equals(nodeId);
        if (a.isEmpty()) return sameId ? 2 : 0;
        if (b.isEmpty()) return 0;
        int s = 0;
        if (a.equals(b)) s = 4;
        else if (b.startsWith(a) && a.length() >= 3) s = 2;
        else if (a.startsWith(b) && b.length() >= 6) s = 2;
        else if (a.length() >= 4 && b.contains(a)) s = 1;
        if (s > 0 && sameId) s += 1;
        return s;
    }

    /** The order total on a checkout screen: the amount after a "Total" label, else the amount on the commit button. */
    public static String total(List<String> texts) {
        for (int i = 0; i < texts.size(); i++) {
            String n = norm(texts.get(i));
            if ((n.startsWith("total") || n.startsWith("ยอดรวม") || n.startsWith("รวมทั้งหมด")) && !n.startsWith("total savings")) {
                String here = money(texts.get(i));
                if (here != null) return here;
                for (int j = i + 1; j < Math.min(texts.size(), i + 4); j++) {
                    String m = money(texts.get(j));
                    if (m != null) return m;
                }
            }
        }
        for (String t : texts) if (isCommit(t)) { String m = money(t); if (m != null) return m; }
        return null;
    }

    public static String money(String s) {
        if (s == null) return null;
        Matcher m = MONEY.matcher(s);
        if (!m.find()) return null;
        if (m.group(2) != null) return ("THB".equalsIgnoreCase(m.group(1)) ? "฿" : m.group(1)) + m.group(2);
        return "฿" + m.group(4);
    }

    /* ------------------------------------------------------------------ steps */

    public static final class Step {
        public final String type;   // tap | type | wait | enter
        public final String label;  // text / content description of the target, or the words to type, or ms to wait
        public final String id;     // view id, when the app exposes one
        public final String near;   // for generic labels ("Add"): the item name next to it
        public final float x, y;    // where it was on screen, 0..1 (last resort)

        public Step(String type, String label, String id, String near, float x, float y) {
            this.type = type == null ? "tap" : type;
            this.label = label == null ? "" : label;
            this.id = id == null ? "" : id;
            this.near = near == null ? "" : near;
            this.x = x; this.y = y;
        }

        /** Pop-up closers are optional: if the pop-up is not there this time, the step is skipped. */
        public boolean optional() { return "tap".equals(type) && isDismiss(label); }

        public String describe() {
            switch (type) {
                case "type": return "type “" + label + "”";
                case "wait": return "wait " + label + " ms";
                case "enter": return "press search";
                default: return "tap " + (label.isEmpty() ? "(" + id + ")" : "“" + label + "”") + (near.isEmpty() ? "" : " by “" + near + "”");
            }
        }
    }

    /**
     * The written form James can edit: one step per line. "tap Som Tam Nua", "tap Add @ Gai yang", "type som tam",
     * "wait 1500", "search" (press the keyboard's search key). A bare line is a tap.
     */
    public static List<Step> parse(String text) {
        List<Step> out = new ArrayList<>();
        if (text == null) return out;
        for (String raw : text.split("\\r?\\n")) {
            String line = raw.trim();
            if (line.isEmpty() || line.startsWith("#")) continue;
            String low = line.toLowerCase(Locale.ROOT);
            if (low.startsWith("type ")) { out.add(new Step("type", line.substring(5).trim(), "", "", -1, -1)); continue; }
            if (low.startsWith("wait ")) {
                String ms = line.substring(5).trim().replaceAll("[^0-9]", "");
                if (!ms.isEmpty()) out.add(new Step("wait", String.valueOf(Math.min(10000, Integer.parseInt(ms.length() > 6 ? "10000" : ms))), "", "", -1, -1));
                continue;
            }
            if (low.equals("search") || low.equals("enter")) { out.add(new Step("enter", "", "", "", -1, -1)); continue; }
            String body = low.startsWith("tap ") ? line.substring(4).trim() : line;
            String near = "";
            int at = body.indexOf(" @ ");
            if (at > 0) { near = body.substring(at + 3).trim(); body = body.substring(0, at).trim(); }
            if (isCommit(body)) continue; // never written into a recipe
            out.add(new Step("tap", body, "", near, -1, -1));
        }
        return out;
    }

    public static String write(List<Step> steps) {
        StringBuilder b = new StringBuilder();
        for (Step s : steps) {
            if (b.length() > 0) b.append('\n');
            switch (s.type) {
                case "type": b.append("type ").append(s.label); break;
                case "wait": b.append("wait ").append(s.label); break;
                case "enter": b.append("search"); break;
                default: b.append("tap ").append(s.label.isEmpty() ? s.id : s.label); if (!s.near.isEmpty()) b.append(" @ ").append(s.near);
            }
        }
        return b.toString();
    }

    /**
     * Tidies a recording: typing collapses to its final text, a tap on the field that is then typed into is kept,
     * and anything that spends money is dropped. Two taps on the same "+" stay (that is quantity two).
     */
    public static List<Step> tidy(List<Step> in) {
        List<Step> out = new ArrayList<>();
        for (Step s : in) {
            if ("tap".equals(s.type) && isCommit(s.label)) continue;
            if ("tap".equals(s.type) && s.label.isEmpty() && s.id.isEmpty() && s.x < 0) continue;
            if ("type".equals(s.type) && !out.isEmpty() && "type".equals(out.get(out.size() - 1).type)) {
                out.set(out.size() - 1, s);
                continue;
            }
            out.add(s);
        }
        while (!out.isEmpty() && "type".equals(out.get(out.size() - 1).type) && out.get(out.size() - 1).label.isEmpty()) out.remove(out.size() - 1);
        return out;
    }

    /** Ms a step may look for its target before the run gives up on it. */
    public static long stepBudgetMs(Step s) { return s.optional() ? 2500 : 25000; }

    /* ------------------------------------------------------------------ voice */

    private static final Pattern WAKE = Pattern.compile("^(hey |ok |okay )?(wizard|archimedes)[, ]*");
    private static final Pattern VERB = Pattern.compile(
            "^(please )?(can you |could you )?(re-?order|order( me)?|get( me)?|grab( me)?|i want|i'd like|i would like)\\s+(.*)$");

    /**
     * Which usual James asked for, or -1. Needs an ordering verb ("order", "reorder", "get me", "grab me") so
     * ordinary talk never starts a run. "order my usual" alone picks the only usual there is.
     */
    public static int matchVoice(List<String> names, String said) {
        String s = norm(said).replaceAll("[.!?]+$", "");
        s = WAKE.matcher(s).replaceFirst("").trim();
        Matcher m = VERB.matcher(s);
        if (!m.matches()) return -1;
        String rest = m.group(7).trim()
                .replaceAll("^(my |the |our )?(usual|usuals|regular|normal)( order)?( of| from)?\\b", "").trim()
                .replaceAll("^(my |the |a |an |some )", "").trim()
                .replaceAll("\\s+(from grab|on grab|please|again|for me)$", "").trim();
        boolean saidUsual = s.contains("usual") || s.contains("regular") || s.startsWith("reorder") || s.startsWith("re-order");
        if (rest.isEmpty()) return saidUsual && names.size() == 1 ? 0 : -1;
        String[] want = rest.split(" ");
        int best = -1, bestScore = 0;
        for (int i = 0; i < names.size(); i++) {
            String n = norm(names.get(i));
            if (n.isEmpty()) continue;
            int sc;
            if (n.equals(rest)) sc = 100;
            else {
                int hit = 0;
                for (String w : want) if (w.length() > 1 && (" " + n + " ").contains(" " + w + " ")) hit++;
                int nameWords = n.split(" ").length;
                // All of what he said is in the name, or all of the name is in what he said.
                sc = hit == 0 ? 0 : (hit == want.length || hit == nameWords) ? 50 + hit : (saidUsual ? 10 + hit : 0);
            }
            if (sc > bestScore) { bestScore = sc; best = i; }
            else if (sc == bestScore && sc > 0) best = -2; // a tie: ask, don't guess
        }
        return best < 0 ? -1 : best;
    }
}
