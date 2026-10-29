package ai.wizards.os;

import static org.junit.Assert.*;
import org.junit.Test;

public class ScrollCaptureCrashGuardTest {
    private static NullPointerException at(String cls, String method) {
        NullPointerException e = new NullPointerException("CancellationSignal.isCanceled()");
        e.setStackTrace(new StackTraceElement[]{new StackTraceElement(cls, method, "X.java", 240)});
        return e;
    }
    @Test public void absorbsOnlyTheFrameworkRace() {
        assertTrue(ScrollCaptureCrashGuard.isFrameworkRace(at("com.android.internal.view.ScrollCaptureViewSupport","onScrollCaptureImageRequest")));
        assertFalse(ScrollCaptureCrashGuard.isFrameworkRace(at("ai.wizards.os.MainActivity","onCreate")));
        IllegalStateException other = new IllegalStateException();
        other.setStackTrace(at("com.android.internal.view.ScrollCaptureViewSupport","onScrollCaptureImageRequest").getStackTrace());
        assertFalse(ScrollCaptureCrashGuard.isFrameworkRace(other));
    }
}
