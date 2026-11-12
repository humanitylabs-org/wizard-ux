package ai.wizards.os.downloads;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.json.JSONObject;
import org.junit.Test;

import java.util.ArrayList;
import java.util.List;

public class DownloadsPolicyTest {
    private static DownloadsPolicy.Item item(long id, String status, long started) {
        DownloadsPolicy.Item it = new DownloadsPolicy.Item();
        it.id = id; it.name = "f" + id + ".pdf"; it.status = status; it.started = started;
        return it;
    }

    @Test public void serverNameWinsOverTheUrlsRandomId() { // issue 1342: Messenger's header carried the real name
        // Messenger web.py for a long or non-ASCII name: a safe ASCII filename plus the real one in filename*.
        String h = "attachment; filename=\"R_sum_long.pdf\"; filename*=UTF-8''R%C3%A9sum%C3%A9%20long.pdf";
        assertEquals("Résumé long.pdf", DownloadsPolicy.dispositionName(h));
        assertEquals("report.pdf", DownloadsPolicy.dispositionName("attachment; filename=\"report.pdf\""));
        assertEquals("report.pdf", DownloadsPolicy.dispositionName("inline; filename=report.pdf"));
        assertEquals("a;b.pdf", DownloadsPolicy.dispositionName("attachment; filename=\"a;b.pdf\""));
        assertEquals("x\"y.pdf", DownloadsPolicy.dispositionName("attachment; FILENAME=\"x\\\"y.pdf\""));
        assertEquals("caf\u00e9.txt", DownloadsPolicy.dispositionName("attachment; filename*=iso-8859-1'en'caf%E9.txt"));
        // unreadable filename* falls back to filename; no name at all is null (Android's guess then applies)
        assertEquals("plain.pdf", DownloadsPolicy.dispositionName("attachment; filename*=UTF-8''bad%G1; filename=\"plain.pdf\""));
        assertEquals("plain.pdf", DownloadsPolicy.dispositionName("attachment; filename*=KOI8-R''x; filename=plain.pdf"));
        assertEquals(null, DownloadsPolicy.dispositionName("attachment"));
        assertEquals(null, DownloadsPolicy.dispositionName(null));
        assertEquals(null, DownloadsPolicy.dispositionName("attachment; filename=\"\""));
    }

    @Test public void savedNamesAreSafeOnDisk() {
        assertEquals("a_b_c.pdf", DownloadsPolicy.saveName("a:b?c.pdf"));
        assertEquals("evil.txt", DownloadsPolicy.saveName("../../evil.txt"));
        assertEquals("_profile", DownloadsPolicy.saveName(".profile"));
        assertEquals("Résumé.pdf", DownloadsPolicy.saveName("Résumé.pdf"));
        assertEquals("download", DownloadsPolicy.saveName(null));
    }

    @Test public void downloadsSkipAndroidsPopUpWhenWizardShowsThem() throws Exception { // issue 1342
        String main = new String(java.nio.file.Files.readAllBytes(java.nio.file.Paths.get("src/main/java/ai/wizards/os/MainActivity.java")), "UTF-8");
        assertTrue(main.contains("shellShows ? android.app.DownloadManager.Request.VISIBILITY_HIDDEN"));
        assertTrue(main.contains("DownloadsPolicy.dispositionName(disposition)"));
        String manifest = new String(java.nio.file.Files.readAllBytes(java.nio.file.Paths.get("src/main/AndroidManifest.xml")), "UTF-8");
        assertTrue(manifest.contains("android.permission.DOWNLOAD_WITHOUT_NOTIFICATION")); // VISIBILITY_HIDDEN throws without it
    }

    @Test public void namesAreSafeToShow() {
        assertEquals("report.pdf", DownloadsPolicy.displayName("/sdcard/Download/report.pdf"));
        assertEquals("evil.txt", DownloadsPolicy.displayName("..\\..\\evil.txt"));
        assertEquals("download", DownloadsPolicy.displayName(".."));
        assertEquals("download", DownloadsPolicy.displayName(null));
        assertEquals("a b.pdf", DownloadsPolicy.displayName("a\nb.pdf"));
        String n = DownloadsPolicy.displayName("x".repeat(300) + ".pdf");
        assertEquals(DownloadsPolicy.MAX_NAME, n.length());
        assertTrue(n.endsWith(".pdf"));
    }

