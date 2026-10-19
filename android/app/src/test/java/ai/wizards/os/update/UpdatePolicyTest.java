package ai.wizards.os.update;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.json.JSONObject;
import org.junit.Test;

import java.util.Arrays;
import java.util.HashSet;

public class UpdatePolicyTest {
    @Test public void tappedMusicInstalls() {
        assertEquals(UpdatePolicy.Step.INSTALL, UpdatePolicy.next(true, true, true, true, UpdatePolicy.Hold.MUSIC, true, true));
    }
    @Test public void tappedBareMicInstalls() {
        assertEquals(UpdatePolicy.Step.INSTALL, UpdatePolicy.next(true, true, true, true, UpdatePolicy.Hold.MIC, true, true));
    }
    @Test public void tappedTakeStillDefers() {
        assertEquals(UpdatePolicy.Step.DEFER, UpdatePolicy.next(true, true, true, true, UpdatePolicy.Hold.TAKE, true, true));
    }
    @Test public void unattendedMusicDefers() {
        assertEquals(UpdatePolicy.Step.DEFER, UpdatePolicy.next(true, true, true, false, UpdatePolicy.Hold.MUSIC, true, false));
    }
    @Test public void unattendedMicDefers() {
        assertEquals(UpdatePolicy.Step.DEFER, UpdatePolicy.next(true, true, true, false, UpdatePolicy.Hold.MIC, true, false));
    }
    @Test public void deadOwnerClaimIsIgnored() {
        assertEquals(UpdatePolicy.Hold.NONE, UpdatePolicy.hold(false, true, false, false, false));
        assertEquals(UpdatePolicy.Step.INSTALL, UpdatePolicy.next(true, true, true, false,
                UpdatePolicy.hold(false, true, false, false, false), true, false));
        assertEquals(UpdatePolicy.Hold.MIC, UpdatePolicy.hold(false, true, false, false, true));
    }
    @Test public void liveOwnerProtectsPausedTakeWithoutAppOps() {
        assertEquals(UpdatePolicy.Hold.TAKE, UpdatePolicy.hold(false, true, true, false, false));
    }
    @Test public void genuineTakeWinsOverMusicAndMic() {
        assertEquals(UpdatePolicy.Hold.TAKE, UpdatePolicy.hold(true, false, false, true, true));
        assertEquals(UpdatePolicy.Hold.MUSIC, UpdatePolicy.hold(false, false, false, true, true));
        assertEquals("take", UpdatePolicy.Hold.TAKE.reason);
        assertEquals("music", UpdatePolicy.Hold.MUSIC.reason);
        assertEquals("mic", UpdatePolicy.Hold.MIC.reason);
    }

    static final String FEED = "https://wizard.tailc0f369.ts.net/reports/wizard-os/latest.json";
    static final String SHA = "864663a75a0dd19a134da46fea51931571d1fb03e7e50b0c05d089344039d771";

    @Test
    public void parsesRelativeApkOnTheFeedOrigin() throws Exception {
        UpdatePolicy.Release r = UpdatePolicy.parse(new JSONObject().put("versionCode", 6).put("versionName", "0.5.1")
                .put("url", "wizard-os-0.5.1.apk").put("sha256", SHA).put("bytes", 437029), FEED);
        assertNotNull(r);
        assertEquals("https://wizard.tailc0f369.ts.net/reports/wizard-os/wizard-os-0.5.1.apk", r.url);
        assertEquals(6, r.versionCode);
        assertFalse(UpdatePolicy.newer(r, 6));
        assertTrue(UpdatePolicy.newer(r, 5));
    }

    @Test
    public void rejectsForeignOriginsBadHashesAndDowngrades() throws Exception {
        assertNull(UpdatePolicy.parse(new JSONObject().put("versionCode", 9).put("versionName", "9").put("url", "https://evil.example/x.apk").put("sha256", SHA), FEED));
        assertNull(UpdatePolicy.parse(new JSONObject().put("versionCode", 9).put("versionName", "9").put("url", "http://wizard.tailc0f369.ts.net/x.apk").put("sha256", SHA), FEED));
        assertNull(UpdatePolicy.parse(new JSONObject().put("versionCode", 9).put("versionName", "9").put("url", "x.apk").put("sha256", "abc"), FEED));
        assertNull(UpdatePolicy.parse(new JSONObject().put("versionCode", 0).put("versionName", "9").put("url", "x.apk").put("sha256", SHA), FEED));
        assertNull(UpdatePolicy.parse(null, FEED));
    }

