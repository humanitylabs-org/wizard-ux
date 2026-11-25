package ai.wizards.os.assist;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.json.JSONObject;
import org.junit.Test;

/** Camera and Attach on the side-button orb (wizard-os issue 655, on for everyone). */
public class AttachPolicyTest {
    @Test public void oneCapSharedAcrossScreenCameraAndAttach() {
        assertEquals(8, AttachPolicy.MAX);
        assertEquals(8, AttachPolicy.room(0));
        assertEquals(3, AttachPolicy.room(5));
        assertEquals(0, AttachPolicy.room(9));
        assertEquals(8, AttachPolicy.room(-2));
    }

    @Test public void emptyOrHugeFilesAreLeftOut() {
        assertFalse(AttachPolicy.fits(0));
        assertTrue(AttachPolicy.fits(1));
        assertTrue(AttachPolicy.fits(AttachPolicy.MAX_BYTES));
        assertFalse(AttachPolicy.fits(AttachPolicy.MAX_BYTES + 1));
    }

    @Test public void namesLoseFoldersControlCharactersAndLeadingDots() {
        assertEquals("passwd", AttachPolicy.safeName("../../etc/passwd", "file"));
        assertEquals("report.pdf", AttachPolicy.safeName("C:\\Users\\me\\report.pdf", "file"));
        assertEquals("bashrc", AttachPolicy.safeName(".bashrc", "file"));
        assertEquals("ab.txt", AttachPolicy.safeName("a\nb\".txt", "file"));
        assertEquals("file", AttachPolicy.safeName("  ", "file"));
        assertEquals("file", AttachPolicy.safeName(null, "file"));
        String longName = AttachPolicy.safeName(new String(new char[300]).replace('\0', 'x') + ".jpeg", "file");
        assertEquals(120, longName.length());
        assertTrue(longName.endsWith(".jpeg"));
    }

    @Test public void typesComeFromAndroidOrTheName() {
        assertEquals("image/jpeg", AttachPolicy.mime("image/JPEG", "x"));
        assertEquals("application/pdf", AttachPolicy.mime(null, "Scan.PDF"));
        assertEquals("image/png", AttachPolicy.mime("application/octet-stream", "a.png"));
        assertEquals("application/octet-stream", AttachPolicy.mime("not a type", "noext"));
        assertEquals("application/octet-stream", AttachPolicy.mime("text/html\r\nX-Evil: 1", "noext"));
    }

    @Test public void wizardIsToldWhatRodeAlong() {
        assertEquals("", AttachPolicy.describe(0, 0, 0));
        assertEquals(" They attached 1 screenshot of what was on their screen while talking.", AttachPolicy.describe(1, 0, 0));
        String all = AttachPolicy.describe(2, 1, 3);
        assertTrue(all.contains("2 screenshots"));
        assertTrue(all.contains("took 1 picture with the phone's camera"));
        assertTrue(all.contains("3 files from the phone"));
    }

    @Test public void countsAreValidJsonWithoutNames() throws Exception {
        JSONObject o = new JSONObject(AttachPolicy.counts(1, 2, 3, 2, 1, 0));
        assertEquals(1, o.getInt("shots"));
        assertEquals(2, o.getInt("pictures"));
        assertEquals(3, o.getInt("files"));
        assertEquals(2, o.getInt("added"));
        assertEquals(1, o.getInt("skipped"));
        assertEquals(8, o.getInt("max"));
        assertEquals(7, o.length());
    }
}
