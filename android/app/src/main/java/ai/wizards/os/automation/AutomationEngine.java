package ai.wizards.os.automation;

import android.accessibilityservice.AccessibilityService;
import android.accessibilityservice.GestureDescription;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Path;
import android.graphics.Rect;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.util.Log;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import ai.wizards.os.BuildConfig;
import ai.wizards.os.everywhere.WizardKeyboardService;

/**
 * device.automation v1: a generic accessibility-automation capability. Records taps and typing in one named target
 * app, replays steps by text match, reads the target's screen, and shows a cover with progress or confirm states.
 * It knows nothing about food, recipes, names or voice phrases: those are the caller's (web/usuals.js + web/food/).
 *
 * Money safety is enforced here for every caller and is not configurable: a replay step can never name a commit
 * button ({@link AutomationPolicy#steps}), a matched control that is or wraps one stops the run, recording never
 * replays the user's own commit tap, and the only path that presses a commit button is {@link #confirm()}, reached
 * solely from a real touch on the cover's confirm button (no bridge method calls it).
 *
 * Outcomes (a finished recording, a run that reached confirm/failed/committed) are kept in a small durable outbox
 * until web takes and acknowledges them, because they usually finish while the Wizard OS page is paused.
 */
public final class AutomationEngine implements AutomationCover.Listener {
    public static final String TAG = "WizardAutomation";
    private static AutomationEngine instance;

    public static synchronized AutomationEngine get(Context c) {
        if (instance == null) instance = new AutomationEngine(c.getApplicationContext());
        return instance;
    }

    public enum Mode { IDLE, RECORDING, REPLAYING, CONFIRM, COMMITTING, DONE, FAILED }

    private static final String PREFS = "automation", OUTBOX = "outbox", SHORTCUTS = "shortcuts";
    private static final int MAX_OUTBOX = 20;
    private static final long AWAY_MS = 20 * 60 * 1000L;

    private final Context app;
    private final Handler main = new Handler(Looper.getMainLooper());
    private Mode mode = Mode.IDLE;
    private String pkg = "", ref = "";
    private JSONObject words = new JSONObject();
    private List<String> ambiguous = new ArrayList<>();
    private boolean returnTo;
    private AutomationCover cover;
    private final List<String> log = new ArrayList<>();

    // recording
    private final JSONArray events = new JSONArray();
    private int taps;
    private String lastSig = "";
    private List<String> lastCommitScreen;
    private long awaySince;
    private String commitLabel;
    private boolean atCommitScreen;
    private final Runnable watch = this::watchScreen;

    // replay
    private List<AutomationPolicy.Step> steps = new ArrayList<>();
    private int stepIdx, scrolls;
    private long stepStarted;
    private boolean scrollUp;
    private AccessibilityNodeInfo pendingEnter;
    private String total;
    private final Runnable tick = this::step;

    private AutomationEngine(Context app) { this.app = app; }

    /* ------------------------------------------------------------------ readiness */

    public Mode mode() { return mode; }

    /** Any active automation (legacy Food runner checks this so the two never drive an app at once). */
    public boolean busy() { return mode == Mode.RECORDING || mode == Mode.REPLAYING || mode == Mode.CONFIRM || mode == Mode.COMMITTING; }

    static boolean installed(Context c, String p) {
        try { c.getPackageManager().getPackageInfo(p, 0); return true; } catch (Exception e) { return false; }
    }

    private static boolean legacyBusy(Context c) {
        ai.wizards.os.usuals.UsualsRunner.Mode m = ai.wizards.os.usuals.UsualsRunner.get(c).mode();
        return m == ai.wizards.os.usuals.UsualsRunner.Mode.TEACHING || m == ai.wizards.os.usuals.UsualsRunner.Mode.RUNNING
                || m == ai.wizards.os.usuals.UsualsRunner.Mode.READY || m == ai.wizards.os.usuals.UsualsRunner.Mode.ORDERING;
    }

    /** "" when an automation of {@code p} can start, else the one thing missing (a code web turns into words). */
    public String blocker(String p) {
        if (!AutomationPolicy.target(p, BuildConfig.DEBUG, app.getPackageName())) return "target-not-allowed";
        if (!WizardKeyboardService.enabled(app) || A11yNodes.svc() == null) return "accessibility";
        if (!installed(app, p)) return "not-installed";
        if (busy() || legacyBusy(app)) return "busy";
        return "";
    }

