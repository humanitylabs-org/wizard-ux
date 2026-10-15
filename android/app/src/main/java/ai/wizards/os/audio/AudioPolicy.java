package ai.wizards.os.audio;

import java.net.URI;
import java.util.Set;

/** v1 pilot: generic transport, one explicitly authorized installed app. */
public final class AudioPolicy {
    private AudioPolicy() {}
    public static final Set<String> METHODS = Set.of("capabilities", "attach", "state", "load", "play", "pause", "seek", "next", "previous", "jump", "enqueueNext", "removeCurrent", "removeUpcoming", "volume", "detach", "stop");
    public static boolean trusted(String url, String origin, String kind) {
        try {
            if (url == null || url.length() > 4096 || url.contains("\\") || url.replaceAll("(?i)%3a", ":").contains("%") || url.contains("..")) return false;
            URI u = URI.create(url), o = URI.create(origin);
            if (!u.getScheme().equals(o.getScheme()) || !u.getRawAuthority().equals(o.getRawAuthority()) || u.getUserInfo() != null || u.getFragment() != null) return false;
            String p = u.getRawPath().replaceAll("(?i)%3a", ":");
            if ("stream".equals(kind) || "art".equals(kind)) return p.matches("/wizard-music/" + kind + "/(?:yt|lib):[A-Za-z0-9_-]{1,40}") && u.getQuery() == null;
            if ("more".equals(kind)) return p.matches("/wizard-music/api/station/[a-f0-9]{16}/more");
            return "feedback".equals(kind) && p.equals("/wizard-music/api/feedback") && u.getQuery() == null;
        } catch (RuntimeException e) { return false; }
    }
    public static boolean shell(String url, String origin) {
        try {
            URI u = URI.create(url), o = URI.create(origin);
            return u.getScheme().equals(o.getScheme()) && u.getRawAuthority().equals(o.getRawAuthority()) && u.getUserInfo() == null
                    && u.getPath().startsWith("/wizard-os-home/") && !u.getPath().contains("..") && !u.getRawPath().contains("%");
        } catch (RuntimeException e) { return false; }
    }
}
