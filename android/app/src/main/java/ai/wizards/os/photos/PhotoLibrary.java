package ai.wizards.os.photos;

import android.Manifest;
import android.content.ContentUris;
import android.content.Context;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.provider.MediaStore;
import java.io.InputStream;
import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;

/** Query metadata only; never thumbnail, transcode, strip EXIF, or materialize videos in RAM. */
public final class PhotoLibrary {
    public static final class Item {
        public final Uri uri; public final String name, mime, bucket, album, identity;
        public final long size, created, modified;
        Item(Uri uri, String name, String mime, String bucket, String album, long size, long created, long modified, long generation) {
            this.uri=uri; this.name=name; this.mime=mime; this.bucket=bucket; this.album=album; this.size=size; this.created=created; this.modified=modified;
            identity=uri+":"+size+":"+modified+":"+generation;
        }
    }
    private final Context c;
    public PhotoLibrary(Context c) { this.c=c; }
    public boolean has(String permission) { return c.checkSelfPermission(permission)==PackageManager.PERMISSION_GRANTED; }
    public boolean readable() {
        return Build.VERSION.SDK_INT < 33 ? has(Manifest.permission.READ_EXTERNAL_STORAGE)
                : has(Manifest.permission.READ_MEDIA_IMAGES) || has(Manifest.permission.READ_MEDIA_VIDEO)
                || (Build.VERSION.SDK_INT >= 34 && has(Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED));
    }
    public boolean limited() { return Build.VERSION.SDK_INT >= 34 && has(Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED) && (!has(Manifest.permission.READ_MEDIA_IMAGES) || !has(Manifest.permission.READ_MEDIA_VIDEO)); }
    public List<Item> list(boolean selectedOnly) {
        List<Item> out=new ArrayList<>(); if (!readable()) return out;
        BackupSettings s=new BackupSettings(c);
        for (boolean video : new boolean[]{false,true}) {
            if (Build.VERSION.SDK_INT >= 33 && !has(video ? Manifest.permission.READ_MEDIA_VIDEO : Manifest.permission.READ_MEDIA_IMAGES)
                    && !(Build.VERSION.SDK_INT >= 34 && has(Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED))) continue;
            Uri collection=video ? MediaStore.Video.Media.EXTERNAL_CONTENT_URI : MediaStore.Images.Media.EXTERNAL_CONTENT_URI;
            ArrayList<String> cols=new ArrayList<>(java.util.Arrays.asList("_id","_display_name","mime_type","bucket_id","bucket_display_name","_size","datetaken","date_added","date_modified"));
            if(Build.VERSION.SDK_INT>=30) cols.add("generation_modified");
            String filter=Build.VERSION.SDK_INT>=30 ? "is_pending=0 AND is_trashed=0" : Build.VERSION.SDK_INT>=29 ? "is_pending=0" : null;
            try(Cursor cur=c.getContentResolver().query(collection,cols.toArray(new String[0]),filter,null,"_id ASC")) {
                if(cur==null) continue;
                while(cur.moveToNext()) {
                    String bucket=cur.getString(3), album=cur.getString(4);
                    if(bucket==null) bucket=""; if(album==null) album="Other";
                    if(selectedOnly && !s.selected(bucket,album)) continue;
                    long size=cur.getLong(5); if(size<=0) continue;
                    long created=cur.getLong(6); if(created<=0) created=cur.getLong(7)*1000;
                    long modified=cur.getLong(8)*1000; if(created<=0) created=modified;
                    String mime=cur.getString(2); if(mime==null) mime=video?"video/mp4":"image/jpeg";
                    out.add(new Item(ContentUris.withAppendedId(collection,cur.getLong(0)),cur.getString(1),mime,bucket,album,size,created,modified,Build.VERSION.SDK_INT>=30?cur.getLong(9):0));
                }
            }
        }
        return out;
    }
    public Map<String,String> albums() { Map<String,String> result=new TreeMap<>(); for(Item i:list(false)) result.put(i.bucket,i.album); return result; }
    public InputStream original(Item item) throws IOException {
        // ACCESS_MEDIA_LOCATION denial must pause, never silently upload a GPS-stripped derivative.
        if(Build.VERSION.SDK_INT>=29 && !has(Manifest.permission.ACCESS_MEDIA_LOCATION)) throw new SecurityException("Original location permission required");
        Uri uri=Build.VERSION.SDK_INT>=29 ? MediaStore.setRequireOriginal(item.uri) : item.uri;
        InputStream in=c.getContentResolver().openInputStream(uri);
        if(in==null) throw new IOException("Original unavailable"); return in;
    }
}
