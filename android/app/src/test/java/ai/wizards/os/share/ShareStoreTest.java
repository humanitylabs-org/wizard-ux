package ai.wizards.os.share;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

public class ShareStoreTest {
    @Test
    public void namesAreSafeUploadHeaders() {
        assertEquals("photo.jpg", ShareStore.safeName("/sdcard/DCIM/photo.jpg", 0));
        assertEquals("evil.txt", ShareStore.safeName("..\\..\\evil.txt", 0));
        assertEquals("shared-3", ShareStore.safeName("..", 2));
        assertEquals("shared-1", ShareStore.safeName(null, 0));
        assertEquals("ab", ShareStore.safeName("a\"\nb", 0));
        String n = ShareStore.safeName("x".repeat(300) + ".pdf", 0);
        assertEquals(120, n.length());
        assertEquals(".pdf", n.substring(116));
    }
}
