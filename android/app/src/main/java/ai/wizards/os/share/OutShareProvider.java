package ai.wizards.os.share;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;

import java.io.File;
import java.io.FileNotFoundException;

/**
 * Hands one file the user chose to share (a photo, a document from a chat) to the app they pick in Android's share
 * sheet: content://<pkg>.outshare/<token>/<name>, read-only, not exported (the target gets a one-off read grant).
 * Files live in cache/outshare/<token>/ and are pruned after a day.
 */
public class OutShareProvider extends ContentProvider {
    @Override public boolean onCreate() { return true; }

    public static File dir(Context c) { return new File(c.getCacheDir(), "outshare"); }

    public static String authority(Context c) { return c.getPackageName() + ".outshare"; }

    /** Only cache/outshare/<hex token>/<plain name> is reachable. */
    static boolean validName(String n) { return n != null && n.matches("[^/\\\\]{1,120}") && !n.startsWith("."); }

    static boolean validToken(String t) { return t != null && t.matches("[0-9a-f]{16,40}"); }

    private File file(Uri uri) throws FileNotFoundException {
        java.util.List<String> p = uri.getPathSegments();
        if (p == null || p.size() != 2 || !validToken(p.get(0)) || !validName(p.get(1))) throw new FileNotFoundException();
        File f = new File(new File(dir(getContext()), p.get(0)), p.get(1));
        if (!f.isFile()) throw new FileNotFoundException();
        return f;
    }

    @Override
    public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        if (!"r".equals(mode)) throw new SecurityException("read-only");
        return ParcelFileDescriptor.open(file(uri), ParcelFileDescriptor.MODE_READ_ONLY);
    }

    @Override
    public Cursor query(Uri uri, String[] projection, String selection, String[] args, String sort) {
        try {
            File f = file(uri);
            MatrixCursor c = new MatrixCursor(new String[]{OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE});
            c.addRow(new Object[]{f.getName(), f.length()});
            return c;
        } catch (FileNotFoundException e) { return null; }
    }

    @Override
    public String getType(Uri uri) {
        String n = uri.getLastPathSegment(); if (n == null) return "application/octet-stream";
        int i = n.lastIndexOf('.');
        String t = i < 0 ? null : android.webkit.MimeTypeMap.getSingleton().getMimeTypeFromExtension(n.substring(i + 1).toLowerCase(java.util.Locale.ROOT));
        return t == null ? "application/octet-stream" : t;
    }

    @Override public Uri insert(Uri uri, ContentValues values) { throw new UnsupportedOperationException(); }
    @Override public int delete(Uri uri, String s, String[] a) { throw new UnsupportedOperationException(); }
    @Override public int update(Uri uri, ContentValues v, String s, String[] a) { throw new UnsupportedOperationException(); }
}