    public JSONObject status(String p) throws JSONException {
        JSONObject o = new JSONObject().put("v", 1).put("mode", mode.name().toLowerCase(java.util.Locale.ROOT))
                .put("ref", ref).put("package", pkg).put("step", stepIdx).put("steps", steps.size()).put("taps", taps)
                .put("accessibility", WizardKeyboardService.enabled(app) && A11yNodes.svc() != null)
                .put("outbox", outbox().length());
        if (p != null && !p.isEmpty()) {
            boolean allowed = AutomationPolicy.target(p, BuildConfig.DEBUG, app.getPackageName());
            o.put("target", new JSONObject().put("package", p).put("allowed", allowed)
                    .put("installed", allowed && installed(app, p)).put("blocker", blocker(p)));
        }
        JSONArray l = new JSONArray();
        for (String s : log.subList(Math.max(0, log.size() - 40), log.size())) l.put(s);
        return o.put("log", l);
    }

    private void note(String s) {
        log.add(s);
        if (log.size() > 200) log.subList(0, log.size() - 200).clear();
        Log.i(TAG, s);
    }

    private String w(String key, String fallback) { return AutomationPolicy.word(words, key, fallback); }

    private void configure(JSONObject p) {
        words = p.optJSONObject("words") == null ? new JSONObject() : p.optJSONObject("words");
        ambiguous = AutomationPolicy.ambiguous(p.optJSONArray("ambiguous"));
        returnTo = p.optBoolean("returnToWizard", false);
        ref = p.optString("ref", "");
        if (ref.length() > 64) ref = ref.substring(0, 64);
    }

    /* ------------------------------------------------------------------ record */

    /** Opens the target fresh and writes down the user's taps and typing until he commits, taps Done or cancels. */
    public String record(JSONObject p) {
        String target = p.optString("package", "");
        String b = blocker(target);
        if (!b.isEmpty()) return b;
        stopQuietly();
        configure(p);
        pkg = target;
        clearRecording();
        steps = new ArrayList<>();
        mode = Mode.RECORDING;
        note("record start " + pkg + " ref=" + ref);
        launchFresh(pkg);
        showRecordingCard();
        main.removeCallbacks(watch);
        main.postDelayed(watch, 1200);
        return "";
    }

    private void clearRecording() {
        while (events.length() > 0) events.remove(events.length() - 1);
        taps = 0; lastSig = ""; lastCommitScreen = null; awaySince = 0; commitLabel = null; atCommitScreen = false; total = null;
    }

    private void showRecordingCard() {
        cover().showRecording(w("recordLabel", "Recording"), w("recordName", ""), recordingLine(),
                w("recordCancel", "Cancel"), w("recordDone", "Done"), w("recordDoneDesc", "Done"));
    }

    private String recordingLine() {
        return taps == 0 ? w("recordEmpty", "0 steps") : AutomationPolicy.fill(w("recordCount", "{n} steps"), "n", String.valueOf(taps));
    }

    /** Done on the recording card. */
    @Override public void finishRecording() { finishRecording(false); }

    private void finishRecording(boolean committed) {
        if (mode != Mode.RECORDING) return;
        main.removeCallbacks(watch);
        if (!committed) sample();
        List<String> seen = lastCommitScreen != null ? lastCommitScreen : screenTexts(pkg);
        String t = AutomationPolicy.total(lastCommitScreen != null ? lastCommitScreen
                : commitLabel != null ? java.util.Collections.singletonList(commitLabel) : seen);
        JSONObject out = outcome("recording");
        try {
            out.put("events", new JSONArray(events.toString())).put("committed", committed)
                    .put("checkout", lastCommitScreen == null ? JSONObject.NULL : toArray(lastCommitScreen))
                    .put("total", t == null ? "" : t);
        } catch (JSONException ignored) { }
        keep(out);
        note("record end: " + events.length() + " events, taps=" + taps + (committed ? ", committed by the user" : ""));
        mode = Mode.IDLE;
        if (committed) {
            cover().showSaved(w("savedTitle", "Saved ✓"), w("savedName", ""), w("savedOk", "OK"), w("savedOpen", "Open"), w("savedOpenDesc", "Open Wizard OS"));
            main.postDelayed(() -> { if (mode == Mode.IDLE && cover != null && cover.showingSaved()) cover.hide(); }, 7000);
        } else {
            if (cover != null) cover.hide();
            if (returnTo) openWizard();
        }
    }

