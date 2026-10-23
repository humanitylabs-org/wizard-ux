package ai.wizards.os;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import static org.junit.Assert.*;

public class ScrollDiagnosticsRingTest {
    @Test public void retainsNewest400InOrder() throws Exception {
        ScrollDiagnosticsRing r=new ScrollDiagnosticsRing();
        for(int i=0;i<900;i++)r.add(i,"main","scrollBy",new JSONObject().put("y",i),null);
        assertEquals(400,r.size());
        JSONObject out=new JSONObject(r.json(new JSONObject()));JSONArray a=out.getJSONArray("events");
        assertEquals(400,a.length());assertEquals(501,a.getJSONObject(0).getLong("seq"));
        assertEquals(900,a.getJSONObject(399).getLong("seq"));assertEquals(1,out.getInt("schema"));
    }
    @Test public void serializesStructuredDataAndEscaping() throws Exception {
        ScrollDiagnosticsRing r=new ScrollDiagnosticsRing();
        r.add(42,"Binder:1","canScrollVertically",new JSONObject().put("result",true),
            new JSONArray().put("android.view.ViewRootImpl.probe"));
        JSONObject e=new JSONObject(r.json(new JSONObject().put("model","test\"model"))).getJSONArray("events").getJSONObject(0);
        assertEquals(42,e.getLong("uptimeMs"));assertEquals("Binder:1",e.getString("thread"));
        assertTrue(e.getJSONObject("data").getBoolean("result"));assertEquals(1,e.getJSONArray("callers").length());
    }
    @Test public void capsUtf8PayloadWithoutMutatingRing() throws Exception {
        ScrollDiagnosticsRing r=new ScrollDiagnosticsRing();
        for(int i=0;i<400;i++)r.add(i,"main","probe",new JSONObject().put("reason","α".repeat(1000)),null);
        String json=r.json(new JSONObject());
        assertTrue(json.getBytes(java.nio.charset.StandardCharsets.UTF_8).length<=240*1024);
        assertEquals(400,r.size());
        JSONArray a=new JSONObject(json).getJSONArray("events");
        assertEquals(400,a.getJSONObject(a.length()-1).getLong("seq"));
    }
}
