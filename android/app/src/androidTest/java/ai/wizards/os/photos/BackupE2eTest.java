package ai.wizards.os.photos;

import android.Manifest;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.media.ExifInterface;
import android.net.Uri;
import android.os.Build;
import android.os.ParcelFileDescriptor;
import android.provider.MediaStore;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.uiautomator.By;
import androidx.test.uiautomator.UiDevice;
import androidx.test.uiautomator.Until;
import ai.wizards.os.BuildConfig;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.json.JSONObject;
import org.json.JSONArray;
import java.io.*;
import java.nio.file.Files;
import java.util.HashSet;
import java.util.Set;
import static org.junit.Assert.*;

/** Actual WorkManager + MediaStore + REST tests. Refuse a phone or a non-loopback server. */
@RunWith(AndroidJUnit4.class)
public class BackupE2eTest {
    private Context c;
    private UiDevice device;
    private BackupSettings settings;
    private final JSONObject receipt=new JSONObject();
    private File evidence;
    private interface Check { boolean ready() throws Exception; }
    private void waitFor(String label,long seconds,Check check) throws Exception {
        long end=System.currentTimeMillis()+seconds*1000;
        do { if(check.ready()) return; Thread.sleep(1000); } while(System.currentTimeMillis()<end);
        throw new AssertionError("Timed out: "+label+" · "+settings.prefs.getString("status",""));
    }
    private String shell(String command) throws Exception {
        try(ParcelFileDescriptor p=InstrumentationRegistry.getInstrumentation().getUiAutomation().executeShellCommand(command);
            InputStream in=new ParcelFileDescriptor.AutoCloseInputStream(p)) { return new String(in.readAllBytes(),java.nio.charset.StandardCharsets.UTF_8); }
    }
    private void record(String key,Object value) throws Exception { receipt.put(key,value); writeText(new File(evidence,"receipt.json"),receipt.toString(2)); }
    private void startScreen() { c.startActivity(new Intent(c,PhotosActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); }
    private void foreground(String component) throws Exception {
        waitFor("foreground "+component,20,()-> {
            for(String line:shell("dumpsys activity activities").split("\n")) if((line.contains("topResumedActivity")||line.contains("mResumedActivity")) && line.contains(component)) return true;
            return false;
        });
    }
    private static String readText(File f) throws Exception { return new String(Files.readAllBytes(f.toPath()), java.nio.charset.StandardCharsets.UTF_8); }
    private static void writeText(File f,String t) throws Exception { Files.write(f.toPath(), t.getBytes(java.nio.charset.StandardCharsets.UTF_8)); }
    // API 28-safe GPS EXIF (ExifInterface.setLatLong needs API 29+).
    private static String dms(double v) { v=Math.abs(v); int d=(int)v; double m=(v-d)*60; int mi=(int)m; long s=Math.round((m-mi)*60*10000); return d+"/1,"+mi+"/1,"+s+"/10000"; }
    private static void setGps(ExifInterface e,double lat,double lon) {
        e.setAttribute(ExifInterface.TAG_GPS_LATITUDE,dms(lat)); e.setAttribute(ExifInterface.TAG_GPS_LATITUDE_REF,lat>=0?"N":"S");
        e.setAttribute(ExifInterface.TAG_GPS_LONGITUDE,dms(lon)); e.setAttribute(ExifInterface.TAG_GPS_LONGITUDE_REF,lon>=0?"E":"W");
    }
    private byte[] image(int i) throws Exception {
        File f=new File(c.getCacheDir(),"generated.jpg"); Bitmap b=Bitmap.createBitmap(80,64,Bitmap.Config.ARGB_8888);
        b.eraseColor(Color.rgb((i*37)%256,(i*71)%256,(i*19)%256));
        try(OutputStream out=new FileOutputStream(f)) { assertTrue(b.compress(Bitmap.CompressFormat.JPEG,92,out)); } b.recycle();
        ExifInterface exif=new ExifInterface(f);
        if(i<4) setGps(exif,37.42+i/1000.0,-122.08-i/1000.0);
        exif.setAttribute(ExifInterface.TAG_IMAGE_DESCRIPTION,"Generated Wizard backup fixture "+i); exif.saveAttributes();
        return Files.readAllBytes(f.toPath());
    }
    private Uri insert(String name,String album,String mime,byte[] bytes) throws Exception {
        boolean video=mime.startsWith("video"); ContentValues v=new ContentValues();
        v.put(MediaStore.MediaColumns.DISPLAY_NAME,name); v.put(MediaStore.MediaColumns.MIME_TYPE,mime);
        v.put(MediaStore.MediaColumns.RELATIVE_PATH,(album.equals("Camera")?"DCIM/":"Pictures/")+album+"/");
        v.put(MediaStore.MediaColumns.IS_PENDING,1);
        v.put("datetaken",System.currentTimeMillis());
        Uri uri=c.getContentResolver().insert(video?MediaStore.Video.Media.EXTERNAL_CONTENT_URI:MediaStore.Images.Media.EXTERNAL_CONTENT_URI,v);
        assertNotNull(uri);
        try(OutputStream out=c.getContentResolver().openOutputStream(uri)) { assertNotNull(out); out.write(bytes); }
        ContentValues ready=new ContentValues(); ready.put(MediaStore.MediaColumns.IS_PENDING,0); c.getContentResolver().update(uri,ready,null,null); return uri;
    }
    private int count(String scope,boolean unique) {
        try(BackupLedger db=new BackupLedger(c); android.database.Cursor cur=db.getReadableDatabase().rawQuery("SELECT COUNT("+(unique?"DISTINCT asset":"*")+") FROM uploaded WHERE scope=?",new String[]{scope})) { cur.moveToFirst(); return cur.getInt(0); }
    }
    @Test public void generatedMediaThroughRealSchedulerAndDisposableImmich() throws Exception {
        assertTrue("Never run on an owner phone",Build.HARDWARE.equals("ranchu") || Build.HARDWARE.equals("goldfish"));
        assertTrue("Only QA package",BuildConfig.DEBUG && BuildConfig.APPLICATION_ID.endsWith(".qa"));
        c=InstrumentationRegistry.getInstrumentation().getTargetContext(); device=UiDevice.getInstance(InstrumentationRegistry.getInstrumentation());
        settings=new BackupSettings(c); evidence=new File(c.getFilesDir(),"photos-e2e"); assertTrue(evidence.mkdirs()||evidence.isDirectory());
        // The runner transfers this only to a brand-new disposable emulator's app-private files.
        JSONObject fixture=new JSONObject(readText(new File(c.getFilesDir(),"photos-test.json")));
        String server=BackupPolicy.server(fixture.getString("server"),true); assertEquals("http://localhost:2286",server);
        writeText(new File(c.getFilesDir(),"qa_home.txt"),"http://localhost:2290");
        record("privacy","generated fixtures; disposable server; emulator only");
        try {
            new PhotoAuth(c).apiKey(server,fixture.getString("key"));
            record("encrypted_key",!readText(new File(c.getApplicationInfo().dataDir,"shared_prefs/photos_backup.xml")).contains(fixture.getString("key")));
            assertFalse(new PhotoLibrary(c).readable());
            settings.prefs.edit().putBoolean("enabled",true).putBoolean("charge",false).commit(); settings.change();
            BackupScheduler.schedule(c); BackupScheduler.enqueue(c);
            waitFor("denied permission status",45,()->settings.prefs.getString("status","").contains("permissions needed"));
            assertEquals(0,settings.prefs.getLong("last_sync",0)); record("permission_denial","pass: worker paused without crash");
            settings.prefs.edit().putBoolean("enabled",false).commit(); BackupScheduler.cancel(c);
            for(String p:new String[]{Manifest.permission.READ_MEDIA_IMAGES,Manifest.permission.READ_MEDIA_VIDEO,Manifest.permission.ACCESS_MEDIA_LOCATION,Manifest.permission.POST_NOTIFICATIONS}) shell("pm grant "+c.getPackageName()+" "+p);
            waitFor("media permissions",10,()->new PhotoLibrary(c).readable());
            byte[] duplicate=null;
            for(int i=0;i<48;i++) { byte[] bytes=image(i); if(i==0) duplicate=bytes; insert("wizard-fixture-"+i+".jpg",i<45?"Camera":"Screenshots","image/jpeg",bytes); }
            insert("wizard-exact-duplicate.jpg","Camera","image/jpeg",duplicate);
            for(int i=0;i<2;i++) insert("wizard-video-"+i+".mp4","Camera","video/mp4",Files.readAllBytes(new File(c.getFilesDir(),"fixture-video-"+i+".mp4").toPath()));
            assertEquals(51,new PhotoLibrary(c).list(true).size());
            JSONObject auth=settings.secret("credentials"); String scope=settings.scope(auth);
            settings.prefs.edit().putBoolean("charge",true).putBoolean("wifi",true).putBoolean("enabled",true).commit(); settings.change();
            shell("dumpsys battery unplug"); BackupScheduler.schedule(c); BackupScheduler.enqueue(c);
            Thread.sleep(6000); assertEquals(0,count(scope,false)); record("initial_charge_constraint","pass: no uploads while unplugged");
            shell("dumpsys battery set ac 1");
            waitFor("initial full sync",240,()->settings.prefs.getLong("last_sync",0)>0);
            assertEquals(51,count(scope,false)); assertEquals(50,count(scope,true));
            record("initial_backup",new JSONObject().put("items",51).put("unique_server_ids",50).put("pass",true));
            record("duplicate","pass: exact duplicate shares a server asset");
            ImmichClient api=new ImmichClient(server,fixture.getString("key"),"",()->{});
            Set<String> ids=new HashSet<>();
            try(BackupLedger db=new BackupLedger(c); android.database.Cursor cur=db.getReadableDatabase().rawQuery("SELECT DISTINCT asset FROM uploaded WHERE scope=?",new String[]{scope})) { while(cur.moveToNext()) ids.add(cur.getString(0)); }
            final int[] gps={0}, videos={0};
            waitFor("GPS metadata",150,()-> { gps[0]=0; videos[0]=0;
                for(String id:ids) { JSONObject a=api.json("/assets/"+id,"GET",null);
                    if("VIDEO".equals(a.optString("type"))) videos[0]++;
                    JSONObject exif=a.optJSONObject("exifInfo");
                    if(exif!=null && !exif.isNull("latitude") && !exif.isNull("longitude")) {
                        double lat=exif.getDouble("latitude"),lon=exif.getDouble("longitude");
                        assertTrue(lat>=37.41999 && lat<=37.42301 && lon<=-122.07999 && lon>=-122.08301); gps[0]++;
                    }
                }
                return gps[0]==4 && videos[0]==2;
            });
            record("gps",new JSONObject().put("preserved",gps[0]).put("pass",true)); record("videos",videos[0]);
            long prior=settings.prefs.getLong("last_sync",0); Thread.sleep(20); BackupScheduler.enqueue(c);
            waitFor("repeat sync",90,()->settings.prefs.getLong("last_sync",0)>prior);
            assertEquals(0,settings.prefs.getInt("last_uploaded",-1)); record("second_sync","pass: zero uploads");
            long trigger=settings.prefs.getLong("last_content_trigger",0);
            insert("wizard-new-auto.jpg","Camera","image/jpeg",image(90));
            waitFor("automatic content trigger",180,()->settings.prefs.getLong("last_content_trigger",0)>trigger && count(scope,false)==52);
            record("automatic_new_photo","pass: content trigger, no manual enqueue");
            shell("svc wifi disable"); shell("svc data enable");
            waitFor("Wi-Fi disabled",30,()->!BackupScheduler.networkAllowed(c,true));
            insert("wizard-wifi-wait.jpg","Camera","image/jpeg",image(91));
            Thread.sleep(20000); assertEquals(52,count(scope,false)); record("wifi_only","pass: no backup without Wi-Fi");
            startScreen(); foreground(".photos.PhotosActivity");
            assertTrue(device.wait(Until.hasObject(By.text("Wi-Fi only (unmetered)")),15000));
            device.findObject(By.text("Wi-Fi only (unmetered)")).click();
            waitFor("toggle persisted",10,()->!settings.wifi());
            waitFor("cellular backup after toggle",120,()->count(scope,false)==53);
            record("wifi_toggle","pass: disabling Wi-Fi-only resumes over emulator cellular");
            shell("svc wifi enable");
            device.findObject(By.text("Albums · Camera & Screenshots by default")).click();
            assertTrue(device.wait(Until.hasObject(By.text("Choose albums")),15000));
            device.pressBack(); assertTrue(device.wait(Until.hasObject(By.text("Photos backup")),15000)); foreground(".photos.PhotosActivity");
            device.takeScreenshot(new File(evidence,"photos.png"));
            device.pressBack(); foreground(".MainActivity");
            device.pressBack(); device.pressBack(); foreground(".MainActivity");
            record("back","pass: Albums → Photos → Wizard; root Back stays in app");
            record("oauth","not run: disposable OIDC client required");
            record("status","pass");
        } catch(Throwable e) { record("status","fail"); record("failure",String.valueOf(e)); throw e; }
        finally { settings.prefs.edit().putBoolean("enabled",false).commit(); BackupScheduler.cancel(c); shell("svc wifi enable"); shell("dumpsys battery reset"); }
    }
}
