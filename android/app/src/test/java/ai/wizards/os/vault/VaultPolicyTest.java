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
    @Test public void sealedFormatRoundTripsV1AndRejectsMalformedData() {
        byte[] iv = new byte[12], ct = new byte[32]; iv[0] = 8; ct[1] = 12;
        byte[][] decoded = VaultPolicy.unpack(VaultPolicy.pack(iv, ct));
        assertArrayEquals(iv, decoded[0]); assertArrayEquals(ct, decoded[1]);
        for (String bad : new String[]{null, "", ":", "bad:base64", "AA==:AA==", "a:b:c"}) assertNull(VaultPolicy.unpack(bad));
    }
    @Test public void capabilityIsAnExactIndependentAllowlist() throws Exception {
        org.json.JSONObject caps = ai.wizards.os.device.DeviceMessageProtocol.capabilities().getJSONObject("capabilities").getJSONObject("vault");
        assertEquals(1, caps.getInt("v"));
        org.json.JSONArray methods = caps.getJSONArray("methods"); assertEquals(4, methods.length());
        for (int i = 0; i < methods.length(); i++) assertEquals(methods.getString(i), VaultPolicy.method(methods.getString(i)));
        for (String bad : new String[]{null, "open", "vault", "vault.sign", "identity.sign", "vault.open.extra"}) assertNull(VaultPolicy.method(bad));
    }
    @Test public void bridgeIsMainFrameShellOnlyAndBiometricBound() throws Exception {
        String src = new String(Files.readAllBytes(Paths.get("src/main/java/ai/wizards/os/vault/VaultBridge.java")), "UTF-8");
        String dispatcher = Files.readString(Paths.get("src/main/java/ai/wizards/os/apps/AppsBridge.java"));
        assertTrue(dispatcher.contains("!isMainFrame || !shellOnTop()"));
        assertTrue(dispatcher.contains("document == vaultDocument"));
        assertTrue(dispatcher.contains("origin.equals(AppState.origin(activity))"));
        assertTrue(src.contains("active != token || !trusted.getAsBoolean()"));
        assertTrue(src.contains("setUserAuthenticationRequired(true)"));
        assertTrue(src.contains("setInvalidatedByBiometricEnrollment(true)"));
        assertTrue(src.contains("new BiometricPrompt.CryptoObject(cipher)"));
        assertTrue(src.contains("wos-vault-v1-"));
        assertFalse(src.contains("wizard-id-owner-wrap-v1"));
        assertFalse(src.contains("JavascriptInterface"));
        assertFalse("never log the secret", src.matches("(?s).*Log\\.[a-z]\\([^;]*secret[^;]*\\);.*"));
    }
}
