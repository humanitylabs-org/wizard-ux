package ai.wizards.os.mizel;

import android.content.Context;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.util.Log;

import org.json.JSONException;
import org.json.JSONObject;

import java.util.UUID;

/**
 * Native borrowers' side of the meeting microphone loan: the floating orb (voice typing and asks) and the side
 * button. Wraps MeetingRecorderService's existing begin/bind/endBorrow (the same receipts the in-app orb uses) and
 * writes the transcript notes for that interruption onto the receipt, which MeetingEventSync posts to the meeting.
 */
public final class MeetingLoans {
    static final String TAG = "WizardMizel";

    private MeetingLoans() {}

    public static MicLoan.Meeting of(Context c) {
        return new MicLoan.Meeting() {
            @Override public String liveMeetingId() {
                MeetingRecorderService.Live l = MeetingRecorderService.live();
                return l == null || l.stopping ? null : l.meetingId;
            }
            @Override public boolean begin(String eventId, String meetingId) {
                String r = MeetingRecorderService.beginBorrow(eventId, meetingId);
                return r != null && !"null".equals(r) && MeetingRecorderService.permitsBorrow(eventId);
            }
            @Override public boolean bind(String eventId, String takeId) { return MeetingRecorderService.bindBorrow(eventId, takeId); }
            @Override public String end(String eventId, String outcome) {
                String r = MeetingRecorderService.endBorrow(eventId, outcome);
                try { return r == null || "null".equals(r) ? null : new JSONObject(r).optString("status", null); }
                catch (JSONException e) { return null; }
            }
        };
    }

    public static String newEventId() { return "orb-" + UUID.randomUUID(); }

    /**
     * Take the mic for a native voice take. {@code kind} is "dictation" (voice typing into another app) or "ask";
     * {@code target} is the app being typed into, when known. Returns null when refused (MicLoan.refusal()).
     */
    public static MicLoan acquire(Context c, String who, String source, String kind, String takeId, String target) {
        MicLoan l = MicLoan.acquire(of(c), who, takeId, newEventId());
        if (l != null && l.borrowed) {
            Log.i(TAG, "meeting loan " + l.eventId + " to " + source + " (" + kind + ") take=" + takeId + " meeting=" + l.meetingId);
            note(c, l.eventId, obj("source", source, "kind", kind, "target", target == null ? "" : target,
                    "event", "paused", "voiceTakeId", takeId));
        }
        return l;
    }

    /** The take's mic is closed: return the meeting's mic. Event status is set by the caller's note. */
    public static String release(Context c, MicLoan l, String outcome) {
        if (l == null) return null;
        boolean first = !l.ended();
        String after = l.release(of(c), outcome);
        if (first && l.borrowed) {
            Log.i(TAG, "meeting loan " + l.eventId + " returned (" + outcome + "); meeting " + after);
            note(c, l.eventId, obj("endedAt", System.currentTimeMillis(), "takeOutcome", outcome));
        }
        return after;
    }

    public static void note(Context c, String eventId, JSONObject patch) {
        if (eventId == null || eventId.isEmpty() || patch == null) return;
        if (!MeetingRecorderService.annotate(c, eventId, patch)) Log.w(TAG, "meeting loan note not saved " + eventId);
    }

    public static JSONObject obj(Object... kv) {
        JSONObject o = new JSONObject();
        for (int i = 0; i + 1 < kv.length; i += 2) {
            try { o.put(String.valueOf(kv[i]), kv[i + 1] == null ? JSONObject.NULL : kv[i + 1]); } catch (JSONException ignored) { }
        }
        return o;
    }

    /** A person's name for the app being typed into ("Messages"), or "" when Android won't say. */
    public static String appLabel(Context c, String pkg) {
        if (pkg == null || pkg.isEmpty()) return "";
        if (pkg.equals(c.getPackageName())) return "Wizard OS";
        try {
            PackageManager pm = c.getPackageManager();
            ApplicationInfo ai = pm.getApplicationInfo(pkg, 0);
            CharSequence label = pm.getApplicationLabel(ai);
            return label == null ? "" : label.toString();
        } catch (Exception e) { return ""; }
    }
}
