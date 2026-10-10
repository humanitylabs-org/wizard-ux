package ai.wizards.os.identity;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

import java.nio.charset.StandardCharsets;

/**
 * Vectors come from outside this code: NIP-19 / NIP-49 spec examples, RFC 7914 (scrypt), BIP-340, and NIP-01 ids
 * computed with Python's json.dumps(separators=(",",":"), ensure_ascii=False) + sha256.
 */
public class WizardIdTest {
    private static final String G = "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798";

    /* ---------------- bech32 / NIP-19 */

    @Test public void npubVectorFromNip19() throws Exception {
        String hex = "7e7e9c42a91bfef19fa929e5fda1b72e0ebc1a4c1141673e2794234d86addf4e";
        String npub = "npub10elfcs4fr0l0r8af98jlmgdh9c8tcxjvz9qkw038js35mp4dma8qzvjptg";
        assertEquals(npub, KeyText.npub(hex));
        assertEquals(hex, KeyText.npubHex(npub));
    }

    @Test public void nsecVectorFromNip19() throws Exception {
        String nsec = "nsec1vl029mgpspedva04g90vltkh6fvh240zqtv9k0t9af8935ke9laqsnlfe5";
        byte[] sk = KeyText.secret(nsec, null);
        assertEquals("67dea2ed018072d675f5415ecfaed7d2597555e202d85b3d65ea4e58d2d92ffa", Hex.of(sk));
        assertEquals(nsec, KeyText.nsec(sk));
    }

    @Test public void bech32RejectsTyposAndMixedCase() throws Exception {
        String good = "npub10elfcs4fr0l0r8af98jlmgdh9c8tcxjvz9qkw038js35mp4dma8qzvjptg";
        expectBad(good.substring(0, good.length() - 1) + "q");
        expectBad("npub10ELFcs4fr0l0r8af98jlmgdh9c8tcxjvz9qkw038js35mp4dma8qzvjptg");
        assertEquals("npub", Bech32.decode(good.toUpperCase()).hrp);
    }

    private static void expectBad(String s) {
        try { Bech32.decode(s); fail("accepted " + s); } catch (IllegalArgumentException expected) { }
    }

    @Test public void keyTextSaysWhatIsWrong() throws Exception {
        assertMessage("npub10elfcs4fr0l0r8af98jlmgdh9c8tcxjvz9qkw038js35mp4dma8qzvjptg", null, "public key");
        assertMessage("nsec1vl029mgpspedva04g90vltkh6fvh240zqtv9k0t9af8935ke9laqsnlfe4", null, "typo");
        assertMessage("hello", null, "starts with nsec");
        assertMessage("ncryptsec1qgg9947rlpvqu76pj5ecreduf9jxhselq2nae2kghhvd5g7dgjtcxfqtd67p9m0w57lspw8gsq6yphnm8623nsl8xn9j4jdzz84zm3frztj3z7s35vpzmqf6ksu8r89qk5z2zxfmu5gv8th8wclt0h4p", "", "password");
    }

    private static void assertMessage(String text, String pw, String part) throws Exception {
        try { KeyText.secret(text, pw); fail("accepted " + text); }
        catch (IllegalArgumentException e) { assertTrue(e.getMessage(), e.getMessage().contains(part)); }
    }

    /* ---------------- NIP-49 (scrypt + XChaCha20-Poly1305) */

    @Test public void scryptRfc7914Vector() throws Exception {
        byte[] dk = Nip49.scrypt("password".getBytes(StandardCharsets.UTF_8), "NaCl".getBytes(StandardCharsets.UTF_8), 1024, 8, 16, 64);
        assertEquals("fdbabe1c9d3472007856e7190d01e9fe7c6ad7cbc8237830e77376634b3731622eaf30d92e22a3886ff109279d9830dac727afb94a83ee6d8360cbdfa2cc0640", Hex.of(dk));
    }

    @Test public void hchacha20DraftVector() throws Exception {
        // draft-irtf-cfrg-xchacha-03 §2.2.1
        byte[] key = Hex.parse("000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f");
        byte[] n = Hex.parse("000000090000004a0000000031415927");
        assertEquals("82413b4227b27bfed30e42508a877d73a0f9e4d58a74a853c12ec41326d3ecdc", Hex.of(Nip49.hchacha20(key, n)));
    }

    @Test public void ncryptsecSpecVector() throws Exception {
        String v = "ncryptsec1qgg9947rlpvqu76pj5ecreduf9jxhselq2nae2kghhvd5g7dgjtcxfqtd67p9m0w57lspw8gsq6yphnm8623nsl8xn9j4jdzz84zm3frztj3z7s35vpzmqf6ksu8r89qk5z2zxfmu5gv8th8wclt0h4p";
        assertEquals("3501454135014541350145413501453fefb02227e449e57cf4d3a3ce05378683", Hex.of(Nip49.decrypt(v, "nostr")));
        try { Nip49.decrypt(v, "nostr!"); fail("wrong password accepted"); } catch (Nip49.BadPassword expected) { }
    }

    /* ---------------- NIP-01 event ids */

