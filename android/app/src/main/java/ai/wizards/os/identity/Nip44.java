package ai.wizards.os.identity;

import fr.acinq.secp256k1.Secp256k1;
import org.bouncycastle.crypto.engines.ChaCha7539Engine;
import org.bouncycastle.crypto.params.KeyParameter;
import org.bouncycastle.crypto.params.ParametersWithIV;
import java.nio.ByteBuffer;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Arrays;
import java.util.Base64;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

/** NIP-44 v2. Mobile resource limit: 1..65535 UTF-8 bytes; no conversation-key cache. */
public final class Nip44 {
    private Nip44() { }
    public static final int MAX_PLAINTEXT = 65535;
    public static final int MAX_PAYLOAD = 87472;
    private static final SecureRandom RANDOM = new SecureRandom();
    private static void require(boolean ok) { if (!ok) throw new IllegalArgumentException("Invalid NIP-44 data"); }
    static void wipe(byte[]... arrays) { for (byte[] a : arrays) if (a != null) Arrays.fill(a, (byte)0); }
    public static byte[] publicKey(String hex) {
        require(hex != null && hex.matches("[0-9a-f]{64}"));
        byte[] compressed = new byte[33]; compressed[0] = 2;
        System.arraycopy(NostrEvent.bytes(hex), 0, compressed, 1, 32);
        Secp256k1.get().pubkeyParse(compressed); // Reject off-curve and zero x-only keys before approval.
        return compressed;
    }
    static byte[] conversationKey(byte[] secret, String pubkey) throws Exception {
        require(secret.length == 32 && Secp256k1.get().secKeyVerify(secret));
        // libsecp's ecdh() hashes the point. NIP-44 requires raw X: use its constant-time tweak-mul.
        byte[] point = Secp256k1.get().pubKeyTweakMul(publicKey(pubkey), secret);
        byte[] x = Arrays.copyOfRange(point, 1, 33);
        try { return hmac("nip44-v2".getBytes(StandardCharsets.US_ASCII), x); }
        finally { wipe(point, x); }
    }
    private static byte[] hmac(byte[] key, byte[]... parts) throws Exception {
        Mac mac = Mac.getInstance("HmacSHA256"); mac.init(new SecretKeySpec(key, "HmacSHA256"));
        for (byte[] p : parts) mac.update(p);
        return mac.doFinal();
    }
    static byte[] messageKeys(byte[] conversation, byte[] nonce) throws Exception {
        require(conversation.length == 32 && nonce.length == 32);
        byte[] result = new byte[76], previous = new byte[0];
        try {
            for (int i = 1, pos = 0; pos < result.length; i++) {
                byte[] next = hmac(conversation, previous, nonce, new byte[]{(byte)i}); wipe(previous); previous = next;
                int n = Math.min(32, result.length - pos); System.arraycopy(next, 0, result, pos, n); pos += n;
            }
            return result;
        } catch (Exception e) { wipe(result); throw e; }
        finally { wipe(previous); }
    }
    static int paddedLength(int n) {
        require(n > 0 && n <= 65536);
        if (n <= 32) return 32;
        int power = Integer.highestOneBit(n - 1) << 1, chunk = power <= 256 ? 32 : power / 8;
        return chunk * ((n - 1) / chunk + 1);
    }
    private static byte[] utf8(String text) throws Exception {
        // No silent replacement of malformed UTF-16, which would encrypt different text.
        ByteBuffer bytes = StandardCharsets.UTF_8.newEncoder().onMalformedInput(CodingErrorAction.REPORT).encode(java.nio.CharBuffer.wrap(text));
        byte[] out = new byte[bytes.remaining()]; bytes.get(out); if (bytes.hasArray()) wipe(bytes.array()); return out;
    }
    public static void validatePlaintext(String text) throws Exception {
        require(text != null && text.length() <= MAX_PLAINTEXT);
        byte[] bytes = utf8(text); try { require(bytes.length <= MAX_PLAINTEXT); paddedLength(bytes.length); } finally { wipe(bytes); }
    }
    public static void validatePayload(String payload) {
        require(payload != null && payload.length() >= 132 && payload.length() <= MAX_PAYLOAD);
        require(payload.matches("[A-Za-z0-9+/]+={0,2}") && payload.length() % 4 == 0);
        byte[] data = Base64.getDecoder().decode(payload);
        try { require(data.length >= 99 && data.length <= 65603 && data[0] == 2); }
        finally { wipe(data); }
    }
    private static byte[] chacha(byte[] keys, byte[] input) {
        byte[] key = Arrays.copyOfRange(keys, 0, 32), nonce = Arrays.copyOfRange(keys, 32, 44);
        ChaCha7539Engine engine = new ChaCha7539Engine();
        try {
            engine.init(true, new ParametersWithIV(new KeyParameter(key), nonce)); // RFC8439 counter 0, not AEAD.
            byte[] result = new byte[input.length]; engine.processBytes(input, 0, input.length, result, 0); return result;
        } finally {
            // Overwrite the engine's retained key/working state as well as caller-owned slices.
            engine.init(true, new ParametersWithIV(new KeyParameter(new byte[32]), new byte[12]));
            byte[] zero = new byte[64]; engine.processBytes(zero, 0, zero.length, zero, 0); wipe(zero, key, nonce);
        }
    }
    public static String encrypt(byte[] secret, String pubkey, String plaintext) throws Exception {
        byte[] conversation = conversationKey(secret, pubkey), nonce = new byte[32]; RANDOM.nextBytes(nonce);
        try { return encryptWithKey(conversation, nonce, plaintext); } finally { wipe(conversation, nonce); }
    }
    static String encryptWithKey(byte[] conversation, byte[] nonce, String plaintext) throws Exception {
        byte[] raw = null, padded = null, keys = null, ciphertext = null, macKey = null, mac = null;
        try {
            require(plaintext != null && plaintext.length() <= MAX_PLAINTEXT);
            raw = utf8(plaintext); require(raw.length <= MAX_PLAINTEXT); padded = new byte[2 + paddedLength(raw.length)];
            padded[0] = (byte)(raw.length >>> 8); padded[1] = (byte)raw.length; System.arraycopy(raw, 0, padded, 2, raw.length);
            keys = messageKeys(conversation, nonce); ciphertext = chacha(keys, padded);
            macKey = Arrays.copyOfRange(keys, 44, 76); mac = hmac(macKey, nonce, ciphertext);
            return Base64.getEncoder().encodeToString(ByteBuffer.allocate(65 + ciphertext.length).put((byte)2).put(nonce).put(ciphertext).put(mac).array());
        } finally { wipe(raw, padded, keys, ciphertext, macKey, mac); }
    }
    public static String decrypt(byte[] secret, String pubkey, String payload) throws Exception {
        byte[] conversation = conversationKey(secret, pubkey);
        try { return decryptWithKey(conversation, payload); } finally { wipe(conversation); }
    }
    static String decryptWithKey(byte[] conversation, String payload) throws Exception {
        validatePayload(payload);
        byte[] data = Base64.getDecoder().decode(payload), nonce = Arrays.copyOfRange(data, 1, 33);
        byte[] ciphertext = Arrays.copyOfRange(data, 33, data.length - 32), supplied = Arrays.copyOfRange(data, data.length - 32, data.length);
        byte[] keys = null, macKey = null, expected = null, padded = null;
        try {
            keys = messageKeys(conversation, nonce); macKey = Arrays.copyOfRange(keys, 44, 76); expected = hmac(macKey, nonce, ciphertext);
            require(MessageDigest.isEqual(expected, supplied)); // Authenticate before any decryption or padding checks.
            padded = chacha(keys, ciphertext); int n = ((padded[0] & 255) << 8) | (padded[1] & 255);
            require(n > 0 && n <= padded.length - 2 && padded.length == 2 + paddedLength(n));
            return StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(padded, 2, n)).toString();
        } finally { wipe(data, nonce, ciphertext, supplied, keys, macKey, expected, padded); }
    }
}
