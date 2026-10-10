package ai.wizards.os.identity;

import android.app.Activity;
import android.hardware.biometrics.BiometricManager;
import android.hardware.biometrics.BiometricPrompt;
import android.os.Build;
import android.os.CancellationSignal;

import javax.crypto.Cipher;

/**
 * The platform biometric/PIN prompt bound to one Keystore operation (no AndroidX: MainActivity is a plain Activity).
 * API 30+: fingerprint, face or the phone's PIN. API 28-29: fingerprint/face only (Android can't bind a PIN to one use).
 */
public final class Unlock {
    public interface Done {
        void unlocked(Cipher c);
        void failed(String why); // null = the owner cancelled
    }

    private Unlock() {}

    public static void ask(Activity a, String title, String subtitle, Cipher cipher, Done done) {
        BiometricPrompt.Builder b = new BiometricPrompt.Builder(a).setTitle(title);
        if (subtitle != null && !subtitle.isEmpty()) b.setSubtitle(subtitle);
        if (Build.VERSION.SDK_INT >= 30) {
            b.setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG | BiometricManager.Authenticators.DEVICE_CREDENTIAL);
        } else {
            b.setNegativeButton("Cancel", a.getMainExecutor(), (d, w) -> done.failed(null));
        }
        if (Build.VERSION.SDK_INT >= 29) b.setConfirmationRequired(false);
        CancellationSignal cancel = new CancellationSignal();
        try {
            b.build().authenticate(new BiometricPrompt.CryptoObject(cipher), cancel, a.getMainExecutor(), new BiometricPrompt.AuthenticationCallback() {
                @Override public void onAuthenticationSucceeded(BiometricPrompt.AuthenticationResult r) {
                    BiometricPrompt.CryptoObject o = r.getCryptoObject();
                    if (o == null || o.getCipher() == null) { done.failed("This phone didn't unlock the key."); return; }
                    done.unlocked(o.getCipher());
                }
                @Override public void onAuthenticationError(int code, CharSequence msg) {
                    boolean cancelled = code == BiometricPrompt.BIOMETRIC_ERROR_USER_CANCELED || code == BiometricPrompt.BIOMETRIC_ERROR_CANCELED
                            || code == 13 /* BIOMETRIC_ERROR_NEGATIVE_BUTTON (androidx name; platform: the negative button) */;
                    done.failed(cancelled ? null : String.valueOf(msg));
                }
            });
        } catch (RuntimeException e) {
            done.failed(lockHint(a));
        }
    }

    /** Null when the phone can unlock Wizard ID; otherwise a sentence saying what to set up. */
    public static String lockHint(Activity a) {
        android.app.KeyguardManager km = a.getSystemService(android.app.KeyguardManager.class);
        if (km == null || !km.isDeviceSecure()) return "Set a screen lock (PIN, pattern or fingerprint) on this phone first. Wizard ID uses it to protect your key.";
        if (Build.VERSION.SDK_INT >= 30) {
            int ok;
            try {
                BiometricManager bm = a.getSystemService(BiometricManager.class);
                ok = bm == null ? BiometricManager.BIOMETRIC_ERROR_HW_UNAVAILABLE
                        : bm.canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG | BiometricManager.Authenticators.DEVICE_CREDENTIAL);
            } catch (RuntimeException e) { // never crash the flow on a phone that refuses the check
                return "This phone's screen lock can't protect a key right now.";
            }
            return ok == BiometricManager.BIOMETRIC_SUCCESS ? null : "This phone's screen lock can't protect a key right now.";
        }
        return null;
    }
}
