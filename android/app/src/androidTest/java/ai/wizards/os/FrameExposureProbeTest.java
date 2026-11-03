package ai.wizards.os;

import android.content.Context;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.uiautomator.By;
import androidx.test.uiautomator.UiDevice;

import org.junit.Test;
import org.junit.runner.RunWith;

import static org.junit.Assert.*;

/**
 * Evidence only, no security assertion: records (logcat chromium "PROBE {...}") what each hostile child frame can see
 * and reach. Run on the base APK and on the candidate to show the before/after for wizard-os issue 387.
 */
@RunWith(AndroidJUnit4.class)
public class FrameExposureProbeTest {
    @Test public void recordWhatChildFramesSee() throws Exception {
        Context c = InstrumentationRegistry.getInstrumentation().getTargetContext();
        UiDevice device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation());
        String facade = null;
        try { facade = HostileFrameFixture.readAsset(InstrumentationRegistry.getInstrumentation().getContext().getAssets().open("native-shell-port.js")); }
        catch (java.io.IOException absent) { /* base build: no facade */ }
        c.getSharedPreferences("wizard_server", Context.MODE_PRIVATE).edit().clear().commit();
        try (HostileFrameFixture fixture = new HostileFrameFixture(facade)) {
            fixture.probeOnly = true;
            ShellPortE2eTest.connect(c, device, fixture.origin());
            assertNotNull("probe page never finished", ShellPortE2eTest.waitPastSystemDialogs(device, By.text("Probe complete"), 60000));
            Thread.sleep(1000);
        }
    }
}