    @Test
    public void qaFakeFeedOnLoopbackWorks() throws Exception {
        UpdatePolicy.Release r = UpdatePolicy.parse(new JSONObject().put("versionCode", 99).put("versionName", "9.9.9").put("url", "/reports/wizard-os/new.apk").put("sha256", SHA),
                "http://localhost:18788/reports/wizard-os/latest.json");
        assertNotNull(r);
        assertEquals("http://localhost:18788/reports/wizard-os/new.apk", r.url);
    }

    @Test
    public void signersMustMatchExactly() {
        HashSet<String> a = new HashSet<>(Arrays.asList("aa")), ab = new HashSet<>(Arrays.asList("aa", "bb"));
        assertTrue(UpdatePolicy.sameSigners(a, new HashSet<>(a)));
        assertFalse(UpdatePolicy.sameSigners(a, ab));
        assertFalse(UpdatePolicy.sameSigners(a, new HashSet<>(Arrays.asList("cc"))));
        assertFalse(UpdatePolicy.sameSigners(new HashSet<>(), new HashSet<>()));
    }

    static final String WOS = "3bf74d0b597bc170761079909d3692428702ba057f753ee1ffd62da3c76ed1fd";
    static final String DBG = "f91f6be0c48a69bb48902ed1b0f391c1ca358235f5f37823e43fa17d962c9371";

    static HashSet<String> set(String... s) { return new HashSet<>(Arrays.asList(s)); }

    @Test
    public void feedSignerAndAppAreKeptAndChecked() throws Exception {
        UpdatePolicy.Release r = UpdatePolicy.parse(new JSONObject().put("versionCode", 12).put("versionName", "0.7.1").put("url", "x.apk")
                .put("sha256", SHA).put("signer", WOS.toUpperCase()).put("app", "ai.wizards.os"), FEED);
        assertNotNull(r);
        assertEquals(WOS, r.signer);
        assertEquals("ai.wizards.os", r.app);
        assertTrue(UpdatePolicy.appOk(r.app, "ai.wizards.os"));
        assertFalse(UpdatePolicy.appOk(r.app, "ai.wizards.os.qa"));
        assertTrue(UpdatePolicy.appOk("", "ai.wizards.os.qa"));
        assertNull("a malformed signer is refused", UpdatePolicy.parse(new JSONObject().put("versionCode", 12).put("versionName", "0.7.1")
                .put("url", "x.apk").put("sha256", SHA).put("signer", "nope"), FEED));
    }

    @Test
    public void signerMustBeExactlyThePinnedKey() {
        assertTrue(UpdatePolicy.signerOk(set(WOS), set(WOS), WOS, WOS));
        assertTrue("feed without a signer field", UpdatePolicy.signerOk(set(WOS), set(WOS), WOS, ""));
        assertTrue("QA: the debug key", UpdatePolicy.signerOk(set(DBG), set(DBG), DBG, null));
        assertFalse("update signed with another key", UpdatePolicy.signerOk(set(WOS), set(DBG), WOS, WOS));
        assertFalse("installed app is not the pinned key", UpdatePolicy.signerOk(set(DBG), set(DBG), WOS, ""));
        assertFalse("extra signer", UpdatePolicy.signerOk(set(WOS, DBG), set(WOS, DBG), WOS, ""));
        assertFalse("feed names a different signer", UpdatePolicy.signerOk(set(WOS), set(WOS), WOS, DBG));
        assertFalse("no pin", UpdatePolicy.signerOk(set(WOS), set(WOS), "", ""));
        assertFalse("empty update", UpdatePolicy.signerOk(set(WOS), set(), WOS, ""));
    }

    // next(newer, verified, unmetered, front, recording, silentOk, tapped)
    @Test
    public void nothingNewerDoesNothing() {
        assertEquals(UpdatePolicy.Step.NONE, UpdatePolicy.next(false, true, true, false, false, true, true));
    }

    @Test
    public void downloadsByItselfOnlyOnUnmeteredNetworks() {
        assertEquals(UpdatePolicy.Step.DOWNLOAD, UpdatePolicy.next(true, false, true, false, false, true, false));
        assertEquals(UpdatePolicy.Step.DOWNLOAD, UpdatePolicy.next(true, false, true, true, true, false, false));
        assertEquals(UpdatePolicy.Step.OFFER, UpdatePolicy.next(true, false, false, true, false, true, false));
        assertEquals("a tap downloads on mobile data", UpdatePolicy.Step.DOWNLOAD, UpdatePolicy.next(true, false, false, true, false, true, true));
    }