    private void watchScreen() {
        if (mode != Mode.RECORDING) return;
        sample();
        if (mode == Mode.RECORDING) main.postDelayed(watch, 700);
    }

    /** Which screen is up (fingerprint, for the caller to take detours out) and, on a commit screen, its texts. */
    private void sample() {
        A11yNodes.fresh();
        AccessibilityNodeInfo root = A11yNodes.root(A11yNodes.svc(), pkg);
        long now = SystemClock.uptimeMillis();
        if (root == null) {
            if (awaySince == 0) { awaySince = now; if (cover != null) cover.recordingVisible(false); }
            else if (now - awaySince > AWAY_MS) {
                if (lastCommitScreen != null) { note("record: away 20 min after a commit screen → keeping"); finishRecording(true); if (cover != null) cover.hide(); }
                else { note("record: away 20 min, dropped"); stopQuietly(); }
            }
            return;
        }
        if (awaySince != 0 && cover != null) cover.recordingVisible(true);
        awaySince = 0;
        List<String> parts = new ArrayList<>(), all = new ArrayList<>();
        boolean[] commit = {false};
        A11yNodes.walkScreen(root, 0, false, parts, all, commit);
        String sig = AutomationPolicy.sig(parts);
        if (commit[0]) lastCommitScreen = all;
        if (sig.isEmpty() || sig.equals(lastSig)) return;
        // From a commit screen to a never-seen screen with no tap since: the target's commit control (a swipe, a
        // custom view) didn't report its tap, and this is what follows a commit. Confirm a moment later.
        if (atCommitScreen && !commit[0] && !seenSig(sig) && !tappedSinceScreen()) {
            final String to = sig;
            final long seenAt = now;
            main.postDelayed(() -> {
                if (mode != Mode.RECORDING) return;
                if (tappedSinceScreen()) { addScreen(to, seenAt); return; }
                if (!to.equals(lastSig)) return;
                note("record: commit screen → new screen without a tap → treating as committed");
                addScreen(to, SystemClock.uptimeMillis());
                finishRecording(true);
            }, 600);
            atCommitScreen = false;
            lastSig = sig;
            return;
        }
        atCommitScreen = commit[0];
        lastSig = sig;
        addScreen(sig, now);
    }

    private void addScreen(String sig, long t) {
        if (events.length() >= AutomationPolicy.MAX_EVENTS) return;
        try { events.put(new JSONObject().put("t", t).put("screen", sig)); } catch (JSONException ignored) { }
    }

    private void addStep(String type, String label, String id, String near, long t) {
        if (events.length() >= AutomationPolicy.MAX_EVENTS) return;
        try {
            events.put(new JSONObject().put("t", t).put("step", new JSONObject().put("type", type).put("label", label)
                    .put("id", id).put("near", near)));
        } catch (JSONException ignored) { }
    }

    private boolean seenSig(String sig) {
        for (int i = 0; i < events.length(); i++) if (sig.equals(events.optJSONObject(i).optString("screen", null))) return true;
        return false;
    }

    private boolean tappedSinceScreen() {
        long shown = -1;
        for (int i = events.length() - 1; i >= 0; i--) { JSONObject e = events.optJSONObject(i); if (e.has("screen")) { shown = e.optLong("t"); break; } }
        for (int i = events.length() - 1; i >= 0; i--) {
            JSONObject e = events.optJSONObject(i), s = e.optJSONObject("step");
            if (s != null && "tap".equals(s.optString("type")) && e.optLong("t") >= shown) return true;
        }
        return false;
    }

