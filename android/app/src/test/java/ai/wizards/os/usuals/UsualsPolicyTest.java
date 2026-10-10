package ai.wizards.os.usuals;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

public class UsualsPolicyTest {
    @Test public void commitButtonsAreRecognised() {
        for (String s : new String[]{"Place order", "Place Order ฿245", "Place order · ฿245", "PLACE ORDER", "Order now", "Pay now",
                "Confirm order", "Swipe to order", "ยืนยันคำสั่งซื้อ", "สั่งอาหาร ฿120", "Pay ฿245"}) {
            assertTrue(s, UsualsPolicy.isCommit(s));
        }
        for (String s : new String[]{"Add", "View basket · 1 item", "Order history", "Krua Thai Kitchen", "Reorder", "Search", "",
                "Orders", "Ordering for someone else?", "Payment methods", "Order nowhere"}) {
            assertFalse(s, UsualsPolicy.isCommit(s));
        }
    }

    @Test public void recipesNeverContainCommitTaps() {
        List<UsualsPolicy.Step> rec = new ArrayList<>();
        rec.add(tap("Krua Thai Kitchen", ""));
        rec.add(tap("Add", "Kra pao moo saap"));
        rec.add(tap("View basket · 1 item", ""));
        rec.add(tap("Place order ฿245", ""));
        List<UsualsPolicy.Step> t = UsualsPolicy.tidy(rec);
        assertEquals(3, t.size());
        assertFalse(UsualsPolicy.write(t).toLowerCase().contains("place order"));
        // A hand-edited recipe can't sneak one in either.
        List<UsualsPolicy.Step> p = UsualsPolicy.parse("tap Krua Thai Kitchen\ntap Place order\nPay now\ntap Add @ Kra pao");
        assertEquals(2, p.size());
    }

    @Test public void typingCollapsesToFinalText() {
        List<UsualsPolicy.Step> rec = Arrays.asList(tap("Search", ""), type("k"), type("kr"), type("krua"), tap("Krua Thai Kitchen", ""));
        List<UsualsPolicy.Step> t = UsualsPolicy.tidy(rec);
        assertEquals("tap Search\ntype krua\ntap Krua Thai Kitchen", UsualsPolicy.write(t));
    }

    @Test public void twoTapsOnPlusStayTwo() {
        List<UsualsPolicy.Step> t = UsualsPolicy.tidy(Arrays.asList(tap("+", "Thai iced tea"), tap("+", "Thai iced tea")));
        assertEquals(2, t.size());
    }

    @Test public void writeAndParseRoundTrip() {
        String s = "tap Not now\ntap Search for dishes\ntype krua\nsearch\ntap Krua Thai Kitchen\ntap Add @ Kra pao moo saap\nwait 1500\ntap View basket";
        assertEquals(s, UsualsPolicy.write(UsualsPolicy.parse(s)));
        UsualsPolicy.Step add = UsualsPolicy.parse(s).get(5);
        assertEquals("Add", add.label);
        assertEquals("Kra pao moo saap", add.near);
        assertTrue(UsualsPolicy.parse("tap Not now").get(0).optional());
        assertFalse(UsualsPolicy.parse("tap Add").get(0).optional());
    }

    @Test public void genericLabels() {
        assertTrue(UsualsPolicy.isGeneric("Add"));
        assertTrue(UsualsPolicy.isGeneric("+"));
        assertTrue(UsualsPolicy.isGeneric("฿65"));
        assertFalse(UsualsPolicy.isGeneric("Kra pao moo saap"));
    }

    @Test public void scoring() {
        assertEquals(4, UsualsPolicy.score("Krua Thai Kitchen", "", "Krua Thai Kitchen", ""));
        assertEquals(5, UsualsPolicy.score("Add", "id/add", "add", "id/add"));
        assertTrue(UsualsPolicy.score("View basket", "", "View basket · 2 items", "") > 0);
        assertEquals(0, UsualsPolicy.score("Add", "", "Kra pao", ""));
        assertEquals(0, UsualsPolicy.score("Krua", "", "Som Tam Nua", ""));
    }

    @Test public void totals() {
        assertEquals("฿245", UsualsPolicy.total(Arrays.asList("Kra pao moo saap", "฿65", "Delivery fee", "฿25", "Total", "฿245", "Place order ฿245")));
        assertEquals("฿245", UsualsPolicy.total(Arrays.asList("Total ฿245")));
        assertEquals("฿1,245", UsualsPolicy.total(Arrays.asList("Place order ฿1,245")));
        assertEquals("฿90", UsualsPolicy.total(Arrays.asList("ยอดรวม", "90 บาท")));
        assertNull(UsualsPolicy.total(Arrays.asList("Kra pao", "Add")));
    }

    @Test public void voiceMatching() {
        List<String> names = Arrays.asList("Kra pao", "Som tam & sticky rice", "Morning coffee");
        assertEquals(0, UsualsPolicy.matchVoice(names, "Order my usual kra pao"));
        assertEquals(0, UsualsPolicy.matchVoice(names, "Hey Wizard, order kra pao please."));
        assertEquals(1, UsualsPolicy.matchVoice(names, "get me som tam"));
        assertEquals(2, UsualsPolicy.matchVoice(names, "reorder my morning coffee"));
        assertEquals(-1, UsualsPolicy.matchVoice(names, "what's a good kra pao place"));      // no ordering verb
        assertEquals(-1, UsualsPolicy.matchVoice(names, "order a taxi to the airport"));       // nothing taught matches
        assertEquals(-1, UsualsPolicy.matchVoice(names, "order my usual"));                    // three usuals: which?
        assertEquals(0, UsualsPolicy.matchVoice(Arrays.asList("Kra pao"), "order my usual"));  // only one
        assertEquals(-1, UsualsPolicy.matchVoice(Arrays.asList("Kra pao chicken", "Kra pao pork"), "order kra pao")); // tie: ask
    }

    private static UsualsPolicy.Step tap(String l, String near) { return new UsualsPolicy.Step("tap", l, "", near, .5f, .5f); }
    private static UsualsPolicy.Step type(String t) { return new UsualsPolicy.Step("type", t, "", "", -1, -1); }
}
