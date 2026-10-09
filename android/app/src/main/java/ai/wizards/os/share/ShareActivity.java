package ai.wizards.os.share;

import android.app.Activity;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Bundle;
import android.provider.OpenableColumns;
import android.util.Log;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

import ai.wizards.os.MainActivity;
import ai.wizards.os.device.DeviceBridge;

/**
 * "Share to Wizard" from any Android app (gap #20). Makes a private copy of what was shared (text, images,
 * files; up to 8 items, 64 MB each — the Wizard Files limits) while Android's read grant is still valid, then
 * hands it to Wizard OS, where James picks New chat or an existing thread and sends it like any message.
 */
public class ShareActivity extends Activity {
    static final String TAG = "WizardShare";

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        final Intent in = getIntent();
        new Thread(() -> {
            String id = null, err = null;
            try { id = stage(in); }
            catch (IOException e) { err = e.getMessage(); Log.w(TAG, "stage: " + e); }
            final String sid = id, why = err;
            runOnUiThread(() -> {
                if (sid == null) Toast.makeText(this, why == null ? "Nothing to share" : why, Toast.LENGTH_LONG).show();
                else startActivity(new Intent(this, MainActivity.class).setAction(DeviceBridge.ACTION_SHARE)
                        .putExtra(DeviceBridge.EXTRA_SHARE, sid).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP));
                finish();
            });
        }, "wizard-share-stage").start();
    }

    @SuppressWarnings("deprecation") // getParcelable*Extra(String): the typed variants are API 33+, minSdk is 28
    private String stage(Intent in) throws IOException {
        if (in == null) return null;
        String a = in.getAction();
        List<Uri> uris = new ArrayList<>();
        if (Intent.ACTION_SEND.equals(a)) {
            Uri u = in.getParcelableExtra(Intent.EXTRA_STREAM);
            if (u != null) uris.add(u);
        } else if (Intent.ACTION_SEND_MULTIPLE.equals(a)) {
            ArrayList<Uri> l = in.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
            if (l != null) uris.addAll(l);
        } else return null;
        if (uris.isEmpty() && in.getClipData() != null) {
            for (int i = 0; i < in.getClipData().getItemCount(); i++) {
                Uri u = in.getClipData().getItemAt(i).getUri();
                if (u != null) uris.add(u);
            }
        }
        CharSequence text = in.getCharSequenceExtra(Intent.EXTRA_TEXT);
        String subject = in.getStringExtra(Intent.EXTRA_SUBJECT);
        if (uris.isEmpty() && (text == null || text.toString().trim().isEmpty())) return null;

        ShareStore store = ShareStore.get(this);
        String id = store.newId();
        File dir = store.dir(id);
        JSONArray items = new JSONArray();
        int skipped = 0;
        for (Uri u : uris) {
            if (items.length() >= ShareStore.MAX_ITEMS) { skipped++; continue; }
            if (!"content".equals(u.getScheme())) { skipped++; continue; } // never read our own private files by path
            String name = ShareStore.safeName(displayName(u), items.length());
            String mime = getContentResolver().getType(u);
            File out = new File(dir, items.length() + ".bin");
            long n = 0;
            try (InputStream is = getContentResolver().openInputStream(u); OutputStream os = new FileOutputStream(out)) {
                if (is == null) { skipped++; continue; }
                byte[] b = new byte[65536];
                int r;
                while ((r = is.read(b)) > 0) {
                    n += r;
                    if (n > ShareStore.MAX_BYTES) break;
                    os.write(b, 0, r);
                }
            } catch (SecurityException e) { skipped++; continue; }
            if (n > ShareStore.MAX_BYTES || n == 0) { //noinspection ResultOfMethodCallIgnored
                out.delete(); skipped++; continue; }
            try {
                items.put(new JSONObject().put("n", items.length()).put("name", name)
                        .put("mime", mime == null ? "application/octet-stream" : mime).put("bytes", n));
            } catch (JSONException ignored) { }
        }
        JSONObject meta = new JSONObject();
        try {
            meta.put("id", id).put("at", System.currentTimeMillis()).put("items", items).put("skipped", skipped)
                    .put("text", text == null ? "" : text.toString().trim()).put("subject", subject == null ? "" : subject)
                    .put("from", getReferrer() == null ? "" : String.valueOf(getReferrer().getHost()));
        } catch (JSONException ignored) { }
        if (items.length() == 0 && meta.optString("text").isEmpty()) { store.delete(id); throw new IOException("Couldn’t read what was shared"); }
        store.save(id, meta.toString().getBytes(StandardCharsets.UTF_8));
        Log.i(TAG, "staged " + id + " items=" + items.length() + " text=" + meta.optString("text").length() + " skipped=" + skipped);
        return id;
    }

    private String displayName(Uri u) {
        try (Cursor c = getContentResolver().query(u, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
            if (c != null && c.moveToFirst()) return c.getString(0);
        } catch (RuntimeException ignored) { }
        return u.getLastPathSegment();
    }
}