    /** Every accessibility event; only taps and typing inside the target, and only while recording. */
    public void onEvent(AccessibilityEvent e) {
        if (mode != Mode.RECORDING || e == null) return;
        CharSequence from = e.getPackageName();
        if (from == null || !pkg.contentEquals(from)) return;
        int t = e.getEventType();
        long at = e.getEventTime() > 0 ? e.getEventTime() : SystemClock.uptimeMillis();
        if (t == AccessibilityEvent.TYPE_VIEW_CLICKED) {
            AccessibilityNodeInfo n = e.getSource();
            String label = n != null ? A11yNodes.labelOf(n) : "";
            if (label.isEmpty() && e.getText() != null && !e.getText().isEmpty()) label = String.valueOf(e.getText().get(0));
            if (label.isEmpty() && e.getContentDescription() != null) label = e.getContentDescription().toString();
            if (n != null && n.isEditable()) return; // the typing step finds the field again
            if (AutomationPolicy.isCommit(label)) {
                // The user committed in the target himself: the end of the recording, and never a replay step.
                note("record: user tapped a commit button → finished");
                commitLabel = label;
                main.post(() -> finishRecording(true));
                return;
            }
            String id = n != null && n.getViewIdResourceName() != null ? n.getViewIdResourceName() : "";
            boolean amb = n != null && AutomationPolicy.isAmbiguous(label, ambiguous);
            if (amb) A11yNodes.fresh();
            String near = amb ? A11yNodes.rowText(n, label, ambiguous) : "";
            addStep("tap", clip(label), clip(id), clip(near), at);
            taps++;
            if (cover != null) cover.recordingLine(recordingLine());
        } else if (t == AccessibilityEvent.TYPE_VIEW_TEXT_CHANGED) {
            AccessibilityNodeInfo n = e.getSource();
            String text = n != null && n.getText() != null ? n.getText().toString()
                    : e.getText() != null && !e.getText().isEmpty() ? String.valueOf(e.getText().get(0)) : "";
            if (n != null && n.getHintText() != null && text.contentEquals(n.getHintText())) text = "";
            addStep("type", clip(text), "", "", at);
        }
    }

    private static String clip(String s) { return s == null ? "" : s.length() > AutomationPolicy.MAX_LABEL ? s.substring(0, AutomationPolicy.MAX_LABEL) : s; }

    /* ------------------------------------------------------------------ replay */

    /** Opens the target fresh and replays {@code steps} under the cover; stops at the confirm state. */
    public String replay(JSONObject p) {
        String target = p.optString("package", "");
        String b = blocker(target);
        if (!b.isEmpty()) return b;
        List<AutomationPolicy.Step> s;
        try { s = AutomationPolicy.steps(p.optJSONArray("steps")); }
        catch (AutomationPolicy.Refusal r) { note("replay refused: " + r.code); return r.code; }
        stopQuietly();
        configure(p);
        pkg = target;
        steps = s;
        clearRecording();
        stepIdx = 0; scrolls = 0; scrollUp = false; pendingEnter = null; stepStarted = SystemClock.uptimeMillis();
        mode = Mode.REPLAYING;
        note("replay start " + pkg + " ref=" + ref + " (" + steps.size() + " steps)");
        progress(w("opening", "Opening"));
        launchFresh(pkg);
        main.postDelayed(tick, 1500);
        return "";
    }

    private void progress(String what) {
        int of = steps.size();
        String sub = of == 0 ? what : AutomationPolicy.fill(w("progress", "Step {step} of {of} · {what}"),
                "step", String.valueOf(Math.min(stepIdx + 1, of)), "of", String.valueOf(of), "what", what);
        cover().showProgress(w("runningTitle", "Working"), sub, stepIdx, of, w("cancel", "Cancel"));
    }

    private String describe(AutomationPolicy.Step st) {
        if (!st.say.isEmpty()) return st.say;
        switch (st.type) {
            case "type": return "“" + st.label + "”";
            case "wait": return "…";
            case "enter": return "⏎";
            default: return "“" + (st.label.isEmpty() ? st.id : st.label) + "”";
        }
    }

