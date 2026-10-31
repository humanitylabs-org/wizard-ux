package ai.wizards.os.photos;
import org.junit.Test;
import static org.junit.Assert.*;
import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
public class BackupPolicyTest {
    @Test public void sha1UsesImmichBase64Contract() throws Exception {
        assertEquals("qZk+NkcGgWq6PiVxeFDCbJzQ2J0=",BackupPolicy.sha1(new ByteArrayInputStream("abc".getBytes(StandardCharsets.UTF_8))));
    }
    @Test public void defaultAlbumsAreExact() { assertTrue(BackupPolicy.defaultAlbum("Camera")); assertTrue(BackupPolicy.defaultAlbum("Screenshots")); assertFalse(BackupPolicy.defaultAlbum("Secret Camera")); }
    @Test public void serversCannotRedirectOrSmuggleCredentials() {
        assertEquals("https://example.org:2283",BackupPolicy.server("https://example.org:2283/",false));
        for(String bad:new String[]{"http://example.org","https://user:pass@example.org","https://example.org/api","https://example.org?key=x","https://example.org#x","file:///foo","http://localhost:2286"}) {
            try { BackupPolicy.server(bad,false); fail(bad); } catch(IllegalArgumentException expected) {}
        }
        assertEquals("http://127.0.0.1:2286",BackupPolicy.server("http://127.0.0.1:2286",true));
        try { BackupPolicy.server("http://example.org",true); fail(); } catch(IllegalArgumentException expected) {}
    }
    @Test public void callbacksRequireExactRouteStateAndCode() {
        String good=BackupPolicy.CALLBACK+"?state=random&code=abc";
        assertTrue(BackupPolicy.validCallback(good,"random"));
        assertFalse(BackupPolicy.validCallback(good,"other"));
        assertFalse(BackupPolicy.validCallback(good+"&state=other","random"));
        assertFalse(BackupPolicy.validCallback(good+"&error=denied","random"));
        assertFalse(BackupPolicy.validCallback(good+"#x","random"));
        assertFalse(BackupPolicy.validCallback(good.replace("photos/","evil/"),"random"));
        assertFalse(BackupPolicy.validCallback(BackupPolicy.CALLBACK+"?state=random","random"));
    }
    @Test public void multipartFilenameCannotInjectHeaders() { assertEquals("a__b_.jpg",BackupPolicy.filename("a\r\nb\".jpg")); }
    @Test public void pkceUsesS256Base64Url() { assertEquals("ungWv48Bz-pBQUDeXa4iI7ADYaOWF3qctBD_YfIAFa0",BackupPolicy.digest("abc")); }
    // James, Wi-Fi only on behind the tailnet VPN: the VPN is the active network and reports metered. Backup must still
    // run on the Wi-Fi under it, and must not use mobile data under it.
    private static BackupPolicy.Net net(boolean internet,boolean unmetered,boolean wifi,boolean vpn) { return new BackupPolicy.Net(internet,unmetered,wifi,vpn); }
    @Test public void wifiOnlyLooksThroughAMeteredVpnToItsWifi() {
        BackupPolicy.Net vpn=net(true,false,true,true), wifi=net(true,true,true,false), cell=net(true,false,false,false);
        assertTrue(BackupPolicy.networkAllowed(vpn,java.util.Arrays.asList(vpn,wifi),true));
        assertFalse(BackupPolicy.networkAllowed(vpn,java.util.Arrays.asList(vpn,cell),true));
        assertTrue(BackupPolicy.networkAllowed(vpn,java.util.Arrays.asList(vpn,cell),false));
    }
    @Test public void wifiOnlyWithoutVpn() {
        BackupPolicy.Net wifi=net(true,true,true,false), cell=net(true,false,false,false), metered=net(true,false,true,false);
        assertTrue(BackupPolicy.networkAllowed(wifi,java.util.Arrays.asList(wifi),true));
        assertFalse(BackupPolicy.networkAllowed(cell,java.util.Arrays.asList(cell),true));
        assertFalse(BackupPolicy.networkAllowed(metered,java.util.Arrays.asList(metered),true));
        assertFalse(BackupPolicy.networkAllowed(null,java.util.Collections.emptyList(),false));
        assertFalse(BackupPolicy.networkAllowed(net(false,true,true,false),java.util.Collections.emptyList(),false));
    }
}
