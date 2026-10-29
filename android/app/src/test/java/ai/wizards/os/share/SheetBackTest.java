package ai.wizards.os.share;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/** Back on the share sheet never closes it with a single press (James's standing rule). */
public class SheetBackTest {
    @Test
    public void backFromTheThreadChooserReturnsToTheSheetAndTheSheetStaysOpen() {
        SheetBack b = new SheetBack();
        b.openChooser();                                   // open sheet → open thread chooser
        assertEquals(SheetBack.Action.CLOSE_CHOOSER, b.back(1_000));
        assertFalse(b.chooserOpen());                      // back on the sheet
        assertEquals(SheetBack.Action.WARN, b.back(10_000)); // a single Back on the sheet only warns: still open
    }

    @Test
    public void onlyASecondBackWithinTheWindowCancels() {
        SheetBack b = new SheetBack();
        assertEquals(SheetBack.Action.WARN, b.back(0));
        assertEquals(SheetBack.Action.WARN, b.back(SheetBack.WINDOW_MS + 1)); // too late: warns again
        assertEquals(SheetBack.Action.CANCEL, b.back(SheetBack.WINDOW_MS + 500));
    }

    @Test
    public void closingAChooserNeverCountsTowardsCancel() {
        SheetBack b = new SheetBack();
        assertEquals(SheetBack.Action.WARN, b.back(0));
        b.openChooser();
        assertEquals(SheetBack.Action.CLOSE_CHOOSER, b.back(100));
        assertEquals(SheetBack.Action.WARN, b.back(200)); // the earlier warning was reset by the chooser
        assertTrue(b.back(300) == SheetBack.Action.CANCEL);
    }
}
