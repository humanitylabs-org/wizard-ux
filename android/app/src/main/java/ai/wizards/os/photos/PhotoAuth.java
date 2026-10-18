package ai.wizards.os.photos;

import android.content.Context;
import android.net.Uri;
import java.security.SecureRandom;
import java.util.Base64;
import org.json.JSONObject;
import org.json.JSONArray;

/** OAuth state and PKCE are generated here, bound to the selected server, encrypted at rest. */
public final class PhotoAuth {
    private final BackupSettings settings;
    public PhotoAuth(Context c) { settings=new BackupSettings(c); }
    private static String random() { byte[] b=new byte[32]; new SecureRandom().nextBytes(b); return Base64.getUrlEncoder().withoutPadding().encodeToString(b); }
    private static ImmichClient api(String server,String key,String bearer) { return new ImmichClient(server,key,bearer,()->{}); }
    public String start(String server) throws Exception {
        String state=random(),verifier=random();
        JSONObject pending=new JSONObject().put("server",server).put("state",state).put("verifier",verifier).put("at",System.currentTimeMillis());
        settings.secret("oauth",pending);
        String url=api(server,"","").json("/oauth/authorize","POST",new JSONObject().put("redirectUri",BackupPolicy.CALLBACK)
                .put("state",state).put("codeChallenge",BackupPolicy.digest(verifier))).getString("url");
        Uri uri=Uri.parse(url);
        if(!"https".equals(uri.getScheme()) || !state.equals(uri.getQueryParameter("state"))) throw new SecurityException("Invalid authorization response");
        return url;
    }
    public void finish(String callback) throws Exception {
        JSONObject pending=settings.secret("oauth");
        if(System.currentTimeMillis()-pending.getLong("at")>10*60*1000 || !BackupPolicy.validCallback(callback,pending.getString("state"))) throw new SecurityException("Expired or unrequested sign-in");
        // Consume before exchanging. Replayed deep links cannot create another long-lived key.
        settings.prefs.edit().remove("oauth").commit();
        String server=pending.getString("server");
        JSONObject login=api(server,"","").json("/oauth/callback","POST",new JSONObject().put("url",callback).put("state",pending.getString("state")).put("codeVerifier",pending.getString("verifier")));
        ImmichClient session=api(server,"",login.getString("accessToken"));
        try {
            JSONObject created=session.json("/api-keys","POST",new JSONObject().put("name","Wizard Android "+settings.device().substring(0,8))
                    .put("permissions",new JSONArray().put("asset.upload").put("asset.read").put("user.read")));
            try { settings.connect(server,created.getString("secret"),login.getString("userId")); }
            catch(Exception failure) { try { session.json("/api-keys/"+created.getString("id"),"DELETE",null); } catch(Exception ignored) {} throw failure; }
        } finally { try { session.json("/auth/logout","POST",new JSONObject()); } catch(Exception ignored) {} }
    }
    /** Test/advanced injection uses the same account binding and encryption as OAuth. */
    public void apiKey(String server,String key) throws Exception {
        String user=api(server,key,"").json("/users/me","GET",null).getString("id");
        settings.connect(server,key,user);
    }
}
