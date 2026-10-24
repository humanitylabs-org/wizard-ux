package ai.wizards.os.automation;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.Normalizer;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.TreeSet;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Pure rules for the generic accessibility-automation capability (device.automation v1), unit-tested off-device.
 *
 * The money-safety boundary lives here, not in any web feature: {@link #isCommit} names the buttons that place an
 * order or take payment. A replay step can never target one ({@link #steps} refuses the recipe), a matched node that
 * turns out to be one stops the run, and the only path that presses one is the user's own tap on the native cover's
 * confirm button. None of this is configurable from web.
 */
public final class AutomationPolicy {
    private AutomationPolicy() { }

    /** Apps the capability may drive. Adding one is an APK decision, like the commit words (never a web parameter). */
    private static final Set<String> TARGETS = Collections.unmodifiableSet(new HashSet<>(Collections.singletonList("com.grabtaxi.passenger")));
    /** Debug (QA) builds only: the androidTest dummy target app. */
    public static final String QA_TARGET = "ai.wizards.os.qa.test";

    public static final int MAX_STEPS = 120;
    public static final int MAX_LABEL = 120;
    public static final int MAX_EVENTS = 1500;
    public static final int MAX_TEXTS = 400;
    public static final int MAX_WORD = 160;

    public static boolean target(String pkg, boolean debug, String ownPackage) {
        if (pkg == null || pkg.isEmpty() || pkg.equals(ownPackage)) return false;
        return TARGETS.contains(pkg) || (debug && QA_TARGET.equals(pkg));
    }

    /** Buttons that place an order or take payment, in English and Thai. Never tapped by a replay step. */
    private static final String[] COMMIT = {
            "place order", "place my order", "place delivery order", "order now", "confirm order", "confirm and pay",
            "confirm payment", "pay now", "pay ฿", "pay thb", "pay $", "checkout and pay", "book and pay", "swipe to order",
            "ยืนยันคำสั่งซื้อ", "ยืนยันการสั่งซื้อ", "สั่งอาหาร", "สั่งเลย", "สั่งซื้อ", "ชำระเงิน"
    };

    /** Pop-ups the replay may close when a step's target is not on screen (promos, ratings, tips). */
    private static final String[] DISMISS = {
            "not now", "maybe later", "no thanks", "no, thanks", "skip", "close", "later", "dismiss", "got it", "ok", "okay",
            "ไม่ใช่ตอนนี้", "ไว้ทีหลัง", "ข้าม", "ปิด", "ตกลง"
    };

    private static final Pattern MONEY = Pattern.compile("(฿|THB|\\$|RM|S\\$|Rp)\\s?([0-9][0-9,]*(\\.[0-9]{1,2})?)|([0-9][0-9,]*(\\.[0-9]{1,2})?)\\s?(฿|THB|บาท)");

    public static String norm(String s) {
        if (s == null) return "";
        String n = Normalizer.normalize(s, Normalizer.Form.NFKC).toLowerCase(Locale.ROOT);
        return n.replace('\u00a0', ' ').replaceAll("\\s+", " ").trim();
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

    public static boolean isPrice(String label) {
        String n = norm(label);
        Matcher m = MONEY.matcher(n.toUpperCase(Locale.ROOT));
        return m.find() && m.start() == 0 && n.length() <= 16;
    }

    public static boolean hasMoney(String s) { return s != null && MONEY.matcher(s).find(); }

    /**
     * Web's words for controls that name nothing in particular ("Add", "+"): "word" exact, "word *" prefix. A
     * recorded tap on one also remembers the text beside it; a replay step with {@code near} must find that text.
     */
    public static List<String> ambiguous(JSONArray extra) {
        List<String> out = new ArrayList<>();
        if (extra != null) for (int i = 0; i < Math.min(extra.length(), 60); i++) {
            String s = norm(extra.optString(i, ""));
            if (!s.isEmpty() && s.length() <= 40) out.add(s);
        }
        return out;
    }

    /** Needs the neighbouring text to tell it apart: very short, a bare price, or on the ambiguous list. */
    public static boolean isAmbiguous(String label, List<String> words) {
        String n = norm(label);
        if (n.length() <= 2 || isPrice(n)) return true;
        for (String w : words) {
            if (w.endsWith(" *") ? n.startsWith(w.substring(0, w.length() - 1)) : n.equals(w)) return true;
        }
        return false;
    }

    /** Without numbers and money: what a button is, not how many or how much. */
    static String noCounts(String n) {
        return n.replaceAll("(฿|\\$|thb|บาท)", "").replaceAll("[0-9\u0e50-\u0e59]+([.,][0-9]+)*", "").replaceAll("\\s+", " ").trim();
    }

    /**
     * How well a node on screen matches a step: 0 none, higher better. Exact text beats same-without-counts beats
     * prefix beats contains; the same view id adds one. A step with no label matches by view id alone.
     */
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

    /**
     * A screen's fingerprint from its fixed parts (titles, bars, view ids; not scrolling lists or typed text).
     * Digits and prices are dropped so "View basket · 2 items" matches "· 3 items". "" means "can't tell".
     */
    public static String sig(List<String> parts) {
        TreeSet<String> set = new TreeSet<>();
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

    /* ------------------------------------------------------------------ steps */

    public static final class Step {
        public final String type;   // tap | type | wait | enter
        public final String label;  // target text, words to type, or ms to wait
        public final String id;     // view id, when the app exposes one
        public final String near;   // for ambiguous labels ("Add"): the text beside it
        public final String say;    // what the cover says while doing it (web's words)

        public Step(String type, String label, String id, String near, String say) {
            this.type = type == null ? "tap" : type;
            this.label = label == null ? "" : label;
            this.id = id == null ? "" : id;
            this.near = near == null ? "" : near;
            this.say = say == null ? "" : say;
        }

        /** Pop-up closers are optional: if the pop-up is not there this time, the step is skipped. */
        public boolean optional() { return "tap".equals(type) && isDismiss(label); }
    }

    public static final class Refusal extends Exception {
        public final String code;
        public Refusal(String code) { super(code); this.code = code; }
    }

    private static String clip(String s, int max) { return s.length() > max ? s.substring(0, max) : s; }

    /**
     * Validates a recipe from web. Refuses the whole recipe (code "commit-step") if any tap names a commit button:
     * a caller that wants money spent gets an error, not a silently shortened run.
     */
    public static List<Step> steps(JSONArray a) throws Refusal {
        if (a == null || a.length() == 0) throw new Refusal("no-steps");
        if (a.length() > MAX_STEPS) throw new Refusal("too-many-steps");
        List<Step> out = new ArrayList<>();
        for (int i = 0; i < a.length(); i++) {
            JSONObject o = a.optJSONObject(i);
            if (o == null) throw new Refusal("bad-step");
            String type = o.optString("type", "tap");
            if (!type.equals("tap") && !type.equals("type") && !type.equals("wait") && !type.equals("enter")) throw new Refusal("bad-step");
            String label = o.optString("label", ""), id = o.optString("id", ""), near = o.optString("near", "");
            if (label.length() > MAX_LABEL || id.length() > MAX_LABEL || near.length() > MAX_LABEL) throw new Refusal("bad-step");
            if (type.equals("tap") && label.isEmpty() && id.isEmpty()) throw new Refusal("bad-step");
            if (type.equals("tap") && isCommit(label)) throw new Refusal("commit-step");
            if (type.equals("wait")) {
                int ms;
                try { ms = Integer.parseInt(label.trim()); } catch (NumberFormatException e) { throw new Refusal("bad-step"); }
                label = String.valueOf(Math.max(0, Math.min(10000, ms)));
            }
            out.add(new Step(type, label, id, near, clip(o.optString("say", ""), MAX_WORD)));
        }
        return out;
    }

    /** Ms a step may look for its target before the run gives up on it. */
    public static long stepBudgetMs(Step s) { return s.optional() ? 2500 : 25000; }

    /** A web-supplied cover word: bounded, single-line; the fallback when absent. */
    public static String word(JSONObject words, String key, String fallback) {
        String s = words == null ? "" : words.optString(key, "");
        s = s.replaceAll("[\\p{Cntrl}]+", " ").trim();
        return s.isEmpty() ? fallback : clip(s, MAX_WORD);
    }

    /**
     * The amount about to be spent, read off the target app's own screen for the confirm cover: the amount after a
     * "Total" label, else the amount on the commit button. Native, so web can't misstate what a tap will spend.
     */
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

    /* ------------------------------------------------------------------ voice shortcuts */

    private static final int MAX_PHRASE = 100;

    /**
     * What a spoken phrase is compared on: NFKC lower case, curly apostrophes straightened, punctuation to spaces,
     * and the wake words ("hey Saffron,", "Wizard") taken off the front. Everything else (politeness, verbs,
     * synonyms) is web's: it registers every phrase it wants matched, already in this form.
     */
    public static String phrase(String said, String wizardName) {
        String s = norm(said).replace('\u2019', '\'').replace('\u2018', '\'');
        String name = norm(ai.wizards.os.device.WizardIdentity.normalize(wizardName)).replace('\u2019', '\'');
        s = Pattern.compile("^(hey |ok |okay )?(?:" + Pattern.quote(name) + "|wizard)(?=[, .!?]|$)[, .!?]*").matcher(s).replaceFirst("");
        s = s.replaceAll("[.!?,;:\"“”]+", " ").replaceAll("\\s+", " ").trim();
        return s.length() > MAX_PHRASE ? "" : s;
    }

    /** "{n}" etc. in a web word, filled natively. */
    public static String fill(String template, String... kv) {
        String s = template;
        for (int i = 0; i + 1 < kv.length; i += 2) s = s.replace("{" + kv[i] + "}", kv[i + 1] == null ? "" : kv[i + 1]);
        return s;
    }
}
