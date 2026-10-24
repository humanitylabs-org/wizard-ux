package ai.wizards.os.identity;

import android.app.Dialog;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.res.ColorStateList;
import android.graphics.Color;
import android.os.Build;
import android.os.CancellationSignal;
import android.os.Handler;
import android.os.Looper;
import android.text.InputType;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.EditText;
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
    private int base = Color.rgb(15,16,20), ink = Color.rgb(244,240,232), accent = Color.rgb(182,159,255), warning = Color.rgb(255,193,92);
    public WizardId(FragmentActivity activity) { this.activity = activity; vault = new KeyVault(activity); }
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
        accent = color(c, "accent", accent); warning = color(c, "warning", warning);
        if (ColorUtils.calculateContrast(accent, base) < 4.5) accent = ink;
        if (ColorUtils.calculateContrast(warning, base) < 4.5) warning = ink;
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
                button(b, "Advanced · message details", () -> details.setVisibility(details.getVisibility() == View.GONE ? View.VISIBLE : View.GONE));
            }
            button(b, encrypt ? "Approve & encrypt" : "Approve & open", () -> {
                try { authenticate(vault.newSigningCipher(), sentence.substring(0, Math.min(200, sentence.length())), cipher -> {
                    try { finish(value(encrypt ? "ciphertext" : "plaintext", vault.nip44(cipher, pubkey, data, encrypt))); }
                    catch (Exception e) { finish(value("denied", true)); }
                }); } catch (Exception e) { finish(value("denied", true)); }
            });
            button(b, "Cancel", this::cancel);
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
    private LinearLayout sheet(String title, boolean secret, Runnable back) {
        if (dialog != null) dialog.dismiss();
        Dialog d = new Dialog(activity); dialog = d;
        LinearLayout body = new LinearLayout(activity); body.setOrientation(LinearLayout.VERTICAL);
        int p = (int)(24 * activity.getResources().getDisplayMetrics().density);
        body.setPadding(p,p,p,p); body.setBackgroundColor(base);
        ScrollView scroll = new ScrollView(activity); scroll.addView(body); d.setContentView(scroll);
        if (secret) d.getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        d.setOnCancelListener(ignored -> cancel());
        d.setOnKeyListener((ignored, key, event) -> {
            if (key != KeyEvent.KEYCODE_BACK) return false;
            if (event.getAction() == KeyEvent.ACTION_UP) back.run();
            return true;
        });
        d.show(); d.getWindow().setGravity(Gravity.BOTTOM);
        d.getWindow().setLayout(WindowManager.LayoutParams.MATCH_PARENT, (int)(activity.getResources().getDisplayMetrics().heightPixels * .90));
        text(body, title, 24); return body;
    }
    private TextView text(LinearLayout body, String label, float size) {
        TextView t = new TextView(activity); t.setText(label); t.setTextSize(size); t.setTextColor(ink); t.setPadding(0,10,0,16); body.addView(t); return t;
    }
    private void button(LinearLayout body, String label, Runnable action) {
        Button b = new Button(activity); b.setText(label); b.setAllCaps(false); b.setTextColor(accent);
        b.setBackgroundTintList(ColorStateList.valueOf(ColorUtils.blendARGB(base,ink,.06f)));
        b.setFilterTouchesWhenObscured(true); b.setMinHeight((int)(48 * activity.getResources().getDisplayMetrics().density));
        b.setOnClickListener(v -> action.run()); body.addView(b);
    }
    private EditText input(LinearLayout body, String hint, boolean secret) {
        EditText e = new EditText(activity); e.setHint(hint); e.setTextColor(ink); e.setHintTextColor(ink); e.setSingleLine(true);
        e.setFilterTouchesWhenObscured(true);
        e.setInputType(InputType.TYPE_CLASS_TEXT | (secret ? InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD | InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS : InputType.TYPE_TEXT_FLAG_CAP_WORDS));
        e.setImportantForAutofill(View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS);
        if (Build.VERSION.SDK_INT >= 30) e.setImportantForContentCapture(View.IMPORTANT_FOR_CONTENT_CAPTURE_NO_EXCLUDE_DESCENDANTS);
        body.addView(e); return e;
    }
    private void onboarding() {
        LinearLayout b = sheet("Create your Wizard ID", false, this::cancel);
        text(b, "Your phone holds your key. Every signature needs your approval and a fingerprint or device PIN.", 16);
        if (Build.VERSION.SDK_INT < 30) text(b, "On Android 9–10 a strong enrolled biometric is required. Device-PIN signing requires Android 11 or newer.", 16);
        EditText name = input(b,"Your name",false), picture = input(b,"Photo URL (optional)",false);
        button(b,"Create key",() -> enroll(name.getText().toString().trim(), picture.getText().toString().trim(), null));
        button(b,"Use my existing key",() -> importScreen(name.getText().toString().trim()));
        button(b,"Cancel",this::cancel);
    }
    private void importScreen(String name) {
        LinearLayout b = sheet("I have a Wizard ID",true,this::onboarding);
        EditText display = input(b,"Your name",false); display.setText(name);
        EditText key = input(b,"Paste nsec or hex key",true);
        TextView status = text(b,"Choose a saved key or paste it here. Encrypted ncryptsec keys are not supported yet.",16);
        button(b,"Choose saved key",() -> getSavedKey(key::setText));
        button(b,"Import key",() -> {
            try { byte[] secret = Nip19.secret(key.getText().toString()); key.getText().clear(); enroll(display.getText().toString().trim(),"",secret); }
            catch (Exception e) { status.setText("That key is not a valid nsec or hex key."); }
        });
        button(b,"Back",this::onboarding); dialog.setOnDismissListener(d -> key.getText().clear());
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
        text(b,vault.name(),20); text(b,info().optString("npub"),13);
        text(b,vault.backedUp()?"Backed up":"Not backed up",16).setTextColor(vault.backedUp()?ink:warning);
        button(b,"Back up again",() -> backupScreen(false)); button(b,"Publish profile",this::profileApproval); button(b,"Done",() -> finish(info()));
    }
    private void backupScreen(boolean fresh) {
        LinearLayout b = sheet("Save your key",false,this::cancel); text(b,WARNING,16);
        Runnable done = fresh ? this::profileApproval : this::settings;
        button(b,"Save to password manager",() -> withBackup(secret -> saveToManager(secret,done)));
        button(b,"No password manager? Copy and check",() -> withBackup(secret -> manualBackup(secret,done)));
        button(b,"Not now",done);
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
    private void saveToManager(String secret, Runnable done) {
        int current = generation; credential = new CancellationSignal();
        CredentialManager.create(activity).createCredentialAsync(activity,new CreatePasswordRequest(vault.name(),secret),credential,ContextCompat.getMainExecutor(activity),
            new CredentialManagerCallback<CreateCredentialResponse, CreateCredentialException>() {
                @Override public void onResult(CreateCredentialResponse response) {
                    if (current != generation) return;
                    LinearLayout b = sheet("Check the backup",false,WizardId.this::cancel);
                    text(b,"Choose your saved Wizard ID once. Only a matching key marks it backed up.",16);
                    button(b,"Check saved key",() -> getSavedKey(saved -> {
                        if (matches(saved)) { vault.markBackedUp(); done.run(); }
                        else failure("That saved key does not match your Wizard ID. This backup has not been confirmed.");
                    })); button(b,"Cancel",WizardId.this::cancel);
                }
                @Override public void onError(CreateCredentialException error) { if (current == generation) manualBackup(secret,done); }
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
    private void manualBackup(String secret, Runnable done) {
        LinearLayout b = sheet("Save your key",true,this::cancel); text(b,WARNING,16);
        TextView key = text(b,secret,12); EditText confirm = input(b,"Paste the saved key to check",true);
        TextView status = text(b,"Paste the saved key to check",16);
        button(b,"Copy",() -> {
            ClipboardManager cm = (ClipboardManager)activity.getSystemService(Context.CLIPBOARD_SERVICE);
            ClipData clip = ClipData.newPlainText("Wizard ID secret",secret);
            if (Build.VERSION.SDK_INT >= 33) { android.os.PersistableBundle extras = new android.os.PersistableBundle(); extras.putBoolean("android.content.extra.IS_SENSITIVE",true); clip.getDescription().setExtras(extras); }
            cm.setPrimaryClip(clip);
            main.postDelayed(() -> { if (cm.getPrimaryClipDescription() != null && "Wizard ID secret".contentEquals(cm.getPrimaryClipDescription().getLabel())) cm.clearPrimaryClip(); },45000);
        });
        button(b,"Check backup",() -> {
            boolean match = matches(confirm.getText().toString()); confirm.getText().clear();
            if (match) { key.setText(""); vault.markBackedUp(); done.run(); } else status.setText("That key does not match. Save the key above and try again.");
        });
        button(b,"Cancel",this::cancel); dialog.setOnDismissListener(d -> { key.setText(""); confirm.getText().clear(); });
    }
    private void approval(JSONObject event, Consumer<JSONObject> signed) throws Exception {
        LinearLayout b = sheet("Wizard ID",false,this::cancel); String sentence = NostrEvent.sentence(event);
        requesterLabel(b);
        text(b,sentence,22); text(b,vault.name()+" · "+info().optString("npub"),14);
        String devices = NostrEvent.deviceBody(event); if (!devices.isEmpty()) text(b, devices, 16);
        TextView details = text(b,event.toString(2),12);
        if (!sentence.equals("Unfamiliar request")) {
            details.setVisibility(View.GONE); button(b,"Advanced · event details",() -> details.setVisibility(details.getVisibility()==View.GONE?View.VISIBLE:View.GONE));
        }
        button(b,"Approve & sign",() -> {
            try { authenticate(vault.newSigningCipher(),sentence.substring(0,Math.min(200,sentence.length())),cipher -> {
                try { byte[] digest = NostrEvent.digest(event); event.put("id",NostrEvent.hex(digest)).put("sig",vault.sign(cipher,digest)); signed.accept(event); }
                catch (Exception e) { finish(value("denied",true)); }
            }); } catch (Exception e) { finish(value("denied",true)); }
        });
        button(b,"Cancel",() -> finish(value("denied",true)));
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
        BiometricPrompt.PromptInfo.Builder b = new BiometricPrompt.PromptInfo.Builder().setTitle(title);
        if (Build.VERSION.SDK_INT >= 30) b.setAllowedAuthenticators(androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_STRONG | androidx.biometric.BiometricManager.Authenticators.DEVICE_CREDENTIAL);
        else b.setAllowedAuthenticators(androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_STRONG).setNegativeButtonText("Cancel");
        prompt.authenticate(b.build(),new BiometricPrompt.CryptoObject(cipher));
    }
    private void failure(String message) {
        if (imported != null) { Arrays.fill(imported,(byte)0); imported = null; }
        LinearLayout b = sheet("Wizard ID needs attention",false,() -> { if (vault.enrolled()) settings(); else onboarding(); });
        text(b,message,16); button(b,"Back",() -> { if (vault.enrolled()) settings(); else onboarding(); }); button(b,"Close",this::cancel);
    }
}
