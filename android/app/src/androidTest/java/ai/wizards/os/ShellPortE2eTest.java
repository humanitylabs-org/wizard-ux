package ai.wizards.os;

import android.content.Context;
import android.content.Intent;
import android.util.Log;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.uiautomator.By;
import androidx.test.uiautomator.UiDevice;
import androidx.test.uiautomator.UiObject2;
import androidx.test.uiautomator.Until;

import org.junit.Test;
import org.junit.runner.RunWith;

import static org.junit.Assert.*;

/**
 * wizard-os issue 387: the remote shell WebView exposes no Java object to any frame, hostile child frames get no
 * native reply on any port, and the trusted shell still works over the main-document port. Real WebView, real
 * MainActivity, disposable loopback Wizard (HostileFrameFixture); native refusals are in logcat tag WizardShellPort.
 */
@RunWith(AndroidJUnit4.class)
public class ShellPortE2eTest {
    @Test public void hostileChildFramesGetNothingAndTheShellStillWorks() throws Exception {
        Context c = InstrumentationRegistry.getInstrumentation().getTargetContext();
        UiDevice device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation());
        assertTrue(BuildConfig.DEBUG);
        String facade = HostileFrameFixture.readAsset(InstrumentationRegistry.getInstrumentation().getContext().getAssets().open("native-shell-port.js"));
        c.getSharedPreferences("wizard_server", Context.MODE_PRIVATE).edit().clear().commit();
        try (HostileFrameFixture fixture = new HostileFrameFixture(facade)) {
            connect(c, device, fixture.origin());
            UiObject2 done = waitPastSystemDialogs(device, By.textStartsWith("Shell port verified"), 60000);
            if (done == null) fail("shell: " + text(device, "status") + " " + text(device, "detail"));
            Log.i("ShellPortE2e", "verified: " + text(device, "detail"));
            assertEquals(c.getPackageName(), device.getCurrentPackageName()); // no hostile openInBrowser left the app
            click(device, "Check new document");
            if (waitPastSystemDialogs(device, By.text("New document verified"), 30000) == null) fail("phase 2: " + text(device, "status") + " " + text(device, "detail"));
            click(device, "Check wrong path");
            assertNotNull("a same-origin non-shell page reached native", waitPastSystemDialogs(device, By.text("Wrong path refused"), 20000));
        }
    }

    static void connect(Context c, UiDevice device, String origin) {
        c.startActivity(new Intent(c, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK));
        assertNotNull("Connect screen's address field never appeared", waitPastSystemDialogs(device, By.desc("Wizard address"), 30000));
        device.findObject(By.desc("Wizard address")).setText(origin);
        device.findObject(By.text("Connect")).click();
    }

    private static void click(UiDevice device, String label) {
        UiObject2 b = waitPastSystemDialogs(device, By.text(label), 10000);
        assertNotNull("missing button " + label, b);
        b.click();
    }

    private static String text(UiDevice device, String id) {
        UiObject2 o = device.findObject(By.res(id));
        return o == null ? "?" : String.valueOf(o.getText());
    }

    /** CI emulators raise "Pixel Launcher isn't responding" over the app; tap Wait and keep looking. */
    static UiObject2 waitPastSystemDialogs(UiDevice device, androidx.test.uiautomator.BySelector target, long ms) {
        long end = System.currentTimeMillis() + ms;
        while (System.currentTimeMillis() < end) {
            UiObject2 hit = device.wait(Until.findObject(target), 1500);
            if (hit != null) return hit;
            UiObject2 wait = device.findObject(By.res("android:id/aerr_wait"));
            if (wait != null) wait.click();
        }
        return null;
    }
}
