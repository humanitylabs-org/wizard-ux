package ai.wizards.os.identity;

import org.json.JSONObject;

/**
 * What the approval sheet says. Built only from the event itself (kind, tags, content), never from text the
 * requester supplies, so a page can't label "post this publicly" as "update your profile".
 */
public final class SignPolicy {
    private SignPolicy() {}

    public static final class Sentence {
        public final String title;    // the one line James reads
        public final String detail;   // what exactly will be signed, in plain words (may be empty)
        public final boolean familiar; // false: "Unfamiliar request", the raw event is shown open
        Sentence(String title, String detail, boolean familiar) { this.title = title; this.detail = detail; this.familiar = familiar; }
    }

    public static Sentence describe(NostrEvent e) {
        switch (e.kind) {
            case 0: return new Sentence("Update your profile", profileDetail(e.content), true);
            case 1: return new Sentence("Post publicly", clip(e.content, 280), true);
            case 3: return new Sentence("Change who you follow", countTags(e, "p") + " people in your follow list", true);
            case 7: return new Sentence("React to a post", clip(e.content, 40), true);
            case 30617: {
                String name = e.tag("name"), d = e.tag("d"), clone = e.tag("clone");
                String app = name != null && !name.isEmpty() ? name : d != null ? d : "an app";
                return new Sentence("Publish " + clip(app, 60) + " as your app", clone == null ? "" : "Code: " + clip(clone, 120), true);
            }
            case 27235: {
                String u = e.tag("u"), m = e.tag("method");
                return new Sentence("Sign in to a website", (m == null ? "" : m + " ") + (u == null ? "" : clip(u, 120)), true);
            }
            default:
                return new Sentence("Unfamiliar request", "Kind " + e.kind + ". Only approve if you know what this is.", false);
        }
    }

    static String profileDetail(String content) {
        try {
            JSONObject p = new JSONObject(content);
            StringBuilder sb = new StringBuilder();
            String n = p.optString("display_name", p.optString("name", ""));
            if (!n.isEmpty()) sb.append("Name: ").append(clip(n, 60));
            String about = p.optString("about", "");
            if (!about.isEmpty()) sb.append(sb.length() > 0 ? "\n" : "").append("About: ").append(clip(about, 140));
            String pic = p.optString("picture", "");
            if (!pic.isEmpty()) sb.append(sb.length() > 0 ? "\n" : "").append("Photo: ").append(clip(pic, 80));
            return sb.toString();
        } catch (Exception x) {
            return "";
        }
    }

    static int countTags(NostrEvent e, String name) {
        int n = 0;
        for (int i = 0; i < e.tags.length(); i++) {
            org.json.JSONArray r = e.tags.optJSONArray(i);
            if (r != null && r.length() > 1 && name.equals(r.optString(0))) n++;
        }
        return n;
    }

    static String clip(String s, int n) {
        if (s == null) return "";
        String t = s.replaceAll("[\\p{Cntrl}&&[^\n]]", " ").trim();
        return t.length() <= n ? t : t.substring(0, n - 1) + "…";
    }
}
