package ai.wizards.os.share;

import android.app.Activity;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Bundle;
import android.provider.OpenableColumns;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import ai.wizards.os.MainActivity;
import ai.wizards.os.device.DeviceBridge;

/** Import adapter only. The sole compose/destination UI is web/core/share-wizard.js.
 * Copy while the sending Activity's URI grants are valid; the web sheet and resumable service then own private
 * durable bytes, not another app's temporary permission. No native agent/chat picker or editable note remains. */
public class ShareActivity extends Activity {
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private volatile boolean cancelled;

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        if (android.os.Build.VERSION.SDK_INT >= 33) getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT, () -> { cancelled = true; finish(); });
        final Intent incoming = getIntent();
        if (incoming == null || !(Intent.ACTION_SEND.equals(incoming.getAction()) || Intent.ACTION_SEND_MULTIPLE.equals(incoming.getAction()))) { finish(); return; }
        // No Home frame is launched until staging completes. This transparent adapter remains over the source app.
        final String from = sourceLabel();
        io.execute(() -> stage(incoming, from));
    }

    private String sourceLabel() {
        String pkg = getCallingPackage();
        Uri referrer = getReferrer();
        if (pkg == null && referrer != null && "android-app".equals(referrer.getScheme())) pkg = referrer.getHost();
        if (pkg == null) return "";
        try { return String.valueOf(getPackageManager().getApplicationLabel(getPackageManager().getApplicationInfo(pkg, 0))); }
        catch (Exception ignored) { return ""; }
    }

    @SuppressWarnings("deprecation")
    private List<Uri> streams(Intent i) {
        List<Uri> out = new ArrayList<>();
        if (Intent.ACTION_SEND_MULTIPLE.equals(i.getAction())) {
            ArrayList<Uri> list = i.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
            if (list != null) for (Uri u : list) add(out, u);
        } else add(out, i.getParcelableExtra(Intent.EXTRA_STREAM));
        if (i.getClipData() != null) for (int n = 0; n < i.getClipData().getItemCount(); n++) add(out, i.getClipData().getItemAt(n).getUri());
        return out;
    }
    private void add(List<Uri> list, Uri uri) {
        // Never accept file:// paths or arbitrary schemes from another app.
        if (uri == null || !"content".equals(uri.getScheme())) return;
        String authority = String.valueOf(uri.getAuthority());
        if (authority.equals(getPackageName()) || authority.startsWith(getPackageName() + ".")) return;
        if (!list.contains(uri)) list.add(uri);
    }

    private void stage(Intent in, String from) {
        ShareStore store = ShareStore.get(this);
        String id = store.newId();
        try {
            store.prune();
            JSONArray items = new JSONArray(); int skipped = 0;
            for (Uri uri : streams(in)) {
                if (cancelled) break;
                if (items.length() >= ShareStore.MAX_ITEMS) { skipped++; continue; }
                int n = items.length(); String name = "", mime = getContentResolver().getType(uri);
                try (Cursor c = getContentResolver().query(uri, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
                    if (c != null && c.moveToFirst()) name = c.getString(0);
                } catch (RuntimeException ignored) { }
                name = ShareStore.safeName(name, n);
                File out = store.item(id, n); out.getParentFile().mkdirs();
                MessageDigest md = MessageDigest.getInstance("SHA-256");
                try (InputStream src = getContentResolver().openInputStream(uri); FileOutputStream dst = new FileOutputStream(out)) {
                    if (src == null) throw new java.io.IOException("No stream");
                    byte[] bytes = new byte[256 * 1024]; int count;
                    while (!cancelled && (count = src.read(bytes)) != -1) {
                        if (out.getParentFile().getUsableSpace() < bytes.length + 32L * 1024 * 1024) throw new java.io.IOException("Not enough phone space");
                        dst.write(bytes, 0, count); md.update(bytes, 0, count);
                    }
                    dst.getFD().sync();
                } catch (Exception e) { out.delete(); skipped++; continue; }
                items.put(new JSONObject().put("n", n).put("name", name).put("mime", mime == null ? "application/octet-stream" : mime)
                        .put("bytes", out.length()).put("sha256", ShareUploader.hex(md.digest())));
            }
            if (cancelled) { store.delete(id); return; }
            CharSequence t = in.getCharSequenceExtra(Intent.EXTRA_TEXT);
            JSONObject meta = new JSONObject().put("id", id).put("at", System.currentTimeMillis()).put("items", items).put("skipped", skipped)
                    .put("text", t == null ? "" : t.toString()).put("subject", in.getStringExtra(Intent.EXTRA_SUBJECT)).put("from", from);
            store.save(id, meta.toString().getBytes(StandardCharsets.UTF_8));
            runOnUiThread(() -> {
                if (cancelled || isFinishing()) { store.delete(id); return; }
                startActivity(new Intent(this, MainActivity.class).setAction(DeviceBridge.ACTION_SHARE).putExtra(DeviceBridge.EXTRA_SHARE, id)
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP));
                finish();
            });
        } catch (Exception e) {
            store.delete(id);
            runOnUiThread(() -> { if (!cancelled) Toast.makeText(this, "Couldn’t read that share · please try again", Toast.LENGTH_LONG).show(); finish(); });
        }
    }

    @Override public void onBackPressed() { cancelled = true; finish(); }
    @Override protected void onDestroy() { cancelled = true; io.shutdown(); super.onDestroy(); }
}
