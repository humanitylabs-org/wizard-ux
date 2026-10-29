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
}
