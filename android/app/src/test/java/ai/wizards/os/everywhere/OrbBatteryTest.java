package ai.wizards.os.everywhere;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.io.File;
import java.nio.file.Files;

import org.junit.Test;

/** Battery (0.8.5): the floating orb draws only while it is on screen with the display on, and rests at a low rate. */
public class OrbBatteryTest {
    @Test public void sleepsWhenOffScreenOrDisplayOff() {
        assertTrue(EverywhereService.orbShouldSleep(false, false));
        assertTrue(EverywhereService.orbShouldSleep(true, true));
        assertTrue(EverywhereService.orbShouldSleep(false, true));
        assertFalse(EverywhereService.orbShouldSleep(true, false));
    }

    @Test public void sharedOrbThrottlesAndCapsResolution() throws Exception {
        File f = new File(System.getProperty("user.dir"), "src/main/assets/wizard-os-home/orb.js");
        if (!f.isFile()) return;
        String s = new String(Files.readAllBytes(f.toPath()), "UTF-8");
        assertTrue("resting frame rate", s.contains("const IDLE_FPS = 12;"));
        assertTrue("native sleep hook", s.contains("sleep(on)"));
        assertTrue("stops when the page is hidden", s.contains("document.hidden"));
        assertTrue("DPR cap 2", s.contains("Math.min(window.devicePixelRatio || 1, 2)"));
    }
}
