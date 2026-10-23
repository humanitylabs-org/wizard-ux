package ai.wizards.os.automation;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

import java.util.Arrays;
import java.util.List;

/** The money-safety boundary of device.automation (ported from UsualsPolicyTest) and its recipe validation. */
public class AutomationPolicyTest {
    @Test public void commitButtonsAreRecognised() {
        for (String s : new String[]{"Place order", "Place Order ฿245", "Place order · ฿245", "PLACE ORDER", "Order now", "Pay now",
                "Confirm order", "Swipe to order", "ยืนยันคำสั่งซื้อ", "สั่งอาหาร ฿120", "Pay ฿245", "Confirm and pay", "Pay THB 90",
                "  place   order  ", "Ｐｌａｃｅ ｏｒｄｅｒ"}) {
            assertTrue(s, AutomationPolicy.isCommit(s));
        }
        for (String s : new String[]{"Add", "View basket · 1 item", "Order history", "Krua Thai Kitchen", "Reorder", "Search", "",
                "Orders", "Ordering for someone else?", "Payment methods", "Order nowhere", null}) {
            assertFalse(String.valueOf(s), AutomationPolicy.isCommit(s));
        }
    }

    private static JSONObject tap(String label) throws Exception { return new JSONObject().put("type", "tap").put("label", label); }

    @Test public void aRecipeNamingACommitButtonIsRefusedWhole() throws Exception {
        for (String c : new String[]{"Place order", "Place order ฿245", "Pay now", "ยืนยันคำสั่งซื้อ", "Swipe to order"}) {
            JSONArray steps = new JSONArray().put(tap("Krua Thai Kitchen")).put(tap(c)).put(tap("View basket"));
            try { AutomationPolicy.steps(steps); fail("accepted " + c); }
            catch (AutomationPolicy.Refusal r) { assertEquals("commit-step", r.code); }
        }
        // Typing the words is not pressing the button.
        assertEquals(2, AutomationPolicy.steps(new JSONArray().put(new JSONObject().put("type", "type").put("label", "place order")).put(tap("Search"))).size());
    }

    @Test public void recipesAreBoundedAndTyped() throws Exception {
        String[] codes = {"no-steps", "no-steps", "bad-step", "bad-step", "bad-step", "bad-step"};
        JSONArray[] bad = {
                null, new JSONArray(),
                new JSONArray().put("tap Add"),
                new JSONArray().put(new JSONObject().put("type", "swipe").put("label", "x")),
                new JSONArray().put(new JSONObject().put("type", "tap")),
                new JSONArray().put(new JSONObject().put("type", "wait").put("label", "soon")),
        };
        for (int i = 0; i < bad.length; i++) {
            try { AutomationPolicy.steps(bad[i]); fail("accepted " + bad[i]); }
            catch (AutomationPolicy.Refusal r) { assertEquals(codes[i], r.code); }
        }
        JSONArray many = new JSONArray();
        for (int i = 0; i <= AutomationPolicy.MAX_STEPS; i++) many.put(tap("x" + i));
        try { AutomationPolicy.steps(many); fail(); } catch (AutomationPolicy.Refusal r) { assertEquals("too-many-steps", r.code); }
        try { AutomationPolicy.steps(new JSONArray().put(tap("x".repeat(AutomationPolicy.MAX_LABEL + 1)))); fail(); }
        catch (AutomationPolicy.Refusal r) { assertEquals("bad-step", r.code); }
        List<AutomationPolicy.Step> ok = AutomationPolicy.steps(new JSONArray()
                .put(new JSONObject().put("type", "wait").put("label", "99999"))
                .put(new JSONObject().put("type", "tap").put("label", "Add").put("near", "Kra pao").put("say", "add kra pao"))
                .put(new JSONObject().put("type", "tap").put("id", "com.x:id/basket"))
                .put(new JSONObject().put("type", "enter")));
        assertEquals("10000", ok.get(0).label);
        assertEquals("Kra pao", ok.get(1).near);
        assertEquals("add kra pao", ok.get(1).say);
        assertEquals("com.x:id/basket", ok.get(2).id);
        assertTrue(AutomationPolicy.steps(new JSONArray().put(tap("Not now"))).get(0).optional());
        assertFalse(AutomationPolicy.steps(new JSONArray().put(tap("Add"))).get(0).optional());
    }

    @Test public void onlyAllowlistedTargetsCanBeDriven() {
        assertTrue(AutomationPolicy.target("com.grabtaxi.passenger", false, "ai.wizards.os"));
        assertFalse(AutomationPolicy.target("com.android.settings", false, "ai.wizards.os"));
        assertFalse(AutomationPolicy.target("com.google.android.apps.walletnfcrel", true, "ai.wizards.os.qa"));
        assertFalse(AutomationPolicy.target("ai.wizards.os", false, "ai.wizards.os")); // never itself
        assertFalse(AutomationPolicy.target("", true, "ai.wizards.os.qa"));
        assertFalse(AutomationPolicy.target(null, true, "ai.wizards.os.qa"));
        assertFalse(AutomationPolicy.target(AutomationPolicy.QA_TARGET, false, "ai.wizards.os")); // release: no QA target
        assertTrue(AutomationPolicy.target(AutomationPolicy.QA_TARGET, true, "ai.wizards.os.qa"));
    }

