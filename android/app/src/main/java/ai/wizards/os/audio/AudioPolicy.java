package ai.wizards.os.audio;

import java.net.URI;
import java.util.Set;

/** Generic transport for the explicitly admitted installed media apps (Music; Podcasts since wizard-ux issue 1661). */
public final class AudioPolicy {
    private AudioPolicy() {}
    public static final Set<String> METHODS = Set.of("capabilities", "attach", "state", "load", "play", "pause", "seek", "next", "previous", "jump", "enqueueNext", "removeCurrent", "removeUpcoming", "volume", "rate", "detach", "stop");
    public static final String MUSIC = "wizard-music", PODCASTS = "wizard-podcasts";
    /** Exactly these apps get the phone's media player, the way only Maps gets location. Never widen this from the registry. */
    public static final Set<String> APPS = Set.of(MUSIC, PODCASTS);
    public static boolean admitted(String appId) { return appId != null && APPS.contains(appId); }
    /** Podcasts is spoken word: its own content type, and -15/+30 buttons instead of next/previous. */
    public static boolean spoken(String appId) { return PODCASTS.equals(appId); }
    /** Where the notification / lock-screen tap goes: the app that owns the playback. */
    public static String openPath(String appId) { return "/wizard-os-home/?open=" + (admitted(appId) ? appId : MUSIC); }
    public static boolean trackId(String appId, String id) {
        if (id == null) return false;
        if (PODCASTS.equals(appId)) return id.matches("ep:[0-9]{1,12}");
        return MUSIC.equals(appId) && id.matches("(?:yt|lib):[A-Za-z0-9_-]{1,40}");
    }
    /** A skip size the app asked for, clamped to 5..120 s; 0 means use next/previous. */
    public static long skipMs(double seconds) {
        if (Double.isNaN(seconds) || seconds <= 0) return 0;
        return Math.round(Math.max(5, Math.min(120, seconds)) * 1000);
    }
    /** A playback speed the app asked for (wizard-ux issue 2061), clamped to 0.5..3; anything unreadable is 1. */
    public static float rate(double value) {
        if (Double.isNaN(value) || Double.isInfinite(value) || value <= 0) return 1f;
        return (float) Math.max(0.5, Math.min(3, value));
    }
    /** Music's original rules, unchanged. */
    public static boolean trusted(String url, String origin, String kind) { return trusted(url, origin, kind, MUSIC); }
    public static boolean trusted(String url, String origin, String kind, String appId) {
        try {
            if (!admitted(appId) || url == null || url.length() > 4096 || url.contains("\\") || url.replaceAll("(?i)%3a", ":").contains("%") || url.contains("..")) return false;
            URI u = URI.create(url), o = URI.create(origin);
            if (!u.getScheme().equals(o.getScheme()) || !u.getRawAuthority().equals(o.getRawAuthority()) || u.getUserInfo() != null || u.getFragment() != null) return false;
            String p = u.getRawPath().replaceAll("(?i)%3a", ":");
            if (PODCASTS.equals(appId)) {
                if (u.getQuery() != null) return false;
                if ("stream".equals(kind)) return p.matches("/" + PODCASTS + "/api/episodes/[0-9]{1,12}/audio");
                if ("art".equals(kind)) return p.matches("/" + PODCASTS + "/api/(?:episodes|shows)/[0-9]{1,12}/art");
                return "progress".equals(kind) && p.matches("/" + PODCASTS + "/api/episodes/[0-9]{1,12}/progress");
            }
            if ("stream".equals(kind) || "art".equals(kind)) return p.matches("/" + MUSIC + "/" + kind + "/(?:yt|lib):[A-Za-z0-9_-]{1,40}") && u.getQuery() == null;
            if ("more".equals(kind)) return p.matches("/" + MUSIC + "/api/station/[a-f0-9]{16}/more");
            return "feedback".equals(kind) && p.equals("/" + MUSIC + "/api/feedback") && u.getQuery() == null;
        } catch (RuntimeException e) { return false; }
    }
    /** The kind ("art" or "stream") of a media URL any admitted app may play, or null. The shared data source opens only these. */
    public static String mediaKind(String url, String origin) {
        for (String app : APPS) {
            if (trusted(url, origin, "art", app)) return "art";
            if (trusted(url, origin, "stream", app)) return "stream";
        }
        return null;
    }
    public static boolean shell(String url, String origin) {
        try {
            URI u = URI.create(url), o = URI.create(origin);
            return u.getScheme().equals(o.getScheme()) && u.getRawAuthority().equals(o.getRawAuthority()) && u.getUserInfo() == null
                    && u.getPath().startsWith("/wizard-os-home/") && !u.getPath().contains("..") && !u.getRawPath().contains("%");
        } catch (RuntimeException e) { return false; }
    }
}
