package ai.wizards.os.photos;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import org.json.JSONObject;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import java.security.KeyStore;
import java.util.HashSet;
import java.util.Set;
import java.util.UUID;
import ai.wizards.os.BuildConfig;

/** Secrets never cross the WebView bridge or Android backups. Fail closed on key loss. */
public final class BackupSettings {
    private final Context context;
    public final SharedPreferences prefs;
    private static final String ALIAS = "wizard.photos.v1";
    public BackupSettings(Context c) { context = c.getApplicationContext(); prefs = context.getSharedPreferences("photos_backup", Context.MODE_PRIVATE); }
    private SecretKey key() throws Exception {
        KeyStore ks = KeyStore.getInstance("AndroidKeyStore"); ks.load(null);
        if (ks.containsAlias(ALIAS)) return (SecretKey) ks.getKey(ALIAS, null);
        KeyGenerator gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        gen.init(new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());
        return gen.generateKey();
    }
    public synchronized JSONObject secret(String name) throws Exception {
        String raw = prefs.getString(name, ""); if (raw.isEmpty()) return new JSONObject();
        String[] parts = raw.split(":", 2);
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, Base64.decode(parts[0], Base64.NO_WRAP)));
        cipher.updateAAD(name.getBytes(java.nio.charset.StandardCharsets.UTF_8));
        return new JSONObject(new String(cipher.doFinal(Base64.decode(parts[1], Base64.NO_WRAP)), java.nio.charset.StandardCharsets.UTF_8));
    }
    public synchronized void secret(String name, JSONObject value) throws Exception {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.ENCRYPT_MODE, key());
        cipher.updateAAD(name.getBytes(java.nio.charset.StandardCharsets.UTF_8));
        String stored = Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP) + ":" + Base64.encodeToString(cipher.doFinal(value.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8)), Base64.NO_WRAP);
        if (!prefs.edit().putString(name, stored).commit()) throw new java.io.IOException("Could not save credentials");
    }
    public String server() { return prefs.getString("server", BuildConfig.PHOTOS_SERVER); }
    public String generation() { return prefs.getString("generation", ""); }
    public void change() { prefs.edit().putString("generation", UUID.randomUUID().toString()).commit(); }
    public boolean enabled() { return prefs.getBoolean("enabled", false); }
    public boolean wifi() { return prefs.getBoolean("wifi", true); }
    public boolean initialCharging() { return prefs.getBoolean("charge", true) && !prefs.getBoolean("initial_done", false); }
    public Set<String> albums() { return new HashSet<>(prefs.getStringSet("albums", java.util.Collections.emptySet())); }
    public boolean selected(String bucket, String name) { return prefs.contains("albums") ? albums().contains(bucket) : BackupPolicy.defaultAlbum(name); }
    public synchronized void connect(String server, String key, String user) throws Exception {
        // Store account binding with the key, not independently mutable preferences.
        prefs.edit().putBoolean("enabled", false).commit(); change(); BackupScheduler.cancel(context);
        secret("credentials", new JSONObject().put("server", server).put("key", key).put("user", user));
        prefs.edit().putString("server", server).putBoolean("initial_done", false).putLong("last_sync", 0)
                .putInt("done", 0).putInt("total", 0).putString("status", "Connected · choose albums and enable backup").commit();
        // The owner tapped the backup switch before signing in: finish what they asked for.
        if (prefs.getBoolean("enable_after_signin", false)) {
            prefs.edit().remove("enable_after_signin").putBoolean("enabled", true).putString("status", "Signed in · backup is on").commit();
            change();
        }
    }
    public boolean connected() {
        try { return secret("credentials").has("key"); } catch (Exception e) { return false; }
    }
    public void disconnect() {
        prefs.edit().putBoolean("enabled", false).remove("credentials").remove("oauth").remove("enable_after_signin").putBoolean("initial_done", false)
                .putLong("last_sync", 0).putInt("done", 0).putInt("total", 0).putString("status", "Disconnected · server originals kept").commit();
        change(); BackupScheduler.cancel(context);
    }
    public String scope(JSONObject auth) throws Exception { return BackupPolicy.digest(auth.getString("server") + "\n" + auth.getString("user")); }
    public String device() {
        String id = prefs.getString("device", "");
        if (id.isEmpty()) { id = UUID.randomUUID().toString(); prefs.edit().putString("device", id).commit(); }
        return id;
    }
    public void status(String status) { prefs.edit().putString("status", status).apply(); }
}
