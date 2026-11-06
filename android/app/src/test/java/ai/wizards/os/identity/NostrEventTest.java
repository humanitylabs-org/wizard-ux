package ai.wizards.os.identity;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import static org.junit.Assert.*;

public class NostrEventTest {
    private static final String PUB = "f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9";
    private JSONObject event(int kind, String tags) throws Exception { return new JSONObject().put("kind",kind).put("tags",new JSONArray(tags)).put("content",""); }
    @Test public void nip01IndependentUtf8Vector() throws Exception {
        JSONObject e = event(1,"[[\"name\",\"Hello / 🧙\"],[\"d\",\"test\"]]").put("created_at",1231006505L).put("content","line\nhttps://example.com/a\t\"quoted\"");
        assertEquals("696f3c88c914898b27ce55242ffce39bbbc9e46091c80abb3421e5d47019a237",NostrEvent.hex(NostrEvent.digest(NostrEvent.normalize(e,PUB,0))));
        assertFalse(NostrEvent.canonical(NostrEvent.normalize(e,PUB,0)).contains("\\/"));
    }
    @Test public void sentenceUsesOnlyKindNameAndD() throws Exception {
        assertEquals("Publish Night as your skin",NostrEvent.sentence(event(30117,"[[\"name\",\"Night\"],[\"d\",\"fallback\"]]").put("description","Safe login")));
        assertEquals("Publish repo as your app",NostrEvent.sentence(event(30617,"[[\"d\",\"repo\"]]")));
        assertEquals("Publish Untitled as your skin",NostrEvent.sentence(event(30117,"[]")));
        assertEquals("Unfamiliar request",NostrEvent.sentence(event(24242,"[]")));
        assertEquals("Update your profile",NostrEvent.sentence(event(0,"[]")));
        assertEquals("Post publicly",NostrEvent.sentence(event(1,"[]")));
        assertEquals("Change who you follow",NostrEvent.sentence(event(3,"[]")));
    }
    @Test public void deviceFriendAndEncryptionSentences() throws Exception {
        String npub = NostrEvent.shortNpub(PUB), tags = "[[\"d\",\"wizard-devices\"],[\"p\",\"" + PUB + "\",\"wss://relay.example\",\"inbox\"]]";
        JSONObject devices = event(30078, tags);
        assertEquals("Let this Wizard receive for you", NostrEvent.sentence(devices));
        assertEquals("Wizard: " + npub, NostrEvent.deviceBody(devices));
        devices.getJSONArray("tags").put(new JSONArray().put("revoked").put(PUB).put("123"));
        assertEquals("Remove a Wizard from your Wizard ID", NostrEvent.sentence(devices));
        assertTrue(NostrEvent.deviceBody(devices).contains("Remove: " + npub));
        assertEquals("Unfamiliar request", NostrEvent.sentence(event(30078, "[[\"d\",\"other\"]]")));
        assertEquals("Send a sealed friend request", NostrEvent.sentence(event(13, "[]")));
        JSONObject rumor = event(1078, "[[\"t\",\"other\"],[\"t\",\"wizard-profile\"],[\"p\",\"" + PUB + "\"]]");
        assertEquals("Add " + npub + " as a friend", NostrEvent.sentence(rumor));
        assertEquals("Unfamiliar request", NostrEvent.sentence(event(1078, "[]")));
        assertEquals("Add " + npub + " as a friend · sealed to " + npub, NostrEvent.encryptionSentence(rumor.toString(), PUB, PUB));
        assertEquals("Encrypt a private message to " + npub, NostrEvent.encryptionSentence("not an event", PUB, PUB));
        assertEquals("Encrypt a private message to " + npub, NostrEvent.encryptionSentence("{\"kind\":13,\"tags\":[],\"content\":5}", PUB, PUB));
    }
    @Test public void partialMatchesShowTheRawRequest() throws Exception {
        String d = "[\"d\",\"wizard-devices\"]", p = "[\"p\",\"" + PUB + "\"]", t = "[\"t\",\"wizard-profile\"]";
        // A friendly sentence hides the event JSON, so any tag the sentence does not describe must fall back to Unfamiliar.
        assertEquals("Unfamiliar request", NostrEvent.sentence(event(30078, "[" + d + "," + p + ",[\"revoked\",\"not-a-key\"]]")));
        assertEquals("Unfamiliar request", NostrEvent.sentence(event(30078, "[" + d + "," + p + ",[\"e\",\"" + PUB + "\"]]")));
        assertEquals("Unfamiliar request", NostrEvent.sentence(event(30078, "[" + d + "," + d + "," + p + "]")));
        assertEquals("Unfamiliar request", NostrEvent.sentence(event(30078, "[" + d + ",[\"p\",\"short\"]]")));
        assertEquals("Unfamiliar request", NostrEvent.sentence(event(30078, "[" + d + "]")));
        assertEquals("Unfamiliar request", NostrEvent.sentence(event(1078, "[" + t + "," + p + "," + p + "]")));
        assertEquals("Unfamiliar request", NostrEvent.sentence(event(1078, "[" + t + "," + p + ",[\"e\",\"x\"]]")));
        assertEquals("Unfamiliar request", NostrEvent.sentence(event(1078, "[" + t + ",[\"p\",\"" + PUB + "\",\"wss://other\"]]")));
        assertEquals("Let this Wizard receive for you", NostrEvent.sentence(event(30078, "[" + d + "," + p + "]")));
        assertEquals("Remove a Wizard from your Wizard ID", NostrEvent.sentence(event(30078, "[" + d + ",[\"revoked\",\"" + PUB + "\",\"123\"]]")));
    }
    @Test public void normalizationBindsSignerDropsUntrustedFields() throws Exception {
        JSONObject e = NostrEvent.normalize(event(1,"[]").put("description","Safe").put("sig","fake").put("id","fake"),PUB,42);
        assertEquals(PUB,e.getString("pubkey")); assertEquals(42,e.getLong("created_at"));
        assertFalse(e.has("description")); assertFalse(e.has("sig")); assertFalse(e.has("id"));
        assertThrows(IllegalArgumentException.class,() -> NostrEvent.normalize(event(1,"[]").put("pubkey","wrong"),PUB,42));
        assertThrows(IllegalArgumentException.class,() -> NostrEvent.normalize(event(1,"[]").put("created_at",1.5),PUB,42));
        assertThrows(IllegalArgumentException.class,() -> NostrEvent.normalize(event(1,"[[\"name\",7]]"),PUB,42));
        assertThrows(IllegalArgumentException.class,() -> NostrEvent.normalize(event(65536,"[]"),PUB,42));
    }
    @Test public void loneSurrogatesMatchJavascript() throws Exception {
        assertTrue(NostrEvent.canonical(NostrEvent.normalize(event(1,"[]").put("content","\ud800 / \udc00"),PUB,42)).contains("\\ud800 / \\udc00"));
    }
    @Test public void nip19ChecksumCaseAndRoundtrip() {
        byte[] secret = NostrEvent.bytes("0000000000000000000000000000000000000000000000000000000000000003");
        String nsec = Nip19.encode("nsec",secret);
        assertArrayEquals(secret,Nip19.secret(nsec)); assertArrayEquals(secret,Nip19.secret(nsec.toUpperCase(java.util.Locale.ROOT)));
        assertThrows(IllegalArgumentException.class,() -> Nip19.secret("N"+nsec.substring(1)));
        assertThrows(IllegalArgumentException.class,() -> Nip19.secret(nsec.substring(0,62)+(nsec.endsWith("q")?"p":"q")));
        assertThrows(IllegalArgumentException.class,() -> Nip19.secret(Nip19.encode("npub",secret)));
    }
}
