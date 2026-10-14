package ai.wizards.os.device;

import android.content.Context;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

/**
 * Who the phone belongs to and what their agent is called, as the owner's own Wizard says (Agent Service settings
 * owner.name / agent.name / voice.vocabulary, read by the shell from GET /wizard/v1/bootstrap and handed over with
 * WizardOSNative.setProfile). Native text the owner or the model reads (voice requests sent from outside the app,
 * notifications, transcription hints) uses it. Nothing about any particular person is built in: unknown means
 * "The owner" and "Wizard".
 */
public final class OwnerProfile {
    static final String PREFS = "owner_profile";
    static final String KEY = "json";
    static final int MAX_NAMES = 40;
    /** Product words every Wizard's speech-to-text should spell right. */
    static final String[] PRODUCT_NAMES = {"Wizard", "Hermes", "Mizel"};

    private static volatile String owner = "";
    private static volatile String agent = "";
    private static volatile List<String> vocabulary = Collections.emptyList();

    private OwnerProfile() {}

    public static void load(Context c) {
        apply(c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, ""));
    }

    /** From the shell: {"owner": "...", "agent": "...", "vocabulary": [...]}. Unknown or bad input changes nothing. */
    public static boolean save(Context c, String json) {
        if (!apply(json)) return false;
        c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY, json).apply();
        return true;
    }

    /** Parse and take {@code json}; false when it is not a profile object. Pure enough for unit tests. */
    public static boolean apply(String json) {
        if (json == null || json.isEmpty() || json.length() > 16_384) return false;
        try {
            JSONObject o = new JSONObject(json);
            owner = clean(o.optString("owner", ""), 80);
            agent = clean(o.optString("agent", ""), 40);
            List<String> v = new ArrayList<>();
            JSONArray a = o.optJSONArray("vocabulary");
            if (a != null) for (int i = 0; i < a.length() && v.size() < MAX_NAMES; i++) {
                String w = clean(a.optString(i, ""), 40);
                if (!w.isEmpty()) v.add(w);
            }
            vocabulary = Collections.unmodifiableList(v);
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    /** Unit tests / a fresh install. */
    public static void reset() { owner = ""; agent = ""; vocabulary = Collections.emptyList(); }

    private static String clean(String s, int max) {
        String t = s == null ? "" : s.replaceAll("[\\p{Cntrl}]", " ").trim().replaceAll("\\s+", " ");
        return t.length() > max ? t.substring(0, max).trim() : t;
    }

    /** The owner's name, or "" when the Wizard has not said. */
    public static String owner() { return owner; }

    /** The owner's name for the start of a sentence: their name, else "The owner". */
    public static String ownerSubject() { return owner.isEmpty() ? "The owner" : owner; }

    /** The agent's display name ("Wizard" until the owner names it). */
    public static String agent() { return agent.isEmpty() ? "Wizard" : agent; }

    /** "Names: …." for speech-to-text: the agent, the owner, product words, then the owner's own words. */
    public static String names() {
        Set<String> all = new LinkedHashSet<>();
        if (!agent.isEmpty()) all.add(agent);
        if (!owner.isEmpty()) all.add(owner);
        Collections.addAll(all, PRODUCT_NAMES);
        all.addAll(vocabulary);
        List<String> out = new ArrayList<>(all);
        if (out.size() > MAX_NAMES) out = out.subList(0, MAX_NAMES);
        return "Names: " + String.join(", ", out) + ".";
    }
}
