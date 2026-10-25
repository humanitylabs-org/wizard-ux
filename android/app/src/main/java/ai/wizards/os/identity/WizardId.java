package ai.wizards.os.identity;

import android.app.Dialog;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.res.ColorStateList;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.RippleDrawable;
import android.os.Build;
import android.os.CancellationSignal;
import android.os.Handler;
import android.os.Looper;
import android.text.InputType;
import android.text.TextUtils;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowManager;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import androidx.biometric.BiometricPrompt;
import androidx.core.content.ContextCompat;
import androidx.core.graphics.ColorUtils;
import androidx.credentials.CreateCredentialResponse;
import androidx.credentials.CreatePasswordRequest;
import androidx.credentials.CredentialManager;
import androidx.credentials.CredentialManagerCallback;
import androidx.credentials.GetCredentialRequest;
import androidx.credentials.GetCredentialResponse;
import androidx.credentials.GetPasswordOption;
import androidx.credentials.PasswordCredential;
import androidx.credentials.exceptions.CreateCredentialException;
import androidx.credentials.exceptions.GetCredentialException;
import androidx.fragment.app.FragmentActivity;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.Arrays;
import java.util.Collections;
import java.util.function.Consumer;
import javax.crypto.Cipher;

/** The one native approval sheet, used for ALL event kinds. Never trusts requester descriptions. */
public final class WizardId {
    public static final String WARNING = "This key is your Wizard ID. Save it like a password. If you lose this phone and this key, your Wizard ID is gone for good, and nobody, including us, can reset it. Your Wizard and your files are not affected.";
    private final FragmentActivity activity;
    private final KeyVault vault;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final Runnable expire = this::cancel;
    private Consumer<JSONObject> completion;
    private Dialog dialog;
    private BiometricPrompt prompt;
    private CancellationSignal credential;
    private byte[] imported;
    private int generation;
    private boolean setupRequest;
    private String requester = "";
    private int base, ink, accent, warning, surface, secondary, muted, border;
    public WizardId(FragmentActivity activity) {
        this.activity = activity; vault = new KeyVault(activity);
        colors(ai.wizards.os.WizardLook.identityColors(activity));
    }
    private static JSONObject value(String key, Object value) {
        try { return new JSONObject().put(key, value); } catch (Exception e) { throw new IllegalStateException(e); }
    }
    public JSONObject info() {
        if (!vault.enrolled()) return value("none", true);
        try { return new JSONObject().put("npub", Nip19.encode("npub", NostrEvent.bytes(vault.publicKey())))
                .put("pubkey", vault.publicKey()).put("name", vault.name()).put("picture", vault.picture()).put("backed_up", vault.backedUp()); }
        catch (Exception e) { return value("none", true); }
    }
    public void colors(JSONObject c) {
        base = color(c, "base", base); ink = color(c, "ink", ink);
        if (ColorUtils.calculateContrast(ink, base) < 4.5) ink = ColorUtils.calculateLuminance(base) > .5 ? Color.BLACK : Color.WHITE;
        surface = color(c, "sheet", base);
        if (ColorUtils.calculateContrast(ink, surface) < 4.5) surface = base;
        accent = ColorUtils.compositeColors(color(c, "accent", ink), surface); warning = color(c, "warning", ink);
        secondary = readable(color(c, "secondary", ink), surface);
        muted = readable(color(c, "muted", secondary), surface);
        border = color(c, "border", ColorUtils.blendARGB(surface, ink, .18f));
        warning = readable(warning, surface);
    }
    private int readable(int color, int background) {
        return ColorUtils.calculateContrast(color, background) >= 4.5 ? color : ColorUtils.blendARGB(background, ink, .72f);
    }
    private int color(JSONObject c, String key, int fallback) { try { return Color.parseColor(c.getString(key)); } catch (Exception e) { return fallback; } }
    private boolean begin(Consumer<JSONObject> reply) {
        if (completion != null) { reply.accept(value("denied", true)); return false; }
        generation++; completion = reply; main.postDelayed(expire, 180000); return true;
    }
    public void setup(Consumer<JSONObject> reply) { if (begin(reply)) { requester = ""; setupRequest = true; if (vault.enrolled()) settings(); else onboarding(); } }
    public void sign(JSONObject input, String app, Consumer<JSONObject> reply) {
        if (!begin(reply)) return;
        requester = cleanRequester(app);
        setupRequest = false;
        try {
            if (!vault.enrolled()) throw new IllegalStateException("No Wizard ID");
            approval(NostrEvent.normalize(input, vault.publicKey(), System.currentTimeMillis()/1000), this::finish);
        } catch (Exception e) { finish(value("denied", true)); }
    }
    private static String cleanRequester(String app) {
        String safe = app == null ? "" : app.replaceAll("[\\p{Cc}\\p{Cf}]", "").trim();
        return safe.substring(0, Math.min(80, safe.length()));
    }
    private void requesterLabel(LinearLayout body) { if (!requester.isEmpty()) text(body, requester + " asks:", 16); }
    public void nip44(JSONObject params, boolean encrypt, String app, Consumer<JSONObject> reply) {
        if (!begin(reply)) return;
        setupRequest = false; requester = cleanRequester(app);
        try {
            if (!vault.enrolled()) throw new IllegalStateException("No Wizard ID");
            String pubkey = params.getString("pubkey"), data = params.getString(encrypt ? "plaintext" : "ciphertext");
            Nip44.publicKey(pubkey);
            if (encrypt) Nip44.validatePlaintext(data); else Nip44.validatePayload(data);
            String sentence = encrypt ? NostrEvent.encryptionSentence(data, pubkey, vault.publicKey()) : "Open a sealed message from " + NostrEvent.shortNpub(pubkey);
            LinearLayout b = sheet("Wizard ID", false, this::cancel); requesterLabel(b);
            text(b, sentence, 22); text(b, vault.name() + " · " + info().optString("npub"), 14);
            if (encrypt) {
                TextView details = text(b, data, 12); details.setVisibility(View.GONE);
                row(b, "Message details", "Inspect the message before approving", () -> details.setVisibility(details.getVisibility() == View.GONE ? View.VISIBLE : View.GONE));
            }
            button(b, encrypt ? "Approve & encrypt" : "Approve & open", () -> {
                try { authenticate(vault.newSigningCipher(), sentence.substring(0, Math.min(200, sentence.length())), cipher -> {
                    try { finish(value(encrypt ? "ciphertext" : "plaintext", vault.nip44(cipher, pubkey, data, encrypt))); }
                    catch (Exception e) { finish(value("denied", true)); }
                }); } catch (Exception e) { finish(value("denied", true)); }
            });

        } catch (Exception e) { finish(value("denied", true)); }
    }
    public void cancel() { if (completion != null) finish(value(setupRequest ? "cancelled" : "denied", true)); }
    private void finish(JSONObject result) {
        generation++; main.removeCallbacks(expire);
        if (imported != null) { Arrays.fill(imported, (byte)0); imported = null; }
        if (credential != null) { credential.cancel(); credential = null; }
        Consumer<JSONObject> done = completion; completion = null;
        if (prompt != null) { prompt.cancelAuthentication(); prompt = null; }
        if (dialog != null) { dialog.dismiss(); dialog = null; }
        if (done != null) done.accept(result);
    }
    private LinearLayout footer;
    private LinearLayout sheet(String title, boolean secret, Runnable back) { return sheet(title, secret, back, false); }
    /** Settings chrome stays outside the scroller, including with a keyboard or large text. */
    private LinearLayout sheet(String title, boolean secret, Runnable back, boolean previous) {
        if (dialog != null) dialog.dismiss();
        Dialog d = new Dialog(activity); dialog = d;
        d.requestWindowFeature(Window.FEATURE_NO_TITLE);
        LinearLayout root = new LinearLayout(activity); root.setOrientation(LinearLayout.VERTICAL);
        GradientDrawable material = new GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM, new int[]{surface, base});
        material.setCornerRadii(new float[]{dp(28),dp(28),dp(28),dp(28),0,0,0,0});
        material.setStroke(dp(1), border); root.setBackground(material); root.setClipToOutline(true);
        FrameLayout chrome = new FrameLayout(activity);
        View handle = new View(activity); handle.setBackground(round(ColorUtils.blendARGB(surface, ink, .28f), 0, 99));
        handle.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
        FrameLayout.LayoutParams hp = new FrameLayout.LayoutParams(dp(44), dp(4), Gravity.TOP | Gravity.CENTER_HORIZONTAL); hp.topMargin = dp(10);
        chrome.addView(handle, hp);
        TextView close = control("×", "Close Wizard ID", this::cancel, true);
        FrameLayout.LayoutParams cp = new FrameLayout.LayoutParams(dp(48), dp(48), Gravity.TOP | Gravity.END); cp.topMargin = dp(16); cp.rightMargin = dp(12);
        chrome.addView(close, cp); root.addView(chrome, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(68)));
        LinearLayout head = new LinearLayout(activity); head.setGravity(Gravity.CENTER_VERTICAL); head.setPadding(dp(20),0,dp(24),dp(16));
        if (previous) head.addView(control("‹", "Back", back, false), new LinearLayout.LayoutParams(dp(48),dp(48)));
        TextView heading = label(title, 28, ink, true); heading.setAccessibilityHeading(true);
        head.addView(heading, new LinearLayout.LayoutParams(0,ViewGroup.LayoutParams.WRAP_CONTENT,1)); root.addView(head);
        LinearLayout body = new LinearLayout(activity); body.setOrientation(LinearLayout.VERTICAL);
        body.setPadding(dp(24),0,dp(24),dp(32)); body.setFocusableInTouchMode(true);
        ScrollView scroll = new ScrollView(activity); scroll.setFillViewport(true); scroll.setClipToPadding(false);
        scroll.addView(body); root.addView(scroll, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT,0,1));
        // The screen's one confirmation stays pinned below the scroller, always visible above the keyboard.
        footer = new LinearLayout(activity); footer.setOrientation(LinearLayout.VERTICAL); footer.setPadding(dp(24),0,dp(24),dp(20));
        root.addView(footer, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT,ViewGroup.LayoutParams.WRAP_CONTENT)); d.setContentView(root);
        if (secret) d.getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        d.setCanceledOnTouchOutside(false);
        d.setOnCancelListener(ignored -> cancel());
        d.setOnKeyListener((ignored, key, event) -> {
            if (key != KeyEvent.KEYCODE_BACK) return false;
            if (event.getAction() == KeyEvent.ACTION_UP) back.run();
            return true;
        });
        d.getWindow().setBackgroundDrawableResource(android.R.color.transparent);
        d.getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE | WindowManager.LayoutParams.SOFT_INPUT_STATE_ALWAYS_HIDDEN);
        d.show(); d.getWindow().setGravity(Gravity.BOTTOM); d.getWindow().setDimAmount(.35f);
        d.getWindow().setLayout(activity.getResources().getDisplayMetrics().widthPixels - dp(16), (int)(activity.getResources().getDisplayMetrics().heightPixels * .90));
        return body;
    }
    private int dp(float value) { return Math.round(value * activity.getResources().getDisplayMetrics().density); }
    private GradientDrawable round(int fill, int stroke, int radius) {
        GradientDrawable g = new GradientDrawable(); g.setColor(fill); g.setCornerRadius(dp(radius));
        if (stroke != 0) g.setStroke(dp(1), stroke); return g;
    }
    private TextView label(String value, float size, int color, boolean bold) {
        TextView t = new TextView(activity); t.setText(value); t.setTextSize(size); t.setTextColor(color);
        t.setTypeface(bold ? Typeface.DEFAULT_BOLD : Typeface.DEFAULT); t.setLineSpacing(0,1.12f); return t;
    }
    private void actionable(View v, Runnable action) {
        v.setFilterTouchesWhenObscured(true); v.setFocusable(true); v.setOnClickListener(ignored -> action.run());
        v.setAccessibilityDelegate(new View.AccessibilityDelegate() {
            @Override public void onInitializeAccessibilityNodeInfo(View host, android.view.accessibility.AccessibilityNodeInfo info) {
                super.onInitializeAccessibilityNodeInfo(host,info); info.setClassName("android.widget.Button");
            }
        });
    }
    private TextView control(String glyph, String description, Runnable action, boolean circle) {
        TextView t = label(glyph, 30, secondary, false); t.setGravity(Gravity.CENTER); t.setContentDescription(description);
        t.setBackground(new RippleDrawable(ColorStateList.valueOf(ColorUtils.setAlphaComponent(ink,40)), round(circle ? ColorUtils.blendARGB(surface,ink,.06f) : Color.TRANSPARENT,0,99), round(Color.WHITE,0,99)));
        actionable(t,action); return t;
    }
    private TextView text(LinearLayout body, String label, float size) {
        TextView t = label(label,size,size >= 20 ? ink : secondary,size >= 20); t.setPadding(0,dp(8),0,dp(16)); body.addView(t); return t;
    }
    private void section(LinearLayout body, String title) {
        TextView t = label(title,13,muted,true); t.setPadding(0,dp(24),0,dp(4)); t.setAccessibilityHeading(true); body.addView(t);
    }
    /** st-row / st-tx / st-go: flat, divided, title + quiet subtitle, no grey Android buttons. */
    private void row(LinearLayout body, String title, String subtitle, Runnable action) {
        LinearLayout r = new LinearLayout(activity); r.setGravity(Gravity.CENTER_VERTICAL); r.setMinimumHeight(dp(72)); r.setPadding(0,dp(14),0,dp(14));
        LinearLayout tx = new LinearLayout(activity); tx.setOrientation(LinearLayout.VERTICAL);
        tx.addView(label(title,17,ink,true));
        if (!subtitle.isEmpty()) { TextView sub = label(subtitle,14,muted,false); sub.setPadding(0,dp(3),0,0); sub.setSingleLine(true); sub.setEllipsize(TextUtils.TruncateAt.END); tx.addView(sub); }
        r.addView(tx,new LinearLayout.LayoutParams(0,ViewGroup.LayoutParams.WRAP_CONTENT,1));
        TextView go = label("›",24,muted,false); go.setPadding(dp(12),0,dp(4),0); go.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO); r.addView(go);
        r.setBackground(new RippleDrawable(ColorStateList.valueOf(ColorUtils.setAlphaComponent(accent,32)),null,round(Color.WHITE,0,0)));
        actionable(r,action); body.addView(r,new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT,ViewGroup.LayoutParams.WRAP_CONTENT));
        View line = new View(activity); line.setBackgroundColor(border); body.addView(line,new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT,dp(1)));
    }
    /** One full-width accent pill for a screen's explicit confirmation. */
    private void button(LinearLayout body, String label, Runnable action) {
        int onAccent = ColorUtils.calculateContrast(Color.BLACK,accent) >= ColorUtils.calculateContrast(Color.WHITE,accent) ? Color.BLACK : Color.WHITE;
        TextView b = label(label,16,onAccent,true); b.setGravity(Gravity.CENTER); b.setMinHeight(dp(52)); b.setPadding(dp(16),dp(12),dp(16),dp(12));
        b.setBackground(new RippleDrawable(ColorStateList.valueOf(ColorUtils.setAlphaComponent(onAccent,32)),round(accent,0,99),round(Color.WHITE,0,99)));
        actionable(b,action); LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT,ViewGroup.LayoutParams.WRAP_CONTENT); p.topMargin = dp(12); (footer != null ? footer : body).addView(b,p);
    }
    private EditText input(LinearLayout body, String hint, boolean secret) {
        TextView fieldLabel = label(hint,13,muted,true); fieldLabel.setPadding(0,dp(16),0,dp(8)); body.addView(fieldLabel);
        EditText e = new EditText(activity); e.setId(View.generateViewId()); fieldLabel.setLabelFor(e.getId()); e.setContentDescription(hint);
        e.setTextColor(ink); e.setHintTextColor(muted); e.setSingleLine(true); e.setTextSize(16); e.setMinHeight(dp(54)); e.setPadding(dp(16),dp(12),dp(16),dp(12));
        int fill = ColorUtils.blendARGB(surface,ink,.06f);
        e.setBackground(round(fill,border,14));
        e.setOnFocusChangeListener((v,focused) -> e.setBackground(round(fill,focused ? accent : border,14)));
        e.setFilterTouchesWhenObscured(true);
        e.setInputType(InputType.TYPE_CLASS_TEXT | (secret ? InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD | InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS : InputType.TYPE_TEXT_FLAG_CAP_WORDS));
        if (secret) e.setImeOptions(android.view.inputmethod.EditorInfo.IME_FLAG_NO_PERSONALIZED_LEARNING);
        e.setImportantForAutofill(View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS);
        if (Build.VERSION.SDK_INT >= 30) e.setImportantForContentCapture(View.IMPORTANT_FOR_CONTENT_CAPTURE_NO_EXCLUDE_DESCENDANTS);
        body.addView(e); return e;
    }
    private void onboarding() {
        LinearLayout b = sheet("Create your Wizard ID", false, this::cancel);
        text(b, "Your phone holds your key. Every signature needs your approval and a fingerprint or device PIN.", 16);
        if (Build.VERSION.SDK_INT < 30) text(b, "On Android 9–10 a strong enrolled biometric is required. Device-PIN signing requires Android 11 or newer.", 16);
        section(b,"Your key");
        row(b,"Use my existing Nostr key","Import the nsec you already use",() -> importScreen(""));
        row(b,"Create a new key","A fresh ID made on this phone",this::createScreen);
    }
    private void createScreen() {
        LinearLayout b = sheet("Create a new key",false,this::onboarding,true);
        text(b,"Choose the name people will see on your Wizard ID.",16);
        EditText name = input(b,"Your name",false), picture = input(b,"Photo URL (optional)",false);
        button(b,"Create key",() -> enroll(name.getText().toString().trim(), picture.getText().toString().trim(), null));
    }
    private void importScreen(String name) {
        LinearLayout b = sheet("I have a Wizard ID",true,this::onboarding,true);
        EditText display = input(b,"Your name",false); display.setText(name);
        EditText key = input(b,"Paste nsec or hex key",true);
        TextView status = text(b,"Choose a saved key or paste it here. Encrypted ncryptsec keys are not supported yet.",16);
        row(b,"Choose saved key","From your password manager",() -> getSavedKey(key::setText));
        button(b,"Import key",() -> {
            try { byte[] secret = Nip19.secret(key.getText().toString()); key.getText().clear(); enroll(display.getText().toString().trim(),"",secret); }
            catch (Exception e) { status.setText("That key is not a valid nsec or hex key."); }
        });
        dialog.setOnDismissListener(d -> key.getText().clear());
    }
    private void enroll(String name, String picture, byte[] secret) {
        if (name.isEmpty() || name.length() > 120 || (!picture.isEmpty() && !picture.matches("https://[^\\s]+"))) {
            if (secret != null) Arrays.fill(secret,(byte)0); failure("Enter your name (up to 120 characters) and an optional HTTPS photo URL."); return;
        }
        imported = secret;
        try { authenticate(vault.newEnrollmentCipher(),"Create your Wizard ID",cipher -> {
            try { vault.finishEnrollment(cipher,name,picture,imported); imported = null; backupScreen(true); }
            catch (Exception e) { failure("Could not create your ID. Check your device lock and saved key."); }
        }); } catch (Exception e) { failure("Set a device PIN or fingerprint before creating your Wizard ID."); }
    }
    private void settings() {
        LinearLayout b = sheet("Wizard ID",false,this::cancel);
        section(b,"Your identity"); text(b,vault.name(),20); text(b,info().optString("npub"),13);
        section(b,"Recovery");
        text(b,vault.backedUp()?"Backed up":"Not backed up",16).setTextColor(vault.backedUp()?ink:warning);
        row(b,"Back up again","Save or check a copy of your key",() -> backupScreen(false));
        section(b,"Public profile"); row(b,"Publish profile","Review and sign your public name and photo",this::profileApproval);
    }
    private void backupScreen(boolean fresh) {
        LinearLayout b = sheet("Save your key",false,this::settings,true); text(b,WARNING,16);
        Runnable done = fresh ? this::profileApproval : this::settings;
        Runnable back = () -> backupScreen(fresh);
        section(b,"Backup options");
        row(b,"Save to password manager","Keep a protected copy of your key",() -> withBackup(secret -> saveToManager(secret,done,back)));
        row(b,"No password manager? Copy and check","Save your key another way",() -> withBackup(secret -> manualBackup(secret,done,back)));
        row(b,"Not now","You can do this later in Wizard ID",done);
    }
    private void profileApproval() {
        try {
            JSONObject profile = new JSONObject().put("kind",0).put("tags",new JSONArray()).put("content",new JSONObject().put("name",vault.name()).put("picture",vault.picture()).toString());
            approval(NostrEvent.normalize(profile,vault.publicKey(),System.currentTimeMillis()/1000), signed -> {
                if (signed.optBoolean("denied")) finish(value("cancelled",true));
                else { JSONObject result = info(); try { result.put("profile_event",signed); } catch (Exception ignored) { } finish(result); }
            });
        } catch (Exception e) { finish(value("cancelled",true)); }
    }
    private void withBackup(Consumer<String> consume) {
        try { authenticate(vault.newSigningCipher(),"Back up your Wizard ID",cipher -> {
            try { vault.backup(cipher,consume); } catch (Exception e) { failure("Could not unlock your key. Restore your saved backup on a new phone."); }
        }); } catch (Exception e) { failure("Could not unlock your key. Use your saved backup to restore your ID."); }
    }
    private void saveToManager(String secret, Runnable done, Runnable back) {
        int current = generation; credential = new CancellationSignal();
        CredentialManager.create(activity).createCredentialAsync(activity,new CreatePasswordRequest(vault.name(),secret),credential,ContextCompat.getMainExecutor(activity),
            new CredentialManagerCallback<CreateCredentialResponse, CreateCredentialException>() {
                @Override public void onResult(CreateCredentialResponse response) {
                    if (current != generation) return;
                    LinearLayout b = sheet("Check the backup",false,back,true);
                    text(b,"Choose your saved Wizard ID once. Only a matching key marks it backed up.",16);
                    button(b,"Check saved key",() -> getSavedKey(saved -> {
                        if (matches(saved)) { vault.markBackedUp(); done.run(); }
                        else failure("That saved key does not match your Wizard ID. This backup has not been confirmed.");
                    }));
                }
                @Override public void onError(CreateCredentialException error) { if (current == generation) manualBackup(secret,done,back); }
            });
    }
    private void getSavedKey(Consumer<String> consume) {
        int current = generation; credential = new CancellationSignal();
        GetCredentialRequest request = new GetCredentialRequest.Builder().addCredentialOption(new GetPasswordOption()).build();
        CredentialManager.create(activity).getCredentialAsync(activity,request,credential,ContextCompat.getMainExecutor(activity),
            new CredentialManagerCallback<GetCredentialResponse, GetCredentialException>() {
                @Override public void onResult(GetCredentialResponse response) {
                    if (current == generation && response.getCredential() instanceof PasswordCredential) consume.accept(((PasswordCredential)response.getCredential()).getPassword());
                }
                @Override public void onError(GetCredentialException error) { if (current == generation) failure("No saved key was selected. You can paste your key instead."); }
            });
    }
    private boolean matches(String value) { try { return vault.matchesBackup(value); } catch (Exception e) { return false; } }
    private void manualBackup(String secret, Runnable done, Runnable back) {
        LinearLayout b = sheet("Save your key",true,back,true); text(b,WARNING,16);
        TextView key = text(b,secret,12);
        row(b,"Copy","Cleared from the clipboard after 45 seconds",() -> {
            ClipboardManager cm = (ClipboardManager)activity.getSystemService(Context.CLIPBOARD_SERVICE);
            ClipData clip = ClipData.newPlainText("Wizard ID secret",secret);
            if (Build.VERSION.SDK_INT >= 33) { android.os.PersistableBundle extras = new android.os.PersistableBundle(); extras.putBoolean("android.content.extra.IS_SENSITIVE",true); clip.getDescription().setExtras(extras); }
            cm.setPrimaryClip(clip);
            main.postDelayed(() -> { if (cm.getPrimaryClipDescription() != null && "Wizard ID secret".contentEquals(cm.getPrimaryClipDescription().getLabel())) cm.clearPrimaryClip(); },45000);
        });
        EditText confirm = input(b,"Paste the saved key to check",true);
        TextView status = text(b,"Paste the saved key to check",16);
        // Inline, not pinned: Android's copy preview sits over the bottom of the screen and its Share chip
        // would catch a tap meant for a bottom pill, putting the key in a share sheet.
        footer.setVisibility(View.GONE); footer = null;
        button(b,"Check backup",() -> {
            boolean match = matches(confirm.getText().toString()); confirm.getText().clear();
            if (match) { key.setText(""); vault.markBackedUp(); done.run(); } else status.setText("That key does not match. Save the key above and try again.");
        });
        dialog.setOnDismissListener(d -> { key.setText(""); confirm.getText().clear(); });
    }
    private void approval(JSONObject event, Consumer<JSONObject> signed) throws Exception {
        LinearLayout b = sheet("Wizard ID",false,this::cancel); String sentence = NostrEvent.sentence(event);
        requesterLabel(b);
        text(b,sentence,22); text(b,vault.name()+" · "+info().optString("npub"),14);
        String devices = NostrEvent.deviceBody(event); if (!devices.isEmpty()) text(b, devices, 16);
        TextView details = text(b,event.toString(2),12);
        if (!sentence.equals("Unfamiliar request")) {
            details.setVisibility(View.GONE); row(b,"Event details","Inspect the event before signing",() -> details.setVisibility(details.getVisibility()==View.GONE?View.VISIBLE:View.GONE));
        }
        button(b,"Approve & sign",() -> {
            try { authenticate(vault.newSigningCipher(),sentence.substring(0,Math.min(200,sentence.length())),cipher -> {
                try { byte[] digest = NostrEvent.digest(event); event.put("id",NostrEvent.hex(digest)).put("sig",vault.sign(cipher,digest)); signed.accept(event); }
                catch (Exception e) { finish(value("denied",true)); }
            }); } catch (Exception e) { finish(value("denied",true)); }
        });

    }
    private void authenticate(Cipher cipher, String title, Consumer<Cipher> success) {
        int current = generation; if (dialog != null) { dialog.dismiss(); dialog = null; }
        prompt = new BiometricPrompt(activity,ContextCompat.getMainExecutor(activity),new BiometricPrompt.AuthenticationCallback() {
            @Override public void onAuthenticationSucceeded(BiometricPrompt.AuthenticationResult result) {
                if (current != generation || completion == null) return;
                prompt = null; Cipher bound = result.getCryptoObject()==null?null:result.getCryptoObject().getCipher();
                if (bound != cipher) finish(value("denied",true)); else success.accept(bound);
            }
            @Override public void onAuthenticationError(int code, CharSequence message) { if (current == generation) cancel(); }
        });
        // System credential screens drop the PIN field under a long title: short title, the full sentence as the description.
        String head = title.split(" · ", 2)[0];
        if (head.length() > 48) head = head.substring(0, 47) + "…";
        BiometricPrompt.PromptInfo.Builder b = new BiometricPrompt.PromptInfo.Builder().setTitle(head);
        if (!head.equals(title)) b.setDescription(title);
        if (Build.VERSION.SDK_INT >= 30) b.setAllowedAuthenticators(androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_STRONG | androidx.biometric.BiometricManager.Authenticators.DEVICE_CREDENTIAL);
        else b.setAllowedAuthenticators(androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_STRONG).setNegativeButtonText("Cancel");
        prompt.authenticate(b.build(),new BiometricPrompt.CryptoObject(cipher));
    }
    private void failure(String message) {
        if (imported != null) { Arrays.fill(imported,(byte)0); imported = null; }
        LinearLayout b = sheet("Wizard ID needs attention",false,() -> { if (vault.enrolled()) settings(); else onboarding(); },true);
        text(b,message,16);
    }
}
