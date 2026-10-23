package ai.wizards.os.vault;

import static org.junit.Assert.*;
import org.junit.Test;
import java.nio.file.Files;
import java.nio.file.Paths;

public class VaultPolicyTest {
    private static String rep(int n) { StringBuilder b = new StringBuilder(); for (int i = 0; i < n; i++) b.append('x'); return b.toString(); }
    @Test public void appIdsCannotAliasEachOther() {
        assertTrue(VaultPolicy.appId("messenger"));
        assertTrue(VaultPolicy.appId("wizard-music"));
        for (String bad : new String[]{null, "", "Messenger", "../x", "a b", "a:b", "-x", rep(65)}) assertFalse(bad, VaultPolicy.appId(bad));
    }
    @Test public void secretsAreBounded() {
        assertTrue(VaultPolicy.secret("p"));
        assertFalse(VaultPolicy.secret(""));
        assertFalse(VaultPolicy.secret(null));
        assertFalse(VaultPolicy.secret(rep(4097)));
    }
    @Test public void titlesAreSanitised() {
        assertEquals("Unlock Messenger", VaultPolicy.title(" Unlock Messenger\n"));
        assertEquals("Unlock", VaultPolicy.title(null));
        assertEquals("Unlock", VaultPolicy.title(rep(61)));
    }
    @Test public void bridgeIsMainFrameShellOnlyAndBiometricBound() throws Exception {
        String src = new String(Files.readAllBytes(Paths.get("src/main/java/ai/wizards/os/vault/VaultBridge.java")), "UTF-8");
        assertTrue(src.contains("!main ||"));
        assertTrue(src.contains("AudioPolicy.shell("));
        assertTrue(src.contains("setUserAuthenticationRequired(true)"));
        assertTrue(src.contains("setInvalidatedByBiometricEnrollment(true)"));
        assertTrue(src.contains("new BiometricPrompt.CryptoObject(c)"));
        assertFalse("never log the secret", src.matches("(?s).*Log\\.[a-z]\\([^;]*secret[^;]*\\);.*"));
    }
}
