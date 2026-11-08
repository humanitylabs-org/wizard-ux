package ai.wizards.os.everywhere;

import android.app.UiAutomation;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.io.File;
import java.io.FileOutputStream;
import java.lang.reflect.Method;
import java.lang.reflect.Proxy;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Consumer;
import static org.junit.Assert.*;

/** Real inherited onDictated caller + real outbox + system-bound AccessibilityService + cross-process editor.
 * No STT/network/mock insertion. Only synthetic transcripts; fixture Items have no meeting metadata.
 * The attached caller deliberately avoids onCreate's unrelated meeting sync/overlay/network startup.
 * Reflection keeps the same decisive tests compilable on the shipped and rejected source controls.
 */
@RunWith(AndroidJUnit4.class)
public class DictationInsertionE2eTest {
    private final android.app.Instrumentation instrumentation = InstrumentationRegistry.getInstrumentation();
    private final Context context = instrumentation.getTargetContext();
    private final Handler main = new Handler(Looper.getMainLooper());
    private File fixture, syntheticAudio;
    private Caller caller;
    private EverywhereOutbox outbox;
    private EverywhereOutbox.Item item;
    private final AtomicInteger terminals = new AtomicInteger();
    private final AtomicInteger verified = new AtomicInteger();
    private boolean legacy() { return InstrumentationRegistry.getArguments().getString("lane", "candidate").equals("control"); }
    public static final class Caller extends EverywhereService {
        void attach(Context context) { attachBaseContext(context); }
    }
    private void onMain(Runnable action) { instrumentation.runOnMainSync(action); }
    private interface Check { boolean ready() throws Exception; }
    private void await(String reason, Check check) throws Exception {
        long end = SystemClock.uptimeMillis() + 6000;
        while (SystemClock.uptimeMillis() < end) { if (check.ready()) return; SystemClock.sleep(20); }
        fail(reason + " fixture=" + (fixture.isFile() ? state() : "missing"));
    }
    private JSONObject state() throws Exception {
        return new JSONObject(new String(Files.readAllBytes(fixture.toPath()), StandardCharsets.UTF_8));
    }
    @Before public void before() throws Exception {
        assertTrue(ai.wizards.os.BuildConfig.DEBUG);
        assertTrue(android.os.Build.FINGERPRINT.contains("generic") || android.os.Build.MODEL.contains("sdk"));
        instrumentation.getUiAutomation(UiAutomation.FLAG_DONT_SUPPRESS_ACCESSIBILITY_SERVICES);
        fixture = new File(context.getFilesDir(), "dictation-fixture.json");
        onMain(() -> { caller = new Caller(); caller.attach(context); });
        await("real accessibility service connected", () -> WizardKeyboardService.get() != null);
    }
    private void editor(String mode, String text, int start, int end) throws Exception {
        fixture.delete();
        Intent intent = new Intent().setClassName(context.getPackageName(), "ai.wizards.os.everywhere.DictationEditorFixture")
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK)
                .putExtra("mode",mode).putExtra("text",text).putExtra("start",start).putExtra("end",end);
        context.startActivity(intent);
        await("companion editor ready", () -> fixture.isFile() && state().getString("mode").equals(mode));
        assertNotEquals("fixture must cross a real process boundary",android.os.Process.myPid(),state().getInt("pid"));
        // Wait for the actual IME lifecycle, not a fabricated connection or a sleep before dispatch.
        await("accessibility input editor bound", () -> {
            final boolean[] ready = {false};
            onMain(() -> {
                android.accessibilityservice.InputMethod method = WizardKeyboardService.get().getInputMethod();
                ready[0] = method != null && method.getCurrentInputEditorInfo() != null
                        && context.getPackageName().equals(method.getCurrentInputEditorInfo().packageName);
            }); return ready[0];
        });
        onMain(() -> context.getSystemService(ClipboardManager.class).setPrimaryClip(ClipData.newPlainText("fixture saved","saved clipboard")));
    }
    private void dispatch(String words) throws Exception {
        item = new EverywhereOutbox.Item(); item.id = "synthetic-" + UUID.randomUUID();
        item.source = EverywhereOutbox.SRC_DICTATION; item.text = words;
        item.createdAt = System.currentTimeMillis(); item.sessionId = "synthetic-unused";
        assertEquals("",item.meetingEvent);
        if (legacy()) {
            Method call = EverywhereService.class.getMethod("onDictated",EverywhereOutbox.Item.class,String.class);
            onMain(() -> { try { call.invoke(caller,item,words); } catch (Exception e) { throw new AssertionError(e); } });
            return;
        }
        File dir = new File(context.getFilesDir(),"dictation-tests/" + item.id + "/everywhere"); assertTrue(dir.mkdirs());
        // Valid 8 kHz mono PCM WAV silence, solely to exercise real recording custody/retention.
        // No decoder or STT uses it. It is not an owner's take or a server-response fixture.
        syntheticAudio = new File(dir.getParentFile(),"synthetic-silence.wav");
        java.nio.ByteBuffer wav = java.nio.ByteBuffer.allocate(300).order(java.nio.ByteOrder.LITTLE_ENDIAN);
        wav.put("RIFF".getBytes(StandardCharsets.US_ASCII)).putInt(292).put("WAVEfmt ".getBytes(StandardCharsets.US_ASCII))
                .putInt(16).putShort((short)1).putShort((short)1).putInt(8000).putInt(16000)
                .putShort((short)2).putShort((short)16).put("data".getBytes(StandardCharsets.US_ASCII)).putInt(256);
        Files.write(syntheticAudio.toPath(),wav.array()); item.audioPath = syntheticAudio.getAbsolutePath();
        ai.wizards.os.audio.CaptureJournal journal = ai.wizards.os.audio.CaptureJournal.at(dir.getParentFile());
        journal.register(item.id,item.source,"note",syntheticAudio,item.createdAt); journal.stopped(item.id);
        journal.hand(item.id,"everywhere-outbox");
        try (FileOutputStream output = new FileOutputStream(new File(dir,"outbox.json"))) {
            output.write(new JSONArray().put(item.json()).toString().getBytes(StandardCharsets.UTF_8)); output.getFD().sync();
        }
        outbox = new EverywhereOutbox(dir,"http://127.0.0.1:1"); item = outbox.item(item.id);
        Method call = EverywhereService.class.getMethod("onDictated",EverywhereOutbox.Item.class,String.class,boolean.class,Consumer.class);
        outbox.addListener((EverywhereOutbox.Listener) Proxy.newProxyInstance(EverywhereOutbox.Listener.class.getClassLoader(),
                new Class<?>[]{EverywhereOutbox.Listener.class}, (proxy, method, args) -> {
                    if (!method.getName().equals("onDictated")) return null;
                    @SuppressWarnings("unchecked") Consumer<Boolean> complete = (Consumer<Boolean>) args[3];
                    Consumer<Boolean> watched = success -> {
                        terminals.incrementAndGet(); if (success) verified.incrementAndGet(); complete.accept(success);
                    };
                    return call.invoke(caller,args[0],args[1],args[2],watched);
                }));
        invokeDelivery();
    }
    private void invokeDelivery() throws Exception {
        Method deliver = EverywhereOutbox.class.getDeclaredMethod("deliverDictation",EverywhereOutbox.Item.class); deliver.setAccessible(true);
        onMain(() -> { try { deliver.invoke(outbox,item); } catch (Exception e) { throw new AssertionError(e); } });
    }
    private void terminal(boolean success) throws Exception {
        if (legacy()) return;
        await("exactly one caller completion", () -> terminals.get() == 1);
        assertEquals(success ? 1 : 0,verified.get());
        if (success) {
            assertNull(outbox.item(item.id)); assertFalse("verified delivery releases its synthetic recording",syntheticAudio.exists());
        } else {
            assertNotNull(outbox.item(item.id)); assertEquals("failed",outbox.item(item.id).state);
            assertTrue("uncertain delivery keeps the original synthetic recording",syntheticAudio.isFile());
        }
        // A delayed watchdog/poll must not cause an extra terminal transition.
        SystemClock.sleep(1600); assertEquals(1,terminals.get());
    }
    private void inserted(String expected, int commits, int pastes) throws Exception {
        await("exact field text", () -> state().getString("text").equals(expected));
        assertEquals(commits,state().getInt("commits")); assertEquals(pastes,state().getInt("pastes"));
        assertEquals("other field",state().getString("other"));
    }
    @Test public void noopInputConnectionWorkingPastePreservesSingleInsertion() throws Exception {
        editor("noopIc","prefix ",7,7); dispatch("hello world"); terminal(true);
        inserted("prefix hello world ",legacy() ? 1 : 0,1);
    }
    @Test public void missingNodeWorkingInputConnectionPreservesSingleInsertion() throws Exception {
        editor("missingNode","prefix ",7,7); dispatch("hello world"); terminal(true);
        inserted("prefix hello world ",1,0);
    }
    @Test public void opaqueInputConnectionUsesWorkingPaste() throws Exception {
        editor("opaqueIc","prefix ",7,7); dispatch("hello world"); terminal(true); inserted("prefix hello world ",0,1);
    }
    @Test public void noopPasteNeverTriggersSecondCommitAndRetainsTake() throws Exception {
        editor("noopPaste","prefix ",7,7); dispatch("hello world"); terminal(false); inserted("prefix ",0,1);
        assertTrue(outbox.item(item.id).json().getBoolean("dictationAttempted"));
    }
    @Test public void falsePasteReplyWithLateMutationNeverTriggersSecondWrite() throws Exception {
        editor("latePaste","prefix ",7,7); dispatch("hello world"); terminal(false); inserted("prefix hello world ",0,1);
    }
    @Test public void delayedInputConnectionCompletesAfterEvidenceNotOnDispatch() throws Exception {
        editor("delayedIc","prefix ",7,7); dispatch("hello world");
        assertNotNull(outbox.item(item.id)); assertEquals(0,terminals.get());
        AtomicInteger beats = new AtomicInteger(); main.postDelayed(beats::incrementAndGet,30);
        SystemClock.sleep(80); assertEquals("main looper not sleeping through verification",1,beats.get());
        assertNotNull(outbox.item(item.id)); terminal(true); inserted("prefix hello world ",1,0);
    }
    @Test public void noopInputConnectionDoesNotBlindPaste() throws Exception {
        editor("noopOnlyIc","prefix ",7,7); dispatch("hello world"); terminal(false); inserted("prefix ",1,0);
    }
    @Test public void unrelatedPunctuationDoesNotVerifyExistingPhrase() throws Exception {
        editor("punctuation","hello",5,5); dispatch("hello"); terminal(false); inserted("hello!",0,1);
    }
    @Test public void caseOnlyChangeDoesNotVerifyExistingPhrase() throws Exception {
        editor("caseOnly","hello",5,5); dispatch("hello"); terminal(false); inserted("Hello",0,1);
    }
    @Test public void substringDoesNotVerifyInsertion() throws Exception {
        editor("substring","",0,0); dispatch("hello"); terminal(false); inserted("shelloworld",0,1);
    }
    @Test public void identicalSelectedPhraseCanVerifyWithoutWholeTextChange() throws Exception {
        editor("noopIc","left hello right",5,10); dispatch("hello"); terminal(true); inserted("left hello right",0,1);
        assertEquals(10,state().getInt("start")); assertEquals(10,state().getInt("end"));
    }
    @Test public void middleSelectionPreservesBothNeighborsAndBoundarySpace() throws Exception {
        editor("noopIc","left old right",5,8); dispatch("hello"); terminal(true); inserted("left hello right",0,1);
    }
    @Test public void hintIsNotExistingTextAndSentenceCapitalizationSurvives() throws Exception {
        editor("noopIc","",0,0); dispatch("hello world"); terminal(true); inserted("Hello world ",0,1);
    }
    @Test public void focusChangeDuringReadbackDoesNotVerifyDifferentField() throws Exception {
        editor("focusChange","prefix ",7,7); dispatch("hello world"); terminal(false); inserted("prefix hello world ",0,1);
    }
    @Test public void newerClipboardIsNotOverwrittenByRestore() throws Exception {
        editor("newClipboard","prefix ",7,7); dispatch("hello world"); terminal(true); inserted("prefix hello world ",0,1);
        final String[] clip = {null}; onMain(() -> clip[0] = context.getSystemService(ClipboardManager.class).getPrimaryClip().getItemAt(0).getText().toString());
        assertEquals("newer clipboard",clip[0]);
    }
    @Test public void persistedAttemptAfterRestartIsCopyOnlyNotAnotherInsertion() throws Exception {
        editor("noopPaste","prefix ",7,7); dispatch("hello world"); terminal(false);
        File file = new File(context.getFilesDir(),"dictation-tests/" + item.id + "/everywhere/outbox.json");
        EverywhereOutbox restarted = new EverywhereOutbox(file.getParentFile(),"http://127.0.0.1:1");
        assertTrue(restarted.item(item.id).json().getBoolean("dictationAttempted"));
        // Retry through the persisted outbox admission boundary, not a helper classification.
        AtomicInteger recovered = new AtomicInteger();
        Method call = EverywhereService.class.getMethod("onDictated",EverywhereOutbox.Item.class,String.class,boolean.class,Consumer.class);
        restarted.addListener((EverywhereOutbox.Listener) Proxy.newProxyInstance(EverywhereOutbox.Listener.class.getClassLoader(),
                new Class<?>[]{EverywhereOutbox.Listener.class}, (proxy, method, args) -> {
                    if (!method.getName().equals("onDictated")) return null;
                    assertEquals(false,args[2]);
                    @SuppressWarnings("unchecked") Consumer<Boolean> complete = (Consumer<Boolean>) args[3];
                    return call.invoke(caller,args[0],args[1],args[2],(Consumer<Boolean>) success -> {
                        assertFalse(success); recovered.incrementAndGet(); complete.accept(success);
                    });
                }));
        outbox = restarted; item = restarted.item(item.id); invokeDelivery();
        assertEquals(1,recovered.get()); assertNotNull(outbox.item(item.id)); inserted("prefix ",0,1);
    }
    @Test public void focusChangeBeforeDispatchCausesZeroEditorWrites() throws Exception {
        editor("focusBefore","prefix ",7,7); dispatch("hello world"); terminal(false); inserted("prefix ",0,0);
    }
    @Test public void unreadableSelectionsAndOpaqueConnectionNeverBlindWrite() throws Exception {
        editor("opaqueAll","prefix ",7,7); dispatch("hello world"); terminal(false); inserted("prefix ",0,0);
    }
    @Test public void wordBoundaryGetsOneLeadingAndOneTrailingSpace() throws Exception {
        editor("noopIc","prefix",6,6); dispatch("hello world"); terminal(true); inserted("prefix hello world ",0,1);
    }
    @Test public void sentenceBoundaryCapitalizesWithoutDroppingSpace() throws Exception {
        editor("noopIc","Done. ",6,6); dispatch("hello world"); terminal(true); inserted("Done. Hello world ",0,1);
    }
    @Test public void newlineBoundaryCapitalizesWithoutDeletingNewline() throws Exception {
        editor("noopIc","line\n",5,5); dispatch("hello world"); terminal(true); inserted("line\nHello world ",0,1);
    }
    @Test public void verifiedPasteRestoresSavedClipboard() throws Exception {
        editor("noopIc","prefix ",7,7); dispatch("hello world"); terminal(true);
        final String[] clip = {null};
        onMain(() -> clip[0] = context.getSystemService(ClipboardManager.class).getPrimaryClip().getItemAt(0).getText().toString());
        assertEquals("saved clipboard",clip[0]); inserted("prefix hello world ",0,1);
    }
    @Test public void noListenerRetainsPendingWordsInsteadOfDeleting() throws Exception {
        editor("noopIc","prefix ",7,7); dispatch("hello world"); terminal(true);
        // Independent durable item with no listener. No network and no editor action permitted.
        item = new EverywhereOutbox.Item(); item.id = "orphan-" + UUID.randomUUID(); item.source = EverywhereOutbox.SRC_DICTATION;
        item.createdAt = System.currentTimeMillis(); item.text = "synthetic recovery";
        File dir = new File(context.getFilesDir(),"dictation-tests/" + item.id + "/everywhere"); assertTrue(dir.mkdirs());
        Files.write(new File(dir,"outbox.json").toPath(),new JSONArray().put(item.json()).toString().getBytes(StandardCharsets.UTF_8));
        outbox = new EverywhereOutbox(dir,"http://127.0.0.1:1"); item = outbox.item(item.id); invokeDelivery();
        assertNotNull(outbox.item(item.id)); assertEquals("failed",item.state); inserted("prefix hello world ",0,1);
    }
}