    private void step() {
        if (mode != Mode.REPLAYING) return;
        WizardKeyboardService s = A11yNodes.svc();
        if (s == null) { fail("accessibility-off", ""); return; }
        if (stepIdx >= steps.size()) { reachConfirm(); return; }
        AutomationPolicy.Step st = steps.get(stepIdx);
        long waited = SystemClock.uptimeMillis() - stepStarted;
        progress(describe(st));
        A11yNodes.fresh();
        AccessibilityNodeInfo root = A11yNodes.root(s, pkg);
        if (root == null) {
            if (waited > 20000) { fail("not-open", ""); return; }
            again(500); return;
        }
        switch (st.type) {
            case "wait": next(Math.min(10000, Integer.parseInt(st.label))); return;
            case "enter": {
                AccessibilityNodeInfo f = A11yNodes.focusedEditable(root);
                if (f != null && A11yNodes.imeEnter(f)) { note("step " + stepIdx + " enter"); next(1200); return; }
                note("step " + stepIdx + " enter: no field, skipped"); next(300); return;
            }
            case "type": {
                AccessibilityNodeInfo f = A11yNodes.focusedEditable(root);
                if (f == null) f = A11yNodes.firstEditable(root, 0);
                if (f == null) {
                    if (waited > AutomationPolicy.stepBudgetMs(st)) { fail("no-field", ""); return; }
                    again(500); return;
                }
                f.performAction(AccessibilityNodeInfo.ACTION_FOCUS);
                Bundle a = new Bundle();
                a.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, st.label);
                boolean ok = f.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, a);
                note("step " + stepIdx + " typed " + (ok ? "ok" : "refused"));
                if (!ok) { fail("type-refused", ""); return; }
                pendingEnter = f;
                next(1500);
                return;
            }
            default: break;
        }
        Match m = find(root, st);
        if (m != null) {
            // The boundary, enforced on the live node whatever the recipe said.
            if (A11yNodes.spends(m.click, m.node)) { fail("commit", A11yNodes.labelOf(m.click)); return; }
            boolean ok = m.click.performAction(AccessibilityNodeInfo.ACTION_CLICK);
            if (!ok) ok = tapAt(s, m.click);
            note("step " + stepIdx + " tap “" + st.label + "” → " + (ok ? "ok" : "refused") + " (score " + m.score + ")");
            pendingEnter = null;
            if (!ok) { fail("tap-refused", st.label); return; }
            next(900);
            return;
        }
        if (pendingEnter != null && waited > 1200) {
            AccessibilityNodeInfo f = pendingEnter; pendingEnter = null;
            if (A11yNodes.imeEnter(f)) { note("step " + stepIdx + " pressed enter to show results"); again(1500); return; }
        }
        if (st.optional() && waited > AutomationPolicy.stepBudgetMs(st)) { note("step " + stepIdx + " optional, skipped"); next(200); return; }
        if (waited > 3000 && A11yNodes.dismissPopup(root)) { again(900); return; }
        if (waited > 4000 && scrolls < 24) {
            boolean moved = A11yNodes.scroll(root, !scrollUp);
            if (!moved && !scrollUp) { scrollUp = true; moved = A11yNodes.scroll(root, false); }
            if (moved) { scrolls++; again(900); return; }
        }
        if (waited > AutomationPolicy.stepBudgetMs(st)) { fail("not-found", st.label + (st.near.isEmpty() ? "" : " · " + st.near)); return; }
        again(500);
    }

    private void again(long ms) { main.removeCallbacks(tick); main.postDelayed(tick, ms); }

    private void next(long ms) {
        stepIdx++; scrolls = 0; scrollUp = false; stepStarted = SystemClock.uptimeMillis() + ms;
        again(ms);
    }

    private void reachConfirm() {
        A11yNodes.fresh();
        AccessibilityNodeInfo root = A11yNodes.root(A11yNodes.svc(), pkg);
        List<String> texts = root == null ? new ArrayList<>() : A11yNodes.texts(root);
        String t = AutomationPolicy.total(texts);
        AccessibilityNodeInfo commit = root == null ? null : A11yNodes.findCommit(root);
        long waited = SystemClock.uptimeMillis() - stepStarted;
        if ((commit == null || t == null) && waited < 6000) { again(600); return; }
        total = t;
        mode = Mode.CONFIRM;
        note("confirm: total=" + t + " commit=" + (commit != null ? "“" + A11yNodes.labelOf(commit) + "”" : "none"));
        JSONObject out = outcome("run");
        try { out.put("result", "ready").put("total", t == null ? "" : t).put("commit", commit != null); } catch (JSONException ignored) { }
        keep(out);
        String tt = t == null ? "" : t;
        if (commit != null) {
            cover().showConfirm(AutomationPolicy.fill(w(t == null ? "confirmTitleNoTotal" : "confirmTitle", t == null ? "Ready" : "Ready · {total}"), "total", tt),
                    w("confirmBody", "Nothing is ordered or paid until you tap the button below."),
                    AutomationPolicy.fill(w(t == null ? "confirmButtonNoTotal" : "confirmButton", t == null ? "Confirm" : "Confirm · {total}"), "total", tt),
                    w("confirmDesc", "Confirm"), w("leave", "Look first"), w("cancel", "Cancel"));
        } else {
            cover().showConfirm(w("noCommitTitle", "Ready"), w("noCommitBody", "The confirm button didn't show. Tap Look first to finish yourself."),
                    null, null, w("leave", "Look first"), w("cancel", "Cancel"));
        }
    }

    /**
     * The user's own tap on the cover's confirm button: the only code path that presses a commit button. Reached only
     * from {@link AutomationCover} (a View.OnClickListener); not exposed on any bridge or port.
     */
    @Override public void confirm() {
        if (mode != Mode.CONFIRM) return;
        A11yNodes.fresh();
        WizardKeyboardService s = A11yNodes.svc();
        AccessibilityNodeInfo root = A11yNodes.root(s, pkg);
        AccessibilityNodeInfo commit = root == null ? null : A11yNodes.findCommit(root);
        if (commit == null) { fail("commit-gone", ""); return; }
        AccessibilityNodeInfo c = A11yNodes.clickable(commit);
        boolean ok = c != null && (c.performAction(AccessibilityNodeInfo.ACTION_CLICK) || tapAt(s, c));
        note("confirm (user tapped) → " + (ok ? "pressed" : "refused"));
        if (!ok) { fail("commit-refused", ""); return; }
        mode = Mode.COMMITTING;
        cover().showBusy(w("committingTitle", "Confirming"), w("committingBody", ""));
        main.postDelayed(() -> {
            if (mode != Mode.COMMITTING) return;
            AccessibilityNodeInfo r2 = A11yNodes.root(A11yNodes.svc(), pkg);
            boolean stillThere = r2 != null && A11yNodes.findCommit(r2) != null;
            mode = Mode.DONE;
            JSONObject out = outcome("run");
            try { out.put("result", stillThere ? "check" : "committed").put("total", total == null ? "" : total); } catch (JSONException ignored) { }
            keep(out);
            note("after confirm: " + (stillThere ? "still on the commit screen" : "committed"));
            cover().showDone(w(stillThere ? "checkTitle" : "doneTitle", stillThere ? "Check the app" : "Done ✓"),
                    w(stillThere ? "checkBody" : "doneBody", ""));
            main.postDelayed(() -> { if (mode == Mode.DONE) { if (cover != null) cover.hide(); mode = Mode.IDLE; } }, stillThere ? 600 : 2200);
        }, 3500);
    }

    /** "Look first": leave the target where it is, uncovered. */
    @Override public void leave() {
        note("leave");
        main.removeCallbacks(tick);
        if (cover != null) cover.hide();
        mode = Mode.IDLE;
    }

    @Override public void cancel() {
        note("cancel in " + mode);
        boolean wasRecording = mode == Mode.RECORDING;
        stopQuietly();
        if (wasRecording) { JSONObject out = outcome("recording"); try { out.put("cancelled", true).put("events", new JSONArray()); } catch (JSONException ignored) { } keep(out); }
        if (returnTo) openWizard();
    }

    private void stopQuietly() {
        main.removeCallbacks(tick);
        main.removeCallbacks(watch);
        if (cover != null) cover.hide();
        mode = Mode.IDLE;
    }

    private void fail(String code, String detail) {
        main.removeCallbacks(tick);
        mode = Mode.FAILED;
        note("failed at step " + stepIdx + ": " + code + (detail.isEmpty() ? "" : " " + detail));
        JSONObject out = outcome("run");
        try { out.put("result", "failed").put("code", code).put("detail", detail).put("step", stepIdx); } catch (JSONException ignored) { }
        keep(out);
        JSONObject f = words.optJSONObject("fail");
        String why = AutomationPolicy.fill(AutomationPolicy.word(f, code, AutomationPolicy.word(f, "default", "Stopped ({code})")), "code", code, "detail", detail);
        cover().showFailed(w("failedTitle", "Stopped · nothing was confirmed"), why, w("failedLeave", "Show me"), w("failedClose", "Close"));
    }

    /** The accessibility service (re)connected: Android drops overlays on rebind, so whatever was up comes back. */
    public void serviceConnected() {
        if (cover != null) { cover.hide(); cover = null; }
        switch (mode) {
            case RECORDING: showRecordingCard(); main.removeCallbacks(watch); main.postDelayed(watch, 700); break;
            case REPLAYING: progress(stepIdx < steps.size() ? describe(steps.get(stepIdx)) : ""); break;
            case CONFIRM: mode = Mode.REPLAYING; stepIdx = steps.size(); stepStarted = SystemClock.uptimeMillis(); again(300); break;
            default: return;
        }
        note("service reconnected: cover back for " + mode);
    }

    /* ------------------------------------------------------------------ screen */

    /** The target's screen as text, its fingerprint, whether a commit button shows, and the total it states. */
    public JSONObject screen(String p) throws JSONException {
        if (!AutomationPolicy.target(p, BuildConfig.DEBUG, app.getPackageName())) throw new JSONException("target-not-allowed");
        A11yNodes.fresh();
        AccessibilityNodeInfo root = A11yNodes.root(A11yNodes.svc(), p);
        JSONObject o = new JSONObject().put("package", p).put("visible", root != null);
        if (root == null) return o.put("texts", new JSONArray()).put("sig", "").put("commit", false).put("total", "");
        List<String> parts = new ArrayList<>(), all = new ArrayList<>();
        boolean[] commit = {false};
        A11yNodes.walkScreen(root, 0, false, parts, all, commit);
        String t = AutomationPolicy.total(all);
        return o.put("texts", toArray(all.subList(0, Math.min(all.size(), AutomationPolicy.MAX_TEXTS))))
                .put("sig", AutomationPolicy.sig(parts)).put("commit", commit[0]).put("total", t == null ? "" : t);
    }

    /* ------------------------------------------------------------------ outbox */

    private JSONObject outcome(String kind) {
        JSONObject o = new JSONObject();
        try {
            o.put("id", "o-" + UUID.randomUUID().toString().substring(0, 8)).put("kind", kind).put("ref", ref)
                    .put("package", pkg).put("at", System.currentTimeMillis());
        } catch (JSONException ignored) { }
        return o;
    }

    private SharedPreferences prefs() { return app.getSharedPreferences(PREFS, Context.MODE_PRIVATE); }

    synchronized JSONArray outbox() {
        try { return new JSONArray(prefs().getString(OUTBOX, "[]")); } catch (JSONException e) { return new JSONArray(); }
    }

    private synchronized void keep(JSONObject o) {
        JSONArray a = outbox();
        a.put(o);
        while (a.length() > MAX_OUTBOX) a.remove(0);
        prefs().edit().putString(OUTBOX, a.toString()).apply();
    }

    /** Removes outcomes web has stored. Unacknowledged ones stay (the page may have been killed mid-take). */
    public synchronized int ack(JSONArray ids) {
        if (ids == null) return 0;
        java.util.Set<String> gone = new java.util.HashSet<>();
        for (int i = 0; i < ids.length(); i++) gone.add(ids.optString(i));
        JSONArray a = outbox(), keep = new JSONArray();
        int n = 0;
        for (int i = 0; i < a.length(); i++) { JSONObject o = a.optJSONObject(i); if (o != null && gone.contains(o.optString("id"))) n++; else keep.put(o); }
        prefs().edit().putString(OUTBOX, keep.toString()).apply();
        return n;
    }

    /* ------------------------------------------------------------------ voice shortcuts */

    /** Replaces the shortcut table (validated whole: a bad entry keeps the old table). */
    public synchronized int setShortcuts(JSONObject table) throws AutomationPolicy.Refusal {
        if (table == null) throw new AutomationPolicy.Refusal("bad-shortcut");
        int n = AutomationShortcuts.parse(table).entries.size();
        prefs().edit().putString(SHORTCUTS, table.toString()).apply();
        return n;
    }

    /** Has web ever registered a table? Until it has, the legacy native Food voice path stays in charge. */
    public boolean shortcutsRegistered() { return prefs().contains(SHORTCUTS); }

    /** The action web registered for these words, or null. */
    public JSONObject shortcut(String said) {
        try {
            AutomationShortcuts.Table t = AutomationShortcuts.parse(new JSONObject(prefs().getString(SHORTCUTS, "{}")));
            return AutomationShortcuts.match(t, AutomationPolicy.phrase(said, ai.wizards.os.device.WizardIdentity.name(app)));
        } catch (JSONException | AutomationPolicy.Refusal ex) { return null; }
    }

    /** Runs a shortcut action from a native voice path; returns the refusal code or "". */
    public String startShortcut(JSONObject action) {
        if (action == null) return "missing";
        // A shortcut's action is web's whole request (package, steps, words) as stored; returnToWizard as asked.
        String op = action.optString("op");
        return "replay".equals(op) ? replay(action) : "record".equals(op) ? record(action) : "bad-shortcut";
    }

    /* ------------------------------------------------------------------ bits */

    static final class Match { AccessibilityNodeInfo node, click; int score; }

    private Match find(AccessibilityNodeInfo root, AutomationPolicy.Step st) {
        List<AccessibilityNodeInfo> all = new ArrayList<>();
        A11yNodes.collect(root, all, 0);
        Match best = null;
        for (AccessibilityNodeInfo n : all) {
            if (!n.isVisibleToUser()) continue;
            String id = n.getViewIdResourceName() == null ? "" : n.getViewIdResourceName();
            int sc = AutomationPolicy.score(st.label, st.id, A11yNodes.labelOf(n), id);
            if (sc == 0) continue;
            A11yNodes.refresh(n);
            if (!n.isVisibleToUser()) continue;
            sc = AutomationPolicy.score(st.label, st.id, A11yNodes.labelOf(n), id); // a recycled row may say something else now
            if (sc == 0) continue;
            AccessibilityNodeInfo c = A11yNodes.clickable(n);
            if (c == null) continue;
            if (!st.near.isEmpty()) {
                String want = AutomationPolicy.norm(st.near), got = AutomationPolicy.norm(A11yNodes.rowText(n, "", ambiguous));
                boolean ok = !got.isEmpty() && (got.equals(want) || (want.length() >= 5 && (got.contains(want) || want.contains(got))));
                if (!ok) continue;
                sc = sc * 10 + 10;
            } else sc *= 10;
            if (best == null || sc > best.score) { best = new Match(); best.node = n; best.click = c; best.score = sc; }
        }
        return best;
    }

    private boolean tapAt(AccessibilityService s, AccessibilityNodeInfo n) {
        Rect r = new Rect(); n.getBoundsInScreen(r);
        if (r.isEmpty()) return false;
        Path p = new Path(); p.moveTo(r.exactCenterX(), r.exactCenterY());
        GestureDescription g = new GestureDescription.Builder().addStroke(new GestureDescription.StrokeDescription(p, 0, 60)).build();
        cover().passThrough(true);
        boolean sent = s.dispatchGesture(g, new AccessibilityService.GestureResultCallback() {
            @Override public void onCompleted(GestureDescription d) { main.postDelayed(() -> cover().passThrough(false), 150); }
            @Override public void onCancelled(GestureDescription d) { main.post(() -> cover().passThrough(false)); }
        }, main);
        if (!sent) cover().passThrough(false);
        return sent;
    }

    private List<String> screenTexts(String p) {
        AccessibilityNodeInfo r = A11yNodes.root(A11yNodes.svc(), p);
        return r == null ? new ArrayList<>() : A11yNodes.texts(r);
    }

    private static JSONArray toArray(List<String> l) { JSONArray a = new JSONArray(); for (String s : l) a.put(s); return a; }

    private void launchFresh(String p) {
        Intent i = app.getPackageManager().getLaunchIntentForPackage(p);
        if (i == null) return;
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
        Context from = A11yNodes.svc() != null ? A11yNodes.svc() : app; // a bound service may open apps from the background
        try { from.startActivity(i); } catch (Exception e) { Log.w(TAG, "launch " + p + " failed", e); }
    }

    /** Back to the Wizard OS shell, which asks web what to show (handoff {"action":"automation"}). */
    @Override public void openWizard() {
        Intent i = new Intent(app, ai.wizards.os.MainActivity.class);
        i.setAction(ai.wizards.os.MainActivity.ACTION_AUTOMATION);
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
        Context from = A11yNodes.svc() != null ? A11yNodes.svc() : app;
        try { from.startActivity(i); } catch (Exception e) { Log.w(TAG, "back to Wizard OS failed", e); }
    }

    private AutomationCover cover() {
        if (cover == null) cover = new AutomationCover(this);
        return cover;
    }

    @Override public Context context() { WizardKeyboardService s = A11yNodes.svc(); return s != null ? s : app; }

    @Override public boolean canDraw() { return A11yNodes.svc() != null; }
}