    @Test
    public void inFrontShowsOneBannerAndInstallsOnTap() {
        assertEquals(UpdatePolicy.Step.BANNER, UpdatePolicy.next(true, true, true, true, false, true, false));
        assertEquals(UpdatePolicy.Step.INSTALL, UpdatePolicy.next(true, true, true, true, false, true, true));
        assertEquals("tap before the first self-install: Android's confirm, with James looking",
                UpdatePolicy.Step.INSTALL, UpdatePolicy.next(true, true, false, true, false, false, true));
    }

    @Test
    public void backgroundInstallsSilentlyOnlyWhenAndroidWontAsk() {
        assertEquals(UpdatePolicy.Step.INSTALL, UpdatePolicy.next(true, true, true, false, false, true, false));
        assertEquals(UpdatePolicy.Step.WAIT_PERMISSION, UpdatePolicy.next(true, true, true, false, false, false, false));
    }

    @Test
    public void neverInterruptsARecording() {
        assertEquals(UpdatePolicy.Step.DEFER, UpdatePolicy.next(true, true, true, false, true, true, false));
        assertEquals(UpdatePolicy.Step.DEFER, UpdatePolicy.next(true, true, true, true, true, true, false));
        assertEquals("not even on a tap", UpdatePolicy.Step.DEFER, UpdatePolicy.next(true, true, true, true, true, true, true));
    }

    @Test
    public void silentOnlyOnApi31Plus() {
        assertEquals(2, UpdatePolicy.requireUserAction(31));
        assertEquals(2, UpdatePolicy.requireUserAction(35));
        assertEquals(0, UpdatePolicy.requireUserAction(30));
    }

    @Test
    public void failuresAreSpelledOut() {
        assertNull(UpdatePolicy.failureMessage(0, null));
        assertNull(UpdatePolicy.failureMessage(-1, null));
        assertEquals("Android blocked the update", UpdatePolicy.failureMessage(2, ""));
        assertTrue(UpdatePolicy.failureMessage(3, null).startsWith("Update cancelled"));
        assertEquals("The update conflicts with the installed app (INSTALL_FAILED_UPDATE_INCOMPATIBLE)",
                UpdatePolicy.failureMessage(5, "INSTALL_FAILED_UPDATE_INCOMPATIBLE"));
        assertEquals("Not enough storage for the update", UpdatePolicy.failureMessage(6, null));
        assertEquals("Update failed", UpdatePolicy.failureMessage(1, null));
        assertTrue(UpdatePolicy.failureMessage(1, new String(new char[300]).replace('\0', 'x')).length() < 160);
    }

    @Test
    public void backgroundNudgeOncePerVersion() {
        assertTrue(UpdatePolicy.mayPromptAgain(0, 12, false));
        assertFalse(UpdatePolicy.mayPromptAgain(12, 12, false));
        assertTrue(UpdatePolicy.mayPromptAgain(12, 12, true));
        assertTrue(UpdatePolicy.mayPromptAgain(12, 13, false));
    }

    @Test
    public void aPausedSideButtonOrFloatingOrbTakeHoldsTheUpdate() {
        // 10 Oct: James paused a side-button take, 0.8.4 installed itself (paused = no active RECORD_AUDIO op) and the take was gone.
        assertTrue(UpdatePolicy.takeLive(false, false, ai.wizards.os.MicOwner.SIDE, false));
        assertTrue(UpdatePolicy.takeLive(false, false, ai.wizards.os.MicOwner.EVERYWHERE, false));
        assertTrue(UpdatePolicy.takeLive(false, false, ai.wizards.os.MicOwner.MEETING, false));
        assertTrue(UpdatePolicy.takeLive(true, false, null, false));
        assertTrue(UpdatePolicy.takeLive(false, true, null, false));
        assertTrue(UpdatePolicy.takeLive(false, false, null, true));
        assertFalse(UpdatePolicy.takeLive(false, false, null, false));
        boolean live = UpdatePolicy.takeLive(false, false, ai.wizards.os.MicOwner.SIDE, false);
        assertEquals(UpdatePolicy.Step.DEFER, UpdatePolicy.next(true, true, true, false, live, true, false));
    }
}
