package ai.wizards.os.device;

import org.json.JSONObject;
import org.junit.Test;
import static org.junit.Assert.*;

public class WizardIdentityTest {
    @Test public void bootstrapUsesConfiguredName() throws Exception {
        JSONObject bootstrap = new JSONObject("{\"settings\":{\"agent\":{\"name\":\"  Saffron  \"}}}");
        assertEquals("Saffron", WizardIdentity.fromBootstrap(bootstrap));
    }

    @Test public void missingBlankAndMalformedIdentityUseWizard() throws Exception {
        for (String json : new String[]{"{}", "{\"settings\":null}", "{\"settings\":{\"agent\":{}}}",
                "{\"settings\":{\"agent\":{\"name\":null}}}", "{\"settings\":{\"agent\":{\"name\":42}}}",
                "{\"settings\":{\"agent\":{\"name\":\" \\t \\n \"}}}"}) {
            assertEquals(json, "Wizard", WizardIdentity.fromBootstrap(new JSONObject(json)));
        }
        assertEquals("Wizard", WizardIdentity.fromBootstrap(null));
        assertEquals("Wizard", WizardIdentity.name(null));
    }

    @Test public void unicodeAndPunctuationAreNotReplacedByOwnerIdentity() {
        assertEquals("Étoile 星", WizardIdentity.normalize(" Étoile\n星 "));
        assertEquals("O'Reilly", WizardIdentity.normalize("O'Reilly"));
    }

    @Test public void allProductionCopyUsesTheSameConfiguredOrFallbackName() {
        for (String input : new String[]{"Saffron", "Étoile 星", "", null}) {
            String name = WizardIdentity.normalize(input);
            assertEquals(name + " replied", WizardIdentity.replyTitle(input));
            assertEquals(name + " needs your approval to continue", WizardIdentity.approvalText(input));
            assertEquals("When " + name + " answers a chat you sent from Wizard OS", WizardIdentity.channelDescription(input));
            assertEquals(name + " · Hello", WizardIdentity.everywhereTitle(input, "Hello"));
            assertEquals("Voice request spoken to " + name + " through Wizard OS on an Android phone.", WizardIdentity.voicePrompt(input));
        }
    }

    @Test public void aRenameOrClearedSettingChangesTheNextRenderedCopy() throws Exception {
        JSONObject bootstrap = new JSONObject("{\"settings\":{\"agent\":{\"name\":\"Saffron\"}}}");
        assertEquals("Saffron replied", WizardIdentity.replyTitle(WizardIdentity.fromBootstrap(bootstrap)));
        bootstrap.getJSONObject("settings").getJSONObject("agent").put("name", "Nova");
        assertEquals("Nova replied", WizardIdentity.replyTitle(WizardIdentity.fromBootstrap(bootstrap)));
        bootstrap.getJSONObject("settings").getJSONObject("agent").remove("name");
        assertEquals("Wizard replied", WizardIdentity.replyTitle(WizardIdentity.fromBootstrap(bootstrap)));
    }
}
