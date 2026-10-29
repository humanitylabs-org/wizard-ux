package ai.wizards.os.identity;

import fr.acinq.secp256k1.Secp256k1;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Arrays;
import static org.junit.Assert.*;

/** Official public test vectors, not owner keys. All JNI/Gradle execution runs on Thales. */
public class Nip44Test {
    private JSONObject vectors() throws Exception {
        try (InputStream in = getClass().getResourceAsStream("/nip44.vectors.json")) {
            return new JSONObject(new String(in.readAllBytes(), StandardCharsets.UTF_8)).getJSONObject("v2");
        }
    }
    private byte[] bytes(JSONObject o, String key) throws Exception { return NostrEvent.bytes(o.getString(key)); }
    private String pub(byte[] secret) { return NostrEvent.hex(Arrays.copyOfRange(Secp256k1.get().pubkeyCreate(secret), 1, 33)); }
    @Test public void officialConversationKeys35() throws Exception {
        JSONArray list = vectors().getJSONObject("valid").getJSONArray("get_conversation_key"); assertEquals(35, list.length());
        for (int i = 0; i < list.length(); i++) { JSONObject v = list.getJSONObject(i);
            assertArrayEquals(bytes(v, "conversation_key"), Nip44.conversationKey(bytes(v, "sec1"), v.getString("pub2")));
        }
    }
    @Test public void officialMessageKeys32() throws Exception {
        JSONObject group = vectors().getJSONObject("valid").getJSONObject("get_message_keys"); JSONArray list = group.getJSONArray("keys"); assertEquals(32, list.length());
        for (int i = 0; i < list.length(); i++) { JSONObject v = list.getJSONObject(i);
            byte[] keys = Nip44.messageKeys(bytes(group, "conversation_key"), bytes(v, "nonce"));
            assertArrayEquals(bytes(v, "chacha_key"), Arrays.copyOfRange(keys, 0, 32));
            assertArrayEquals(bytes(v, "chacha_nonce"), Arrays.copyOfRange(keys, 32, 44));
            assertArrayEquals(bytes(v, "hmac_key"), Arrays.copyOfRange(keys, 44, 76));
        }
    }
    @Test public void officialPaddingLengths24() throws Exception {
        JSONArray list = vectors().getJSONObject("valid").getJSONArray("calc_padded_len"); assertEquals(24, list.length());
        for (int i = 0; i < list.length(); i++) { JSONArray v = list.getJSONArray(i); assertEquals(v.getInt(1), Nip44.paddedLength(v.getInt(0))); }
    }
    @Test public void officialEncryptDecrypt10AndSymmetricEcdh() throws Exception {
        JSONArray list = vectors().getJSONObject("valid").getJSONArray("encrypt_decrypt"); assertEquals(10, list.length());
        for (int i = 0; i < list.length(); i++) { JSONObject v = list.getJSONObject(i);
            byte[] a = bytes(v, "sec1"), b = bytes(v, "sec2"), key = bytes(v, "conversation_key"); String text = v.getString("plaintext"), payload = v.getString("payload");
            assertArrayEquals(key, Nip44.conversationKey(a, pub(b))); assertArrayEquals(key, Nip44.conversationKey(b, pub(a)));
            assertEquals(payload, Nip44.encryptWithKey(key, bytes(v, "nonce"), text));
            assertEquals(text, Nip44.decrypt(b, pub(a), payload));
            assertEquals(text, Nip44.decrypt(b, pub(a), Nip44.encrypt(a, pub(b), text)));
        }
    }
    @Test public void officialLongMessages3() throws Exception {
        JSONArray list = vectors().getJSONObject("valid").getJSONArray("encrypt_decrypt_long_msg"); assertEquals(3, list.length());
        for (int i = 0; i < list.length(); i++) { JSONObject v = list.getJSONObject(i);
            String text = v.getString("pattern").repeat(v.getInt("repeat")); byte[] key = bytes(v, "conversation_key");
            assertEquals(v.getString("plaintext_sha256"), hash(text)); String payload = Nip44.encryptWithKey(key, bytes(v, "nonce"), text);
            assertEquals(v.getString("payload_sha256"), hash(payload)); assertEquals(text, Nip44.decryptWithKey(key, payload));
        }
    }
    private String hash(String s) throws Exception { return NostrEvent.hex(MessageDigest.getInstance("SHA-256").digest(s.getBytes(StandardCharsets.UTF_8))); }
    @Test public void officialInvalidKeys8() throws Exception {
        JSONArray list = vectors().getJSONObject("invalid").getJSONArray("get_conversation_key"); assertEquals(8, list.length());
        for (int i = 0; i < list.length(); i++) { JSONObject v = list.getJSONObject(i); assertThrows(Exception.class, () -> Nip44.conversationKey(bytes(v, "sec1"), v.getString("pub2"))); }
    }
    @Test public void officialInvalidDecrypt12() throws Exception {
        JSONArray list = vectors().getJSONObject("invalid").getJSONArray("decrypt"); assertEquals(12, list.length());
        for (int i = 0; i < list.length(); i++) { JSONObject v = list.getJSONObject(i); assertThrows(v.getString("note"), Exception.class, () -> Nip44.decryptWithKey(bytes(v, "conversation_key"), v.getString("payload"))); }
    }
    @Test public void officialInvalidLengths4AndMalformedUtf8() throws Exception {
        JSONArray list = vectors().getJSONObject("invalid").getJSONArray("encrypt_msg_lengths"); assertEquals(4, list.length());
        for (int i = 0; i < list.length(); i++) { int n = list.getInt(i); assertThrows(Exception.class, () -> Nip44.validatePlaintext("a".repeat(n))); }
        assertThrows(Exception.class, () -> Nip44.validatePlaintext("\ud800"));
        assertThrows(Exception.class, () -> Nip44.validatePlaintext("🧙".repeat(20000)));
        assertThrows(Exception.class, () -> Nip44.messageKeys(new byte[31], new byte[32]));
        assertThrows(Exception.class, () -> Nip44.messageKeys(new byte[32], new byte[31]));
        assertThrows(Exception.class, () -> Nip44.validatePayload("A".repeat(90000)));
    }
}
