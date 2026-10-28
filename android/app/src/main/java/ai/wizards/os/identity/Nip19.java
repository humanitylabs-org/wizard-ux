package ai.wizards.os.identity;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/** Bech32, not Bech32m. Native import and backup only. */
public final class Nip19 {
    private static final String ALPHABET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
    private static void require(boolean c) { if (!c) throw new IllegalArgumentException("Invalid key"); }
    private static List<Integer> expand(String hrp) {
        List<Integer> out = new ArrayList<>();
        for (char c : hrp.toCharArray()) out.add(c >> 5);
        out.add(0);
        for (char c : hrp.toCharArray()) out.add(c & 31);
        return out;
    }
    private static int polymod(List<Integer> values) {
        int chk = 1;
        int[] gen = {0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3};
        for (int v : values) {
            int top = chk >>> 25; chk = ((chk & 0x1ffffff) << 5) ^ v;
            for (int i = 0; i < 5; i++) if (((top >>> i) & 1) != 0) chk ^= gen[i];
        }
        return chk;
    }
    private static List<Integer> convert(List<Integer> values, int from, int to, boolean pad) {
        int acc = 0, bits = 0; List<Integer> out = new ArrayList<>();
        for (int v : values) {
            require((v >>> from) == 0); acc = ((acc << from) | v) & 0xffffff; bits += from;
            while (bits >= to) { bits -= to; out.add((acc >>> bits) & ((1 << to) - 1)); }
        }
        if (pad && bits > 0) out.add((acc << (to - bits)) & ((1 << to) - 1));
        else if (!pad) require(bits < from && ((acc << (to - bits)) & ((1 << to) - 1)) == 0);
        return out;
    }
    public static String encode(String hrp, byte[] bytes) {
        require((hrp.equals("npub") || hrp.equals("nsec")) && bytes.length == 32);
        List<Integer> values = new ArrayList<>(); for (byte b : bytes) values.add(b & 255);
        List<Integer> words = convert(values, 8, 5, true), all = expand(hrp);
        all.addAll(words); for (int i = 0; i < 6; i++) all.add(0);
        int check = polymod(all) ^ 1;
        StringBuilder out = new StringBuilder(hrp).append('1');
        for (int w : words) out.append(ALPHABET.charAt(w));
        for (int i = 0; i < 6; i++) out.append(ALPHABET.charAt((check >>> (5 * (5 - i))) & 31));
        return out.toString();
    }
    public static byte[] secret(String value) {
        String raw = value.trim();
        if (raw.matches("[0-9a-fA-F]{64}")) return NostrEvent.bytes(raw);
        require(raw.equals(raw.toLowerCase(Locale.ROOT)) || raw.equals(raw.toUpperCase(Locale.ROOT)));
        String s = raw.toLowerCase(Locale.ROOT); require(s.startsWith("nsec1") && s.length() == 63);
        List<Integer> words = new ArrayList<>();
        for (char c : s.substring(5).toCharArray()) { int w = ALPHABET.indexOf(c); require(w >= 0); words.add(w); }
        List<Integer> all = expand("nsec"); all.addAll(words); require(polymod(all) == 1);
        List<Integer> bytes = convert(words.subList(0, words.size() - 6), 5, 8, false);
        require(bytes.size() == 32); byte[] out = new byte[32];
        for (int i = 0; i < 32; i++) out[i] = bytes.get(i).byteValue();
        return out;
    }
}
