package ai.wizards.os.identity;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.security.GeneralSecurityException;
import java.util.Arrays;

import javax.crypto.Cipher;
import javax.crypto.Mac;
import javax.crypto.spec.IvParameterSpec;
import javax.crypto.spec.SecretKeySpec;

/**
 * NIP-49 import: ncryptsec1… → 32-byte secret. scrypt (RFC 7914) + XChaCha20-Poly1305, both done here because
 * Android's JCA has neither scrypt nor XChaCha. XChaCha = HChaCha20 subkey + the platform's ChaCha20-Poly1305
 * (API 28+, and JDK 11+ for the JVM tests). Wizard ID only reads ncryptsec; backups go to the password manager.
 */
public final class Nip49 {
    private Nip49() {}

    public static final class BadPassword extends Exception {
        BadPassword() { super("That password doesn't open this key."); }
    }

    public static byte[] decrypt(String ncryptsec, String password) throws BadPassword {
        Bech32.Decoded d = Bech32.decode(ncryptsec);
        if (!"ncryptsec".equals(d.hrp)) throw new IllegalArgumentException("not an ncryptsec");
        byte[] b = d.data;
        if (b.length != 91 || b[0] != 0x02) throw new IllegalArgumentException("unsupported ncryptsec version");
        int logN = b[1] & 0xff;
        if (logN < 1 || logN > 18) throw new IllegalArgumentException("unsupported scrypt cost"); // 2^18 = 256 MB of scrypt memory
        byte[] salt = Arrays.copyOfRange(b, 2, 18);
        byte[] nonce = Arrays.copyOfRange(b, 18, 42);
        byte[] ad = Arrays.copyOfRange(b, 42, 43);
        byte[] ct = Arrays.copyOfRange(b, 43, 91);
        byte[] pw = java.text.Normalizer.normalize(password == null ? "" : password, java.text.Normalizer.Form.NFKC)
                .getBytes(java.nio.charset.StandardCharsets.UTF_8);
        byte[] key = scrypt(pw, salt, 1 << logN, 8, 1, 32);
        try {
            byte[] sk = xchachaOpen(key, nonce, ad, ct);
            if (sk.length != 32) throw new BadPassword();
            return sk;
        } catch (GeneralSecurityException e) {
            throw new BadPassword();
        } finally {
            Arrays.fill(key, (byte) 0);
            Arrays.fill(pw, (byte) 0);
        }
    }

    /* ------------------------------------------------------------------ XChaCha20-Poly1305 (open only) */

    static byte[] xchachaOpen(byte[] key, byte[] nonce24, byte[] ad, byte[] ct) throws GeneralSecurityException {
        byte[] sub = hchacha20(key, Arrays.copyOfRange(nonce24, 0, 16));
        byte[] n12 = new byte[12];
        System.arraycopy(nonce24, 16, n12, 4, 8);
        try {
            Cipher c = Cipher.getInstance("ChaCha20-Poly1305");
            c.init(Cipher.DECRYPT_MODE, new SecretKeySpec(sub, "ChaCha20"), new IvParameterSpec(n12));
            c.updateAAD(ad);
            return c.doFinal(ct);
        } finally {
            Arrays.fill(sub, (byte) 0);
        }
    }

    static byte[] hchacha20(byte[] key, byte[] n16) {
        int[] s = new int[16];
        s[0] = 0x61707865; s[1] = 0x3320646e; s[2] = 0x79622d32; s[3] = 0x6b206574;
        ByteBuffer k = ByteBuffer.wrap(key).order(ByteOrder.LITTLE_ENDIAN);
        for (int i = 0; i < 8; i++) s[4 + i] = k.getInt();
        ByteBuffer n = ByteBuffer.wrap(n16).order(ByteOrder.LITTLE_ENDIAN);
        for (int i = 0; i < 4; i++) s[12 + i] = n.getInt();
        for (int i = 0; i < 10; i++) {
            qr(s, 0, 4, 8, 12); qr(s, 1, 5, 9, 13); qr(s, 2, 6, 10, 14); qr(s, 3, 7, 11, 15);
            qr(s, 0, 5, 10, 15); qr(s, 1, 6, 11, 12); qr(s, 2, 7, 8, 13); qr(s, 3, 4, 9, 14);
        }
        ByteBuffer out = ByteBuffer.allocate(32).order(ByteOrder.LITTLE_ENDIAN);
        for (int i : new int[]{0, 1, 2, 3, 12, 13, 14, 15}) out.putInt(s[i]);
        Arrays.fill(s, 0);
        return out.array();
    }

    private static void qr(int[] s, int a, int b, int c, int d) {
        s[a] += s[b]; s[d] = Integer.rotateLeft(s[d] ^ s[a], 16);
        s[c] += s[d]; s[b] = Integer.rotateLeft(s[b] ^ s[c], 12);
        s[a] += s[b]; s[d] = Integer.rotateLeft(s[d] ^ s[a], 8);
        s[c] += s[d]; s[b] = Integer.rotateLeft(s[b] ^ s[c], 7);
    }

    /* ------------------------------------------------------------------ scrypt (RFC 7914) */

    static byte[] scrypt(byte[] pw, byte[] salt, int n, int r, int p, int dkLen) {
        if (n < 2 || (n & (n - 1)) != 0) throw new IllegalArgumentException("N must be a power of 2");
        byte[] b = pbkdf2(pw, salt, p * 128 * r);
        int[] xy = new int[64 * r];
        int[] v = new int[32 * r * n];
        for (int i = 0; i < p; i++) romix(b, i * 128 * r, r, n, v, xy);
        Arrays.fill(v, 0);
        byte[] dk = pbkdf2(pw, b, dkLen);
        Arrays.fill(b, (byte) 0);
        return dk;
    }

