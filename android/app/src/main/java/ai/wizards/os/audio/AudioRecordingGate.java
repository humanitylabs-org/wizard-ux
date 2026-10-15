package ai.wizards.os.audio;

import java.util.HashSet;
import java.util.Set;

/** Pure-Java observer only: existing recorders retain all mic/input/output ownership. */
public final class AudioRecordingGate {
    public interface Observer { void changed(boolean recording); }
    private static final Set<String> holders = new HashSet<>();
    private static Observer observer;
    private AudioRecordingGate() {}
    public static synchronized boolean held() { return !holders.isEmpty(); }
    public static void observe(Observer o) {
        boolean held;
        synchronized(AudioRecordingGate.class) { observer=o; held=!holders.isEmpty(); }
        if(o!=null) o.changed(held);
    }
    public static void set(String key,boolean on) {
        Observer o; boolean active, changed;
        synchronized(AudioRecordingGate.class) {
            boolean before=!holders.isEmpty();
            if(on) holders.add(key); else holders.remove(key);
            active=!holders.isEmpty(); changed=before!=active; o=observer;
        }
        if(changed && o!=null) o.changed(active);
    }
}
