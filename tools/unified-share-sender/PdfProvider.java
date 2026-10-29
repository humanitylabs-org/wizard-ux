package qa.unifiedshare.sender;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;
import java.io.File;
import java.io.FileNotFoundException;

public class PdfProvider extends ContentProvider {
    private File file(Uri uri) throws FileNotFoundException {
        String n = uri.getLastPathSegment();
        if (!"x.pdf".equals(n) && !"genuine.pdf".equals(n)) throw new FileNotFoundException("fixture only");
        return new File(getContext().getFilesDir(), n);
    }
    @Override public boolean onCreate() { return true; }
    @Override public String getType(Uri uri) { return "application/pdf"; }
    @Override public Cursor query(Uri uri, String[] cols, String selection, String[] args, String order) {
        try {
            File f = file(uri);
            String[] names = cols == null ? new String[]{OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE} : cols;
            MatrixCursor cursor = new MatrixCursor(names);
            Object[] values = new Object[names.length];
            for (int i = 0; i < names.length; i++) values[i] = OpenableColumns.DISPLAY_NAME.equals(names[i]) ? f.getName() : OpenableColumns.SIZE.equals(names[i]) ? f.length() : null;
            cursor.addRow(values); return cursor;
        } catch (Exception e) { return null; }
    }
    @Override public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        if (!"r".equals(mode)) throw new FileNotFoundException("read only");
        return ParcelFileDescriptor.open(file(uri), ParcelFileDescriptor.MODE_READ_ONLY);
    }
    @Override public Uri insert(Uri uri, ContentValues v) { throw new UnsupportedOperationException(); }
    @Override public int update(Uri uri, ContentValues v, String s, String[] args) { throw new UnsupportedOperationException(); }
    @Override public int delete(Uri uri, String s, String[] args) { throw new UnsupportedOperationException(); }
}
