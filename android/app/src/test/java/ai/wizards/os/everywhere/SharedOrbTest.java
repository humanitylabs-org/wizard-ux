package ai.wizards.os.everywhere;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertTrue;

import java.io.File;
import java.nio.file.Files;

import org.junit.Test;

/**
 * One assistant, one look: the side button and the floating orb draw the exact orb the app's dock draws.
 * The pages come from web/assist/ (served by the Wizard); the APK's offline copy in assets/wizard-os-home/ must be
 * byte-identical to web/ (tests/android-overlay-fallback.test.mjs checks every bundled file).
 */
public class SharedOrbTest {
    private static File repo() {
        File d = new File(System.getProperty("user.dir")).getAbsoluteFile();
        for (int i = 0; i < 5 && d != null; i++, d = d.getParentFile()) if (new File(d, "web/orb.js").isFile()) return d;
        return null;
    }

    @Test public void androidOrbIsTheAppOrb() throws Exception {
        File r = repo();
        if (r == null) return; // only the android/ dir was shipped to the builder: nothing to compare against
        for (String f : new String[]{"orb.js", "robert-thread-orb.png", "robert-listening-galaxy.png",
                "assist/surface.html", "assist/everywhere.html", "assist/screen.html"}) {
            byte[] web = Files.readAllBytes(new File(r, "web/" + f).toPath());
            byte[] apk = Files.readAllBytes(new File(r, "android/app/src/main/assets/wizard-os-home/" + f).toPath());
            assertArrayEquals(f + " differs between web/ and the Android assets; copy web/" + f + " over", web, apk);
        }
    }

    @Test public void bothNativeSurfacesUseIt() throws Exception {
        File a = new File(System.getProperty("user.dir"), "src/main/assets/wizard-os-home/assist");
        if (!a.isDirectory()) return;
        for (String page : new String[]{"surface.html", "everywhere.html"}) {
            String s = new String(Files.readAllBytes(new File(a, page).toPath()), "UTF-8");
            assertTrue(page + " must load the shared orb", s.contains("<script src=\"../orb.js\"></script>"));
            assertTrue(page + " must have the orb canvas", s.contains("id=\"orb\""));
        }
    }
}
