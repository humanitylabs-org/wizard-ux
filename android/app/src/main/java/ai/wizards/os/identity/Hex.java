package ai.wizards.os.identity;

/** Lower-case hex, strict. */
public final class Hex {
    private Hex() {}

    public static String of(byte[] b) {
        char[] out = new char[b.length * 2];
        final char[] d = "0123456789abcdef".toCharArray();
        for (int i = 0; i < b.length; i++) { out[i * 2] = d[(b[i] >> 4) & 15]; out[i * 2 + 1] = d[b[i] & 15]; }
        return new String(out);
    }

    public static byte[] parse(String s) {
        if (s == null || (s.length() & 1) != 0 || !s.matches("[0-9a-f]*")) throw new IllegalArgumentException("not lower-case hex");
        byte[] out = new byte[s.length() / 2];
        for (int i = 0; i < out.length; i++) out[i] = (byte) Integer.parseInt(s.substring(i * 2, i * 2 + 2), 16);
        return out;
    }

    public static boolean is32(String s) { return s != null && s.matches("[0-9a-f]{64}"); }
}
