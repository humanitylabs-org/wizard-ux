package ai.wizards.os.automation;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;
import java.util.regex.Pattern;
import java.util.regex.PatternSyntaxException;

/**
 * Voice shortcuts web registers so an orb or the side button can start an automation while the Wizard OS page is
 * not running. Web owns every word. A table is
 * <pre>{entries: [{pattern: "^…$", priority: 0..1000, action: "key"}], actions: {key: {op: "replay"|"record", …}}}</pre>
 * where each pattern is anchored and matched against the normalised phrase ({@link AutomationPolicy#phrase}).
 * Native only picks the highest-priority match; two different actions tied at the top mean "ask", so nothing runs.
 * Replay actions pass the same money check as any replay. Pure Java (org.json only), unit-tested off-device.
 */
public final class AutomationShortcuts {
    public static final int MAX_ENTRIES = 400;
    public static final int MAX_ACTIONS = 60;
    public static final int MAX_PATTERN = 2000;

    public static final class Entry {
        public final Pattern pattern;
        public final int priority;
        public final String key;
        Entry(Pattern p, int priority, String key) { this.pattern = p; this.priority = priority; this.key = key; }
    }

    public static final class Table {
        public final List<Entry> entries;
        public final JSONObject actions;
        Table(List<Entry> e, JSONObject a) { entries = e; actions = a; }
    }

    private AutomationShortcuts() { }

    /** Validates web's table; throws on anything malformed so a half-valid table never replaces a good one. */
    public static Table parse(JSONObject t) throws AutomationPolicy.Refusal {
        List<Entry> out = new ArrayList<>();
        if (t == null) return new Table(out, new JSONObject());
        JSONArray a = t.optJSONArray("entries");
        JSONObject actions = t.optJSONObject("actions");
        if (a == null || actions == null) throw new AutomationPolicy.Refusal("bad-shortcut");
        if (a.length() > MAX_ENTRIES || actions.length() > MAX_ACTIONS) throw new AutomationPolicy.Refusal("too-many-shortcuts");
        for (Iterator<String> it = actions.keys(); it.hasNext(); ) {
            String k = it.next();
            JSONObject action = actions.optJSONObject(k);
            if (k.isEmpty() || k.length() > 64 || action == null) throw new AutomationPolicy.Refusal("bad-shortcut");
            String op = action.optString("op", "");
            if (op.equals("replay")) AutomationPolicy.steps(action.optJSONArray("steps")); // the money rule applies here too
            else if (!op.equals("record")) throw new AutomationPolicy.Refusal("bad-shortcut");
        }
        for (int i = 0; i < a.length(); i++) {
            JSONObject o = a.optJSONObject(i);
            if (o == null) throw new AutomationPolicy.Refusal("bad-shortcut");
            String p = o.optString("pattern", ""), key = o.optString("action", "");
            if (p.isEmpty() || p.length() > MAX_PATTERN || !p.startsWith("^") || !p.endsWith("$") || !actions.has(key)) throw new AutomationPolicy.Refusal("bad-shortcut");
            Pattern compiled;
            try { compiled = Pattern.compile(p); } catch (PatternSyntaxException e) { throw new AutomationPolicy.Refusal("bad-shortcut"); }
            out.add(new Entry(compiled, Math.max(0, Math.min(1000, o.optInt("priority", 0))), key));
        }
        return new Table(out, actions);
    }

    /** The action for this phrase, or null: no match, or two different actions tie at the top. */
    public static JSONObject match(Table t, String phrase) {
        if (phrase == null || phrase.isEmpty() || t == null) return null;
        Entry best = null; boolean tie = false;
        for (Entry e : t.entries) {
            if (!e.pattern.matcher(phrase).matches()) continue;
            if (best == null || e.priority > best.priority) { best = e; tie = false; }
            else if (e.priority == best.priority && !e.key.equals(best.key)) tie = true;
        }
        return best == null || tie ? null : t.actions.optJSONObject(best.key);
    }
}
