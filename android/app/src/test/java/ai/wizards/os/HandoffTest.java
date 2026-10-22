package ai.wizards.os;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class HandoffTest {
    @Test
    public void listen() {
        assertEquals("{\"action\":\"listen\"}", Handoff.json(MainActivity.ACTION_LISTEN, null));
    }

    @Test
    public void sayCarriesTextSafely() {
        String j = Handoff.json(MainActivity.ACTION_SAY, "  call \"Miguel\" </script>\n\u2028'x' \\ ");
        assertEquals("{\"action\":\"say\",\"text\":\"call \\\"Miguel\\\" \\u003c/script\\u003e\\n\\u2028\\u0027x\\u0027 \\\\\"}", j);
    }

    @Test
    public void settingsFocusIsAShortFeatureIdOnly() {
        assertEquals("{\"action\":\"settings\"}", Handoff.settings(null));
        assertEquals("{\"action\":\"settings\",\"focus\":\"photos-backup\"}", Handoff.settings("photos-backup"));
        for (String bad : new String[]{"", "Photos", "x\"};alert(1)//", "photos backup", "-x", "a123456789012345678901234567890123456789x"})
            assertEquals(bad, "{\"action\":\"settings\"}", Handoff.settings(bad));
    }

    @Test
    public void ignoresEverythingElse() {
        assertNull(Handoff.json(MainActivity.ACTION_SAY, "   "));
        assertNull(Handoff.json(MainActivity.ACTION_SAY, null));
        assertNull(Handoff.json("android.intent.action.MAIN", "hi"));
        assertNull(Handoff.json(null, "hi"));
    }

    @Test
    public void capsLength() {
        StringBuilder b = new StringBuilder();
        for (int i = 0; i < 5000; i++) b.append('a');
        String j = Handoff.json(MainActivity.ACTION_SAY, b.toString());
        assertTrue(j.length() < Handoff.MAX_TEXT + 40);
    }
}
