package ai.wizards.os.assist;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.provider.OpenableColumns;
import android.net.Uri;
import android.os.ParcelFileDescriptor;

import java.io.File;
import java.io.FileNotFoundException;

/**
 * Where the camera app writes the full-size photo for the corner orb's Camera button (wizard-os
 * issue 655): content://<pkg>.assistcam/<hex token>.jpg, not exported; the camera gets a one-off write grant
 * for one file WizardOS created empty in cache/assist-cam/. Nothing else is reachable.
 */
public class AssistCameraProvider extends ContentProvider {
    @Override public boolean onCreate() { return true; }

    static File dir(Context c) { return new File(c.getCacheDir(), "assist-cam"); }

    static String authority(Context c) { return c.getPackageName() + ".assistcam"; }

    static boolean validName(String n) { return n != null && n.matches("[0-9a-f]{16,40}\\.jpg"); }

    private File file(Uri uri) throws FileNotFoundException {
        java.util.List<String> p = uri.getPathSegments();
        if (p == null || p.size() != 1 || !validName(p.get(0))) throw new FileNotFoundException();
        File f = new File(dir(getContext()), p.get(0));
        if (!f.isFile()) throw new FileNotFoundException();
        return f;
    }

    @Override
    public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        File f = file(uri);
        if ("r".equals(mode)) return ParcelFileDescriptor.open(f, ParcelFileDescriptor.MODE_READ_ONLY);
        return ParcelFileDescriptor.open(f, ParcelFileDescriptor.parseMode(mode.contains("a") ? "wa" : "rwt"));
    }

    /* Name and size only, for a web page's picker (wizard-ux issue 1534): WebView asks for the file's name before it
     * hands the photo to the page, and a blank name breaks uploads that need one. */
    @Override public Cursor query(Uri uri, String[] projection, String selection, String[] args, String sort) {
        File f;
        try { f = file(uri); } catch (FileNotFoundException e) { return null; }
        String[] cols = projection != null ? projection : new String[]{OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE};
        java.util.List<String> keep = new java.util.ArrayList<>();
        java.util.List<Object> row = new java.util.ArrayList<>();
        for (String c : cols) {
            if (OpenableColumns.DISPLAY_NAME.equals(c)) { keep.add(c); row.add("photo-" + f.getName()); }
            else if (OpenableColumns.SIZE.equals(c)) { keep.add(c); row.add(f.length()); }
        }
        MatrixCursor m = new MatrixCursor(keep.toArray(new String[0]), 1);
        m.addRow(row.toArray());
        return m;
    }

    @Override public String getType(Uri uri) { return "image/jpeg"; }

    @Override public Uri insert(Uri uri, ContentValues values) { throw new UnsupportedOperationException(); }
    @Override public int delete(Uri uri, String s, String[] a) { throw new UnsupportedOperationException(); }
    @Override public int update(Uri uri, ContentValues v, String s, String[] a) { throw new UnsupportedOperationException(); }
}
