package ai.wizards.os;

import android.content.Context;
import android.os.SystemClock;
import org.json.JSONArray;
import org.json.JSONObject;

/** Session-only geometry/probe recorder. No page text, thread IDs, URLs, or raw Bundles. */
final class ScrollCaptureDiagnostics {
    static final ScrollDiagnosticsRing RING = new ScrollDiagnosticsRing();
    private static final android.os.Handler MAIN = new android.os.Handler(android.os.Looper.getMainLooper());
    private static JSONObject session;
    private static volatile long armedUntil;
    private static long generation, delivered;
    private static boolean uploading, retryRequested;
    static JSONObject fields(Object... kv) {
        JSONObject out = new JSONObject();
        try { for (int i=0;i<kv.length;i+=2) out.put((String)kv[i], kv[i+1]); }
        catch (org.json.JSONException ignored) { }
        return out;
    }
    @android.annotation.SuppressLint("PrivateApi")
    static synchronized void init(Context c) {
        if (session != null) return;
        session = fields("id", java.util.UUID.randomUUID().toString(), "manufacturer", android.os.Build.MANUFACTURER,
            "model", android.os.Build.MODEL, "sdk", android.os.Build.VERSION.SDK_INT,
            "appVersion", BuildConfig.VERSION_NAME, "versionCode", BuildConfig.VERSION_CODE);
        try {
            String oneui=(String)Class.forName("android.os.SystemProperties").getMethod("get",String.class)
                .invoke(null,"ro.build.version.oneui");
            if (oneui != null && !oneui.isEmpty()) session.put("oneui",oneui);
        } catch (Exception ignored) { }
        try {
            android.content.pm.PackageInfo p=android.webkit.WebView.getCurrentWebViewPackage();
            if(p!=null) session.put("webviewPackage",p.packageName).put("webviewVersion",p.versionName);
            String enabled=android.provider.Settings.Secure.getString(c.getContentResolver(),
                android.provider.Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES);
            JSONArray services=new JSONArray();
            if(enabled!=null) for(String name:enabled.split(":")) if(name.length()<256) services.put(name);
            session.put("accessibilityServices",services);
        } catch (Exception ignored) { }
    }
    static boolean armed() { return SystemClock.uptimeMillis() < armedUntil; }
    static synchronized void arm(String reason) {
        armedUntil=SystemClock.uptimeMillis()+60000; generation++;
        record("arm",fields("reason",reason));
    }
    // Accessibility services (password managers, voice tools) query the node tree hundreds of times
    // a second; during a capture they flooded the 400-event ring and hid the session's end.
    static volatile boolean capturing;
    static void gated(String method, JSONObject data) {
        if(capturing && method.contains("ccessibility")) return;
        if(armed()) record(method,data);
    }
    static void record(String method, JSONObject data) {
        Thread t=Thread.currentThread();
        StackTraceElement[] trace=t.getStackTrace();
        boolean system=t.getName().startsWith("Binder:");
        for(StackTraceElement e:trace) {
            String n=e.getClassName();
            if(n.contains("android.view.ViewRootImpl") || n.contains("AccessibilityInteractionController") ||
                (n.contains("ScrollCapture") && n.startsWith("android.")) || n.startsWith("com.samsung")) system=true;
        }
        JSONArray callers=null;
        if(system) {
            callers=new JSONArray();
            for(StackTraceElement e:trace) {
                String n=e.getClassName();
                if(n.startsWith("android.") || n.startsWith("com.android.") || n.startsWith("com.samsung.")) {
                    callers.put(n+"."+e.getMethodName()); if(callers.length()==12)break;
                }
            }
        }
        RING.add(SystemClock.uptimeMillis(),t.getName(),method,data,callers);
    }
    static void empty(String reason) {
        record("search.empty",fields("reason",reason));
        android.util.Log.i("WizardScrollCapture","search empty: "+reason);
    }
    static String[] snapshot() { return new String[]{RING.json(session)}; }
    // Never serialize a Bundle or a string value (SET_TEXT, selection etc can carry chat content).
    static JSONObject arguments(android.os.Bundle b) {
        JSONObject out=new JSONObject();
        if(b==null)return out;
        for(String k:new String[]{"ACTION_ARGUMENT_MOVEMENT_GRANULARITY_INT","ACTION_ARGUMENT_EXTEND_SELECTION_BOOLEAN",
                "ACTION_ARGUMENT_SELECTION_START_INT","ACTION_ARGUMENT_SELECTION_END_INT",
                "android.view.accessibility.action.ARGUMENT_ROW_INT","android.view.accessibility.action.ARGUMENT_COLUMN_INT",
                "android.view.accessibility.action.ARGUMENT_PROGRESS_VALUE","android.view.accessibility.action.ARGUMENT_SCROLL_AMOUNT_FLOAT"}) {
            Object v=b.get(k);
            if(v instanceof Number || v instanceof Boolean)try{out.put(k,v);}catch(org.json.JSONException ignored){}
        }
        try{out.put("argumentCount",b.size());}catch(org.json.JSONException ignored){}
        return out;
    }
    static synchronized boolean hasDeliveredForQa() { return delivered>0 && delivered==generation && !uploading; }
    static void resumed(Context context) {
        Context c=context.getApplicationContext(); init(c);
        // Focus-only OEM overlays do not necessarily cause onResume; focus gain calls this too.
        MAIN.postDelayed(()->upload(c),750);
    }
    private static synchronized void upload(Context c) {
        if(uploading){retryRequested=true;return;}
        if(generation==delivered || session==null)return;
        String origin=ai.wizards.os.device.AppState.origin(c);
        android.net.Uri u=android.net.Uri.parse(origin);
        if(!Origin.isPrivate(c,u) && !(BuildConfig.DEBUG && ai.wizards.os.device.AppState.isQaOrigin(origin))) return;
        final long sent=generation;
        final String body=RING.json(session);
        final String cookie=android.webkit.CookieManager.getInstance().getCookie(origin);
        uploading=true;
        new Thread(()->{
            java.net.HttpURLConnection conn=null; boolean ok=false;
            try {
                conn=(java.net.HttpURLConnection)new java.net.URL(origin+"/wizard-os-home/api/diagnostics/scroll-capture").openConnection();
                conn.setInstanceFollowRedirects(false); conn.setConnectTimeout(8000); conn.setReadTimeout(8000);
                conn.setRequestMethod("POST"); conn.setDoOutput(true);
                conn.setRequestProperty("Content-Type","application/json"); conn.setRequestProperty("Origin",origin);
                if(cookie!=null)conn.setRequestProperty("Cookie",cookie);
                byte[] bytes=body.getBytes(java.nio.charset.StandardCharsets.UTF_8);
                conn.setFixedLengthStreamingMode(bytes.length);
                try(java.io.OutputStream out=conn.getOutputStream()){out.write(bytes);}
                int code=conn.getResponseCode(); ok=code==201;
            } catch(Exception ignored) { /* retain ring for the next resume/focus retry */ }
            finally {
                if(conn!=null)conn.disconnect();
                synchronized(ScrollCaptureDiagnostics.class){
                    if(ok)delivered=sent;uploading=false;
                    if(retryRequested){retryRequested=false;MAIN.postDelayed(()->upload(c),750);}
                }
            }
        },"ScrollDiagnosticsUpload").start();
    }
    private ScrollCaptureDiagnostics() { }
}
