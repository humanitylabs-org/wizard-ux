package ai.wizards.os.identity;

import java.io.ByteArrayOutputStream;
import java.util.Locale;

/** Bech32 (BIP-173) as Nostr uses it: npub / nsec / ncryptsec. No 90-character limit (ncryptsec is longer). */
public final class Bech32 {
    private static final String CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
    private static final int[] GEN = {0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3};

    private Bech32() {}

    public static final class Decoded {
        public final String hrp;
        public final byte[] data;
        Decoded(String hrp, byte[] data) { this.hrp = hrp; this.data = data; }
    }

    private static int polymod(int[] values) {
        int chk = 1;
        for (int v : values) {
            int top = chk >>> 25;
            chk = ((chk & 0x1ffffff) << 5) ^ v;
            for (int i = 0; i < 5; i++) if (((top >>> i) & 1) != 0) chk ^= GEN[i];
        }
        return chk;
    }

    private static int[] hrpExpand(String hrp) {
        int n = hrp.length();
        int[] out = new int[n * 2 + 1];
        for (int i = 0; i < n; i++) {
            out[i] = hrp.charAt(i) >> 5;
            out[n + 1 + i] = hrp.charAt(i) & 31;
        }
        return out;
    }

    private static int[] concat(int[] a, int[] b) {
        int[] o = new int[a.length + b.length];
        System.arraycopy(a, 0, o, 0, a.length);
        System.arraycopy(b, 0, o, a.length, b.length);
        return o;
    }

    static int[] convertBits(byte[] data, int from, int to, boolean pad) {
        int acc = 0, bits = 0, maxv = (1 << to) - 1;
        java.util.ArrayList<Integer> out = new java.util.ArrayList<>();
        for (byte b : data) {
            int value = b & 0xff;
            if ((value >>> from) != 0) throw new IllegalArgumentException("bad value");
            acc = (acc << from) | value;
            bits += from;
            while (bits >= to) { bits -= to; out.add((acc >>> bits) & maxv); }
        }
        if (pad) { if (bits > 0) out.add((acc << (to - bits)) & maxv); }
        else if (bits >= from || ((acc << (to - bits)) & maxv) != 0) throw new IllegalArgumentException("bad padding");
        int[] r = new int[out.size()];
        for (int i = 0; i < r.length; i++) r[i] = out.get(i);
        return r;
    }

    public static String encode(String hrp, byte[] payload) {
        int[] data = convertBits(payload, 8, 5, true);
        int[] values = concat(hrpExpand(hrp), concat(data, new int[6]));
        int mod = polymod(values) ^ 1;
        StringBuilder sb = new StringBuilder(hrp).append('1');
        for (int d : data) sb.append(CHARSET.charAt(d));
        for (int i = 0; i < 6; i++) sb.append(CHARSET.charAt((mod >>> (5 * (5 - i))) & 31));
        return sb.toString();
    }

    /** Throws IllegalArgumentException on anything that is not valid bech32 (mixed case, bad checksum, bad chars). */
    public static Decoded decode(String s) {
        if (s == null) throw new IllegalArgumentException("empty");
        String t = s.trim();
        if (!t.equals(t.toLowerCase(Locale.ROOT)) && !t.equals(t.toUpperCase(Locale.ROOT))) throw new IllegalArgumentException("mixed case");
        t = t.toLowerCase(Locale.ROOT);
        int pos = t.lastIndexOf('1');
        if (pos < 1 || pos + 7 > t.length()) throw new IllegalArgumentException("no separator");
        String hrp = t.substring(0, pos);
        int[] data = new int[t.length() - pos - 1];
        for (int i = 0; i < data.length; i++) {
            int c = CHARSET.indexOf(t.charAt(pos + 1 + i));
            if (c < 0) throw new IllegalArgumentException("bad character");
            data[i] = c;
        }
        if (polymod(concat(hrpExpand(hrp), data)) != 1) throw new IllegalArgumentException("bad checksum");
        int[] five = java.util.Arrays.copyOf(data, data.length - 6);
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        byte[] in = new byte[five.length];
        for (int i = 0; i < five.length; i++) in[i] = (byte) five[i];
        for (int v : convertBits(in, 5, 8, false)) bytes.write(v);
        return new Decoded(hrp, bytes.toByteArray());
    }
}
