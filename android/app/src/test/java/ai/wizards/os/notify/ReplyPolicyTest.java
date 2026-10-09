package ai.wizards.os.notify;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class ReplyPolicyTest {
    @Test
    public void settledStates() {
        for (String s : new String[]{"completed", "failed", "cancelled", "stopped", "interrupted"}) assertTrue(s, ReplyPolicy.settled(s));
        for (String s : new String[]{"queued", "running", "waiting_for_approval", "", null}) assertFalse(String.valueOf(s), ReplyPolicy.settled(s));
    }

    @Test
    public void excerptStripsMarkdownAndClips() {
        assertEquals("Done. See the report and the list item", ReplyPolicy.excerpt("## Done.\n\nSee **the** [report](https://x) and\n- the list item"));
        String long_ = "word ".repeat(100);
        String e = ReplyPolicy.excerpt(long_);
        assertTrue(e.length() <= 281);
        assertTrue(e.endsWith("…"));
        assertEquals("", ReplyPolicy.excerpt(null));
    }
}
