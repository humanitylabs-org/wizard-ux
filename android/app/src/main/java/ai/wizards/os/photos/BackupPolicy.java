package ai.wizards.os.photos;

import java.io.InputStream;
import java.io.IOException;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Base64;
import java.util.Locale;

/** Pure contracts; our implementation, independent of Immich's mobile application. */
public final class BackupPolicy {
    private BackupPolicy() {}
    /** The capabilities of one network that the Wi-Fi-only rule reads, so the rule runs on the JVM. */
    public static final class Net {
        final boolean internet, unmetered, wifi, vpn;
        public Net(boolean internet, boolean unmetered, boolean wifi, boolean vpn) { this.internet=internet; this.unmetered=unmetered; this.wifi=wifi; this.vpn=vpn; }
    }
    /** May a backup item upload now? With Wi-Fi only, a VPN (the tailnet) counts when an unmetered Wi-Fi network sits
     *  under it. The VPN itself is often reported metered, so it is checked before the active network's own metering. */
    public static boolean networkAllowed(Net active, Iterable<Net> all, boolean wifiOnly) {
        if(active==null || !active.internet) return false;
        if(!wifiOnly) return true;
        if(active.vpn) {
            for(Net n:all) if(n!=null && !n.vpn && n.wifi && n.internet && n.unmetered) return true;
            return false;
        }
        return active.unmetered && active.wifi;
    }
    public static final String CALLBACK = "ai.wizards.os://photos/oauth-callback";
    public static String server(String input, boolean test) {
        URI u = URI.create(input.trim());
        boolean loopback = "127.0.0.1".equals(u.getHost()) || "localhost".equals(u.getHost()) || "10.0.2.2".equals(u.getHost());
        if (!("https".equals(u.getScheme()) || (test && loopback && "http".equals(u.getScheme())))
                || u.getHost() == null || u.getUserInfo() != null || u.getQuery() != null || u.getFragment() != null
                || !(u.getPath().isEmpty() || "/".equals(u.getPath())))
            throw new IllegalArgumentException("Enter an HTTPS server origin (no path or credentials)");
        return u.getScheme() + "://" + u.getRawAuthority();
    }
    public static String sha1(InputStream stream) throws Exception {
        MessageDigest d = MessageDigest.getInstance("SHA-1");
        byte[] b = new byte[64 * 1024]; int n;
        while ((n = stream.read(b)) != -1) { if (Thread.currentThread().isInterrupted()) throw new IOException("Stopped"); d.update(b, 0, n); }
        return Base64.getEncoder().encodeToString(d.digest());
    }
    public static String digest(String s) {
        try { return Base64.getUrlEncoder().withoutPadding().encodeToString(MessageDigest.getInstance("SHA-256").digest(s.getBytes(StandardCharsets.UTF_8))); }
        catch (Exception e) { throw new IllegalStateException(e); }
    }
    public static String filename(String name) { return (name == null ? "original" : name).replaceAll("[\r\n\"\\\\]", "_"); }
    public static boolean defaultAlbum(String name) { return "camera".equals(name.toLowerCase(Locale.ROOT)) || "screenshots".equals(name.toLowerCase(Locale.ROOT)); }
    public static boolean validCallback(String url, String state) {
        try {
            URI u = URI.create(url);
            if (!CALLBACK.equals(u.getScheme() + "://" + u.getRawAuthority() + u.getRawPath()) || u.getFragment() != null || state.isEmpty()) return false;
            String found = null, code = null;
            for (String part : u.getRawQuery().split("&")) {
                String[] pair = part.split("=", 2); String v = pair.length == 2 ? java.net.URLDecoder.decode(pair[1], "UTF-8") : "";
                if (pair[0].equals("state")) { if (found != null) return false; found = v; }
                if (pair[0].equals("code")) { if (code != null) return false; code = v; }
                if (pair[0].equals("error")) return false;
            }
            return state.equals(found) && code != null && !code.isEmpty();
        } catch (Exception e) { return false; }
    }
}
