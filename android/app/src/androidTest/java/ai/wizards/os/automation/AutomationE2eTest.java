package ai.wizards.os.automation;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import android.app.Instrumentation;
import android.app.UiAutomation;
import android.content.Context;
import android.os.ParcelFileDescriptor;
import android.os.SystemClock;
import android.view.accessibility.AccessibilityNodeInfo;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;

import java.io.FileInputStream;
import java.util.List;
import java.util.concurrent.atomic.AtomicReference;

import ai.wizards.os.everywhere.WizardKeyboardService;

/**
 * device.automation against a real other-package app (DummyFoodActivity, in the instrumentation APK) through the real
 * Wizard OS accessibility service: record, replay to the confirm state, and the money boundary (a commit step is
 * refused, a control wrapping a payment button stops the run, nothing is ever pressed until confirm()).
 * No network, no owner server, no Grab.
 */
@RunWith(AndroidJUnit4.class)
public class AutomationE2eTest {
    private static final String T = AutomationPolicy.QA_TARGET;
    private Instrumentation ins;
    private UiAutomation ui;
    private Context app;
    private AutomationEngine engine;

    @Before public void setUp() throws Exception {
        ins = InstrumentationRegistry.getInstrumentation();
        // Keep Wizard OS's accessibility service running while the test drives the device.
        ui = ins.getUiAutomation(UiAutomation.FLAG_DONT_SUPPRESS_ACCESSIBILITY_SERVICES);
        app = ins.getTargetContext();
        assertEquals("ai.wizards.os.qa.test", ins.getContext().getPackageName());
        shell("settings put secure enabled_accessibility_services " + app.getPackageName() + "/" + WizardKeyboardService.class.getName());
        shell("settings put secure accessibility_enabled 1");
        long until = SystemClock.uptimeMillis() + 30000;
        while (WizardKeyboardService.get() == null && SystemClock.uptimeMillis() < until) SystemClock.sleep(250);
        assertNotNull("Wizard OS accessibility service did not connect", WizardKeyboardService.get());
        engine = AutomationEngine.get(app);
        main(() -> { if (engine.busy()) engine.cancel(); return null; });
        drain();
    }

    private void shell(String cmd) throws Exception {
        ParcelFileDescriptor pfd = ui.executeShellCommand(cmd);
        try (FileInputStream in = new ParcelFileDescriptor.AutoCloseInputStream(pfd)) { while (in.read() != -1) { } }
    }

    private interface Call<V> { V run() throws Exception; }

    private <V> V main(Call<V> c) {
        AtomicReference<V> out = new AtomicReference<>(); AtomicReference<Exception> err = new AtomicReference<>();
        ins.runOnMainSync(() -> { try { out.set(c.run()); } catch (Exception e) { err.set(e); } });
        if (err.get() != null) throw new AssertionError(err.get());
        return out.get();
    }

    private AutomationEngine.Mode waitMode(long ms, AutomationEngine.Mode... want) {
        long until = SystemClock.uptimeMillis() + ms;
        AutomationEngine.Mode m;
        do {
            m = main(engine::mode);
            for (AutomationEngine.Mode w : want) if (m == w) return m;
            SystemClock.sleep(250);
        } while (SystemClock.uptimeMillis() < until);
        return m;
    }

    private JSONArray drain() throws Exception {
        JSONArray o = main(engine::outbox);
        JSONArray ids = new JSONArray();
        for (int i = 0; i < o.length(); i++) ids.put(o.getJSONObject(i).getString("id"));
        main(() -> engine.ack(ids));
        return o;
    }

    private String screen() throws Exception {
        JSONObject s = main(() -> engine.screen(T));
        return s.getJSONArray("texts").toString();
    }

    private static JSONObject tap(String label, String near) throws Exception {
        return new JSONObject().put("type", "tap").put("label", label).put("near", near);
    }

    private JSONObject request(JSONArray steps) throws Exception {
        return new JSONObject().put("package", T).put("ref", "r1").put("steps", steps).put("ambiguous", new JSONArray().put("add"))
                .put("words", new JSONObject().put("runningTitle", "Ordering").put("confirmButton", "Place order · {total}"));
    }

    @Test public void replayStopsAtConfirmAndPressesNothing() throws Exception {
        JSONArray steps = new JSONArray().put(tap("Krua Thai Kitchen", "")).put(tap("Add", "Kra pao")).put(tap("View basket", ""));
        assertEquals("", main(() -> engine.replay(request(steps))));
        assertEquals(AutomationEngine.Mode.CONFIRM, waitMode(60000, AutomationEngine.Mode.CONFIRM, AutomationEngine.Mode.FAILED));
        String texts = screen();
        assertTrue(texts, texts.contains("1× Kra pao"));
        assertFalse(texts, texts.contains("Pad thai"));
        JSONObject s = main(() -> engine.screen(T));
        assertTrue(s.getBoolean("commit"));
        assertEquals("฿90", s.getString("total"));
        SystemClock.sleep(5000); // nothing presses the commit button on its own
        assertFalse(screen().contains("ORDER PLACED"));
        assertEquals(AutomationEngine.Mode.CONFIRM, main(engine::mode));
        JSONArray out = drain();
        JSONObject run = out.getJSONObject(out.length() - 1);
        assertEquals("ready", run.getString("result"));
        assertEquals("฿90", run.getString("total"));
        // The owner's tap on the cover (this test stands in for it): the only path that presses Place order.
        main(() -> { engine.confirm(); return null; });
        long until = SystemClock.uptimeMillis() + 10000;
        while (!screen().contains("ORDER PLACED") && SystemClock.uptimeMillis() < until) SystemClock.sleep(250);
        assertTrue(screen().contains("ORDER PLACED"));
        waitMode(10000, AutomationEngine.Mode.IDLE);
        drain();
    }

