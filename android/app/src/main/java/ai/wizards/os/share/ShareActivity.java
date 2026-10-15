package ai.wizards.os.share;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.OpenableColumns;
import android.text.InputType;
import android.text.TextUtils;
import android.util.Log;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowManager;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;
import android.window.OnBackInvokedDispatcher;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

import ai.wizards.os.MainActivity;
import ai.wizards.os.device.AppState;
import ai.wizards.os.device.DeviceBridge;

/**
 * "Share to Wizard" from any Android app. One tap: a compact sheet opens with everything chosen (the default
 * agent, New chat), an optional note, and Send. The "To" row appears only when the Wizard has more than one agent;
 * the chat row can pick an existing thread. Send closes the sheet at once: {@link ShareService} copies what was
 * shared into private storage (Android's read grant goes with it) and uploads it through the resumable
 * /wizard/v1/shares API, surviving app close, network loss and reboot; the Wizard posts it into the thread.
 *
 * Wizards without capabilities.resumable_uploads (and text-only shares) keep the previous route: a private copy
 * handed to Wizard OS, where the web picker chooses the thread.
 */
public class ShareActivity extends Activity {
    static final String TAG = "WizardShare";
    private static final String PREFS = "wizard-share", K_CFG = "cfg";

    private final Handler main = new Handler(Looper.getMainLooper());
    private final SheetBack back = new SheetBack();
    private final List<Uri> uris = new ArrayList<>();
    private final List<JSONObject> files = new ArrayList<>();
    private String sharedText = "", subject = "";
    private long knownBytes;

    /** What this Wizard can do, cached so the sheet opens complete even offline. */
    private JSONObject cfg = new JSONObject();
    private JSONObject agent;          // chosen agent (null = the default; no registry)
    private String thread = "", threadTitle = "";
    private boolean sent;

