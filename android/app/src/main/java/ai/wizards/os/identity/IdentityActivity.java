package ai.wizards.os.identity;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ClipData;
import android.content.ClipDescription;
import android.content.ClipboardManager;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.PersistableBundle;
import android.text.InputType;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.Arrays;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import javax.crypto.Cipher;

/**
 * Every Wizard ID screen: create or bring a key, save it to the password manager and check it, manage it, and the
 * one approval sheet that signs. Not exported: only Wizard OS itself can open it. FLAG_SECURE: no screenshots.
 * Back always steps back inside these screens; from the first screen it returns to Wizard OS (it never exits).
 */
public final class IdentityActivity extends Activity {
    private enum Screen { WELCOME, IMPORT, BACKUP, CHECK, DONE, MANAGE, SIGN }

    private static final int REQ_FILE = 71;
    private static final Pattern KEY_IN_TEXT = Pattern.compile("(ncryptsec1[02-9ac-hj-np-z]{20,}|nsec1[02-9ac-hj-np-z]{58})");
    private static final int BG = Color.rgb(5, 3, 12), INK = Color.rgb(244, 240, 255), INK2 = Color.rgb(184, 172, 220),
            INK3 = Color.rgb(132, 122, 168), VIOLET = Color.rgb(143, 99, 255), AMBER = Color.rgb(255, 190, 85), RED = Color.rgb(255, 107, 134);

    private final Handler main = new Handler(Looper.getMainLooper());
    private final ArrayDeque<Screen> history = new ArrayDeque<>();
    private KeyVault vault;
    private String reqId, mode;
    private boolean answered;
    private Screen screen;
    private LinearLayout body;
    private TextView error;
    private EditText importField, importPassword;

