package ai.wizards.os;

import android.app.Notification;
import android.app.NotificationManager;
import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.RectF;
import android.service.notification.StatusBarNotification;
import android.util.Base64;
import android.util.Log;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.uiautomator.By;
import androidx.test.uiautomator.UiDevice;
import androidx.test.uiautomator.UiObject2;
import ai.wizards.os.badge.BadgeCompositor;
import ai.wizards.os.badge.UnreadBadges;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import static org.junit.Assert.*;

/**
 * Emulator QA for the Messenger icon unread bubble. Synthetic only: a generated icon and a disposable local server
 * (adb reverse) standing in for the Messenger unread endpoint; never an owner's Wizard or Messenger data.
 * Run in order: composePixels, seedAndPin, confirmPin, then feedPoll for each count the script serves.
 */
@RunWith(AndroidJUnit4.class)
public class UnreadBadgeQaTest {
    static final String TAG = "UnreadBadgeQa";
    private final Context c = InstrumentationRegistry.getInstrumentation().getTargetContext();

    private static Bitmap baseIcon() {
        Bitmap b = Bitmap.createBitmap(192, 192, Bitmap.Config.ARGB_8888);
        Canvas k = new Canvas(b);
        Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
        p.setColor(0xFF110D1B); k.drawRoundRect(new RectF(0, 0, 192, 192), 40, 40, p);
        p.setColor(0xFF00D6CF); k.drawRoundRect(new RectF(40, 52, 152, 128), 24, 24, p);
        k.drawCircle(70, 146, 14, p);
        return b;
    }

    @Test public void composePixels() {
        Bitmap base = baseIcon();
        assertSame("zero draws nothing and does not copy", base, BadgeCompositor.compose(base, 0));
        Bitmap three = BadgeCompositor.compose(base, 3), many = BadgeCompositor.compose(base, 12);
        assertNotSame(base, three);
        assertEquals("base is never modified", 0xFF00D6CF, base.getPixel(96, 90));
        save(three, "compose-3"); save(many, "compose-12"); // before any assertion, so a failure still leaves the images to look at
        int red = 0xFFE5322D;
        // The digit is white and sits in the middle of the bubble, so probe the red just left of it (bubble spans x 105..181,
        // y 11..87 at 192px; a "3" starts near x 129) and count red over the whole top-right quadrant as the robust check.
        assertTrue("red in top-right (left of the digit): " + Integer.toHexString(three.getPixel(114, 49)), near(three.getPixel(114, 49), red));
        int quadrant = redIn(three, 96, 0, 192, 96);
        assertTrue("red bubble fills the top-right quadrant, red px=" + quadrant, quadrant > 1500);
        assertEquals("nothing red in the bottom-left", 0, redIn(three, 0, 96, 96, 192));
        assertEquals(base.getPixel(20, 170), three.getPixel(20, 170));
        // "9+" is a wider pill: red further left than a single digit reaches.
        int leftReach3 = leftmostRed(three), leftReach12 = leftmostRed(many);
        assertTrue("12 shows 9+ in a wider pill (" + leftReach12 + " < " + leftReach3 + ")", leftReach12 < leftReach3);
        assertTrue("some white text pixels inside the bubble", whiteInside(many));
    }

    private static boolean near(int a, int b) {
        return Math.abs(Color.red(a) - Color.red(b)) < 12 && Math.abs(Color.green(a) - Color.green(b)) < 12 && Math.abs(Color.blue(a) - Color.blue(b)) < 12;
    }
    private static int redIn(Bitmap b, int x0, int y0, int x1, int y1) {
        int n = 0;
        for (int x = x0; x < x1; x++) for (int y = y0; y < y1; y++) if (near(b.getPixel(x, y), 0xFFE5322D)) n++;
        return n;
    }
    private static int leftmostRed(Bitmap b) {
        for (int x = 0; x < b.getWidth(); x++) for (int y = 0; y < 80; y++) if (near(b.getPixel(x, y), 0xFFE5322D)) return x;
        return b.getWidth();
    }
    private static boolean whiteInside(Bitmap b) {
        int white = 0;
        for (int x = 100; x < 188; x++) for (int y = 6; y < 80; y++) if (b.getPixel(x, y) == Color.WHITE) white++;
        return white > 30;
    }
    private void save(Bitmap b, String name) {
        try (FileOutputStream o = new FileOutputStream(new File(c.getExternalFilesDir(null), name + ".png"))) { b.compress(Bitmap.CompressFormat.PNG, 100, o); }
        catch (Exception e) { Log.w(TAG, "save " + e); }
    }