    private FrameLayout root;
    private LinearLayout card, page;
    private EditText note;
    private TextView sendBtn, hint, toValue, chatValue;
    private View toRow;
    private float dp;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        dp = getResources().getDisplayMetrics().density;
        Intent in = getIntent();
        if (!collect(in)) { Toast.makeText(this, "Nothing to share", Toast.LENGTH_LONG).show(); finish(); return; }
        if (uris.isEmpty()) { legacy(in); return; } // text only: the app's own picker, as before
        cfg = readCfg(this);
        pickDefaultAgent();
        build();
        refreshConfig();
        if (Build.VERSION.SDK_INT >= 33) getOnBackInvokedDispatcher().registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::onBack);
    }

    @SuppressWarnings("deprecation")
    @Override
    public void onBackPressed() { onBack(); } // never super: a single Back must not close the sheet

    void onBack() {
        switch (back.back(System.currentTimeMillis())) {
            case CLOSE_CHOOSER: showMain(); break;
            case WARN: flash("Press back again to cancel"); break;
            case CANCEL: cancel(); break;
        }
    }

    private void cancel() { sent = true; finish(); }

    /* ------------------------------------------------------------------ what was shared */

    @SuppressWarnings("deprecation") // getParcelable*Extra(String): the typed variants are API 33+, minSdk is 28
    private boolean collect(Intent in) {
        if (in == null) return false;
        String a = in.getAction();
        if (Intent.ACTION_SEND.equals(a)) {
            Uri u = in.getParcelableExtra(Intent.EXTRA_STREAM);
            if (u != null) uris.add(u);
        } else if (Intent.ACTION_SEND_MULTIPLE.equals(a)) {
            ArrayList<Uri> l = in.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
            if (l != null) uris.addAll(l);
        } else return false;
        if (uris.isEmpty() && in.getClipData() != null)
            for (int i = 0; i < in.getClipData().getItemCount(); i++) { Uri u = in.getClipData().getItemAt(i).getUri(); if (u != null) uris.add(u); }
        // Never read our own private files by path, or anything that is not a content URI.
        for (int i = uris.size() - 1; i >= 0; i--) if (!"content".equals(uris.get(i).getScheme()) || isOurs(uris.get(i))) uris.remove(i);
        CharSequence t = in.getCharSequenceExtra(Intent.EXTRA_TEXT);
        sharedText = t == null ? "" : t.toString().trim();
        String s = in.getStringExtra(Intent.EXTRA_SUBJECT);
        subject = s == null ? "" : s.trim();
        for (int i = 0; i < uris.size(); i++) {
            Uri u = uris.get(i);
            String name = null; long size = -1;
            try (Cursor c = getContentResolver().query(u, new String[]{OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE}, null, null, null)) {
                if (c != null && c.moveToFirst()) {
                    name = c.getString(0);
                    if (!c.isNull(1)) size = c.getLong(1);
                }
            } catch (RuntimeException ignored) { }
            if (name == null) name = u.getLastPathSegment();
            String mime = null;
            try { mime = getContentResolver().getType(u); } catch (RuntimeException ignored) { }
            try {
                files.add(new JSONObject().put("n", i).put("name", ShareStore.safeName(name, i))
                        .put("mime", mime == null ? "application/octet-stream" : mime).put("bytes", size).put("uri", u.toString()));
            } catch (JSONException ignored) { }
            if (size > 0) knownBytes += size;
        }
        return !uris.isEmpty() || !sharedText.isEmpty();
    }

    private boolean isOurs(Uri u) {
        String auth = String.valueOf(u.getAuthority());
        return auth.startsWith(getPackageName() + ".");
    }

    /* ------------------------------------------------------------------ config: bootstrap + agents */

    static JSONObject readCfg(Context c) {
        try { return new JSONObject(c.getSharedPreferences(PREFS, MODE_PRIVATE).getString(K_CFG, "{}")); }
        catch (JSONException e) { return new JSONObject(); }
    }

    private boolean resumableKnownOff() { return cfg.has("resumable") && !cfg.optBoolean("resumable"); }

    private JSONArray agents() { JSONArray a = cfg.optJSONArray("agents"); return a == null ? new JSONArray() : a; }

    private void pickDefaultAgent() {
        JSONArray a = agents();
        agent = null;
        for (int i = 0; i < a.length(); i++) if (a.optJSONObject(i).optBoolean("is_default")) { agent = a.optJSONObject(i); break; }
        if (agent == null && a.length() > 0) agent = a.optJSONObject(0);
    }

    private String agentLabel() {
        if (agent != null && !agent.optString("label").isEmpty()) return agent.optString("label");
        String n = cfg.optString("agentName").trim();
        return ai.wizards.os.device.WizardIdentity.normalize(n);
    }

    /** Re-read what the Wizard offers (in the background; the sheet is already usable from the cache). */
    private void refreshConfig() {
        final String origin = AppState.origin(this);
        new Thread(() -> {
            JSONObject next = new JSONObject();
            try {
                JSONObject b = getJson(origin, "/wizard/v1/bootstrap");
                if (b == null) return; // offline: keep the cache
                ai.wizards.os.device.WizardIdentity.acceptBootstrap(this, origin, b);
                next.put("resumable", b.optJSONObject("capabilities") != null && b.optJSONObject("capabilities").optBoolean("resumable_uploads"));
                JSONObject st = b.optJSONObject("settings");
                next.put("agentName", st != null && st.optJSONObject("agent") != null ? st.optJSONObject("agent").optString("name") : "");
                JSONObject ag = getJson(origin, "/wizard/v1/agents"); // 404 on a box without an agents registry
                JSONArray list = ag == null ? null : ag.optJSONArray("agents");
                next.put("agents", list == null ? new JSONArray() : list);
                next.put("at", System.currentTimeMillis());
            } catch (JSONException e) { return; }
            getSharedPreferences(PREFS, MODE_PRIVATE).edit().putString(K_CFG, next.toString()).apply();
            main.post(() -> {
                if (sent || isFinishing()) return;
                String had = agent == null ? "" : agent.optString("id");
                cfg = next;
                pickDefaultAgentKeeping(had);
                syncRows();
            });
        }, "wizard-share-cfg").start();
    }

    private void pickDefaultAgentKeeping(String id) {
        JSONArray a = agents();
        for (int i = 0; !id.isEmpty() && i < a.length(); i++) if (id.equals(a.optJSONObject(i).optString("id"))) { agent = a.optJSONObject(i); return; }
        pickDefaultAgent();
        thread = ""; threadTitle = "";
    }

    static JSONObject getJson(String origin, String path) {
        HttpURLConnection c = null;
        try {
            c = (HttpURLConnection) new URL(AppState.live(origin) + path).openConnection();
            c.setConnectTimeout(5000); c.setReadTimeout(8000);
            c.setRequestProperty("Origin", origin); c.setRequestProperty("Accept", "application/json");
            int code = c.getResponseCode();
            if (code == 404) return new JSONObject();
            if (code < 200 || code >= 300) return null;
            try (InputStream is = c.getInputStream()) {
                byte[] b = new byte[1 << 20]; int n = 0, r;
                while (n < b.length && (r = is.read(b, n, b.length - n)) > 0) n += r;
                return new JSONObject(new String(b, 0, n, StandardCharsets.UTF_8));
            }
        } catch (IOException | JSONException e) {
            return null;
        } finally { if (c != null) c.disconnect(); }
    }

    /* ------------------------------------------------------------------ the sheet */

    private int px(float v) { return Math.round(v * dp); }

    private static final int BG = 0xFF15111F, ROW = 0xFF201A31, INK = 0xFFEFEAFF, INK2 = 0xFFA79EC2, VIOLET = 0xFFA27BFF, SCRIM = 0x99000000;

    private GradientDrawable round(int color, float r) { GradientDrawable g = new GradientDrawable(); g.setColor(color); g.setCornerRadius(px(r)); return g; }

    private TextView text(String s, float sp, int color, boolean bold) {
        TextView t = new TextView(this);
        t.setText(s); t.setTextColor(color); t.setTextSize(TypedValue.COMPLEX_UNIT_SP, sp);
        if (bold) t.setTypeface(Typeface.DEFAULT_BOLD);
        return t;
    }

    private void build() {
        Window w = getWindow();
        w.setBackgroundDrawableResource(android.R.color.transparent);
        w.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
        if (Build.VERSION.SDK_INT >= 30) w.setDecorFitsSystemWindows(false);
        root = new FrameLayout(this);
        root.setBackgroundColor(SCRIM);
        root.setOnClickListener(v -> onBack()); // a tap outside behaves like Back: warn first, never a silent cancel
        card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        GradientDrawable g = new GradientDrawable(); g.setColor(BG);
        g.setCornerRadii(new float[]{px(24), px(24), px(24), px(24), 0, 0, 0, 0});
        card.setBackground(g);
        card.setClickable(true); // taps on the card never reach the scrim
        card.setPadding(px(20), px(16), px(20), px(16));
        FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM);
        root.addView(card, lp);
        root.setOnApplyWindowInsetsListener((v, ins) -> {
            int bottom, top;
            if (Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets i = ins.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.ime());
                bottom = i.bottom; top = i.top;
            } else { bottom = ins.getSystemWindowInsetBottom(); top = ins.getSystemWindowInsetTop(); }
            card.setPadding(px(20), px(16), px(20), px(16) + bottom);
            root.setPadding(0, top, 0, 0);
            return ins;
        });
        page = new LinearLayout(this);
        page.setOrientation(LinearLayout.VERTICAL);
        card.addView(page);
        setContentView(root);
        showMain();
    }

    private void showMain() {
        page.removeAllViews();
        // Header: title + cancel.
        LinearLayout head = new LinearLayout(this);
        head.setGravity(Gravity.CENTER_VERTICAL);
        TextView title = text("Send to " + agentLabel(), 19, INK, true);
        head.addView(title, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        TextView x = text("✕", 20, INK2, false);
        x.setContentDescription("Cancel");
        x.setPadding(px(12), px(6), px(4), px(6));
        x.setOnClickListener(v -> cancel());
        head.addView(x);
        page.addView(head);
        title.setTag("title");

        // What is being sent: names are fine on the sheet (on screen, James's own eyes); notifications never show them.
        String what = files.size() == 1 ? files.get(0).optString("name") : files.size() + " files";
        TextView sum = text(what + (knownBytes > 0 ? " · " + ShareNotifier.size(knownBytes) : ""), 14, INK2, false);
        sum.setSingleLine(true); sum.setEllipsize(TextUtils.TruncateAt.MIDDLE);
        sum.setPadding(0, px(4), 0, px(12));
        page.addView(sum);

        toRow = row("To", agentLabel(), v -> showAgents());
        toValue = (TextView) toRow.getTag();
        page.addView(toRow);
        View chat = row("Chat", thread.isEmpty() ? "New chat" : threadTitle, v -> showThreads());
        chatValue = (TextView) chat.getTag();
        page.addView(chat);

        if (note == null) {
            note = new EditText(this);
            note.setHint("Add a note (optional)");
            note.setHintTextColor(INK2); note.setTextColor(INK);
            note.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
            note.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_MULTI_LINE | InputType.TYPE_TEXT_FLAG_CAP_SENTENCES);
            note.setMaxLines(4);
            note.setBackground(round(ROW, 14));
            note.setPadding(px(14), px(12), px(14), px(12));
            String pre = sharedText.isEmpty() ? subject : (subject.isEmpty() || sharedText.contains(subject) ? sharedText : subject + "\n" + sharedText);
            if (!pre.isEmpty()) note.setText(pre);
        } else if (note.getParent() != null) ((ViewGroup) note.getParent()).removeView(note);
        LinearLayout.LayoutParams nlp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        nlp.topMargin = px(8);
        page.addView(note, nlp);

        hint = text("", 13, 0xFFFFB4A8, false);
        hint.setPadding(px(2), px(8), 0, 0);
        hint.setVisibility(View.GONE);
        page.addView(hint);

        sendBtn = text("Send", 17, Color.BLACK, true);
        sendBtn.setGravity(Gravity.CENTER);
        sendBtn.setBackground(round(VIOLET, 16));
        sendBtn.setContentDescription("Send");
        sendBtn.setOnClickListener(v -> send());
        LinearLayout.LayoutParams slp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, px(52));
        slp.topMargin = px(14);
        page.addView(sendBtn, slp);
        syncRows();
    }

    private View row(String label, String value, View.OnClickListener tap) {
        LinearLayout r = new LinearLayout(this);
        r.setGravity(Gravity.CENTER_VERTICAL);
        r.setBackground(round(ROW, 14));
        r.setPadding(px(14), 0, px(12), 0);
        r.setMinimumHeight(px(50));
        r.addView(text(label, 15, INK2, false), new LinearLayout.LayoutParams(px(56), ViewGroup.LayoutParams.WRAP_CONTENT));
        TextView v = text(value, 15, INK, true);
        v.setSingleLine(true); v.setEllipsize(TextUtils.TruncateAt.END);
        r.addView(v, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        r.addView(text("›", 20, INK2, false));
        r.setOnClickListener(tap);
        r.setContentDescription(label + ": " + value);
        r.setTag(v);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.topMargin = px(8);
        r.setLayoutParams(lp);
        return r;
    }

    private void syncRows() {
        if (toRow == null) return;
        toRow.setVisibility(agents().length() > 1 ? View.VISIBLE : View.GONE); // the To row only when there is a choice
        toValue.setText(agentLabel());
        toRow.setContentDescription("To: " + agentLabel());
        chatValue.setText(thread.isEmpty() ? "New chat" : threadTitle);
        ((View) chatValue.getParent()).setContentDescription("Chat: " + (thread.isEmpty() ? "New chat" : threadTitle));
        View t = page.findViewWithTag("title");
        if (t instanceof TextView) ((TextView) t).setText("Send to " + agentLabel());
        // Room on the phone for the private copies (Android's grant ends with the sheet, so they are made first).
        long free = getFilesDir().getUsableSpace();
        boolean fits = knownBytes + ShareUploader.PHONE_RESERVE + ShareQueue.get(this).bytesToCopy() <= free;
        sendBtn.setEnabled(fits);
        sendBtn.setAlpha(fits ? 1f : .45f);
        if (!fits) { hint.setText(ShareUploader.NO_SPACE_PHONE + " · free up " + ShareNotifier.size(knownBytes + ShareUploader.PHONE_RESERVE - free) + " and share again"); hint.setVisibility(View.VISIBLE); }
    }

    private Runnable unflash;
    private void flash(String s) {
        if (back.chooserOpen() || hint == null) { Toast.makeText(this, s, Toast.LENGTH_SHORT).show(); return; }
        hint.setText(s); hint.setTextColor(INK2); hint.setVisibility(View.VISIBLE);
        if (unflash != null) main.removeCallbacks(unflash);
        unflash = () -> { if (hint != null && s.contentEquals(hint.getText())) { hint.setVisibility(View.GONE); hint.setTextColor(0xFFFFB4A8); syncRows(); } };
        main.postDelayed(unflash, SheetBack.WINDOW_MS);
    }

    /* ------------------------------------------------------------------ choosers (Back returns to the sheet) */

    private LinearLayout chooser(String title) {
        back.openChooser();
        page.removeAllViews();
        LinearLayout head = new LinearLayout(this);
        head.setGravity(Gravity.CENTER_VERTICAL);
        TextView b = text("‹", 26, INK, false);
        b.setContentDescription("Back to the share sheet");
        b.setPadding(px(2), 0, px(14), px(2));
        b.setOnClickListener(v -> { back.closeChooser(); showMain(); });
        head.addView(b);
        head.addView(text(title, 18, INK, true));
        page.addView(head);
        ScrollView sv = new ScrollView(this);
        LinearLayout list = new LinearLayout(this);
        list.setOrientation(LinearLayout.VERTICAL);
        list.setPadding(0, px(6), 0, 0);
        sv.addView(list);
        page.addView(sv, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, Math.round(getResources().getDisplayMetrics().heightPixels * .5f)));
        return list;
    }

    private TextView choice(LinearLayout list, String label, boolean on, View.OnClickListener tap) {
        TextView t = text((on ? "✓  " : "     ") + label, 16, on ? VIOLET : INK, on);
        t.setSingleLine(true); t.setEllipsize(TextUtils.TruncateAt.END);
        t.setPadding(px(10), px(14), px(10), px(14));
        t.setOnClickListener(tap);
        t.setContentDescription(label);
        list.addView(t);
        return t;
    }

    private void showAgents() {
        LinearLayout list = chooser("Send to");
        JSONArray a = agents();
        for (int i = 0; i < a.length(); i++) {
            final JSONObject ag = a.optJSONObject(i);
            boolean running = "running".equals(ag.optString("status", "running"));
            String label = ag.optString("label", ag.optString("id")) + (running ? "" : " · stopped");
            TextView t = choice(list, label, agent != null && ag.optString("id").equals(agent.optString("id")), v -> {
                if (agent == null || !ag.optString("id").equals(agent.optString("id"))) { thread = ""; threadTitle = ""; }
                agent = ag; back.closeChooser(); showMain();
            });
            if (!running) { t.setEnabled(false); t.setAlpha(.45f); }
        }
    }

    private void showThreads() {
        final LinearLayout list = chooser("Choose chat");
        choice(list, "New chat", thread.isEmpty(), v -> { thread = ""; threadTitle = ""; back.closeChooser(); showMain(); });
        final TextView loading = text("Loading chats…", 14, INK2, false);
        loading.setPadding(px(10), px(12), 0, px(12));
        list.addView(loading);
        final String origin = AppState.origin(this);
        final String agentQ = agent != null && !agent.optBoolean("is_default") ? "&agent=" + Uri.encode(agent.optString("id")) : "";
        new Thread(() -> {
            JSONObject j = getJson(origin, "/wizard/hermes/api/sessions?limit=40&offset=0&include_children=false" + agentQ);
            main.post(() -> {
                if (!back.chooserOpen() || loading.getParent() != list) return;
                JSONArray rows = j == null ? null : j.optJSONArray("data") != null ? j.optJSONArray("data") : j.optJSONArray("sessions") != null ? j.optJSONArray("sessions") : j.optJSONArray("items");
                if (rows == null) { loading.setText("Couldn’t load chats · New chat still works"); return; }
                list.removeView(loading);
                int shown = 0;
                for (int i = 0; i < rows.length() && shown < 30; i++) {
                    JSONObject s = rows.optJSONObject(i);
                    if (s == null || s.optBoolean("archived") || s.optBoolean("hidden")) continue;
                    final String id = s.optString("id", s.optString("session_id")), t = s.optString("title", "Untitled chat");
                    if (id.isEmpty()) continue;
                    choice(list, t.isEmpty() ? "Untitled chat" : t, id.equals(thread), v -> { thread = id; threadTitle = t; back.closeChooser(); showMain(); });
                    shown++;
                }
                if (shown == 0) { loading.setText("No chats yet"); list.addView(loading); }
            });
        }, "wizard-share-threads").start();
    }

    /* ------------------------------------------------------------------ send */

    private void send() {
        if (sent) return;
        if (resumableKnownOff()) { sendBtn.setText("Preparing…"); sendBtn.setEnabled(false); legacy(getIntent()); return; }
        sent = true;
        String id = ShareQueue.newId();
        try {
            JSONArray fs = new JSONArray();
            for (JSONObject f : files) fs.put(new JSONObject(f.toString()));
            JSONObject it = new JSONObject().put("id", id).put("v", 2).put("created", System.currentTimeMillis()).put("state", ShareQueue.COPYING)
                    .put("agent", agent != null && !agent.optBoolean("is_default") ? agent.optString("id") : "")
                    .put("agentLabel", agentLabel()).put("thread", thread).put("note", note == null ? "" : note.getText().toString().trim())
                    .put("files", fs).put("uploads", new JSONArray());
            ShareQueue.get(this).save(it);
        } catch (JSONException | IOException e) {
            Log.w(TAG, "queue: " + e);
            sent = false;
            hint.setText("Couldn’t save the share on the phone"); hint.setVisibility(View.VISIBLE);
            return;
        }
        ShareService.send(this, id, uris);
        Log.i(TAG, "queued " + id + " files=" + files.size() + " bytes=" + knownBytes + " agent=" + agentLabel() + " thread=" + (thread.isEmpty() ? "new" : thread));
        finish(); // the sheet closes at once; the notification shows the rest
    }

    /* ------------------------------------------------------------------ previous route (no resumable API, text only) */

    private void legacy(Intent in) {
        new Thread(() -> {
            String id = null, err = null;
            try { id = stage(in); }
            catch (IOException e) { err = e.getMessage(); Log.w(TAG, "stage: " + e); }
            final String sid = id, why = err;
            runOnUiThread(() -> {
                sent = true;
                if (sid == null) Toast.makeText(this, why == null ? "Nothing to share" : why, Toast.LENGTH_LONG).show();
                else startActivity(new Intent(this, MainActivity.class).setAction(DeviceBridge.ACTION_SHARE)
                        .putExtra(DeviceBridge.EXTRA_SHARE, sid).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP));
                finish();
            });
        }, "wizard-share-stage").start();
    }

    /** A private copy of everything shared (no size cap: only the phone's free space), for the web picker. */
    private String stage(Intent in) throws IOException {
        ShareStore store = ShareStore.get(this);
        String id = store.newId();
        File dir = store.dir(id);
        JSONArray items = new JSONArray();
        int skipped = 0;
        for (int k = 0; k < uris.size(); k++) {
            Uri u = uris.get(k);
            if (items.length() >= ShareStore.MAX_ITEMS) { skipped++; continue; }
            JSONObject f = files.get(k);
            File out = new File(dir, items.length() + ".bin");
            long n = 0;
            try (InputStream is = getContentResolver().openInputStream(u); OutputStream os = new FileOutputStream(out)) {
                if (is == null) { skipped++; continue; }
                byte[] b = new byte[65536];
                int r;
                while ((r = is.read(b)) > 0) { n += r; os.write(b, 0, r); }
            } catch (SecurityException e) { skipped++; continue; }
            catch (IOException e) { //noinspection ResultOfMethodCallIgnored
                out.delete(); store.delete(id); throw new IOException(getFilesDir().getUsableSpace() < 8L << 20 ? ShareUploader.NO_SPACE_PHONE : "Couldn’t read what was shared"); }
            if (n == 0) { //noinspection ResultOfMethodCallIgnored
                out.delete(); skipped++; continue; }
            try { items.put(new JSONObject().put("n", items.length()).put("name", f.optString("name")).put("mime", f.optString("mime")).put("bytes", n)); }
            catch (JSONException ignored) { }
        }
        JSONObject meta = new JSONObject();
        try {
            String text = note != null ? note.getText().toString().trim() : sharedText;
            meta.put("id", id).put("at", System.currentTimeMillis()).put("items", items).put("skipped", skipped)
                    .put("text", text).put("subject", note != null ? "" : subject)
                    .put("from", getReferrer() == null ? "" : String.valueOf(getReferrer().getHost()));
        } catch (JSONException ignored) { }
        if (items.length() == 0 && meta.optString("text").isEmpty()) { store.delete(id); throw new IOException("Couldn’t read what was shared"); }
        store.save(id, meta.toString().getBytes(StandardCharsets.UTF_8));
        Log.i(TAG, "staged " + id + " items=" + items.length() + " text=" + meta.optString("text").length() + " skipped=" + skipped);
        return id;
    }

    @Override
    protected void onDestroy() {
        main.removeCallbacksAndMessages(null);
        super.onDestroy();
    }
}
