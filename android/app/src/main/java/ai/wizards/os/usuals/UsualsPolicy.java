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
        for (String raw : COMMIT) {
            String c = norm(raw); // NFKC splits Thai ำ: compare normalised to normalised
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
        for (String d : DISMISS) if (n.equals(norm(d))) return true;
        return false;
    }

    /** A label that names nothing in particular ("Add", "+"): the step also remembers the text beside it. */
    public static boolean isGeneric(String label) {
        String n = norm(label);
        if (n.length() <= 2) return true;
        return n.equals("add") || n.equals("add to basket") || n.equals("add to cart") || n.equals(norm("เพิ่ม")) || n.equals("plus")
                || n.equals("increase") || n.equals("more") || n.equals("select") || n.equals(norm("เลือก")) || isPrice(n);
    }

    /** A tap that puts something in the basket: "Add", "Add to basket · ฿65", "+", "เพิ่ม". */
    public static boolean isAddLabel(String label) {
        String n = norm(label);
        if (n.isEmpty() || isCommit(label) || isRemoveLabel(label)) return false;
        // "Add", "Add to basket · ฿65", "Add ฿65", "Add 2 to basket"; not "Address" or "Add a note for the driver".
        return n.equals("+") || n.equals("plus") || n.equals("increase") || n.equals("add")
                || n.matches("add to (basket|cart|order)\\b.*") || n.matches("add\\s*[·•|-]?\\s*(฿|\\$|thb)?\\s*[0-9].*")
                || n.matches("add [0-9]+ (item|items )?to (basket|cart|order)\\b.*")
                || n.equals(norm("เพิ่ม")) || n.startsWith(norm("เพิ่มลง")) || n.startsWith(norm("ใส่ตะกร้า"));
    }

    /** A tap that takes something out: "Remove", "−", "Delete", "ลบ". */
    public static boolean isRemoveLabel(String label) {
        String n = norm(label);
        return n.equals("-") || n.equals("−") || n.equals("–") || n.equals("minus") || n.equals("decrease") || n.equals("remove")
                || n.startsWith("remove ") || n.equals("delete") || n.equals(norm("ลบ")) || n.equals(norm("ลด"));
    }

    /** A recorded step that added to the basket. */
    public static boolean isAdd(Step s) {
        return s != null && "tap".equals(s.type) && !isRemoveLabel(s.label)
                && (isAddLabel(s.label) || (!s.near.isEmpty() && isPrice(s.label)));
    }

    public static boolean isRemove(Step s) { return s != null && "tap".equals(s.type) && isRemoveLabel(s.label); }

    public static boolean isPrice(String label) {
        String n = norm(label);
        Matcher m = MONEY.matcher(n.toUpperCase(Locale.ROOT).replace("฿", "฿"));
        return m.find() && m.start() == 0 && n.length() <= 16;
    }

    /**
     * How well a node on screen matches a recorded step: 0 none, higher better. Exact text beats prefix beats
     * contains; the same view id adds one. A step with no label matches by view id alone.
     */
    /** Without numbers and money: what a button is, not how many or how much. */
    static String noCounts(String n) {
        return n.replaceAll("(฿|\\$|thb|บาท)", "").replaceAll("[0-9\u0e50-\u0e59]+([.,][0-9]+)*", "").replaceAll("\\s+", " ").trim();
    }

    public static int score(String stepLabel, String stepId, String nodeLabel, String nodeId) {
        String a = norm(stepLabel), b = norm(nodeLabel);
        boolean sameId = stepId != null && !stepId.isEmpty() && stepId.equals(nodeId);
        if (a.isEmpty()) return sameId ? 2 : 0;
        if (b.isEmpty()) return 0;
        int s = 0;
        String an = noCounts(a), bn = noCounts(b);
        if (a.equals(b)) s = 4;
        else if (an.length() >= 4 && an.equals(bn)) s = 3; // "View basket · 4 items" is "View basket · 3 items" now
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
            if ((n.startsWith("total") || n.startsWith(norm("ยอดรวม")) || n.startsWith(norm("รวมทั้งหมด"))) && !n.startsWith("total savings")) {
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
            if (isRemove(s)) continue; // a recipe only builds the basket up (path() already took back what was removed)
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

    /* ------------------------------------------------------------------ browse-first recording */

    /**
     * One entry of a browse recording, with when it happened: either the screen Grab showed (a fingerprint from
     * {@link #sig}) or a step James took. Screens come from a light poll; steps from his taps and typing.
     */
    public static final class Rec {
        public final String sig;
        public final Step step;
        public final long t;
        private Rec(String sig, Step step, long t) { this.sig = sig; this.step = step; this.t = t; }
        public static Rec screen(String sig, long t) { return new Rec(sig == null ? "" : sig, null, t); }
        public static Rec of(Step s, long t) { return new Rec(null, s, t); }
    }

    /**
     * A screen's fingerprint from its fixed parts (titles, bars, view ids; not the contents of scrolling lists or
     * what's typed in a field). Digits and prices are dropped so "View basket · 2 items" matches "· 3 items".
     * "" means "can't tell".
     */
    public static String sig(List<String> parts) {
        java.util.TreeSet<String> set = new java.util.TreeSet<>();
        for (String p : parts) {
            if (p == null) continue;
            String n = norm(p);
            if (n.length() < 2 || n.length() > 48 || isPrice(n)) continue;
            n = n.replaceAll("[0-9\u0e50-\u0e59]+([.,][0-9]+)?", "").replaceAll("[฿$]", "").replaceAll("\\s+", " ").trim();
            if (n.length() < 2) continue;
            set.add(n);
            if (set.size() >= 40) break;
        }
        return String.join("|", set);
    }

    /**
     * Which dish each add was for. "Add" beside a dish names it (near); "Add to basket" on a dish's own page is for
     * the tap that opened that page (not the options he picked on it, like "Pork" or "Extra egg").
     */
    public static java.util.Map<Step, String> items(List<Rec> recsIn) {
        List<Rec> recs = new ArrayList<>(recsIn);
        recs.sort((x, y) -> Long.compare(x.t, y.t));
        java.util.Map<Step, String> itemOf = new java.util.IdentityHashMap<>();
        String lastTap = "", screenItem = "", sig = null;
        for (Rec r : recs) {
            if (r.step == null) {
                if (!r.sig.isEmpty() && !r.sig.equals(sig)) { sig = r.sig; screenItem = lastTap; }
                continue;
            }
            Step s = r.step;
            if (!"tap".equals(s.type)) continue;
            if (isAdd(s) || isRemove(s)) itemOf.put(s, !s.near.isEmpty() ? s.near : !screenItem.isEmpty() && isAdd(s) ? screenItem : isAdd(s) ? lastTap : "");
            else if (!s.optional() && !isCommit(s.label) && !isGeneric(s.label)) lastTap = s.label;
        }
        return itemOf;
    }

    /** A tap within this long before the screen changed is what changed it. */
    static final long CAUSE_MS = 4000;

    /**
     * The route James actually took to his basket, with the browsing taken out.
     *
     * <ul>
     * <li>Coming back to a screen he was already on (Back out of a restaurant he didn't order from, out of reviews,
     *     out of checkout) erases the detour and the tap that started it, unless something that ended up in the
     *     basket was added on the way (an item page that returns to the menu after "Add to basket").</li>
     * <li>With the checkout screen's text known, adds of things that aren't in the final basket are dropped too
     *     (added, then removed at checkout).</li>
     * </ul>
     *
     * @param finalTexts texts on the last checkout screen, or null if he never reached it
     */
    public static List<Step> path(List<Rec> recsIn, List<String> finalTexts) {
        List<Rec> recs = new ArrayList<>(recsIn);
        recs.sort((x, y) -> Long.compare(x.t, y.t)); // tap times are when he tapped; screens when they were seen
        java.util.Map<Step, String> itemOf = items(recs);
        String basketText = "";
        if (finalTexts != null) { StringBuilder b = new StringBuilder(); for (String t : finalTexts) b.append(' ').append(norm(t)); basketText = b.toString(); }
        final String bt = basketText;
        java.util.function.Predicate<String> kept = item -> {
            if (bt.isEmpty() || item == null || item.isEmpty()) return true;
            String n = norm(item);
            if (bt.contains(n)) return true;
            String[] w = n.split(" ");
            return (n.length() > 12 && bt.contains(n.substring(0, 12))) || (w.length >= 2 && bt.contains(w[0] + " " + w[1]));
        };

        List<String> sigs = new ArrayList<>();
        List<Long> since = new ArrayList<>();
        List<List<Rec>> visits = new ArrayList<>();
        for (Rec r : recs) {
            if (r.step != null) {
                if (visits.isEmpty()) { sigs.add(""); since.add(r.t); visits.add(new ArrayList<>()); }
                visits.get(visits.size() - 1).add(r);
                continue;
            }
            String g = r.sig;
            if (g.isEmpty()) continue;
            if (!sigs.isEmpty() && g.equals(sigs.get(sigs.size() - 1))) continue;
            int j = sigs.lastIndexOf(g);
            if (j >= 0) {
                boolean productive = false;
                for (int v = j + 1; v < visits.size() && !productive; v++)
                    for (Rec x : visits.get(v)) if (isAdd(x.step) && kept.test(itemOf.get(x.step))) { productive = true; break; }
                if (!productive) {
                    // Did one of his taps take him away from screen j? Then everything since was a detour: erase it
                    // with that tap. If the screen changed on its own (a pop-up, a redraw, results appearing as he
                    // typed), keep his typing and pop-up closers from that stretch; only its taps were browsing.
                    long left = since.get(j + 1);
                    List<Rec> on = visits.get(j);
                    boolean tapped = false;
                    if (!on.isEmpty()) {
                        Rec last = on.get(on.size() - 1);
                        if ("tap".equals(last.step.type) && !isAdd(last.step) && !last.step.optional() && left - last.t <= CAUSE_MS) {
                            on.remove(on.size() - 1);
                            tapped = true;
                        }
                    }
                    List<Rec> keep = new ArrayList<>();
                    for (int v = j + 1; v < visits.size(); v++)
                        for (Rec x : visits.get(v))
                            if (x.step.optional() || (!tapped && !"tap".equals(x.step.type))) keep.add(x);
                    while (sigs.size() > j + 1) { sigs.remove(sigs.size() - 1); since.remove(since.size() - 1); visits.remove(visits.size() - 1); }
                    on.addAll(keep);
                    continue;
                }
            }
            sigs.add(g);
            since.add(r.t);
            visits.add(new ArrayList<>());
        }
        List<Step> out = new ArrayList<>();
        for (List<Rec> v : visits) for (Rec x : v) out.add(x.step);

        // "−" / Remove: takes back the latest add of that item; the tap itself never goes in a recipe.
        for (int i = 0; i < out.size(); i++) {
            Step s = out.get(i);
            if (!isRemove(s)) continue;
            String item = itemOf.get(s);
            out.remove(i--);
            if (item == null || item.isEmpty()) continue;
            for (int k = i; k >= 0; k--) {
                Step a = out.get(k);
                String ai = itemOf.get(a);
                if (isAdd(a) && ai != null && !ai.isEmpty() && (item.equals(ai) || norm(item).contains(norm(ai)))) { out.remove(k); i--; break; }
            }
        }
        // Added then taken out again: only when the checkout text plainly lists the rest of the basket.
        if (!bt.isEmpty()) {
            boolean anyKept = false;
            for (Step s : out) if (isAdd(s) && itemOf.containsKey(s) && !itemOf.get(s).isEmpty() && kept.test(itemOf.get(s))) { anyKept = true; break; }
            if (anyKept) out.removeIf(s -> itemOf.containsKey(s) && !kept.test(itemOf.get(s)));
        }
        return out;
    }

    /** What went into the basket, in order, with how many: item name → count. {@code items} from {@link #items}, or null. */
    public static java.util.LinkedHashMap<String, Integer> basket(List<Step> steps, java.util.Map<Step, String> items) {
        java.util.LinkedHashMap<String, Integer> m = new java.util.LinkedHashMap<>();
        String lastItem = "";
        for (Step s : steps) {
            if (!"tap".equals(s.type)) continue;
            if (isAdd(s)) {
                String item = items != null && items.containsKey(s) ? items.get(s) : !s.near.isEmpty() ? s.near : lastItem;
                if (item != null && !item.isEmpty()) m.merge(item, 1, Integer::sum);
            } else if (!isGeneric(s.label) && !s.optional() && !isCommit(s.label)) lastItem = s.label;
        }
        return m;
    }

    /** "2× Kra pao moo saap · 1× Thai iced tea" */
    public static String basketLine(List<Step> steps, java.util.Map<Step, String> items) {
        StringBuilder b = new StringBuilder();
        for (java.util.Map.Entry<String, Integer> e : basket(steps, items).entrySet()) {
            if (b.length() > 0) b.append(" · ");
            b.append(e.getValue()).append("× ").append(e.getKey());
        }
        return b.toString();
    }

    /** The restaurant: the last real tap before the first dish was opened or added. */
    public static String place(List<Step> steps, java.util.Map<Step, String> items) {
        Step first = null;
        for (Step s : steps) if ("tap".equals(s.type) && isAdd(s)) { first = s; break; }
        String dish = first == null ? "" : items != null && items.containsKey(first) ? items.get(first) : first.near;
        String last = "";
        for (Step s : steps) {
            if (s == first) break;
            if (!"tap".equals(s.type)) continue;
            if (dish != null && !dish.isEmpty() && first.near.isEmpty() && s.label.equals(dish)) break; // the dish's own page
            if (isGeneric(s.label) || s.optional() || s.label.length() > 60) continue;
            last = s.label;
        }
        return last;
    }

    /** A name he would say: the dish he took most of ("Kra pao moo saap"), plus the next one or "+ 2 more". */
    public static String suggestName(List<Step> steps, java.util.Map<Step, String> items) {
        java.util.LinkedHashMap<String, Integer> b = basket(steps, items);
        List<String> names = new ArrayList<>(b.keySet());
        if (names.isEmpty()) { String p = place(steps, items); return p.isEmpty() ? "Grab order" : clip(p); }
        String first = names.get(0);
        for (String i : names) if (b.get(i) > b.get(first)) first = i;
        if (names.size() == 1) return clip(first);
        String other = names.get(0).equals(first) ? names.get(1) : names.get(0);
        if (names.size() == 2) return clip(first + " + " + other);
        return clip(first + " + " + (names.size() - 1) + " more");
    }

    private static String clip(String s) { return s.length() > 40 ? s.substring(0, 39).trim() + "…" : s; }

    private static final Pattern BROWSE_ORDER = Pattern.compile(
            "(something|anything)( new| different| else)?( to eat)?( (from|on) grab)?|(some )?food( (from|on) grab)?|(from |on )?grab( ?food)?");
    private static final Pattern BROWSE_GET = Pattern.compile(
            "(some )?food( (from|on) grab)?|something (new )?to eat( (from|on) grab)?|something (new )?(from|on) grab|grab( ?food)?");

    /**
     * "Order something new", "order food", "get me some food from Grab": open Grab to browse (and save the route)
     * instead of running a usual. "I want something else" on its own is ordinary talk, not food.
     */
    public static boolean isBrowse(String said) {
        String s = norm(said).replaceAll("[.!?]+$", "");
        s = WAKE.matcher(s).replaceFirst("").trim();
        Matcher m = VERB.matcher(s);
        if (!m.matches()) return false;
        String verb = m.group(3).trim(), rest = m.group(7).trim().replaceAll("^(me |us )", "").trim();
        boolean order = verb.startsWith("order") || verb.startsWith("reorder") || verb.startsWith("re-order");
        return (order ? BROWSE_ORDER : BROWSE_GET).matcher(rest).matches();
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