    @Test public void downloadManagerStatusMapsToWords() {
        assertEquals("done", DownloadsPolicy.status(8));
        assertEquals("failed", DownloadsPolicy.status(16));
        assertEquals("running", DownloadsPolicy.status(2));
        assertEquals("paused", DownloadsPolicy.status(4));
        assertEquals("pending", DownloadsPolicy.status(1));
        assertEquals("pending", DownloadsPolicy.status(99));
    }

    @Test public void idsAreDigitsOnly() {
        assertEquals(42, DownloadsPolicy.parseId("42"));
        for (String bad : new String[]{null, "", "-1", "4 2", "4;2", "../1", "1234567890123456789", "0x10"})
            assertEquals(bad, -1, DownloadsPolicy.parseId(bad));
    }

    @Test public void specificTypeWinsOtherwiseTheFileNameDecides() {
        assertEquals("application/pdf", DownloadsPolicy.openMime("application/pdf", "x.bin"));
        assertEquals("application/pdf", DownloadsPolicy.openMime("application/pdf; charset=binary", "x"));
        assertEquals("application/pdf", DownloadsPolicy.openMime("application/octet-stream", "Plan.PDF"));
        assertEquals("application/pdf", DownloadsPolicy.openMime(null, "plan.pdf"));
        assertEquals("image/jpeg", DownloadsPolicy.openMime("*/*", "pic.jpeg"));
        assertEquals("application/octet-stream", DownloadsPolicy.openMime("", "mystery"));
        assertEquals("application/octet-stream", DownloadsPolicy.openMime("not a type", "mystery"));
    }

    @Test public void listKeepsThirtyNewestAndNeverDropsARunningOne() {
        List<DownloadsPolicy.Item> items = new ArrayList<>();
        for (int i = 0; i < 40; i++) items.add(item(i, "done", 1000 + i));
        items.add(item(100, "running", 1)); // oldest of all, still downloading
        List<DownloadsPolicy.Item> out = DownloadsPolicy.trim(items);
        assertEquals(31, out.size());
        assertEquals(39, out.get(0).id);                       // newest first
        assertTrue(out.stream().anyMatch(i -> i.id == 100));    // in-flight kept
        assertFalse(out.stream().anyMatch(i -> i.id == 0));     // oldest finished dropped
    }

    @Test public void listSurvivesStorageRoundTrip() {
        DownloadsPolicy.Item a = item(7, "running", 5000);
        a.total = 1000; a.got = 250; a.mime = "application/pdf";
        List<DownloadsPolicy.Item> back = DownloadsPolicy.parse(DownloadsPolicy.serialize(List.of(a)));
        assertEquals(1, back.size());
        assertEquals(7, back.get(0).id);
        assertEquals(1000, back.get(0).total);
        assertEquals(250, back.get(0).got);
        assertEquals("running", back.get(0).status);
        assertEquals(0, DownloadsPolicy.parse("not json").size());
        assertEquals(0, DownloadsPolicy.parse(null).size());
    }

    @Test public void pageJsonIsInertAndCarriesWhatTheSheetNeeds() throws Exception {
        DownloadsPolicy.Item a = item(9, "done", 1);
        a.name = "q\"</script>\u2028.pdf"; a.total = 4_700_000; a.got = 4_700_000; a.finished = 2;
        String json = DownloadsPolicy.eventJson("done", a);
        assertFalse(json.contains("</script>"));
        assertFalse(json.contains("\u2028"));
        JSONObject o = new JSONObject(json);
        assertEquals("done", o.getString("type"));
        assertEquals("9", o.getJSONObject("item").getString("id"));
        assertEquals(4_700_000, o.getJSONObject("item").getLong("size"));
        assertEquals("sync", new JSONObject(DownloadsPolicy.eventJson("sync", null)).getString("type"));
        JSONObject list = new JSONObject(DownloadsPolicy.listJson(List.of(a)));
        assertEquals(1, list.getJSONArray("items").length());
    }
}
