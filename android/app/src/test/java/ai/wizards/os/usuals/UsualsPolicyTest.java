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

    /* ---------------- browse first ("Order something new") ---------------- */

    private long now;
    private final List<UsualsPolicy.Rec> recs = new ArrayList<>();
    private void screen(String name) { now += 700; recs.add(UsualsPolicy.Rec.screen(name, now)); }
    private void tapAt(String l, String near) { now += 300; recs.add(UsualsPolicy.Rec.of(tap(l, near), now)); }
    private void typeAt(String txt) { now += 150; recs.add(UsualsPolicy.Rec.of(type(txt), now)); }
    private String route(List<String> checkout) { return UsualsPolicy.write(UsualsPolicy.tidy(UsualsPolicy.path(recs, checkout))); }

    @Test public void browsingDetoursAreTakenOut() {
        screen("home");
        tapAt("Not now", "");
        typeAt("k"); typeAt("kr"); typeAt("krua");
        screen("results");
        tapAt("Kruang Burger", "");          // a look...
        screen("menu kruang");
        tapAt("Reviews", "");
        screen("reviews");
        screen("menu kruang");               // back
        screen("results");                   // back again: nothing ordered there
        tapAt("Krua Thai Kitchen", "");
        screen("menu krua");
        tapAt("Add", "Kra pao moo saap");
        tapAt("Add", "Kra pao moo saap");
        tapAt("Add", "Thai iced tea");
        tapAt("View basket · 3 items", "");
        screen("checkout");
        assertEquals("tap Not now\ntype krua\ntap Krua Thai Kitchen\ntap Add @ Kra pao moo saap\ntap Add @ Kra pao moo saap\n"
                + "tap Add @ Thai iced tea\ntap View basket · 3 items", route(null));
        List<UsualsPolicy.Step> st = UsualsPolicy.tidy(UsualsPolicy.path(recs, null));
        java.util.Map<UsualsPolicy.Step, String> items = UsualsPolicy.items(recs);
        assertEquals("2× Kra pao moo saap · 1× Thai iced tea", UsualsPolicy.basketLine(st, items));
        assertEquals("Kra pao moo saap + Thai iced tea", UsualsPolicy.suggestName(st, items));
        assertEquals("Krua Thai Kitchen", UsualsPolicy.place(st, items));
    }

    @Test public void itemPageLoopIsKept() {
        // Menu → dish page → options → "Add to basket" → back on the menu: a loop that put food in the basket.
        screen("home");
        tapAt("Krua Thai Kitchen", "");
        screen("menu");
        tapAt("Kra pao moo saap", "");
        screen("dish");
        tapAt("Pork", "");
        tapAt("Add to basket · ฿65", "");
        screen("menu");
        tapAt("Som tam thai", "");           // a look at another dish, backed out of
        screen("dish 2");
        screen("menu");
        tapAt("View basket · 1 item", "");
        screen("checkout");
        assertEquals("tap Krua Thai Kitchen\ntap Kra pao moo saap\ntap Pork\ntap Add to basket · ฿65\ntap View basket · 1 item", route(null));
        List<UsualsPolicy.Step> st = UsualsPolicy.tidy(UsualsPolicy.path(recs, null));
        java.util.Map<UsualsPolicy.Step, String> items = UsualsPolicy.items(recs);
        assertEquals("1× Kra pao moo saap", UsualsPolicy.basketLine(st, items));
        assertEquals("Kra pao moo saap", UsualsPolicy.suggestName(st, items));
        assertEquals("Krua Thai Kitchen", UsualsPolicy.place(st, items));
    }

    @Test public void removedItemsLeaveTheRecipe() {
        screen("menu");
        tapAt("Add", "Kra pao moo saap");
        tapAt("Add", "Pad thai");
        tapAt("Add", "Thai iced tea");
        tapAt("−", "Thai iced tea");         // changed his mind with the stepper
        tapAt("View basket · 2 items", "");
        screen("checkout");
        // ...and took the pad thai out on the checkout screen: the final basket only lists the kra pao.
        assertEquals("tap Add @ Kra pao moo saap\ntap View basket · 2 items",
                route(Arrays.asList("Review order", "1× Kra pao moo saap   ฿65", "Delivery fee ฿25", "Total", "฿90", "Place order ฿90")));
    }

    @Test public void basketChangersAndAddresses() {
        assertTrue(UsualsPolicy.isAddLabel("Add"));
        assertTrue(UsualsPolicy.isAddLabel("Add to basket · ฿65"));
        assertTrue(UsualsPolicy.isAddLabel("+"));
        assertTrue(UsualsPolicy.isAddLabel("เพิ่ม"));
        assertFalse(UsualsPolicy.isAddLabel("Address"));
        assertFalse(UsualsPolicy.isAddLabel("Add a note for the driver"));
        assertFalse(UsualsPolicy.isAddLabel("Place order ฿245"));
        assertTrue(UsualsPolicy.isRemoveLabel("−"));
        assertTrue(UsualsPolicy.isRemoveLabel("Remove"));
    }

    @Test public void screenFingerprintsIgnoreCountsAndPrices() {
        assertEquals(UsualsPolicy.sig(Arrays.asList("Krua Thai Kitchen", "View basket · 2 items", "฿65")),
                UsualsPolicy.sig(Arrays.asList("Krua Thai Kitchen", "View basket · 3 items", "฿130")));
        assertFalse(UsualsPolicy.sig(Arrays.asList("Krua Thai Kitchen")).equals(UsualsPolicy.sig(Arrays.asList("Som Tam Nua"))));
    }

    @Test public void orderSomethingNewByVoice() {
        for (String s : new String[]{"Order something new", "order something", "Hey Wizard, order something new.", "order food",
                "order something from Grab", "get me some food", "get me food from grab", "order something to eat", "grab me something to eat"})
            assertTrue(s, UsualsPolicy.isBrowse(s));
        for (String s : new String[]{"I want something else", "order my usual kra pao", "get me a taxi", "what should I order",
                "order a taxi to the airport", "get me something"})
            assertFalse(s, UsualsPolicy.isBrowse(s));
    }

    /** James, 12 Oct: "I should be able to say order grab or order food or similar". */
    @Test public void foodSpells() {
        for (String s : new String[]{"Order grab.", "Order food.", "order Grab food", "order grabfood", "order from Grab", "order on grab",
                "Order lunch", "order dinner on Grab", "order breakfast from grab", "order a snack", "order takeout", "order delivery",
                "Hey Wizard, order food please", "Okay Wizard order food", "I want to order food", "I'd like to order dinner",
                "I\u2019d like to order lunch", "I wanna order food", "let's order food", "can you order food", "please order food",
                "get food", "get me some food", "grab food", "grab me food", "food order", "a grab order", "new food order", "order foods",
                "order me some food", "order something new", "order food now"})
            assertTrue(s, UsualsPolicy.isBrowse(s));
        for (String s : new String[]{"food", "what food should I order", "food is great", "the grab driver is late", "order a taxi",
                "order my usual kra pao", "order kra pao", "order the pizza", "I like food", "grab a coffee", "order pizza for the team meeting"})
            assertFalse(s, UsualsPolicy.isBrowse(s));
    }

    @Test public void aSavedOrderNamedLikeASpellWins() {
        List<String> names = Arrays.asList("Kra pao moo saap + Thai iced tea", "Lunch");
        assertEquals(1, UsualsPolicy.namedExactly(names, "Order lunch."));
        assertEquals(-1, UsualsPolicy.namedExactly(names, "order food"));
        assertEquals(-1, UsualsPolicy.namedExactly(names, "order grab"));
        assertEquals(-1, UsualsPolicy.namedExactly(new ArrayList<>(), "order lunch"));
    }

    @Test public void namesKeepItShort() {
        List<UsualsPolicy.Step> st = Arrays.asList(tap("Krua Thai Kitchen", ""), tap("Add", "Kra pao moo saap"), tap("Add", "Pad thai"),
                tap("Add", "Thai iced tea"), tap("Add", "Pad thai"));
        assertEquals("Pad thai + 2 more", UsualsPolicy.suggestName(st, null));
        assertEquals("Grab order", UsualsPolicy.suggestName(new ArrayList<>(), null));
    }

    @Test public void promoPopUpClosersSurvive() {
        screen("home");
        screen("promo");
        tapAt("Not now", "");
        screen("home");                     // "back" from the pop-up
        typeAt("krua");
        screen("results");
        tapAt("Krua Thai Kitchen", "");
        screen("menu");
        tapAt("Add", "Kra pao moo saap");
        assertEquals("tap Not now\ntype krua\ntap Krua Thai Kitchen\ntap Add @ Kra pao moo saap", route(null));
    }

    @Test public void basketButtonsMatchWhateverTheCount() {
        assertEquals(3, UsualsPolicy.score("View basket · 4 items", "", "View basket · 3 items", ""));
        assertEquals(3, UsualsPolicy.score("View Basket 2 Items ฿245", "", "View Basket 3 Items ฿280", ""));
        assertEquals(0, UsualsPolicy.score("฿65", "", "฿80", ""));
    }

    private static UsualsPolicy.Step tap(String l, String near) { return new UsualsPolicy.Step("tap", l, "", near, .5f, .5f); }
    private static UsualsPolicy.Step type(String t) { return new UsualsPolicy.Step("type", t, "", "", -1, -1); }
}
