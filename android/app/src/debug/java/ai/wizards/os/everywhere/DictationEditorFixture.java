package ai.wizards.os.everywhere;

import android.app.Activity;
import android.content.ClipboardManager;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.view.accessibility.AccessibilityNodeInfo;
import android.view.inputmethod.EditorInfo;
import android.view.inputmethod.InputConnection;
import android.view.inputmethod.InputConnectionWrapper;
import android.view.inputmethod.SurroundingText;
import android.view.inputmethod.TextAttribute;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;
import org.json.JSONObject;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;

/** Synthetic native editor in a DIFFERENT process. Configurable editor behavior, real Android IPC. */
@android.annotation.TargetApi(35)
public final class DictationEditorFixture extends Activity {
    private String mode;
    private Editor editor;
    private EditText other;
    private int commits, pastes, slowReads;
    private long preflightWait;
    private String pastePayload = "";
    // Opt-in, bounded observations only. Never changes advertised capabilities or editor behavior.
    private boolean emptyHintDiagnostics;
    private final org.json.JSONArray observations = new org.json.JSONArray();
    private int observationsDropped;
    private boolean moved;
    private final Handler main = new Handler(Looper.getMainLooper());

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        mode = getIntent().getStringExtra("mode");
        if (mode == null) mode = "noopIc";
        emptyHintDiagnostics = getIntent().getBooleanExtra("emptyHintDiagnostics", false);
        LinearLayout layout = new LinearLayout(this); layout.setOrientation(LinearLayout.VERTICAL);
        TextView label = new TextView(this); label.setText("Synthetic dictation editor · " + mode); layout.addView(label);
        editor = new Editor(); editor.setId(View.generateViewId()); editor.setSingleLine(false);
        editor.setInputType(android.text.InputType.TYPE_CLASS_TEXT | android.text.InputType.TYPE_TEXT_FLAG_MULTI_LINE);
        editor.setHint(mode.equals("noHint") ? null : "Synthetic hint");
        String text = getIntent().getStringExtra("text"); editor.setText(text == null ? "prefix " : text);
        editor.setSelection(getIntent().getIntExtra("start", editor.length()), getIntent().getIntExtra("end", editor.length()));
        layout.addView(editor, new LinearLayout.LayoutParams(-1, 240));
        other = new EditText(this); other.setText("other field"); layout.addView(other);
        setContentView(layout); editor.requestFocus();
        getWindow().setSoftInputMode(android.view.WindowManager.LayoutParams.SOFT_INPUT_STATE_ALWAYS_VISIBLE);
        main.postDelayed(this::persist, 150);
    }

    private boolean noNode() { return mode.equals("missingNode") || mode.equals("delayedIc") || mode.equals("noopOnlyIc"); }
    private void observe(String phase, AccessibilityNodeInfo info) {
        if (!emptyHintDiagnostics) return;
        if (observations.length() >= 64) { observationsDropped++; return; }
        try {
            ClipboardManager cb = getSystemService(ClipboardManager.class);
            android.content.ClipDescription clip = cb.getPrimaryClipDescription();
            String label = clip == null ? "absent" : String.valueOf(clip.getLabel());
            JSONObject row = new JSONObject().put("phase", phase)
                    .put("uptime", android.os.SystemClock.uptimeMillis())
                    .put("actualText", editor.getText().toString())
                    .put("actualStart", editor.getSelectionStart()).put("actualEnd", editor.getSelectionEnd())
                    .put("actualFocused", editor.isFocused())
                    .put("clipClass", label.startsWith("Wizard dictation ") ? "wizard" : label);
            if (info != null) {
                org.json.JSONArray actions = new org.json.JSONArray();
                for (AccessibilityNodeInfo.AccessibilityAction action : info.getActionList()) actions.put(action.getId());
                row.put("nodeText", info.getText() == null ? JSONObject.NULL : info.getText().toString())
                        .put("nodeHint", info.getHintText() == null ? JSONObject.NULL : info.getHintText().toString())
                        .put("nodeShowingHint", info.isShowingHintText())
                        .put("nodeStart", info.getTextSelectionStart()).put("nodeEnd", info.getTextSelectionEnd())
                        .put("nodeFocused", info.isFocused()).put("nodeEditable", info.isEditable())
                        .put("actions", actions);
            }
            observations.put(row);
            persist();
        } catch (Exception e) { throw new IllegalStateException(e); }
    }
    private void persist() {
        try {
            JSONObject value = new JSONObject().put("text", editor.getText().toString())
                    .put("start", editor.getSelectionStart()).put("end", editor.getSelectionEnd())
                    .put("commits", commits).put("pastes", pastes).put("pid", android.os.Process.myPid())
                    .put("other", other.getText().toString()).put("mode", mode)
                    .put("preflightWait", preflightWait).put("pastePayload", pastePayload);
            if (emptyHintDiagnostics) value.put("observations", observations).put("observationsDropped", observationsDropped);
            File next = new File(getFilesDir(), "dictation-fixture.json.tmp");
            try (FileOutputStream out = new FileOutputStream(next)) {
                out.write(value.toString().getBytes(StandardCharsets.UTF_8)); out.getFD().sync();
            }
            if (!next.renameTo(new File(getFilesDir(), "dictation-fixture.json"))) throw new IllegalStateException("fixture rename");
        } catch (Exception e) { throw new IllegalStateException(e); }
    }

    private final class Editor extends EditText {
        Editor() { super(DictationEditorFixture.this); }
        @Override public void onInitializeAccessibilityNodeInfo(AccessibilityNodeInfo info) {
            if (mode.equals("slowPreflightPaste") && slowReads < 3) {
                android.content.ClipDescription clip = getSystemService(ClipboardManager.class).getPrimaryClipDescription();
                if (clip != null && String.valueOf(clip.getLabel()).startsWith("Wizard dictation ")) {
                    // Real cross-process synchronous read latency, below each accessibility IPC timeout.
                    // Three refreshed preflight reads exceed the former outer 2.5 second timer.
                    slowReads++;
                    long before = android.os.SystemClock.uptimeMillis();
                    android.os.SystemClock.sleep(950);
                    preflightWait += android.os.SystemClock.uptimeMillis() - before;
                }
            }
            if (mode.equals("focusBefore") && other != null && !moved) {
                ClipboardManager cb = getSystemService(ClipboardManager.class);
                android.content.ClipDescription clip = cb.getPrimaryClipDescription();
                if (clip != null && String.valueOf(clip.getLabel()).startsWith("Wizard dictation ")) {
                    moved = true; other.requestFocus(); persist();
                }
            }
            super.onInitializeAccessibilityNodeInfo(info);
            if (mode.equals("opaqueAll")) info.setTextSelection(-1,-1);
            if (noNode()) {
                info.setEditable(false); info.setText(null); info.setTextSelection(-1,-1);
                info.removeAction(AccessibilityNodeInfo.AccessibilityAction.ACTION_PASTE);
            }
            observe("publish", info);
        }
        @Override public boolean performAccessibilityAction(int action, Bundle arguments) {
            if (action != AccessibilityNodeInfo.ACTION_PASTE) return super.performAccessibilityAction(action, arguments);
            pastes++;
            observe("paste", null);
            if (mode.equals("noopPaste")) { persist(); return true; }
            if (mode.equals("punctuation")) { append("!"); persist(); return true; }
            if (mode.equals("caseOnly")) { setText("Hello"); setSelection(length()); persist(); return true; }
            if (mode.equals("substring")) { setText("shelloworld"); setSelection(length()); persist(); return true; }
            if (mode.equals("latePaste")) {
                main.postDelayed(() -> { super.performAccessibilityAction(action, arguments); persist(); }, 900);
                persist(); return false; // Lost/false reply is NOT permission to commit again.
            }
            if (mode.equals("slowPreflightPaste") || mode.equals("acceptedDelayedPaste")) {
                main.postDelayed(() -> {
                    android.content.ClipData clip = getSystemService(ClipboardManager.class).getPrimaryClip();
                    pastePayload = clip == null ? "" : String.valueOf(clip.getItemAt(0).getText());
                    super.performAccessibilityAction(action, arguments); persist();
                }, 300);
                persist(); return true; // Acceptance is not readback; paste consumes the clipboard later.
            }
            boolean result = super.performAccessibilityAction(action, arguments);
            if (mode.equals("focusChange")) other.requestFocus();
            if (mode.equals("newClipboard")) getSystemService(ClipboardManager.class).setPrimaryClip(
                    android.content.ClipData.newPlainText("fixture newer", "newer clipboard"));
            persist(); return result;
        }
        @Override public InputConnection onCreateInputConnection(EditorInfo info) {
            InputConnection base = super.onCreateInputConnection(info);
            if (base == null) return null;
            return new InputConnectionWrapper(base, false) {
                @Override public boolean commitText(CharSequence text, int cursor) { return commit(text,cursor,null); }
                @Override public boolean commitText(CharSequence text, int cursor, TextAttribute attr) { return commit(text,cursor,attr); }
                private boolean commit(CharSequence text, int cursor, TextAttribute attr) {
                    commits++;
                    observe("commit", null);
                    if (mode.equals("noopIc") || mode.equals("noopOnlyIc") || mode.equals("opaqueIc")) { persist(); return true; }
                    if (mode.equals("delayedIc")) {
                        main.postDelayed(() -> { base.commitText(text,cursor,attr); persist(); }, 300);
                        persist(); return true;
                    }
                    boolean result = base.commitText(text,cursor,attr); persist(); return result;
                }
                @Override public SurroundingText getSurroundingText(int left, int right, int flags) {
                    return mode.equals("opaqueIc") || mode.equals("opaqueAll") ? null : super.getSurroundingText(left,right,flags);
                }
            };
        }
    }
}
