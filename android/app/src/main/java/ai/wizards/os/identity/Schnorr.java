package ai.wizards.os.identity;

import java.security.SecureRandom;
import java.util.Arrays;

import fr.acinq.secp256k1.Secp256k1;

/** BIP-340 over libsecp256k1 (fr.acinq secp256k1-kmp). Every signature is checked before it is returned. */
public final class Schnorr {
    private static final SecureRandom RANDOM = new SecureRandom();

    private Schnorr() {}

    private static Secp256k1 lib() { return Secp256k1.Companion; }

    public static boolean validSecret(byte[] sk) {
        return sk != null && sk.length == 32 && lib().secKeyVerify(sk);
    }

    /** 32-byte x-only public key, hex. */
    public static String publicKey(byte[] sk) {
        if (!validSecret(sk)) throw new IllegalArgumentException("That isn't a valid key.");
        byte[] full = lib().pubkeyCreate(sk);
        if (full.length != 65 || full[0] != 4) throw new IllegalStateException("unexpected public key encoding");
        return Hex.of(Arrays.copyOfRange(full, 1, 33));
    }

    public static byte[] newSecret() {
        for (int i = 0; i < 1024; i++) {
            byte[] c = new byte[32];
            RANDOM.nextBytes(c);
            if (lib().secKeyVerify(c)) return c;
            Arrays.fill(c, (byte) 0);
        }
        throw new IllegalStateException("secure random produced no valid key");
    }

    public static String sign(byte[] digest32, byte[] sk, String expectedPubkey) {
        if (digest32.length != 32) throw new IllegalArgumentException("digest must be 32 bytes");
        if (!publicKey(sk).equals(expectedPubkey)) throw new IllegalStateException("The stored key doesn't match this Wizard ID.");
        byte[] aux = new byte[32];
        RANDOM.nextBytes(aux);
        try {
            byte[] sig = lib().signSchnorr(digest32, sk, aux);
            if (!verify(sig, digest32, expectedPubkey)) throw new IllegalStateException("Signature self-check failed.");
            return Hex.of(sig);
        } finally {
            Arrays.fill(aux, (byte) 0);
        }
    }

    public static boolean verify(byte[] sig, byte[] digest32, String pubkeyHex) {
        try { return lib().verifySchnorr(sig, digest32, Hex.parse(pubkeyHex)); }
        catch (RuntimeException e) { return false; }
    }
}