    /** Only while this flow is open: the fresh secret (wiped on finish) and what to hand back. */
    private byte[] pending;
    private final JSONArray signedOut = new JSONArray();
    private NostrEvent signEvent;
    private long askedAt;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        // No screenshots of key screens. Debug (QA) builds only: files/qa_screens.txt lets the emulator QA capture them.
        if (!(ai.wizards.os.BuildConfig.DEBUG && new java.io.File(getFilesDir(), "qa_screens.txt").isFile()))
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        vault = new KeyVault(this);
        Intent in = getIntent();
        reqId = in.getStringExtra(IdentityHub.EXTRA_ID);
        mode = in.getStringExtra(IdentityHub.EXTRA_MODE);
        askedAt = in.getLongExtra(IdentityHub.EXTRA_ASKED, System.currentTimeMillis());
        if (state != null || reqId == null) { // recreated after process death: the request is gone
            answer(null, "cancelled");
            finish();
            return;
        }
        ScrollView scroll = new ScrollView(this);
        scroll.setBackgroundColor(BG);
        scroll.setFillViewport(true);
        body = new LinearLayout(this);
        body.setOrientation(LinearLayout.VERTICAL);
        int p = dp(24);
        body.setPadding(p, p, p, p);
        scroll.addView(body, new ScrollView.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        scroll.setOnApplyWindowInsetsListener((v, insets) -> {
            if (Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets i = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.ime() | WindowInsets.Type.displayCutout());
                v.setPadding(i.left, i.top, i.right, i.bottom);
                return WindowInsets.CONSUMED;
            }
            return insets;
        });
        setContentView(scroll);
        if (IdentityHub.MODE_SIGN.equals(mode)) {
            if (!vault.exists()) { answer(null, "no-identity"); finish(); return; }
            try {
                JSONObject ev = new JSONObject(in.getStringExtra(IdentityHub.EXTRA_EVENT));
                signEvent = NostrEvent.fromRequest(ev, vault.publicKey(), System.currentTimeMillis() / 1000);
            } catch (JSONException | IllegalArgumentException | NullPointerException e) {
                answer(null, "invalid: " + (e instanceof IllegalArgumentException ? e.getMessage() : "bad event"));
                finish();
                return;
            }
            show(Screen.SIGN, false);
        } else {
            show(vault.exists() ? Screen.MANAGE : Screen.WELCOME, false);
        }
    }

    @Override
    public void onBackPressed() {
        if (screen == Screen.SIGN) { answer(null, "denied"); finish(); return; }
        if (screen == Screen.DONE) { finishOk(); return; }
        if (!history.isEmpty()) { show(history.pop(), false); return; }
        finishOk();
    }

    @Override
    protected void onDestroy() {
        wipe();
        if (!answered) answer(vault != null && !IdentityHub.MODE_SIGN.equals(mode) ? status() : null, IdentityHub.MODE_SIGN.equals(mode) ? "denied" : null);
        super.onDestroy();
    }

    @Override
    public void onSaveInstanceState(Bundle out, PersistableBundle p) { /* nothing secret is ever saved */ }

    /* ------------------------------------------------------------------ screens */

    private void show(Screen s, boolean push) {
        if (push && screen != null && screen != s) history.push(screen);
        screen = s;
        body.removeAllViews();
        error = null;
        revealed = false;
        switch (s) {
            case WELCOME: welcome(); break;
            case IMPORT: importScreen(); break;
            case BACKUP: backup(); break;
            case CHECK: check(); break;
            case DONE: done(); break;
            case MANAGE: manage(); break;
            case SIGN: sign(); break;
        }
    }

    private void welcome() {
        eyebrow("WIZARD ID", VIOLET);
        title("Create your Wizard ID");
        text("Your Wizard ID is how people and apps know it's you: your name on the apps you publish, your posts and your sign-ins. It's a key that lives on this phone, locked with your fingerprint or PIN.");
        EditText name = field("Your name (shown publicly)", InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_CAP_WORDS);
        name.setText(vault.name());
        small("Your name is published with your Wizard ID so people can find you.");
        errorLine();
        primary("Create my Wizard ID", v -> create(name.getText().toString()));
        secondary("I already have one", v -> show(Screen.IMPORT, true));
    }

    private void create(String name) {
        String lock = Unlock.lockHint(this);
        if (lock != null) { fail(lock); return; }
        Cipher c;
        try { c = vault.encryptCipher(); } catch (Exception e) { fail("This phone couldn't make a safe place for the key."); return; }
        Unlock.ask(this, "Create your Wizard ID", "Confirm it's you", c, new Unlock.Done() {
            @Override public void unlocked(Cipher u) {
                byte[] sk = Schnorr.newSecret();
                try {
                    String pub = vault.store(u, sk, name, "created", false);
                    String n = name.trim();
                    if (!n.isEmpty()) signedOut.put(profileEvent(sk, pub, n));
                    pending = sk;
                    IdentityHub.notifyChanged();
                    history.clear();
                    show(Screen.BACKUP, false);
                } catch (Exception e) {
                    Arrays.fill(sk, (byte) 0);
                    fail("Couldn't save your Wizard ID. Try again.");
                }
            }
            @Override public void failed(String why) { if (why != null) fail(why); }
        });
    }

    private JSONObject profileEvent(byte[] sk, String pub, String name) throws JSONException {
        JSONObject meta = new JSONObject().put("name", name).put("display_name", name);
        NostrEvent e = NostrEvent.fromRequest(new JSONObject().put("kind", 0).put("content", meta.toString()).put("tags", new JSONArray()),
                pub, System.currentTimeMillis() / 1000);
        return e.signed(pub, Schnorr.sign(e.id(pub), sk, pub));
    }

    private void backup() {
        eyebrow("STEP 2 OF 3", VIOLET);
        title("Save your key");
        warn("This key is your Wizard ID. Save it like a password.\n\nIf you lose this phone and this key, your Wizard ID is gone for good. Nobody, including us, can reset it. Your Wizard and your files aren't affected.");
        errorLine();
        primary("Save to my password manager", v -> Backup.save(this, Backup.label(vault.name(), vault.publicKey()), nsec(), (ok, why) -> {
            if (ok) show(Screen.CHECK, true);
            else if (why != null) { fail(why + " You can copy the key instead."); }
        }));
        secondary("Copy the key instead", v -> revealKey());
        link("Skip for now", v -> confirm("Skip the backup?",
                "Until you save your key, losing this phone means losing your Wizard ID. You can back it up later in Settings.",
                "Skip", () -> show(Screen.DONE, true)));
    }

    private boolean revealed;

    private void revealKey() {
        if (revealed) return;
        revealed = true;
        LinearLayout box = card(Color.argb(40, 143, 99, 255));
        TextView k = new TextView(this);
        k.setText(nsec());
        k.setTypeface(Typeface.MONOSPACE);
        k.setTextColor(INK);
        k.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
        box.addView(k);
        body.addView(box, Math.max(0, body.getChildCount() - 1));
        Button copy = button("Copy key", false);
        copy.setOnClickListener(v -> { copySecret(nsec()); copy.setText("Copied. Paste it into your password manager"); });
        body.addView(copy, Math.max(0, body.getChildCount() - 1));
        Button saved = button("I've saved it", true);
        saved.setOnClickListener(v -> show(Screen.CHECK, true));
        body.addView(saved, Math.max(0, body.getChildCount() - 1));
    }

    private void check() {
        eyebrow("STEP 3 OF 3", VIOLET);
        title("Check your backup");
        text("Get the key back from where you saved it, so we know it's really there.");
        errorLine();
        primary("Get it from my password manager", v -> Backup.get(this, (id, secret, why) -> {
            if (secret != null) checkAgainst(secret);
            else if (why != null) fail(why + " Paste it below instead.");
        }));
        EditText paste = field("Or paste the key here", InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD | InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS);
        secondary("Check", v -> checkAgainst(paste.getText().toString()));
        link("Skip for now", v -> show(Screen.DONE, true));
    }

    private void checkAgainst(String text) {
        String want = nsec();
        if (want != null && text != null && text.trim().equalsIgnoreCase(want)) {
            vault.markBackedUp();
            IdentityHub.notifyChanged();
            show(Screen.DONE, true);
        } else {
            fail("That isn't the same key. Save it again, then check.");
        }
    }

    private void done() {
        wipe();
        eyebrow("WIZARD ID", VIOLET);
        title("You're set");
        identityCard();
        if (!vault.backedUp()) warn("Not backed up yet. You can save your key any time from Settings → Wizard ID.");
        primary("Done", v -> finishOk());
        secondary("Copy your public key", v -> { copyPublic(); ((Button) v).setText("Copied"); });
    }

    private void importScreen() {
        eyebrow("WIZARD ID", VIOLET);
        title("Bring your Wizard ID");
        text("Use the key you saved when you made it. It starts with nsec, or ncryptsec if it's locked with a password.");
        errorLine();
        primary("Get it from my password manager", v -> Backup.get(this, (id, secret, why) -> {
            if (secret != null) { importField.setText(secret); doImport(true); }
            else if (why != null) fail(why);
        }));
        secondary("Choose a backup file", v -> {
            Intent pick = new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*");
            try { startActivityForResult(pick, REQ_FILE); } catch (RuntimeException e) { fail("No file picker on this phone."); }
        });
        importField = field("Or paste your key", InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD | InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS);
        importPassword = field("Its password (only for ncryptsec)", InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
        primary("Bring it in", v -> doImport(false));
    }

    @Override
    protected void onActivityResult(int code, int result, Intent data) {
        super.onActivityResult(code, result, data);
        if (code != REQ_FILE || result != RESULT_OK || data == null || data.getData() == null || importField == null) return;
        Uri u = data.getData();
        try (InputStream is = getContentResolver().openInputStream(u)) {
            byte[] buf = new byte[16384];
            int n = is == null ? -1 : is.read(buf);
            String text = n <= 0 ? "" : new String(buf, 0, n, StandardCharsets.UTF_8);
            Arrays.fill(buf, (byte) 0);
            Matcher m = KEY_IN_TEXT.matcher(text.toLowerCase(java.util.Locale.ROOT));
            if (m.find()) { importField.setText(m.group(1)); if (m.group(1).startsWith("ncryptsec")) importPassword.requestFocus(); }
            else fail("That file doesn't contain a Wizard ID key.");
        } catch (Exception e) {
            fail("Couldn't read that file.");
        }
    }

    private void doImport(boolean fromPasswordManager) {
        String text = importField.getText().toString(), pw = importPassword.getText().toString();
        String lock = Unlock.lockHint(this);
        if (lock != null) { fail(lock); return; }
        fail(KeyText.kind(text) == KeyText.Kind.NCRYPTSEC ? "Unlocking…" : null);
        new Thread(() -> { // scrypt for ncryptsec takes a few seconds
            byte[] sk = null; String err = null;
            try { sk = KeyText.secret(text, pw); }
            catch (Nip49.BadPassword e) { err = e.getMessage(); }
            catch (IllegalArgumentException e) { err = e.getMessage(); }
            catch (RuntimeException e) { err = "That key couldn't be read."; }
            final byte[] key = sk; final String why = err;
            main.post(() -> { if (key == null) fail(why); else storeImported(key, fromPasswordManager); });
        }, "wizard-id-import").start();
    }

    private void storeImported(byte[] sk, boolean fromPasswordManager) {
        Cipher c;
        try { c = vault.encryptCipher(); } catch (Exception e) { Arrays.fill(sk, (byte) 0); fail("This phone couldn't make a safe place for the key."); return; }
        Unlock.ask(this, "Bring in your Wizard ID", "Confirm it's you", c, new Unlock.Done() {
            @Override public void unlocked(Cipher u) {
                try {
                    vault.store(u, sk, "", "imported", true);
                    importField.setText("");
                    importPassword.setText("");
                    IdentityHub.notifyChanged();
                    history.clear();
                    show(Screen.DONE, false);
                } catch (Exception e) {
                    fail("Couldn't save your Wizard ID. Try again.");
                } finally {
                    Arrays.fill(sk, (byte) 0);
                }
            }
            @Override public void failed(String why) { Arrays.fill(sk, (byte) 0); if (why != null) fail(why); }
        });
    }

    private void manage() {
        eyebrow("WIZARD ID", VIOLET);
        title("Your Wizard ID");
        identityCard();
        errorLine();
        if (!vault.backedUp()) {
            warn("Not backed up. If you lose this phone, you lose your Wizard ID.");
            primary("Back up my key", v -> unlockForBackup());
        } else {
            secondary("Save my key to a password manager again", v -> unlockForBackup());
        }
        secondary("Copy your public key", v -> { copyPublic(); ((Button) v).setText("Copied"); });
        link("Remove from this phone", v -> confirm("Remove your Wizard ID from this phone?",
                vault.backedUp() ? "You can bring it back with the key in your password manager."
                        : "Your key isn't backed up. Without it, this Wizard ID is gone for good.",
                "Remove", () -> { vault.remove(); IdentityHub.notifyChanged(); history.clear(); show(Screen.WELCOME, false); }));
    }

    private void unlockForBackup() {
        Cipher c;
        try { c = vault.decryptCipher(); }
        catch (android.security.keystore.KeyPermanentlyInvalidatedException e) { fail("Your fingerprints changed, so this phone locked the key. Remove it here and bring it back from your password manager."); return; }
        catch (Exception e) { fail("This phone couldn't open the key."); return; }
        Unlock.ask(this, "Back up your Wizard ID", "Confirm it's you", c, new Unlock.Done() {
            @Override public void unlocked(Cipher u) {
                try {
                    pending = vault.withSecret(u, sk -> sk.clone());
                    show(Screen.BACKUP, true);
                } catch (Exception e) { fail("This phone couldn't open the key."); }
            }
            @Override public void failed(String why) { if (why != null) fail(why); }
        });
    }

    private void sign() {
        SignPolicy.Sentence s = SignPolicy.describe(signEvent);
        LinearLayout rail = card(Color.argb(36, 255, 190, 85));
        GradientDrawable g = (GradientDrawable) rail.getBackground();
        g.setStroke(dp(1), AMBER);
        TextView chip = new TextView(this);
        chip.setText("NEEDS YOUR APPROVAL");
        chip.setTextColor(AMBER);
        chip.setTypeface(Typeface.DEFAULT_BOLD);
        chip.setLetterSpacing(.12f);
        chip.setTextSize(TypedValue.COMPLEX_UNIT_SP, 11);
        rail.addView(chip);
        TextView t = new TextView(this);
        t.setText(s.title);
        t.setTextColor(INK);
        t.setTypeface(Typeface.DEFAULT_BOLD);
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, 24);
        t.setPadding(0, dp(8), 0, dp(4));
        rail.addView(t);
        if (!s.detail.isEmpty()) {
            TextView d = new TextView(this);
            d.setText(s.detail);
            d.setTextColor(INK2);
            d.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
            rail.addView(d);
        }
        TextView who = new TextView(this);
        String n = vault.name();
        who.setText("As " + (n.isEmpty() ? "" : n + " · ") + KeyText.shortNpub(vault.publicKey()) + "\nOne use · expires in 2 minutes");
        who.setTextColor(INK3);
        who.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
        who.setPadding(0, dp(12), 0, 0);
        rail.addView(who);
        body.addView(rail);
        if (!s.familiar) warn("Wizard OS doesn't recognise this kind of request. Only approve it if you know exactly what it is.");
        TextView raw = new TextView(this);
        raw.setTypeface(Typeface.MONOSPACE);
        raw.setTextColor(INK3);
        raw.setTextSize(TypedValue.COMPLEX_UNIT_SP, 11);
        try { raw.setText(signEvent.signed(vault.publicKey(), "").toString(2).replace(",\n  \"sig\": \"\"", "")); } catch (JSONException ignored) { }
        raw.setVisibility(s.familiar ? View.GONE : View.VISIBLE);
        errorLine();
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        Button deny = button("Deny", false), ok = button("Approve & sign", true);
        ok.setBackground(round(AMBER, 18));
        ok.setTextColor(Color.rgb(30, 18, 0));
        deny.setOnClickListener(v -> { answer(null, "denied"); finish(); });
        ok.setOnClickListener(v -> approve());
        LinearLayout.LayoutParams half = new LinearLayout.LayoutParams(0, dp(52), 1f);
        half.setMargins(0, dp(16), dp(6), 0);
        row.addView(deny, half);
        LinearLayout.LayoutParams half2 = new LinearLayout.LayoutParams(0, dp(52), 1f);
        half2.setMargins(dp(6), dp(16), 0, 0);
        row.addView(ok, half2);
        body.addView(row);
        link(s.familiar ? "Details" : "Hide details", v -> {
            boolean open = raw.getVisibility() == View.VISIBLE;
            raw.setVisibility(open ? View.GONE : View.VISIBLE);
            ((TextView) v).setText(open ? "Details" : "Hide details");
        });
        body.addView(raw);
    }

    private void approve() {
        if (System.currentTimeMillis() - askedAt > IdentityHub.SIGN_TTL_MS) { answer(null, "expired"); fail("This request expired. Ask again."); main.postDelayed(this::finish, 1200); return; }
        Cipher c;
        try { c = vault.decryptCipher(); }
        catch (android.security.keystore.KeyPermanentlyInvalidatedException e) { fail("Your fingerprints changed, so this phone locked the key. Open Settings → Wizard ID to bring it back."); return; }
        catch (Exception e) { fail("This phone couldn't open the key."); return; }
        String pub = vault.publicKey();
        Unlock.ask(this, "Approve & sign", SignPolicy.describe(signEvent).title, c, new Unlock.Done() {
            @Override public void unlocked(Cipher u) {
                try {
                    String sig = vault.withSecret(u, sk -> Schnorr.sign(signEvent.id(pub), sk, pub));
                    answer(new JSONObject().put("event", signEvent.signed(pub, sig)), null);
                    finish();
                } catch (Exception e) { fail("Couldn't sign. Nothing was sent."); }
            }
            @Override public void failed(String why) { if (why != null) fail(why); }
        });
    }

    /* ------------------------------------------------------------------ answers */

    private JSONObject status() {
        try {
            JSONObject o = new JSONObject().put("exists", vault.exists());
            if (vault.exists()) o.put("pubkey", vault.publicKey()).put("npub", KeyText.npub(vault.publicKey()))
                    .put("name", vault.name()).put("backedUp", vault.backedUp()).put("origin", vault.origin());
            if (signedOut.length() > 0) o.put("signed", signedOut);
            return o;
        } catch (JSONException e) { return new JSONObject(); }
    }

    private void finishOk() { answer(status(), null); finish(); }

    private void answer(JSONObject result, String err) {
        if (answered) return;
        answered = true;
        IdentityHub.finish(reqId, result, err);
    }

    private String nsec() {
        if (pending == null) return null;
        return KeyText.nsec(pending);
    }

    private void wipe() { if (pending != null) { Arrays.fill(pending, (byte) 0); pending = null; } }

    /* ------------------------------------------------------------------ small UI kit */

    private int dp(int v) { return Math.round(v * getResources().getDisplayMetrics().density); }

    private GradientDrawable round(int color, int radiusDp) {
        GradientDrawable g = new GradientDrawable();
        g.setColor(color);
        g.setCornerRadius(dp(radiusDp));
        return g;
    }

    private void eyebrow(String s, int color) {
        TextView t = new TextView(this);
        t.setText(s); t.setTextColor(color); t.setTypeface(Typeface.DEFAULT_BOLD); t.setLetterSpacing(.12f);
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, 11);
        t.setPadding(0, dp(24), 0, dp(6));
        body.addView(t);
    }

    private void title(String s) {
        TextView t = new TextView(this);
        t.setText(s); t.setTextColor(INK); t.setTypeface(Typeface.DEFAULT_BOLD);
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, 28);
        t.setPadding(0, 0, 0, dp(12));
        body.addView(t);
    }

    private void text(String s) {
        TextView t = new TextView(this);
        t.setText(s); t.setTextColor(INK2); t.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16);
        t.setLineSpacing(0, 1.2f);
        t.setPadding(0, 0, 0, dp(16));
        body.addView(t);
    }

    private void small(String s) {
        TextView t = new TextView(this);
        t.setText(s); t.setTextColor(INK3); t.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
        t.setPadding(dp(4), 0, 0, dp(12));
        body.addView(t);
    }

    private void warn(String s) {
        LinearLayout c = card(Color.argb(30, 255, 190, 85));
        TextView t = new TextView(this);
        t.setText(s); t.setTextColor(AMBER); t.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
        t.setLineSpacing(0, 1.2f);
        c.addView(t);
        body.addView(c);
    }

    private void errorLine() {
        error = new TextView(this);
        error.setTextColor(RED);
        error.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
        error.setVisibility(View.GONE);
        error.setPadding(0, dp(4), 0, dp(4));
        body.addView(error);
    }

    private void fail(String s) {
        if (error == null) return;
        error.setText(s == null ? "" : s);
        error.setTextColor(s != null && s.endsWith("…") ? INK2 : RED);
        error.setVisibility(s == null ? View.GONE : View.VISIBLE);
    }

    private LinearLayout card(int color) {
        LinearLayout c = new LinearLayout(this);
        c.setOrientation(LinearLayout.VERTICAL);
        c.setBackground(round(color, 18));
        c.setPadding(dp(16), dp(14), dp(16), dp(14));
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.setMargins(0, dp(4), 0, dp(12));
        c.setLayoutParams(lp);
        return c;
    }

    private void identityCard() {
        LinearLayout c = card(Color.argb(30, 205, 190, 255));
        TextView n = new TextView(this);
        String name = vault.name();
        n.setText(name.isEmpty() ? "Wizard ID" : name);
        n.setTextColor(INK); n.setTypeface(Typeface.DEFAULT_BOLD); n.setTextSize(TypedValue.COMPLEX_UNIT_SP, 18);
        c.addView(n);
        TextView k = new TextView(this);
        k.setText(KeyText.shortNpub(vault.publicKey()));
        k.setTypeface(Typeface.MONOSPACE); k.setTextColor(INK2); k.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
        c.addView(k);
        TextView st = new TextView(this);
        st.setText(vault.backedUp() ? "● Backed up" : "● Not backed up");
        st.setTextColor(vault.backedUp() ? Color.rgb(120, 220, 160) : AMBER);
        st.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
        st.setPadding(0, dp(6), 0, 0);
        c.addView(st);
        body.addView(c);
    }

    private EditText field(String hint, int type) {
        EditText e = new EditText(this);
        e.setHint(hint); e.setHintTextColor(INK3); e.setTextColor(INK);
        e.setInputType(type);
        e.setSingleLine(true);
        e.setBackground(round(Color.argb(28, 205, 190, 255), 14));
        e.setPadding(dp(14), dp(12), dp(14), dp(12));
        if (Build.VERSION.SDK_INT >= 26) e.setImportantForAutofill((type & InputType.TYPE_TEXT_VARIATION_PASSWORD) != 0 ? View.IMPORTANT_FOR_AUTOFILL_YES : View.IMPORTANT_FOR_AUTOFILL_NO);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.setMargins(0, dp(4), 0, dp(8));
        body.addView(e, lp);
        return e;
    }

    private Button button(String label, boolean primary) {
        Button b = new Button(this);
        b.setText(label); b.setAllCaps(false);
        b.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16);
        b.setTypeface(Typeface.DEFAULT_BOLD);
        b.setTextColor(primary ? Color.WHITE : INK);
        b.setBackground(round(primary ? VIOLET : Color.argb(36, 205, 190, 255), 18));
        b.setStateListAnimator(null);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(52));
        lp.setMargins(0, dp(6), 0, dp(6));
        b.setLayoutParams(lp);
        return b;
    }

    private void primary(String label, View.OnClickListener l) { Button b = button(label, true); b.setOnClickListener(l); body.addView(b); }
    private void secondary(String label, View.OnClickListener l) { Button b = button(label, false); b.setOnClickListener(l); body.addView(b); }

    private void link(String label, View.OnClickListener l) {
        TextView t = new TextView(this);
        t.setText(label); t.setTextColor(INK3); t.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
        t.setGravity(Gravity.CENTER);
        t.setPadding(0, dp(14), 0, dp(14));
        t.setOnClickListener(l);
        body.addView(t);
    }

    private void confirm(String title, String msg, String yes, Runnable then) {
        new AlertDialog.Builder(this, android.R.style.Theme_DeviceDefault_Dialog_Alert)
                .setTitle(title).setMessage(msg)
                .setPositiveButton(yes, (d, w) -> then.run())
                .setNegativeButton("Cancel", null)
                .show();
    }

    private void copyPublic() {
        ClipboardManager cm = getSystemService(ClipboardManager.class);
        if (cm != null) cm.setPrimaryClip(ClipData.newPlainText("Wizard ID", KeyText.npub(vault.publicKey())));
    }

    /** The private key on the clipboard: marked sensitive (hidden from previews) and cleared after a minute. */
    private void copySecret(String s) {
        ClipboardManager cm = getSystemService(ClipboardManager.class);
        if (cm == null || s == null) return;
        ClipData clip = ClipData.newPlainText("Wizard ID key", s);
        if (Build.VERSION.SDK_INT >= 24) {
            PersistableBundle extras = new PersistableBundle();
            extras.putBoolean(Build.VERSION.SDK_INT >= 33 ? ClipDescription.EXTRA_IS_SENSITIVE : "android.content.extra.IS_SENSITIVE", true);
            clip.getDescription().setExtras(extras);
        }
        cm.setPrimaryClip(clip);
        main.postDelayed(() -> {
            try {
                ClipData now = cm.getPrimaryClip();
                if (now != null && now.getItemCount() > 0 && s.contentEquals(String.valueOf(now.getItemAt(0).getText()))) {
                    if (Build.VERSION.SDK_INT >= 28) cm.clearPrimaryClip();
                    else cm.setPrimaryClip(ClipData.newPlainText("", ""));
                }
            } catch (RuntimeException ignored) { }
        }, 60_000);
    }
}
