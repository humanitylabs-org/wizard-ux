package ai.wizards.os;

import static org.junit.Assert.*;
import org.json.JSONArray;
import org.junit.Test;

public class KnownWizardsTest {
    @Test public void remembersEachWizardOnceWithItsName() throws Exception {
        String j = KnownWizards.add(null, "https://first.example");
        j = KnownWizards.name(j, "https://first.example", "  Archimedes ");
        j = KnownWizards.add(j, "https://second.example");
        j = KnownWizards.add(j, "https://first.example"); // switching back keeps the name, moves it last
        JSONArray all = new JSONArray(j);
        assertEquals(2, all.length());
        assertEquals("https://first.example", all.getJSONObject(1).getString("url"));
        assertEquals("Archimedes", all.getJSONObject(1).getString("name"));
        JSONArray others = new JSONArray(KnownWizards.others(j, "https://second.example"));
        assertEquals(1, others.length());
        assertEquals("Archimedes", others.getJSONObject(0).getString("name"));
        assertEquals(0, new JSONArray(KnownWizards.others(KnownWizards.add(null, "https://only.example"), "https://only.example")).length());
    }
    @Test public void boundedAndForgiving() throws Exception {
        String j = "not json";
        for (int i = 0; i < 30; i++) j = KnownWizards.add(j, "https://w" + i + ".example");
        assertEquals(KnownWizards.MAX, new JSONArray(j).length());
        assertEquals("https://w29.example", new JSONArray(j).getJSONObject(KnownWizards.MAX - 1).getString("url"));
        assertEquals(KnownWizards.add(j, ""), KnownWizards.add(j, null));
        String named = KnownWizards.name(j, "https://w29.example", "a\nb" + "x".repeat(80));
        String n = new JSONArray(named).getJSONObject(KnownWizards.MAX - 1).getString("name");
        assertTrue(n.length() <= KnownWizards.NAME);
        assertFalse(n.contains("\n"));
        assertEquals("", new JSONArray(KnownWizards.name(null, "https://x.example", "   ")).getJSONObject(0).getString("name"));
    }
    @Test public void previousFromAnOlderInstallIsKept() throws Exception {
        JSONArray j = new JSONArray(KnownWizards.withPrevious(null, "https://old.example"));
        assertEquals("https://old.example", j.getJSONObject(0).getString("url"));
        String named = KnownWizards.name(null, "https://old.example", "Old");
        assertEquals(named, KnownWizards.withPrevious(named, "https://old.example"));
        assertEquals("[]", KnownWizards.withPrevious(null, null));
    }
}