    @Test public void aCommitStepIsRefusedBeforeAnythingRuns() throws Exception {
        JSONArray steps = new JSONArray().put(tap("Krua Thai Kitchen", "")).put(tap("Place order ฿90", ""));
        assertEquals("commit-step", main(() -> engine.replay(request(steps))));
        assertEquals(AutomationEngine.Mode.IDLE, main(engine::mode));
        // Only allowlisted targets: the system Settings app can't be driven.
        assertEquals("target-not-allowed", main(() -> engine.replay(request(steps).put("package", "com.android.settings"))));
    }

    @Test public void aControlWrappingAPaymentButtonStopsTheRun() throws Exception {
        JSONArray steps = new JSONArray().put(tap("Krua Thai Kitchen", "")).put(tap("Express", ""));
        assertEquals("", main(() -> engine.replay(request(steps))));
        assertEquals(AutomationEngine.Mode.FAILED, waitMode(60000, AutomationEngine.Mode.FAILED, AutomationEngine.Mode.CONFIRM));
        assertFalse(screen().contains("PAID BY EXPRESS"));
        JSONArray out = drain();
        assertEquals("commit", out.getJSONObject(out.length() - 1).getString("code"));
        main(() -> { engine.cancel(); return null; });
    }

    private AccessibilityNodeInfo find(String text) {
        long until = SystemClock.uptimeMillis() + 15000;
        while (SystemClock.uptimeMillis() < until) {
            AccessibilityNodeInfo root = ui.getRootInActiveWindow();
            if (root != null && T.contentEquals(root.getPackageName() == null ? "" : root.getPackageName())) {
                List<AccessibilityNodeInfo> l = root.findAccessibilityNodeInfosByText(text);
                for (AccessibilityNodeInfo n : l) if (n.isClickable() && n.isVisibleToUser()) return n;
            }
            SystemClock.sleep(250);
        }
        throw new AssertionError("no clickable “" + text + "” in " + T);
    }

    /** A real touch (input tap), like the owner's finger: accessibility-action clicks are not what a user does. */
    private void touch(AccessibilityNodeInfo n) throws Exception {
        android.graphics.Rect r = new android.graphics.Rect(); n.getBoundsInScreen(r);
        shell("input tap " + r.centerX() + " " + r.centerY());
        SystemClock.sleep(1200);
    }

    private void userTaps(String text) throws Exception { touch(find(text)); }

    @Test public void recordingKeepsTheRouteAndNeverTheCommitTap() throws Exception {
        assertEquals("", main(() -> engine.record(new JSONObject().put("package", T).put("ref", "+new").put("ambiguous", new JSONArray().put("add")))));
        SystemClock.sleep(2000);
        userTaps("Krua Thai Kitchen");
        // "Add" is ambiguous: the recorder must remember the dish beside it. Two rows say Add; take Pad thai's.
        AccessibilityNodeInfo root = ui.getRootInActiveWindow();
        AccessibilityNodeInfo pad = root.findAccessibilityNodeInfosByText("Pad thai").get(0).getParent();
        AccessibilityNodeInfo add = null;
        for (int i = 0; i < pad.getChildCount(); i++) if ("Add".contentEquals(String.valueOf(pad.getChild(i).getText()))) add = pad.getChild(i);
        assertNotNull(add);
        touch(add);
        userTaps("View basket");
        userTaps("Place order"); // the owner's own commit: ends the recording, never becomes a step
        assertEquals(AutomationEngine.Mode.IDLE, waitMode(10000, AutomationEngine.Mode.IDLE));
        JSONArray out = drain();
        JSONObject rec = out.getJSONObject(out.length() - 1);
        assertEquals("recording", rec.getString("kind"));
        assertTrue(rec.getBoolean("committed"));
        assertEquals("฿95", rec.getString("total"));
        String events = rec.getJSONArray("events").toString();
        assertTrue(events, events.contains("\"label\":\"Krua Thai Kitchen\""));
        assertTrue(events, events.contains("\"near\":\"Pad thai\""));
        assertTrue(events, events.contains("View basket"));
        // The owner's commit tap ends the recording; it is never a step (screen fingerprints may name the button).
        JSONArray ev = rec.getJSONArray("events");
        for (int i = 0; i < ev.length(); i++) {
            JSONObject step = ev.getJSONObject(i).optJSONObject("step");
            if (step != null) assertFalse(events, AutomationPolicy.isCommit(step.optString("label")));
        }
    }
}
