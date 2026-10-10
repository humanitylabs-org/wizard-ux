package ai.wizards.os.identity;

import java.util.Arrays;

/** Turns whatever the owner pasted or picked into a 32-byte secret: nsec1…, or ncryptsec1… with its password. */
public final class KeyText {
    private KeyText() {}

    public enum Kind { NSEC, NCRYPTSEC, NPUB, UNKNOWN }

    public static Kind kind(String s) {
        String t = s == null ? "" : s.trim().toLowerCase(java.util.Locale.ROOT);
        if (t.startsWith("nsec1")) return Kind.NSEC;
        if (t.startsWith("ncryptsec1")) return Kind.NCRYPTSEC;
        if (t.startsWith("npub1")) return Kind.NPUB;
        return Kind.UNKNOWN;
    }

    /** @throws IllegalArgumentException with a sentence James can read; Nip49.BadPassword for a wrong password. */
    public static byte[] secret(String text, String password) throws Nip49.BadPassword {
        switch (kind(text)) {
            case NSEC: {
                Bech32.Decoded d;
                try { d = Bech32.decode(text); } catch (IllegalArgumentException e) { throw new IllegalArgumentException("That key has a typo in it. Copy it again."); }
                if (!"nsec".equals(d.hrp) || d.data.length != 32) throw new IllegalArgumentException("That key has a typo in it. Copy it again.");
                if (!Schnorr.validSecret(d.data)) { Arrays.fill(d.data, (byte) 0); throw new IllegalArgumentException("That isn't a valid key."); }
                return d.data;
            }
            case NCRYPTSEC: {
                if (password == null || password.isEmpty()) throw new IllegalArgumentException("This key is locked with a password. Enter it below.");
                byte[] sk;
                try { sk = Nip49.decrypt(text.trim(), password); }
                catch (IllegalArgumentException e) { throw new IllegalArgumentException("That key has a typo in it. Copy it again."); }
                if (!Schnorr.validSecret(sk)) { Arrays.fill(sk, (byte) 0); throw new IllegalArgumentException("That isn't a valid key."); }
                return sk;
            }
            case NPUB:
                throw new IllegalArgumentException("That's your public key (npub). Signing needs the private key, which starts with nsec.");
            default:
                throw new IllegalArgumentException("Paste a key that starts with nsec or ncryptsec.");
        }
    }

    public static String nsec(byte[] sk) { return Bech32.encode("nsec", sk); }

    public static String npub(String pubkeyHex) { return Bech32.encode("npub", Hex.parse(pubkeyHex)); }

    public static String npubHex(String npub) {
        Bech32.Decoded d = Bech32.decode(npub);
        if (!"npub".equals(d.hrp) || d.data.length != 32) throw new IllegalArgumentException("not an npub");
        return Hex.of(d.data);
    }

    /** "npub1abcd…wxyz" for the identity line. */
    public static String shortNpub(String pubkeyHex) {
        String n = npub(pubkeyHex);
        return n.substring(0, 10) + "…" + n.substring(n.length() - 6);
    }
}
