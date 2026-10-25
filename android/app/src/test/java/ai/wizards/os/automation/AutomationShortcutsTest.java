package ai.wizards.os.automation;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.fail;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

public class AutomationShortcutsTest {
    private static JSONObject replay(String label) throws Exception {
        return new JSONObject().put("op", "replay").put("package", "com.grabtaxi.passenger")
                .put("steps", new JSONArray().put(new JSONObject().put("type", "tap").put("label", label)));
    }

    private static JSONObject table() throws Exception {
        return new JSONObject()
                .put("actions", new JSONObject().put("kra", replay("Krua Thai Kitchen")).put("lunch", replay("Som Tam Nua"))
                        .put("new", new JSONObject().put("op", "record").put("package", "com.grabtaxi.passenger"))
                        .put("chicken", replay("Chicken")).put("pork", replay("Pork")))
                .put("entries", new JSONArray()
                        .put(new JSONObject().put("pattern", "^order (?:my usual )?kra pao$").put("priority", 60).put("action", "kra"))
                        .put(new JSONObject().put("pattern", "^order (?:food|lunch)$").put("priority", 10).put("action", "new"))
                        .put(new JSONObject().put("pattern", "^order lunch$").put("priority", 100).put("action", "lunch"))
                        .put(new JSONObject().put("pattern", "^order kra pao (?:chicken|pork)?$").put("priority", 50).put("action", "chicken"))
                        .put(new JSONObject().put("pattern", "^order thai$").put("priority", 50).put("action", "chicken"))
                        .put(new JSONObject().put("pattern", "^order thai$").put("priority", 50).put("action", "pork")));
    }

    @Test public void highestPriorityWinsAndTiesAsk() throws Exception {
        AutomationShortcuts.Table t = AutomationShortcuts.parse(table());
        assertEquals("Krua Thai Kitchen", AutomationShortcuts.match(t, "order my usual kra pao").getJSONArray("steps").getJSONObject(0).getString("label"));
        assertEquals("Som Tam Nua", AutomationShortcuts.match(t, "order lunch").getJSONArray("steps").getJSONObject(0).getString("label")); // a saved "Lunch" beats the spell
        assertEquals("record", AutomationShortcuts.match(t, "order food").getString("op"));
        assertNull(AutomationShortcuts.match(t, "order thai"));        // two actions tie: ask, don't guess
        assertNull(AutomationShortcuts.match(t, "what's a good kra pao place"));
        assertNull(AutomationShortcuts.match(t, ""));
        assertNull(AutomationShortcuts.match(AutomationShortcuts.parse(null), "order food"));
    }

    private static void refused(JSONObject t, String code) {
        try { AutomationShortcuts.parse(t); fail("accepted " + t); }
        catch (AutomationPolicy.Refusal r) { assertEquals(code, r.code); }
    }

    @Test public void malformedTablesAreRefusedWhole() throws Exception {
        refused(new JSONObject().put("entries", new JSONArray()), "bad-shortcut");
        JSONObject unanchored = table(); unanchored.getJSONArray("entries").getJSONObject(0).put("pattern", "kra pao"); refused(unanchored, "bad-shortcut");
        JSONObject broken = table(); broken.getJSONArray("entries").getJSONObject(0).put("pattern", "^(kra$"); refused(broken, "bad-shortcut");
        JSONObject dangling = table(); dangling.getJSONArray("entries").getJSONObject(0).put("action", "nope"); refused(dangling, "bad-shortcut");
        JSONObject op = table(); op.getJSONObject("actions").put("x", new JSONObject().put("op", "confirm")); refused(op, "bad-shortcut");
    }

    @Test public void aShortcutCannotCarryACommitStep() throws Exception {
        JSONObject t = table();
        t.getJSONObject("actions").put("kra", replay("Place order ฿245"));
        refused(t, "commit-step");
    }
}
