package ai.wizards.os.share;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.security.MessageDigest;

import static org.junit.Assert.*;

/** Synthetic bytes only. Exercises phone-private promotion; emulator still must prove external URI / bridge / service. */
public class UnifiedShareStoreTest {
    @Rule public TemporaryFolder tmp = new TemporaryFolder();

    private String hash(byte[] bytes) throws Exception {
        StringBuilder out = new StringBuilder();
        for (byte b : MessageDigest.getInstance("SHA-256").digest(bytes)) out.append(String.format("%02x", b & 255));
        return out.toString();
    }
    private void stage(ShareStore store) throws Exception {
        JSONArray files = new JSONArray();
        for (int n=0; n<2; n++) {
            byte[] bytes = ("synthetic-pdf-" + n).getBytes(StandardCharsets.UTF_8);
            File f = store.item("share-synthetic", n); f.getParentFile().mkdirs(); Files.write(f.toPath(),bytes);
            files.put(new JSONObject().put("n",n).put("name","file-"+n+".pdf").put("mime","application/pdf").put("bytes",bytes.length).put("sha256",hash(bytes)));
        }
        store.save("share-synthetic",new JSONObject().put("items",files).toString().getBytes(StandardCharsets.UTF_8));
    }
    private JSONObject request(int... indexes) throws Exception {
        JSONArray kept = new JSONArray(); for (int n:indexes) kept.put(n);
        return new JSONObject().put("shareId","share-synthetic").put("agent","synthetic-private").put("agentLabel","Synthetic Private")
                .put("thread","existing-synthetic").put("note","Owner comment").put("keptItemIndexes",kept);
    }
    @Test public void keptFileAgentExistingChatAndCommentSurviveStagingDeletionAndQueueReload() throws Exception {
        ShareStore store = new ShareStore(tmp.newFolder("staged")); File queueRoot = tmp.newFolder("queue"); ShareQueue queue = new ShareQueue(queueRoot); stage(store);
        String id = store.enqueue(queue,request(1)); JSONObject item = queue.load(id);
        assertEquals("synthetic-private",item.getString("agent")); assertEquals("existing-synthetic",item.getString("thread")); assertEquals("Owner comment",item.getString("note"));
        assertEquals(ShareQueue.READY,item.getString("state")); assertEquals(1,item.getJSONArray("files").length()); assertEquals("file-1.pdf",item.getJSONArray("files").getJSONObject(0).getString("name"));
        assertFalse("Ownership must move, not hard-link (denied by Android SELinux)", store.item("share-synthetic",1).exists());
        assertNull(store.meta("share-synthetic"));
        assertEquals("1.bin",queue.file(id,0).getName());
        assertEquals(hash("synthetic-pdf-1".getBytes(StandardCharsets.UTF_8)),hash(Files.readAllBytes(queue.file(id,0).toPath())));
        store.delete("share-synthetic");
        assertEquals("synthetic-pdf-1",new String(Files.readAllBytes(queue.file(id,0).toPath()),StandardCharsets.UTF_8));
        assertEquals(ShareQueue.READY,new ShareQueue(queueRoot).load(id).getString("state"));
        assertEquals(id,store.enqueue(queue,request(1))); assertEquals(1,queue.ids().size());
    }
    @Test public void reorderedSelectionAndLegacyQueueFilesResolveToTheirActualBytes() throws Exception {
        ShareStore store = new ShareStore(tmp.newFolder("staged")); File queueRoot = tmp.newFolder("queue"); ShareQueue queue = new ShareQueue(queueRoot); stage(store);
        String id = store.enqueue(queue,request(1,0));
        ShareQueue reloaded = new ShareQueue(queueRoot);
        for (int i=0;i<2;i++) assertEquals("synthetic-pdf-"+(1-i),new String(Files.readAllBytes(reloaded.file(id,i).toPath()),StandardCharsets.UTF_8));
        JSONObject legacy = new JSONObject().put("id","legacy").put("files",new JSONArray().put(new JSONObject()));
        queue.save(legacy); Files.write(queue.file("legacy",0).toPath(),"legacy-bytes".getBytes(StandardCharsets.UTF_8));
        assertEquals("0.bin",queue.file("legacy",0).getName()); assertEquals("legacy-bytes",new String(Files.readAllBytes(reloaded.file("legacy",0).toPath()),StandardCharsets.UTF_8));
        queue.dropCopies(id); assertFalse(queue.file(id,0).exists()); assertFalse(queue.file(id,1).exists());
    }
    @Test public void failedAtomicPromotionPreservesEveryOriginalAndRetriesWithoutDuplicate() throws Exception {
        ShareStore store = new ShareStore(tmp.newFolder("staged")); File queueRoot = tmp.newFolder("queue"); ShareQueue queue = new ShareQueue(queueRoot); stage(store);
        File conflict = new File(queueRoot,"and-share-synthetic"); assertTrue(conflict.mkdir());
        File sentinel = new File(conflict,"sentinel"); Files.write(sentinel.toPath(),"untouched".getBytes(StandardCharsets.UTF_8));
        try {store.enqueue(queue,request(1));fail("Conflicting destination accepted");} catch(java.io.IOException expected) { }
        assertNotNull(store.meta("share-synthetic")); assertEquals(0,queue.ids().size());
        for(int n=0;n<2;n++) assertEquals("synthetic-pdf-"+n,new String(Files.readAllBytes(store.item("share-synthetic",n).toPath()),StandardCharsets.UTF_8));
        assertEquals("untouched",new String(Files.readAllBytes(sentinel.toPath()),StandardCharsets.UTF_8)); assertTrue(sentinel.delete()); assertTrue(conflict.delete());
        // A real rename failure (moving a directory into itself) must also retain the complete source.
        ShareQueue impossible = new ShareQueue(new File(store.item("share-synthetic",0).getParentFile(),"nested"));
        try {store.enqueue(impossible,request(1));fail("Impossible atomic move accepted");} catch(java.io.IOException expected) { }
        assertEquals(0,impossible.ids().size()); assertNotNull(store.meta("share-synthetic"));
        for(int n=0;n<2;n++) assertEquals("synthetic-pdf-"+n,new String(Files.readAllBytes(store.item("share-synthetic",n).toPath()),StandardCharsets.UTF_8));
        // Crash checkpoint: manifest was fsynced in staging, but directory rename had not happened.
        Files.write(new File(store.item("share-synthetic",0).getParentFile(),"item.json").toPath(),"{\"id\":\"and-share-synthetic\",\"state\":\"ready\"}".getBytes(StandardCharsets.UTF_8));
        assertNull(queue.next());
        String id=store.enqueue(queue,request(1));
        assertEquals(id,store.enqueue(new ShareQueue(queueRoot),request(1))); assertEquals(1,queue.ids().size());
        assertEquals("synthetic-pdf-1",new String(Files.readAllBytes(queue.file(id,0).toPath()),StandardCharsets.UTF_8));
        queue.dropCopies(id); assertFalse(new File(queueRoot,id+"/0.bin").exists()); assertFalse(new File(queueRoot,id+"/1.bin").exists());
    }
    @Test public void failedManifestSaveDoesNotLoseStagedBytesOrPublishAnItem() throws Exception {
        ShareStore store = new ShareStore(tmp.newFolder("staged")); ShareQueue queue = new ShareQueue(tmp.newFolder("queue")); stage(store);
        File blocked = new File(store.item("share-synthetic",0).getParentFile(),"item.json.tmp"); assertTrue(blocked.mkdir());
        try {store.enqueue(queue,request(0));fail("Unwritable manifest accepted");} catch(java.io.IOException expected) { }
        assertEquals(0,queue.ids().size()); assertNotNull(store.meta("share-synthetic"));
        assertEquals("synthetic-pdf-0",new String(Files.readAllBytes(store.item("share-synthetic",0).toPath()),StandardCharsets.UTF_8));
        assertTrue(blocked.delete()); assertNotNull(store.enqueue(queue,request(0)));
    }
    @Test public void removedAllAndUnknownOrDuplicateIndexesAreRefusedWithoutLosingOriginals() throws Exception {
        ShareStore store = new ShareStore(tmp.newFolder("staged")); ShareQueue queue = new ShareQueue(tmp.newFolder("queue")); stage(store);
        for (int[] indexes : new int[][]{ {}, {2}, {0,0} }) {
            try { store.enqueue(queue,request(indexes)); fail("Invalid selection accepted"); } catch (java.io.IOException expected) { }
            assertEquals(0,queue.ids().size()); assertTrue(store.item("share-synthetic",0).isFile()); assertTrue(store.item("share-synthetic",1).isFile());
        }
        assertNotNull(store.enqueue(queue,request(0,1)));
    }
    @Test public void malformedShareIdAndAgentAreNotNormalizedIntoAValidTarget() throws Exception {
        ShareStore store = new ShareStore(tmp.newFolder("staged")); ShareQueue queue = new ShareQueue(tmp.newFolder("queue")); stage(store);
        for (JSONObject r : new JSONObject[]{request(0).put("shareId","../../share-synthetic"),request(0).put("agent","Synthetic Private"),request(0).put("thread","../../other")}) {
            try {store.enqueue(queue,r);fail("Invalid identifier accepted");}catch(java.io.IOException expected) { }
        }
        assertEquals(0,queue.ids().size());
    }
}
