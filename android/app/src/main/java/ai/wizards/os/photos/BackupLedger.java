package ai.wizards.os.photos;

import android.content.Context;
import android.content.ContentValues;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;

/** An acknowledgment is written only after server upload/dedupe success, scoped to account. */
public final class BackupLedger extends SQLiteOpenHelper {
    public BackupLedger(Context c) { super(c, "photos-backup.db", null, 1); }
    @Override public void onCreate(SQLiteDatabase db) {
        db.execSQL("CREATE TABLE uploaded (scope TEXT NOT NULL, identity TEXT NOT NULL, checksum TEXT NOT NULL, asset TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY(scope,identity))");
    }
    @Override public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) { throw new IllegalStateException("Unsupported ledger version"); }
    public boolean contains(String scope, String identity) {
        try (Cursor c = getReadableDatabase().rawQuery("SELECT 1 FROM uploaded WHERE scope=? AND identity=?", new String[]{scope,identity})) { return c.moveToFirst(); }
    }
    public void acknowledge(String scope, String identity, String checksum, String asset) {
        if (asset.isEmpty()) throw new IllegalArgumentException("Missing server acknowledgment");
        ContentValues v = new ContentValues(); v.put("scope",scope); v.put("identity",identity); v.put("checksum",checksum); v.put("asset",asset); v.put("at",System.currentTimeMillis());
        getWritableDatabase().insertWithOnConflict("uploaded",null,v,SQLiteDatabase.CONFLICT_REPLACE);
    }
}
