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
        assertTrue(Files.isSameFile(store.item("share-synthetic",1).toPath(),queue.file(id,0).toPath()));
        store.delete("share-synthetic");
        assertEquals("synthetic-pdf-1",new String(Files.readAllBytes(queue.file(id,0).toPath()),StandardCharsets.UTF_8));
        assertEquals(ShareQueue.READY,new ShareQueue(queueRoot).load(id).getString("state"));
        assertEquals(id,store.enqueue(queue,request(1))); assertEquals(1,queue.ids().size());
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
