package ai.wizards.os.assist;

import android.app.Activity;
import android.app.KeyguardManager;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.Context;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.MediaStore;
import android.provider.OpenableColumns;
import android.util.Log;
import android.widget.Toast;

import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.List;

import ai.wizards.os.everywhere.EverywhereOutbox;

/**
 * Camera and Attach for the side-button corner orb (wizard-os issue 655).
 * A see-through activity the orb opens while you talk: it starts the phone's camera (one full-size photo) or Android's
 * file picker (pictures or files, several at once), reads what comes back, hands it to the live take and shows the orb
 * again. The take is paused meanwhile, so nothing said is lost and the pause detector never sends it. Never on the
 * lock screen: a locked phone gets nothing.
 */
public class AssistPickActivity extends Activity {
    static final String TAG = AssistLockActivity.TAG;
    static final String EXTRA_KIND = "kind";
    static final String KIND_CAMERA = "camera", KIND_PICK = "pick";
    static final String ARG_ATTACHED = "wizard_attached";
    private static final int REQ = 655;
    private static final String STATE_PHOTO = "photo", STATE_ASKED = "asked";

    private final Handler main = new Handler(Looper.getMainLooper());
    private File photo;
    private boolean asked, delivered;

    static Intent intent(Context c, String kind) {
        return new Intent(c, AssistPickActivity.class).putExtra(EXTRA_KIND, kind).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
    }

    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        if (saved != null) {
            asked = saved.getBoolean(STATE_ASKED);
            String p = saved.getString(STATE_PHOTO);
            if (p != null) photo = new File(p);
        }
        if (asked) return; // recreated while the camera or picker is open: wait for its answer
        PickedFiles.prune(this);
        KeyguardManager k = (KeyguardManager) getSystemService(Context.KEYGUARD_SERVICE);
        if (k != null && k.isKeyguardLocked()) { deliver(null, 0); return; }
        if (!VoiceCapture.get(this).away()) { deliver(null, 0); return; }
        String kind = getIntent().getStringExtra(EXTRA_KIND);
        try {
            if (KIND_CAMERA.equals(kind)) openCamera();
            else openPicker();
            asked = true;
        } catch (ActivityNotFoundException | IOException | SecurityException e) {
            Log.w(TAG, "camera/attach could not open " + kind, e);
            Toast.makeText(this, KIND_CAMERA.equals(kind) ? "No camera app on this phone" : "No file picker on this phone", Toast.LENGTH_SHORT).show();
            deliver(null, 0);
        }
    }

    private void openCamera() throws IOException {
        File d = AssistCameraProvider.dir(this);
        //noinspection ResultOfMethodCallIgnored
        d.mkdirs();
        byte[] t = new byte[12];
        new SecureRandom().nextBytes(t);
        StringBuilder hex = new StringBuilder();
        for (byte b : t) hex.append(Character.forDigit((b >> 4) & 0xf, 16)).append(Character.forDigit(b & 0xf, 16));
        photo = new File(d, hex + ".jpg");
        if (!photo.createNewFile()) throw new IOException("photo file exists");
        Uri out = new Uri.Builder().scheme("content").authority(AssistCameraProvider.authority(this)).appendPath(photo.getName()).build();
        Intent i = new Intent(MediaStore.ACTION_IMAGE_CAPTURE)
                .putExtra(MediaStore.EXTRA_OUTPUT, out)
                .addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
        i.setClipData(ClipData.newRawUri("photo", out));
        startActivityForResult(i, REQ);
    }

    private void openPicker() {
        Intent i = new Intent(Intent.ACTION_GET_CONTENT)
                .setType("*/" + "*") // any type; written so no "slash-star" starts a comment for source scanners
                .addCategory(Intent.CATEGORY_OPENABLE)
                .putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
        startActivityForResult(i, REQ);
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        out.putBoolean(STATE_ASKED, asked);
        if (photo != null) out.putString(STATE_PHOTO, photo.getAbsolutePath());
    }

    @Override
    protected void onActivityResult(int req, int result, Intent data) {
        super.onActivityResult(req, result, data);
        if (req != REQ) return;
        final File cameraJpeg = photo;
        final List<Uri> uris = new ArrayList<>();
        if (result == RESULT_OK && cameraJpeg == null && data != null) {
            ClipData clip = data.getClipData();
            if (clip != null) for (int i = 0; i < clip.getItemCount(); i++) { Uri u = clip.getItemAt(i).getUri(); if (u != null) uris.add(u); }
            else if (data.getData() != null) uris.add(data.getData());
        }
        final boolean ok = result == RESULT_OK;
        new Thread(() -> {
            List<EverywhereOutbox.Attachment> got = new ArrayList<>();
            int tooBig = 0;
            if (cameraJpeg != null) {
                // The photo moves out of the camera's reach (the provider serves only assist-cam/) into the picked copies.
                File kept = null;
                if (ok && cameraJpeg.isFile()) {
                    if (!AttachPolicy.fits(cameraJpeg.length())) { if (cameraJpeg.length() > 0) tooBig++; }
                    else {
                        File to = PickedFiles.fresh(this);
                        if (cameraJpeg.renameTo(to)) kept = to;
                        else try (InputStream in = new FileInputStream(cameraJpeg)) { kept = PickedFiles.copy(this, in); }
                        catch (IOException e) { Log.w(TAG, "camera photo unreadable", e); }
                    }
                }
                if (kept != null) got.add(new EverywhereOutbox.Attachment(kept, "photo-" + System.currentTimeMillis() + ".jpg", "image/jpeg", AttachPolicy.KIND_PHOTO));
                //noinspection ResultOfMethodCallIgnored
                if (cameraJpeg.isFile()) cameraJpeg.delete();
            }
            int room = AttachPolicy.MAX;
            for (Uri u : uris) {
                if (got.size() >= room) break;
                try {
                    String[] meta = meta(u);
                    long size = meta[1] == null ? -1 : Long.parseLong(meta[1]);
                    if (size > AttachPolicy.MAX_BYTES) { tooBig++; continue; }
                    File copy;
                    try (InputStream in = getContentResolver().openInputStream(u)) {
                        if (in == null) continue;
                        copy = PickedFiles.copy(this, in); // streamed to a private file, never held whole in memory
                    }
                    if (copy == null) { tooBig++; continue; }
                    if (copy.length() == 0) { PickedFiles.drop(copy); continue; }
                    String name = AttachPolicy.safeName(meta[0], "file");
                    got.add(new EverywhereOutbox.Attachment(copy, name, AttachPolicy.mime(getContentResolver().getType(u), name), AttachPolicy.KIND_FILE));
                } catch (Exception e) { Log.w(TAG, "picked file unreadable", e); }
            }
            final int big = tooBig;
            main.post(() -> deliver(got, big));
        }, "assist-attach").start();
    }

    /** Name and size (as text, or null) from the picker's provider. */
    private String[] meta(Uri u) {
        String[] r = new String[2];
        try (Cursor c = getContentResolver().query(u, new String[]{OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE}, null, null, null)) {
            if (c != null && c.moveToFirst()) {
                int n = c.getColumnIndex(OpenableColumns.DISPLAY_NAME), s = c.getColumnIndex(OpenableColumns.SIZE);
                if (n >= 0 && !c.isNull(n)) r[0] = c.getString(n);
                if (s >= 0 && !c.isNull(s)) r[1] = String.valueOf(c.getLong(s));
            }
        } catch (Exception ignored) { }
        return r;
    }

    /** Hand the result to the take (once) and bring the orb back when nothing is on screen. */
    private void deliver(List<EverywhereOutbox.Attachment> got, int tooBig) {
        if (delivered) { PickedFiles.drop(got); return; }
        delivered = true;
        VoiceCapture capture = VoiceCapture.get(this);
        boolean shown = capture.pickDone(got, tooBig);
        if (!shown && capture.listening()) {
            Bundle args = new Bundle();
            args.putBoolean(WizardSession.ARG_HANDOFF, true);
            args.putBoolean(ARG_ATTACHED, true);
            if (!WizardVoiceService.showCorner(args)) Log.w(TAG, "camera/attach: assistant not bound, orb not shown again");
        }
        finish();
    }

    @Override
    protected void onDestroy() {
        // Gone without an answer (the system closed it): the take carries on with nothing added.
        if (isFinishing() && !delivered) deliver(null, 0);
        super.onDestroy();
    }
}
