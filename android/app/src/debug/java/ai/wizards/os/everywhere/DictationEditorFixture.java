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
    private int commits, pastes;
    private boolean moved;
    private final Handler main = new Handler(Looper.getMainLooper());

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        mode = getIntent().getStringExtra("mode");
        if (mode == null) mode = "noopIc";
        LinearLayout layout = new LinearLayout(this); layout.setOrientation(LinearLayout.VERTICAL);
        TextView label = new TextView(this); label.setText("Synthetic dictation editor · " + mode); layout.addView(label);
        editor = new Editor(); editor.setId(View.generateViewId()); editor.setSingleLine(false);
        editor.setInputType(android.text.InputType.TYPE_CLASS_TEXT | android.text.InputType.TYPE_TEXT_FLAG_MULTI_LINE);
        editor.setHint("Synthetic hint");
        String text = getIntent().getStringExtra("text"); editor.setText(text == null ? "prefix " : text);
        editor.setSelection(getIntent().getIntExtra("start", editor.length()), getIntent().getIntExtra("end", editor.length()));
        layout.addView(editor, new LinearLayout.LayoutParams(-1, 240));
        other = new EditText(this); other.setText("other field"); layout.addView(other);
        setContentView(layout); editor.requestFocus();
        getWindow().setSoftInputMode(android.view.WindowManager.LayoutParams.SOFT_INPUT_STATE_ALWAYS_VISIBLE);
        main.postDelayed(this::persist, 150);
    }

    private boolean noNode() { return mode.equals("missingNode") || mode.equals("delayedIc") || mode.equals("noopOnlyIc"); }
    private void persist() {
        try {
            JSONObject value = new JSONObject().put("text", editor.getText().toString())
                    .put("start", editor.getSelectionStart()).put("end", editor.getSelectionEnd())
                    .put("commits", commits).put("pastes", pastes).put("pid", android.os.Process.myPid())
                    .put("other", other.getText().toString()).put("mode", mode);
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
        }
        @Override public boolean performAccessibilityAction(int action, Bundle arguments) {
            if (action != AccessibilityNodeInfo.ACTION_PASTE) return super.performAccessibilityAction(action, arguments);
            pastes++;
            if (mode.equals("noopPaste")) { persist(); return true; }
            if (mode.equals("punctuation")) { append("!"); persist(); return true; }
            if (mode.equals("caseOnly")) { setText("Hello"); setSelection(length()); persist(); return true; }
            if (mode.equals("substring")) { setText("shelloworld"); setSelection(length()); persist(); return true; }
            if (mode.equals("latePaste")) {
                main.postDelayed(() -> { super.performAccessibilityAction(action, arguments); persist(); }, 900);
                persist(); return false; // Lost/false reply is NOT permission to commit again.
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