    @Test public void scoring() {
        assertEquals(4, AutomationPolicy.score("Krua Thai Kitchen", "", "Krua Thai Kitchen", ""));
        assertEquals(5, AutomationPolicy.score("Add", "id/add", "add", "id/add"));
        assertTrue(AutomationPolicy.score("View basket", "", "View basket · 2 items", "") > 0);
        assertEquals(0, AutomationPolicy.score("Add", "", "Kra pao", ""));
        assertEquals(0, AutomationPolicy.score("Krua", "", "Som Tam Nua", ""));
        assertEquals(3, AutomationPolicy.score("View basket · 4 items", "", "View basket · 3 items", ""));
        assertEquals(3, AutomationPolicy.score("View Basket 2 Items ฿245", "", "View Basket 3 Items ฿280", ""));
        assertEquals(0, AutomationPolicy.score("฿65", "", "฿80", ""));
        assertEquals(2, AutomationPolicy.score("", "id/basket", "anything", "id/basket"));
    }

    @Test public void totals() {
        assertEquals("฿245", AutomationPolicy.total(Arrays.asList("Kra pao moo saap", "฿65", "Delivery fee", "฿25", "Total", "฿245", "Place order ฿245")));
        assertEquals("฿245", AutomationPolicy.total(Arrays.asList("Total ฿245")));
        assertEquals("฿1,245", AutomationPolicy.total(Arrays.asList("Place order ฿1,245")));
        assertEquals("฿90", AutomationPolicy.total(Arrays.asList("ยอดรวม", "90 บาท")));
        assertNull(AutomationPolicy.total(Arrays.asList("Kra pao", "Add")));
        assertNull(AutomationPolicy.total(Arrays.asList("Total savings", "฿20")));
    }

    @Test public void screenFingerprintsIgnoreCountsAndPrices() {
        assertEquals(AutomationPolicy.sig(Arrays.asList("Krua Thai Kitchen", "View basket · 2 items", "฿65")),
                AutomationPolicy.sig(Arrays.asList("Krua Thai Kitchen", "View basket · 3 items", "฿130")));
        assertFalse(AutomationPolicy.sig(Arrays.asList("Krua Thai Kitchen")).equals(AutomationPolicy.sig(Arrays.asList("Som Tam Nua"))));
    }

    @Test public void ambiguousWordsComeFromTheCaller() throws Exception {
        List<String> none = AutomationPolicy.ambiguous(null);
        assertTrue(AutomationPolicy.isAmbiguous("+", none));      // short
        assertTrue(AutomationPolicy.isAmbiguous("฿65", none));    // a bare price
        assertFalse(AutomationPolicy.isAmbiguous("Add", none));   // a word only web knows is generic
        List<String> food = AutomationPolicy.ambiguous(new JSONArray().put("add").put("add to basket").put("remove *").put("เพิ่ม"));
        assertTrue(AutomationPolicy.isAmbiguous("Add", food));
        assertTrue(AutomationPolicy.isAmbiguous("Remove Pad thai", food));
        assertTrue(AutomationPolicy.isAmbiguous("เพิ่ม", food));
        assertFalse(AutomationPolicy.isAmbiguous("Kra pao moo saap", food));
    }

    @Test public void dismissWordsNeverOverlapCommitWords() {
        for (String s : new String[]{"Not now", "OK", "Skip", "Close", "ปิด", "ตกลง"}) {
            assertTrue(s, AutomationPolicy.isDismiss(s));
            assertFalse(s, AutomationPolicy.isCommit(s));
        }
    }

    @Test public void phrasesDropWakeWordsAndPunctuation() {
        assertEquals("order kra pao", AutomationPolicy.phrase("Hey Saffron, order kra pao.", "Saffron"));
        assertEquals("order kra pao", AutomationPolicy.phrase("Okay Wizard order kra pao!", "Saffron"));
        assertEquals("i'd like to order lunch", AutomationPolicy.phrase("I\u2019d like to order lunch", null));
        assertEquals("saffronville order food", AutomationPolicy.phrase("Saffronville, order food", "Saffron"));
        assertEquals("archimedes order food", AutomationPolicy.phrase("Archimedes, order food", "Saffron"));
        assertEquals("order food", AutomationPolicy.phrase("Hey A+B, order food", "A+B"));
        assertEquals("", AutomationPolicy.phrase("x".repeat(101), null));
    }

    @Test public void webWordsAreBoundedAndFilled() throws Exception {
        JSONObject w = new JSONObject().put("title", "Ordering\nyour {name}").put("long", "x".repeat(500));
        assertEquals("Ordering your {name}", AutomationPolicy.word(w, "title", "f"));
        assertEquals(AutomationPolicy.MAX_WORD, AutomationPolicy.word(w, "long", "f").length());
        assertEquals("f", AutomationPolicy.word(w, "missing", "f"));
        assertEquals("f", AutomationPolicy.word(null, "title", "f"));
        assertEquals("Step 2 of 5", AutomationPolicy.fill("Step {step} of {of}", "step", "2", "of", "5"));
    }
}
