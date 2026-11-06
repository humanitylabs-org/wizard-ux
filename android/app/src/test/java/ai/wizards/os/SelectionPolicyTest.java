package ai.wizards.os;

import static org.junit.Assert.*;

import org.junit.Test;

public class SelectionPolicyTest {
    @Test public void pressOnPageTextIsOursWhileFresh() {
        assertTrue(SelectionPolicy.ours(false, false, 500));
        assertFalse(SelectionPolicy.ours(false, false, 5000));
    }

    @Test public void textFieldAlwaysKeepsAndroidMenu() {
        assertFalse(SelectionPolicy.ours(true, true, 300));
        assertFalse(SelectionPolicy.ours(false, true, 300));
    }

    @Test public void reportedSelectionStaysOursAfterThePress() {
        assertTrue(SelectionPolicy.ours(true, false, 60_000));
        assertTrue(SelectionPolicy.ours(true, true, 60_000)); // an old field press no longer counts
    }

    @Test public void neverPressedIsNotOurs() {
        assertFalse(SelectionPolicy.ours(false, false, -1));
    }

    @Test public void shareTextCapped() {
        assertEquals("", SelectionPolicy.shareText(null));
        assertEquals("hi", SelectionPolicy.shareText("hi"));
        String big = new String(new char[100_000]).replace('\0', 'a');
        assertTrue(SelectionPolicy.shareText(big).length() < 90_010);
    }

    @Test public void fileNamesAreSafe() {
        assertEquals("a_b.png", SelectionPolicy.fileName("a/b.png"));
        assertEquals("secret", SelectionPolicy.fileName("..secret"));
        assertEquals("wizard-file", SelectionPolicy.fileName(""));
        String n = SelectionPolicy.fileName(new String(new char[200]).replace('\0', 'x') + ".jpeg");
        assertEquals(120, n.length());
        assertTrue(n.endsWith(".jpeg"));
    }
}