    @Test public void eventIdMatchesPythonReference() throws Exception {
        JSONObject e = new JSONObject()
                .put("kind", 1).put("created_at", 1700000000)
                .put("tags", new JSONArray().put(new JSONArray().put("e").put("abc").put("wss://x")).put(new JSONArray().put("t").put("wizard-app")))
                .put("content", "hé \"q\" \\ \n\t\u0001 ✶ 🧙 </script>");
        NostrEvent ev = NostrEvent.fromRequest(e, G, 0);
        assertEquals("[0,\"" + G + "\",1700000000,1,[[\"e\",\"abc\",\"wss://x\"],[\"t\",\"wizard-app\"]],\"hé \\\"q\\\" \\\\ \\n\\t\\u0001 ✶ 🧙 </script>\"]", ev.serialize(G));
        assertEquals("d61af93aed309b936d47f4204ed4a28c0676a8b5b1f62870e2835ecbcdce3ac8", Hex.of(ev.id(G)));
        NostrEvent p = NostrEvent.fromRequest(new JSONObject().put("kind", 0).put("created_at", 1700000000).put("content", "{}"), G, 0);
        assertEquals("bc73b6b079e3a5efe10a865632b67fa5bc9872ffa733679dc4de5a36e2ca5c2d", Hex.of(p.id(G)));
    }

    @Test public void eventRequestsAreValidated() throws Exception {
        long now = 1700000000L;
        NostrEvent filled = NostrEvent.fromRequest(new JSONObject().put("kind", 1).put("content", "x"), G, now);
        assertEquals(now, filled.createdAt);
        assertEquals(0, filled.tags.length());
        refuse(new JSONObject().put("kind", 1).put("content", "x").put("pubkey", "00".repeat(32)), "different identity");
        refuse(new JSONObject().put("kind", "1"), "kind");
        refuse(new JSONObject().put("kind", 1).put("content", 5), "text");
        refuse(new JSONObject().put("kind", 1).put("tags", new JSONArray().put(new JSONArray().put(1))), "tags");
        refuse(new JSONObject().put("kind", 1).put("content", "x".repeat(NostrEvent.MAX_CONTENT + 1)), "too large");
        NostrEvent.fromRequest(new JSONObject().put("kind", 1).put("pubkey", G), G, now); // own pubkey is fine
    }

    private static void refuse(JSONObject e, String part) throws Exception {
        try { NostrEvent.fromRequest(e, G, 1); fail("accepted " + e); }
        catch (IllegalArgumentException x) { assertTrue(x.getMessage(), x.getMessage().contains(part)); }
    }

    /* ---------------- the approval sheet's sentence */

    @Test public void sheetSentenceComesFromTheEvent() throws Exception {
        assertEquals("Update your profile", SignPolicy.describe(ev(0, "{\"name\":\"James\"}")).title);
        assertEquals("Name: James", SignPolicy.describe(ev(0, "{\"name\":\"James\"}")).detail);
        assertEquals("Post publicly", SignPolicy.describe(ev(1, "gm")).title);
        JSONObject app = new JSONObject().put("kind", 30617).put("content", "")
                .put("tags", new JSONArray().put(new JSONArray().put("d").put("defleur-video")).put(new JSONArray().put("name").put("DeFleur Video"))
                        .put(new JSONArray().put("clone").put("https://github.com/humanitylabs-org/defleur-video")));
        SignPolicy.Sentence s = SignPolicy.describe(NostrEvent.fromRequest(app, G, 1));
        assertEquals("Publish DeFleur Video as your app", s.title);
        assertEquals("Code: https://github.com/humanitylabs-org/defleur-video", s.detail);
        SignPolicy.Sentence odd = SignPolicy.describe(ev(4, "secret dm"));
        assertEquals("Unfamiliar request", odd.title);
        assertFalse(odd.familiar);
    }

    private static NostrEvent ev(int kind, String content) throws Exception {
        return NostrEvent.fromRequest(new JSONObject().put("kind", kind).put("content", content), G, 1);
    }

    /* ---------------- BIP-340 */

    @Test public void schnorrMatchesBip340() throws Exception {
        byte[] sk3 = Hex.parse("0000000000000000000000000000000000000000000000000000000000000003");
        assertEquals("f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9", Schnorr.publicKey(sk3));
        // BIP-340 test vector 1 (verify)
        assertTrue(Schnorr.verify(
                Hex.parse("6896bd60eeae296db48a229ff71dfe071bde413e6d43f917dc8dcf8c78de33418906d11ac976abccb20b091292bff4ea897efcb639ea871cfa95f6de339e4b0a"),
                Hex.parse("243f6a8885a308d313198a2e03707344a4093822299f31d0082efa98ec4e6c89"),
                "dff1d77f2a671c5f36183726db2341be58feae1da2deced843240f7b502ba659"));
    }

    @Test public void signedEventVerifiesAndForgeryFails() throws Exception {
        byte[] sk = Schnorr.newSecret();
        String pub = Schnorr.publicKey(sk);
        NostrEvent e = NostrEvent.fromRequest(new JSONObject().put("kind", 0).put("content", "{\"name\":\"Robin\"}"), pub, 1700000000);
        String sig = Schnorr.sign(e.id(pub), sk, pub);
        assertTrue(Schnorr.verify(Hex.parse(sig), e.id(pub), pub));
        byte[] other = e.id(pub).clone();
        other[0] ^= 1;
        assertFalse(Schnorr.verify(Hex.parse(sig), other, pub));
        JSONObject out = e.signed(pub, sig);
        assertEquals(Hex.of(e.id(pub)), out.getString("id"));
        assertEquals(pub, out.getString("pubkey"));
        try { Schnorr.sign(e.id(pub), sk, "00".repeat(32)); fail("signed under the wrong pubkey"); } catch (IllegalStateException expected) { }
        assertNull(null);
    }
}
