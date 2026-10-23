package ai.wizards.os.apps;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

import androidx.webkit.WebMessageCompat;
import org.junit.Test;

/** Both Apps ports read payloads through AppsBridge.text: a binary message is refused, never a main-thread crash. */
public class AppsBridgeMessageTest {
    @Test public void binaryMessagesAreRefusedNotThrown() {
        assertNull(AppsBridge.text(new WebMessageCompat(new byte[]{1, 2, 3})));
        assertNull(AppsBridge.text(null));
    }

    @Test public void stringMessagesPassThrough() {
        assertEquals("{\"v\":1}", AppsBridge.text(new WebMessageCompat("{\"v\":1}")));
        assertNull(AppsBridge.text(new WebMessageCompat(null)));
    }
}
