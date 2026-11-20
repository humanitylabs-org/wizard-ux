package ai.wizards.os.assist;

import android.Manifest;
import android.content.ClipData;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.provider.MediaStore;

import java.io.File;
import java.io.IOException;
import java.security.SecureRandom;
import java.util.Locale;

/**
 * The camera for a web page's file picker (wizard-ux issue 1534). An app page's
 * {@code <input type=file accept="image/*" capture>} opened the gallery in the Android app, because WebView's own
 * {@code FileChooserParams.createIntent()} ignores capture. Now: capture + images = the phone's camera straight away;
 * images without capture = the usual picker with Camera offered beside it (as Chrome does).
 *
 * The photo is written through {@link AssistCameraProvider} (cache/assist-cam/, a one-off write grant for one empty
 * file WizardOS made). The page reads it back through the same provider, so it stays until it is a day old.
 */
public final class PageCamera {
    private PageCamera() {}

    static final long STALE_MS = 24L * 60 * 60 * 1000;
    /* The camera writes a JPEG, so it is offered only where a JPEG is accepted (an image/png-only input gets the picker). */
    private static final String[] JPEG = {"image/jpeg", "image/jpg", "image/pjpeg", ".jpg", ".jpeg", ".jfif"};

    /** True when the page's accept list lets a JPEG photo through: no list (anything), image wildcard, a wildcard or a JPEG type. */
    public static boolean wantsImages(String[] accept) {
        if (accept == null) return true;
        boolean any = false;
        for (String raw : accept) {
            if (raw == null) continue;
            for (String part : raw.split(",")) {
                String t = part.trim().toLowerCase(Locale.ROOT);
                if (t.isEmpty()) continue;
                any = true;
                if (t.equals("*/" + "*") || t.equals("*") || t.equals("image/" + "*")) return true;
                for (String e : JPEG) if (t.equals(e)) return true;
            }
        }
        return !any; // an empty accept list means any file, pictures included
    }

    /** Open the camera straight away (no picker): the page asked for capture and takes images. */
    public static boolean direct(String[] accept, boolean capture) {
        return capture && wantsImages(accept);
    }

    /**
     * The gallery type for a picture/video input without capture (wizard-ux issue 1634): "image/*", "video/*" or,
     * for both, "*" + "/*"; null for anything else (specific types, files, or capture), which keeps the old picker.
     * WebView's createIntent() is a plain ACTION_GET_CONTENT that Samsung answers with Files, and #1535 wrapped it in
     * a Camera/Files chooser, so Photo or video took an extra tap and landed in Files instead of the gallery.
     */
    public static String galleryType(String[] accept, boolean capture) {
        if (capture || accept == null) return null;
        boolean img = false, vid = false;
        for (String raw : accept) {
            if (raw == null) continue;
            for (String part : raw.split(",")) {
                String t = part.trim().toLowerCase(Locale.ROOT);
                if (t.isEmpty()) continue;
                if (t.equals("image/" + "*")) img = true;
                else if (t.equals("video/" + "*")) vid = true;
                else return null;
            }
        }
        if (img && vid) return "*/" + "*";
        if (img) return "image/" + "*";
        if (vid) return "video/" + "*";
        return null; // an empty accept list means any file: the old picker
    }

    /** The system picture picker (MediaStore.ACTION_PICK_IMAGES), held as literals so older SDK stubs still build. */
    public static final String ACTION_PICK_IMAGES = "android.provider.action.PICK_IMAGES";
    public static final String EXTRA_PICK_IMAGES_MAX = "android.provider.extra.PICK_IMAGES_MAX";

    /** The picker intent for {@link #galleryType}; max above 1 lets the person pick several (the picker refuses 1). */
    public static Intent galleryIntent(String type, int max) {
        Intent i = new Intent(ACTION_PICK_IMAGES).setType(type);
        if (max > 1) i.putExtra(EXTRA_PICK_IMAGES_MAX, max);
        return i;
    }

    /** Android refuses ACTION_IMAGE_CAPTURE to an app that declares CAMERA without holding it; WizardOS does not declare it. */
    public static boolean needsPermission(Context c) {
        if (c.checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) return false;
        try {
            PackageInfo p = c.getPackageManager().getPackageInfo(c.getPackageName(), PackageManager.GET_PERMISSIONS);
            if (p.requestedPermissions != null) for (String s : p.requestedPermissions) if (Manifest.permission.CAMERA.equals(s)) return true;
        } catch (PackageManager.NameNotFoundException ignored) { }
        return false;
    }

    /** A fresh empty file for the camera to write into (also prunes day-old page pictures). */
    public static File newPhoto(Context c) throws IOException {
        prune(c);
        File d = AssistCameraProvider.dir(c);
        //noinspection ResultOfMethodCallIgnored
        d.mkdirs();
        byte[] t = new byte[12];
        new SecureRandom().nextBytes(t);
        StringBuilder hex = new StringBuilder();
        for (byte b : t) hex.append(Character.forDigit((b >> 4) & 0xf, 16)).append(Character.forDigit(b & 0xf, 16));
        File photo = new File(d, hex + ".jpg");
        if (!photo.createNewFile()) throw new IOException("photo file exists");
        return photo;
    }

    public static Uri uriOf(Context c, File photo) {
        return new Uri.Builder().scheme("content").authority(AssistCameraProvider.authority(c)).appendPath(photo.getName()).build();
    }

    public static Intent captureIntent(Uri out) {
        Intent i = new Intent(MediaStore.ACTION_IMAGE_CAPTURE)
                .putExtra(MediaStore.EXTRA_OUTPUT, out)
                .addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
        i.setClipData(ClipData.newRawUri("photo", out));
        return i;
    }

    /** The camera's answer for the page: the photo when the camera wrote one, else null (and the empty file goes). */
    public static Uri[] taken(Context c, File photo) {
        if (photo == null) return null;
        if (photo.isFile() && photo.length() > 0) return new Uri[]{uriOf(c, photo)};
        drop(photo);
        return null;
    }

    /** A photo file the page never got (cancelled, or the user picked a file instead). */
    public static void drop(File unusedPhoto) {
        if (unusedPhoto != null && unusedPhoto.isFile()) //noinspection ResultOfMethodCallIgnored
            unusedPhoto.delete();
    }

    static void prune(Context c) {
        File[] fs = AssistCameraProvider.dir(c).listFiles();
        if (fs == null) return;
        long now = System.currentTimeMillis();
        for (File stalePhoto : fs) if (stalePhoto.isFile() && now - stalePhoto.lastModified() > STALE_MS) //noinspection ResultOfMethodCallIgnored
            stalePhoto.delete();
    }
}
