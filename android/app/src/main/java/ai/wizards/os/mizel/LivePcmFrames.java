package ai.wizards.os.mizel;

import java.util.Arrays;

/** Transient low-latency PCM tee. Durable WAV chunks remain the recording authority. */
public final class LivePcmFrames {
    public static final int FRAME_SAMPLES = 16000 / 4; // 250 ms, same small-frame approach as native Mizel.
    public interface Sink { void frame(byte[] pcm, long startMs); }
    private final Sink sink;
    private final byte[] frame = new byte[FRAME_SAMPLES * 2];
    private int used;
    private long startSample;
    public LivePcmFrames(Sink sink) { this.sink = sink; }
    public void append(short[] samples, int count, long firstSample) {
        int off = 0;
        while (off < count) {
            if (used == 0) startSample = firstSample + off;
            int take = Math.min(count - off, FRAME_SAMPLES - used);
            for (int i = 0; i < take; i++) {
                short s = samples[off + i];
                frame[(used + i) * 2] = (byte) s;
                frame[(used + i) * 2 + 1] = (byte) (s >> 8);
            }
            used += take; off += take;
            if (used == FRAME_SAMPLES) flush();
        }
    }
    public void flush() {
        if (used == 0) return;
        byte[] out = Arrays.copyOf(frame, used * 2);
        long at = startSample * 1000 / 16000;
        used = 0;
        try { sink.frame(out, at); } catch (RuntimeException ignored) { /* live delivery never interrupts capture */ }
    }
    public void reset() { used = 0; }
}
