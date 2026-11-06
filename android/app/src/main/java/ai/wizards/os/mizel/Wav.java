package ai.wizards.os.mizel;

import java.io.IOException;
import java.io.RandomAccessFile;

/** 16 kHz mono PCM16 WAV (RIFF) headers. Pure Java, unit-tested off-device. */
public final class Wav {
    public static final int RATE = 16000, CHANNELS = 1, BITS = 16;
    public static final int BYTES_PER_SAMPLE = BITS / 8 * CHANNELS;
    public static final int HEADER = 44;
    /** Samples per full chunk: 5 seconds. */
    public static final int CHUNK_SAMPLES = RATE * 5;

    private Wav() {}

    /** 44-byte canonical header for {@code dataBytes} of PCM. */
    public static byte[] header(long dataBytes) {
        byte[] h = new byte[HEADER];
        long byteRate = (long) RATE * BYTES_PER_SAMPLE;
        put(h, 0, "RIFF");
        le32(h, 4, 36 + dataBytes);
        put(h, 8, "WAVE");
        put(h, 12, "fmt ");
        le32(h, 16, 16);              // PCM fmt chunk size
        le16(h, 20, 1);               // PCM
        le16(h, 22, CHANNELS);
        le32(h, 24, RATE);
        le32(h, 28, byteRate);
        le16(h, 32, BYTES_PER_SAMPLE); // block align
        le16(h, 34, BITS);
        put(h, 36, "data");
        le32(h, 40, dataBytes);
        return h;
    }

    /** Rewrites the header of a file whose PCM data follows a (possibly placeholder) 44-byte header. Returns data bytes. */
    public static long fixHeader(RandomAccessFile f) throws IOException {
        long len = f.length();
        long data = Math.max(0, len - HEADER);
        data -= data % BYTES_PER_SAMPLE;     // a torn last sample is dropped
        if (len != HEADER + data) f.setLength(HEADER + data);
        f.seek(0);
        f.write(header(data));
        return data;
    }

    /** Samples (frames) in a data section of {@code dataBytes}. */
    public static long samples(long dataBytes) { return dataBytes / BYTES_PER_SAMPLE; }

    /** Media milliseconds for a sample count (floor). */
    public static long ms(long samples) { return samples * 1000L / RATE; }

    /** True if {@code h} is a 16 kHz mono PCM16 RIFF header. */
    public static boolean valid(byte[] h) {
        if (h == null || h.length < HEADER) return false;
        return "RIFF".equals(str(h, 0)) && "WAVE".equals(str(h, 8)) && "fmt ".equals(str(h, 12)) && "data".equals(str(h, 36))
                && u16(h, 20) == 1 && u16(h, 22) == CHANNELS && u32(h, 24) == RATE && u16(h, 34) == BITS;
    }

    static long dataSize(byte[] h) { return u32(h, 40); }

    private static void put(byte[] b, int o, String s) { for (int i = 0; i < 4; i++) b[o + i] = (byte) s.charAt(i); }
    private static void le16(byte[] b, int o, int v) { b[o] = (byte) v; b[o + 1] = (byte) (v >> 8); }
    private static void le32(byte[] b, int o, long v) { for (int i = 0; i < 4; i++) b[o + i] = (byte) (v >> (8 * i)); }
    private static String str(byte[] b, int o) { return new String(b, o, 4, java.nio.charset.StandardCharsets.US_ASCII); }
    private static int u16(byte[] b, int o) { return (b[o] & 0xff) | (b[o + 1] & 0xff) << 8; }
    private static long u32(byte[] b, int o) { return (b[o] & 0xffL) | (b[o + 1] & 0xffL) << 8 | (b[o + 2] & 0xffL) << 16 | (b[o + 3] & 0xffL) << 24; }
}
