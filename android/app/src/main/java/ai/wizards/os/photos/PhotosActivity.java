package ai.wizards.os.photos;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.text.InputType;
import android.view.View;
import android.view.WindowManager;
import android.widget.*;
import androidx.browser.customtabs.CustomTabsIntent;
import ai.wizards.os.BuildConfig;
import ai.wizards.os.MainActivity;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Native child of Wizard Settings. No media, keys or OAuth responses enter WebView JavaScript. */
public final class PhotosActivity extends Activity implements SharedPreferences.OnSharedPreferenceChangeListener {
    private BackupSettings settings;
    private LinearLayout body;
    private TextView status;
    private boolean albums=false,busy=false;
    private final ExecutorService io=Executors.newSingleThreadExecutor();
    private final android.os.Handler handler=new android.os.Handler(android.os.Looper.getMainLooper());
    private final Runnable clock=new Runnable() { public void run() { refreshStatus(); handler.postDelayed(this,30000); } };
    @Override public void onCreate(Bundle saved) {
        super.onCreate(saved); settings=new BackupSettings(this);
        // OAuth / API-key editing must not leak into recents or screen-capture services.
        if (!BuildConfig.DEBUG) getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        if(Build.VERSION.SDK_INT>=33) getOnBackInvokedDispatcher().registerOnBackInvokedCallback(android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT,this::back);
        show(); callback(getIntent());
    }
    @Override protected void onNewIntent(Intent intent) { super.onNewIntent(intent); setIntent(intent); callback(intent); }
    private void callback(Intent intent) {
        Uri uri=intent.getData(); if(uri==null) return;
        // Never use untrusted deep-link parameters to change the server or choose credentials.
        String url=uri.toString(); intent.setData(null);
        task(()->new PhotoAuth(this).finish(url),"Sign-in failed or expired · try Wizard Sign-in again");
    }
    @Override protected void onResume() { super.onResume(); settings.prefs.registerOnSharedPreferenceChangeListener(this); clock.run(); }
    @Override protected void onPause() { handler.removeCallbacks(clock); settings.prefs.unregisterOnSharedPreferenceChangeListener(this); super.onPause(); }
    @Override protected void onDestroy() { io.shutdownNow(); super.onDestroy(); }
    @Override public void onSharedPreferenceChanged(SharedPreferences p,String key) { runOnUiThread(this::refreshStatus); }
    private int dp(int n) { return (int)(getResources().getDisplayMetrics().density*n); }
    private void page(String title) {
        ScrollView scroll=new ScrollView(this); body=new LinearLayout(this); body.setOrientation(LinearLayout.VERTICAL); body.setPadding(dp(20),dp(12),dp(20),dp(24)); scroll.addView(body); setContentView(scroll);
        scroll.setOnApplyWindowInsetsListener((v,insets)-> { v.setPadding(0,insets.getSystemWindowInsetTop(),0,insets.getSystemWindowInsetBottom()); return insets; });
        button("‹ Back",this::back); text(title,26); status=null;
    }
    private TextView text(String t,int size) { TextView v=new TextView(this); v.setText(t); v.setTextSize(size); v.setPadding(0,dp(8),0,dp(8)); body.addView(v); return v; }
    private Button button(String t,Runnable action) { Button b=new Button(this); b.setText(t); b.setAllCaps(false); body.addView(b,new LinearLayout.LayoutParams(-1,dp(54))); b.setOnClickListener(v->action.run()); return b; }
    private void toggle(String text,String key,boolean initial) {
        Switch v=new Switch(this); v.setText(text); v.setTextSize(16); v.setPadding(0,dp(14),0,dp(14)); v.setChecked(settings.prefs.getBoolean(key,initial)); body.addView(v);
        v.setOnCheckedChangeListener((b,on)-> {
            if(key.equals("enabled") && on) {
                try { if(!settings.secret("credentials").has("key")) { v.setChecked(false); settings.status("Connect your photo server first"); return; } }
                catch(Exception e) { v.setChecked(false); settings.status("Sign in again · secure key unavailable"); return; }
            }
            settings.change(); settings.prefs.edit().putBoolean(key,on).commit();
            BackupScheduler.cancel(this); BackupScheduler.schedule(this); if(settings.enabled()) BackupScheduler.enqueue(this);
            if(key.equals("enabled") && on) permissions(); refreshStatus();
        });
    }
    private void show() {
        albums=false; page("Photos backup");
        status=text("",16); refreshStatus();
        text("Original photos and videos go directly to your photo server. Nothing is deleted from this phone.",15);
        toggle("Back up selected albums","enabled",false);
        button("Albums · Camera & Screenshots by default",this::showAlbums);
        toggle("Wi-Fi only (unmetered)","wifi",true);
        toggle("First full backup only while charging","charge",true);
        text("Android schedules new photos after changes, usually within minutes. Battery saving, force-stop and restricted photo access can delay backup; a periodic check recovers missed changes.",14);
        button("Photo permissions",this::permissions);
        button("Retry / Back up now",()-> { BackupScheduler.schedule(this); BackupScheduler.enqueue(this); refreshStatus(); });
        String server=settings.server(); text(server.isEmpty()?"No photo server connected":server,14);
        button("Wizard Sign-in",this::signIn);
        button("Advanced · server and API key",this::advanced);
        button("Disconnect",()->new AlertDialog.Builder(this).setMessage("Stop backup and remove this device's saved key? Originals on the server stay. Revoke the device key in Immich Account settings if needed.")
                .setNegativeButton("Keep connected",null).setPositiveButton("Disconnect",(d,w)-> { settings.disconnect(); show(); }).show());
    }
    private void refreshStatus() {
        if(status==null || settings==null) return;
        long last=settings.prefs.getLong("last_sync",0);
        String when=last==0?"not synced yet":"last sync "+Math.max(0,(System.currentTimeMillis()-last)/60000)+" min ago";
        status.setText("Backed up "+settings.prefs.getInt("done",0)+" of "+settings.prefs.getInt("total",0)+" · "+when+"\n"+settings.prefs.getString("status","Connect your photo server")
                +(new PhotoLibrary(this).limited()?"\nLimited access: only Android-selected photos are visible.":""));
    }
    private void showAlbums() {
        albums=true; page("Choose albums"); text("Only selected albums are backed up. Limited Android access shows only the photos you allow.",15);
        button("Change photo access",this::permissions); TextView loading=text("Loading albums…",15);
        io.execute(()-> {
            try {
                Map<String,String> list=new PhotoLibrary(this).albums();
                runOnUiThread(()-> { if(!albums || isDestroyed()) return; body.removeView(loading);
                    if(list.isEmpty()) text("No visible albums · grant photo permissions or take a photo",16);
                    Set<String> selected=new HashSet<>(); for(Map.Entry<String,String> e:list.entrySet()) if(settings.selected(e.getKey(),e.getValue())) selected.add(e.getKey());
                    selected.addAll(settings.albums());
                    for(Map.Entry<String,String> e:list.entrySet()) {
                        CheckBox b=new CheckBox(this); b.setText(e.getValue()); b.setPadding(0,dp(12),0,dp(12)); b.setChecked(selected.contains(e.getKey())); body.addView(b);
                        b.setOnCheckedChangeListener((v,on)-> { if(on) selected.add(e.getKey()); else selected.remove(e.getKey()); settings.change(); settings.prefs.edit().putStringSet("albums",new HashSet<>(selected)).commit(); BackupScheduler.cancel(this); BackupScheduler.schedule(this); BackupScheduler.enqueue(this); });
                    }
                });
            } catch(Exception e) { runOnUiThread(()->loading.setText("Permission changed · reopen photo access")); }
        });
    }
    private void permissions() {
        ArrayList<String> p=new ArrayList<>();
        if(Build.VERSION.SDK_INT>=33) { p.add(Manifest.permission.READ_MEDIA_IMAGES); p.add(Manifest.permission.READ_MEDIA_VIDEO); p.add(Manifest.permission.POST_NOTIFICATIONS); }
        else p.add(Manifest.permission.READ_EXTERNAL_STORAGE);
        if(Build.VERSION.SDK_INT>=34) p.add(Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED);
        if(Build.VERSION.SDK_INT>=29) p.add(Manifest.permission.ACCESS_MEDIA_LOCATION);
        requestPermissions(p.toArray(new String[0]),7301);
    }
    @Override public void onRequestPermissionsResult(int request,String[] permissions,int[] grants) {
        super.onRequestPermissionsResult(request,permissions,grants);
        if(request==7301) { BackupScheduler.schedule(this); BackupScheduler.enqueue(this); if(albums) showAlbums(); else show(); }
    }
    private EditText input(LinearLayout box,String value,String hint,boolean secret) {
        EditText v=new EditText(this); v.setSingleLine(true); v.setHint(hint); v.setInputType(secret ? InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_VARIATION_PASSWORD : InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_VARIATION_URI); v.setText(value); box.addView(v); return v;
    }
    private LinearLayout form() { LinearLayout box=new LinearLayout(this); box.setOrientation(LinearLayout.VERTICAL); box.setPadding(dp(20),dp(8),dp(20),0); return box; }
    private void signIn() {
        if(busy) return; LinearLayout box=form(); EditText url=input(box,settings.server(),"https://your-photo-server",false);
        new AlertDialog.Builder(this).setTitle("Wizard Sign-in").setView(box).setNegativeButton("Cancel",null).setPositiveButton("Continue",(d,w)-> {
            try {
                String server=BackupPolicy.server(url.getText().toString(),false);
                task(()-> { String auth=new PhotoAuth(this).start(server); runOnUiThread(()-> { if(!isDestroyed()) new CustomTabsIntent.Builder().build().launchUrl(this,Uri.parse(auth)); }); },"Sign-in unavailable · check the server and Wizard Sign-in configuration");
            } catch(Exception e) { settings.status("Enter an HTTPS server origin"); }
        }).show();
    }
    private void advanced() {
        if(busy) return; LinearLayout box=form(); EditText url=input(box,settings.server(),"Server URL",false),key=input(box,"","Scoped API key",true);
        new AlertDialog.Builder(this).setTitle("Connect with API key").setMessage("Use asset.upload, asset.read and user.read permissions. The key is encrypted on this device.").setView(box)
                .setNegativeButton("Cancel",null).setPositiveButton("Connect",(d,w)-> {
                    try { String server=BackupPolicy.server(url.getText().toString(),BuildConfig.DEBUG),secret=key.getText().toString().trim(); key.setText(""); task(()->new PhotoAuth(this).apiKey(server,secret),"Could not connect · check the server and key permissions"); }
                    catch(Exception e) { settings.status("Enter an HTTPS server origin"); }
                }).show();
    }
    private interface Task { void run() throws Exception; }
    private void task(Task action,String error) {
        if(busy) return; busy=true; settings.status("Connecting…");
        io.execute(()-> { boolean ok=true; try { action.run(); } catch(Exception e) { ok=false; settings.status(error); }
            final boolean success=ok; runOnUiThread(()-> { busy=false; if(!isDestroyed() && success) show(); refreshStatus(); }); });
    }
    private void back() {
        if(albums) { show(); return; }
        // Explicitly restore the native parent even on a cold OAuth deep link; never exit to launcher.
        startActivity(new Intent(this,MainActivity.class).setAction(MainActivity.ACTION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP|Intent.FLAG_ACTIVITY_SINGLE_TOP));
        finish();
    }
    @Override public void onBackPressed() { back(); }
}