    /** Points native HTTP at the disposable local server and asks Android to pin the Messenger shortcut (real pin code). */
    @Test public void seedAndPin() throws Exception {
        assertTrue(BuildConfig.DEBUG);
        String origin = InstrumentationRegistry.getArguments().getString("origin", "http://localhost:18765");
        try (FileOutputStream o = new FileOutputStream(new File(c.getFilesDir(), "qa_home.txt"))) { o.write(origin.getBytes("UTF-8")); }
        c.getSharedPreferences("unread-badge", Context.MODE_PRIVATE).edit().clear().commit();
        c.getSharedPreferences("home-screen-pins", Context.MODE_PRIVATE).edit().clear().commit();
        ByteArrayOutputStream png = new ByteArrayOutputStream();
        baseIcon().compress(Bitmap.CompressFormat.PNG, 100, png);
        JSONObject data = new JSONObject().put("appId", "messenger").put("name", "Messenger")
            .put("icon", "data:image/png;base64," + Base64.encodeToString(png.toByteArray(), Base64.NO_WRAP));
        assertEquals("pending", HomeScreenShortcuts.pin(c, data));
        // am instrument kills this process right after the test returns; make sure the stored base icon is on disk first.
        c.getSharedPreferences("home-screen-pins", Context.MODE_PRIVATE).edit().putLong("qa-flush", System.nanoTime()).commit();
        String id = HomeScreenPolicy.identity(origin, "messenger");
        assertTrue("base icon stored for the shortcut", c.getSharedPreferences("home-screen-pins", Context.MODE_PRIVATE).getString(id + ":icon", "").startsWith("data:image/png"));
        Log.i(TAG, "pin requested for " + HomeScreenPolicy.identity(origin, "messenger"));
    }

    /** Taps the launcher's "add" confirmation, whichever wording this launcher uses. */
    @Test public void confirmPin() throws Exception {
        UiDevice d = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation());
        String[] labels = {"Add automatically", "Add to home screen", "Add to Home screen", "Add"};
        long end = System.currentTimeMillis() + 20000;
        while (System.currentTimeMillis() < end) {
            for (String l : labels) {
                UiObject2 hit = d.findObject(By.text(l).clickable(true));
                if (hit == null) hit = d.findObject(By.text(l));
                if (hit != null) { hit.click(); Thread.sleep(1500); d.pressHome(); Log.i(TAG, "confirmed via " + l); return; }
            }
            Thread.sleep(500);
        }
        fail("no pin confirmation shown; window=" + d.getCurrentPackageName());
    }

    /** One production poll against the local server: HTTP fetch, parse, then all three mechanisms. */
    @Test public void feedPoll() throws Exception {
        int want = Integer.parseInt(InstrumentationRegistry.getArguments().getString("count", "0"));
        UnreadBadges.pollNow(c);
        assertEquals(want, c.getSharedPreferences("unread-badge", Context.MODE_PRIVATE).getInt("count", -9));
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        StatusBarNotification found = null;
        for (StatusBarNotification s : nm.getActiveNotifications()) if (s.getId() == 7490) found = s;
        if (want == 0) assertNull("notification cancelled at zero", found);
        else {
            assertNotNull("silent Unread notification posted", found);
            assertEquals(want, found.getNotification().number);
            assertEquals("unread", found.getNotification().getChannelId());
            assertNotNull("carries the shortcut id", found.getNotification().getShortcutId());
        }
        Log.i(TAG, "feed ok count=" + want + " notify=" + (found != null));
        // Same reason as seedAndPin: the process is killed straight after, so flush async prefs writes (count, applied.*).
        c.getSharedPreferences("unread-badge", Context.MODE_PRIVATE).edit().putLong("qa-flush", System.nanoTime()).commit();
    }
}
