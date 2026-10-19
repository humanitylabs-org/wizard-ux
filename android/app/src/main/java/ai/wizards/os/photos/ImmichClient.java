package ai.wizards.os.photos;

import org.json.JSONObject;
import org.json.JSONArray;
import java.net.HttpURLConnection;
import java.net.URL;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.UUID;
import java.security.MessageDigest;
import java.util.Base64;

/** Immich v3.3.3 REST client. No redirect following (credentials must stay on the chosen origin). */
public final class ImmichClient {
    public interface Guard { void check() throws IOException; }
    public static final class HttpFailure extends IOException {
        public final int code;
        HttpFailure(int code) { super("Photo server returned HTTP " + code); this.code=code; }
    }
    private final String server, key, bearer;
    private final Guard guard;
    private volatile HttpURLConnection active;
    public ImmichClient(String server, String key, String bearer, Guard guard) { this.server=server; this.key=key; this.bearer=bearer; this.guard=guard; }
    public void cancel() { HttpURLConnection c=active; if(c!=null) c.disconnect(); }
    private HttpURLConnection open(String path, String method) throws IOException {
        guard.check(); HttpURLConnection c=(HttpURLConnection)new URL(server+"/api"+path).openConnection(); active=c;
        c.setRequestMethod(method); c.setInstanceFollowRedirects(false); c.setConnectTimeout(20000); c.setReadTimeout(60000);
        c.setRequestProperty("Accept","application/json"); c.setRequestProperty("User-Agent","Wizard-Photos/1 Android");
        if(!key.isEmpty()) c.setRequestProperty("x-api-key",key);
        if(!bearer.isEmpty()) c.setRequestProperty("Authorization","Bearer "+bearer);
        return c;
    }
    private JSONObject response(HttpURLConnection c) throws Exception {
        guard.check(); int code=c.getResponseCode(); if(code<200 || code>=300) throw new HttpFailure(code);
        try(InputStream in=c.getInputStream(); ByteArrayOutputStream out=new ByteArrayOutputStream()) {
            byte[] b=new byte[8192]; int n;
            while((n=in.read(b))!=-1) { if(out.size()+n>2*1024*1024) throw new IOException("Response too large"); out.write(b,0,n); }
            return out.size()==0 ? new JSONObject() : new JSONObject(out.toString("UTF-8"));
        }
    }
    public JSONObject json(String path, String method, JSONObject body) throws Exception {
        HttpURLConnection c=open(path,method);
        try {
            if(body!=null) { byte[] bytes=body.toString().getBytes(StandardCharsets.UTF_8); c.setDoOutput(true); c.setRequestProperty("Content-Type","application/json"); c.setFixedLengthStreamingMode(bytes.length); try(OutputStream out=c.getOutputStream()) { out.write(bytes); } }
            return response(c);
        } finally { c.disconnect(); active=null; }
    }
    public String duplicate(String id,String checksum) throws Exception {
        JSONObject request=new JSONObject().put("assets",new JSONArray().put(new JSONObject().put("id",id).put("checksum",checksum)));
        JSONArray results=json("/assets/bulk-upload-check","POST",request).getJSONArray("results");
        if(results.length()!=1) throw new IOException("Invalid duplicate response");
        JSONObject r=results.getJSONObject(0); if(!id.equals(r.getString("id"))) throw new IOException("Mismatched duplicate response");
        if("accept".equals(r.getString("action"))) return "";
        if("reject".equals(r.getString("action")) && "duplicate".equals(r.optString("reason")) && !r.optBoolean("isTrashed",false)) return r.getString("assetId");
        throw new IOException("Server rejected original or it is in the server trash");
    }
    private static String field(String boundary,String name,String value) { return "--"+boundary+"\r\nContent-Disposition: form-data; name=\""+name+"\"\r\n\r\n"+value+"\r\n"; }
    public String upload(PhotoLibrary library,PhotoLibrary.Item item,String checksum) throws Exception {
        String boundary="Wizard"+UUID.randomUUID().toString().replace("-","");
        // v3 removed deviceId/deviceAssetId. Sending obsolete fields fails strict server validation.
        String header=field(boundary,"fileCreatedAt",Instant.ofEpochMilli(item.created).toString())
                +field(boundary,"fileModifiedAt",Instant.ofEpochMilli(item.modified).toString())
                +"--"+boundary+"\r\nContent-Disposition: form-data; name=\"assetData\"; filename=\""+BackupPolicy.filename(item.name)+"\"\r\nContent-Type: "+item.mime.replaceAll("[\r\n]","")+"\r\n\r\n";
        byte[] prefix=header.getBytes(StandardCharsets.UTF_8), suffix=("\r\n--"+boundary+"--\r\n").getBytes(StandardCharsets.UTF_8);
        HttpURLConnection c=open("/assets","POST");
        try {
            c.setDoOutput(true); c.setReadTimeout(120000); c.setRequestProperty("Content-Type","multipart/form-data; boundary="+boundary); c.setRequestProperty("x-immich-checksum",checksum);
            c.setFixedLengthStreamingMode(prefix.length+item.size+suffix.length);
            try(InputStream in=library.original(item); OutputStream out=c.getOutputStream()) {
                out.write(prefix); byte[] b=new byte[64*1024]; int n; long sent=0; MessageDigest digest=MessageDigest.getInstance("SHA-1");
                while((n=in.read(b))!=-1) { guard.check(); sent+=n; if(sent>item.size) throw new IOException("Original changed during upload"); digest.update(b,0,n); out.write(b,0,n); }
                if(sent!=item.size || !checksum.equals(Base64.getEncoder().encodeToString(digest.digest()))) throw new IOException("Original changed during upload");
                out.write(suffix);
            }
            return response(c).getString("id");
        } finally { c.disconnect(); active=null; }
    }
}
