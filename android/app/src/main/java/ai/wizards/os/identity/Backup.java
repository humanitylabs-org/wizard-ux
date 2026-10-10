package ai.wizards.os.identity;

import android.app.Activity;
import android.app.PendingIntent;
import android.content.Context;
import android.os.CancellationSignal;

import androidx.credentials.CreateCredentialResponse;
import androidx.credentials.CreatePasswordRequest;
import androidx.credentials.Credential;
import androidx.credentials.CredentialManager;
import androidx.credentials.CredentialManagerCallback;
import androidx.credentials.GetCredentialRequest;
import androidx.credentials.GetCredentialResponse;
import androidx.credentials.GetPasswordOption;
import androidx.credentials.PasswordCredential;
import androidx.credentials.exceptions.CreateCredentialCancellationException;
import androidx.credentials.exceptions.CreateCredentialException;
import androidx.credentials.exceptions.GetCredentialCancellationException;
import androidx.credentials.exceptions.GetCredentialException;

/**
 * The phone's own password manager (Google Password Manager, Bitwarden, 1Password … whatever Android's Credential
 * Manager offers). Wizard ID saves the key there as a password and reads it back to check the backup or restore.
 */
public final class Backup {
    public interface Saved { void done(boolean ok, String why); }          // why == null: cancelled
    public interface Got { void done(String id, String secretText, String why); }

    private Backup() {}

    /** The "username" the password manager shows next to the key. */
    public static String label(String name, String pubkeyHex) {
        String n = name == null ? "" : name.trim();
        return "Wizard ID" + (n.isEmpty() ? "" : " · " + n) + " (" + KeyText.shortNpub(pubkeyHex) + ")";
    }

    public static void save(Activity a, String label, String nsec, Saved cb) {
        CredentialManager cm = CredentialManager.create(a);
        cm.createCredentialAsync(a, new CreatePasswordRequest(label, nsec), new CancellationSignal(), a.getMainExecutor(),
                new CredentialManagerCallback<CreateCredentialResponse, CreateCredentialException>() {
                    @Override public void onResult(CreateCredentialResponse r) { cb.done(true, ""); }
                    @Override public void onError(CreateCredentialException e) {
                        cb.done(false, e instanceof CreateCredentialCancellationException ? null : "Your password manager didn't save it.");
                    }
                });
    }

    public static void get(Activity a, Got cb) {
        CredentialManager cm = CredentialManager.create(a);
        GetCredentialRequest req = new GetCredentialRequest.Builder().addCredentialOption(new GetPasswordOption()).build();
        cm.getCredentialAsync(a, req, new CancellationSignal(), a.getMainExecutor(),
                new CredentialManagerCallback<GetCredentialResponse, GetCredentialException>() {
                    @Override public void onResult(GetCredentialResponse r) {
                        Credential c = r.getCredential();
                        if (c instanceof PasswordCredential) cb.done(((PasswordCredential) c).getId(), ((PasswordCredential) c).getPassword(), "");
                        else cb.done(null, null, "That isn't a saved password.");
                    }
                    @Override public void onError(GetCredentialException e) {
                        cb.done(null, null, e instanceof GetCredentialCancellationException ? null : "No saved Wizard ID found in your password manager.");
                    }
                });
    }
}