    private static byte[] pbkdf2(byte[] pw, byte[] salt, int len) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(pw.length == 0 ? new EmptyKey() : new SecretKeySpec(pw, "HmacSHA256"));
            byte[] out = new byte[len];
            byte[] block = new byte[4];
            for (int i = 1, off = 0; off < len; i++, off += 32) {
                block[0] = (byte) (i >>> 24); block[1] = (byte) (i >>> 16); block[2] = (byte) (i >>> 8); block[3] = (byte) i;
                mac.update(salt);
                byte[] u = mac.doFinal(block); // c = 1
                System.arraycopy(u, 0, out, off, Math.min(32, len - off));
            }
            return out;
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException(e);
        }
    }

    /** HMAC with a zero-length key (SecretKeySpec refuses empty keys). */
    private static final class EmptyKey implements javax.crypto.SecretKey {
        @Override public String getAlgorithm() { return "HmacSHA256"; }
        @Override public String getFormat() { return "RAW"; }
        @Override public byte[] getEncoded() { return new byte[0]; }
    }

    private static void romix(byte[] b, int off, int r, int n, int[] v, int[] xy) {
        int words = 32 * r;
        int[] x = new int[words];
        ByteBuffer bb = ByteBuffer.wrap(b, off, 128 * r).order(ByteOrder.LITTLE_ENDIAN);
        for (int i = 0; i < words; i++) x[i] = bb.getInt();
        for (int i = 0; i < n; i++) { System.arraycopy(x, 0, v, i * words, words); blockMix(x, r, xy); }
        for (int i = 0; i < n; i++) {
            int j = x[(2 * r - 1) * 16] & (n - 1);
            for (int k = 0; k < words; k++) x[k] ^= v[j * words + k];
            blockMix(x, r, xy);
        }
        ByteBuffer out = ByteBuffer.wrap(b, off, 128 * r).order(ByteOrder.LITTLE_ENDIAN);
        for (int i = 0; i < words; i++) out.putInt(x[i]);
        Arrays.fill(x, 0);
    }

    private static void blockMix(int[] b, int r, int[] y) {
        int[] x = Arrays.copyOfRange(b, (2 * r - 1) * 16, 2 * r * 16);
        for (int i = 0; i < 2 * r; i++) {
            for (int k = 0; k < 16; k++) x[k] ^= b[i * 16 + k];
            salsa8(x);
            System.arraycopy(x, 0, y, i * 16, 16);
        }
        for (int i = 0; i < r; i++) System.arraycopy(y, (2 * i) * 16, b, i * 16, 16);
        for (int i = 0; i < r; i++) System.arraycopy(y, (2 * i + 1) * 16, b, (r + i) * 16, 16);
    }

    private static void salsa8(int[] b) {
        int[] x = b.clone();
        for (int i = 0; i < 8; i += 2) {
            x[4] ^= Integer.rotateLeft(x[0] + x[12], 7);  x[8] ^= Integer.rotateLeft(x[4] + x[0], 9);
            x[12] ^= Integer.rotateLeft(x[8] + x[4], 13); x[0] ^= Integer.rotateLeft(x[12] + x[8], 18);
            x[9] ^= Integer.rotateLeft(x[5] + x[1], 7);   x[13] ^= Integer.rotateLeft(x[9] + x[5], 9);
            x[1] ^= Integer.rotateLeft(x[13] + x[9], 13); x[5] ^= Integer.rotateLeft(x[1] + x[13], 18);
            x[14] ^= Integer.rotateLeft(x[10] + x[6], 7); x[2] ^= Integer.rotateLeft(x[14] + x[10], 9);
            x[6] ^= Integer.rotateLeft(x[2] + x[14], 13); x[10] ^= Integer.rotateLeft(x[6] + x[2], 18);
            x[3] ^= Integer.rotateLeft(x[15] + x[11], 7); x[7] ^= Integer.rotateLeft(x[3] + x[15], 9);
            x[11] ^= Integer.rotateLeft(x[7] + x[3], 13); x[15] ^= Integer.rotateLeft(x[11] + x[7], 18);
            x[1] ^= Integer.rotateLeft(x[0] + x[3], 7);   x[2] ^= Integer.rotateLeft(x[1] + x[0], 9);
            x[3] ^= Integer.rotateLeft(x[2] + x[1], 13);  x[0] ^= Integer.rotateLeft(x[3] + x[2], 18);
            x[6] ^= Integer.rotateLeft(x[5] + x[4], 7);   x[7] ^= Integer.rotateLeft(x[6] + x[5], 9);
            x[4] ^= Integer.rotateLeft(x[7] + x[6], 13);  x[5] ^= Integer.rotateLeft(x[4] + x[7], 18);
            x[11] ^= Integer.rotateLeft(x[10] + x[9], 7); x[8] ^= Integer.rotateLeft(x[11] + x[10], 9);
            x[9] ^= Integer.rotateLeft(x[8] + x[11], 13); x[10] ^= Integer.rotateLeft(x[9] + x[8], 18);
            x[12] ^= Integer.rotateLeft(x[15] + x[14], 7); x[13] ^= Integer.rotateLeft(x[12] + x[15], 9);
            x[14] ^= Integer.rotateLeft(x[13] + x[12], 13); x[15] ^= Integer.rotateLeft(x[14] + x[13], 18);
        }
        for (int i = 0; i < 16; i++) b[i] += x[i];
    }
}
