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
        int red = 0xFFE5322D;
        // Centre of the single-digit bubble: top-right, red. Bottom-left still the original icon.
        assertTrue("red in top-right", near(three.getPixel(192 - 40, 40), red));
        assertEquals(base.getPixel(20, 170), three.getPixel(20, 170));
        // "9+" is a wider pill: red further left than a single digit reaches.
        int leftReach3 = leftmostRed(three), leftReach12 = leftmostRed(many);
        assertTrue("12 shows 9+ in a wider pill (" + leftReach12 + " < " + leftReach3 + ")", leftReach12 < leftReach3);
        assertTrue("some white text pixels inside the bubble", whiteInside(many));
        save(three, "compose-3"); save(many, "compose-12");
    }

    private static boolean near(int a, int b) {
        return Math.abs(Color.red(a) - Color.red(b)) < 12 && Math.abs(Color.green(a) - Color.green(b)) < 12 && Math.abs(Color.blue(a) - Color.blue(b)) < 12;
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
    }
}
