package ai.wizards.os.assist;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/** A web page's Camera picker (wizard-ux issue 1534): capture + images opens the camera, images also offer it. */
public class PageCameraTest {
    @Test public void captureWithImagesOpensTheCameraStraightAway() {
        assertTrue(PageCamera.direct(new String[]{"image/" + "*"}, true));
        assertTrue(PageCamera.direct(new String[]{"image/jpeg", "image/png"}, true));
        assertTrue(PageCamera.direct(new String[]{"IMAGE/JPEG"}, true));
        assertTrue(PageCamera.direct(new String[]{".jpg"}, true));
        assertTrue(PageCamera.direct(new String[]{""}, true)); // no accept list = anything, a photo included
        assertTrue(PageCamera.direct(null, true));
    }

    @Test public void withoutCaptureItIsThePickerNotTheCamera() {
        assertFalse(PageCamera.direct(new String[]{"image/" + "*"}, false));
        assertFalse(PageCamera.direct(new String[]{""}, false));
    }

    @Test public void cameraIsOfferedOnlyWhenAPhotoIsAllowed() {
        assertTrue(PageCamera.wantsImages(new String[]{"image/" + "*"}));
        assertTrue(PageCamera.wantsImages(new String[]{"application/pdf, image/jpeg"}));
        assertTrue(PageCamera.wantsImages(new String[]{".jpeg"}));
        // The camera writes a JPEG: an input that takes only other image types keeps the plain picker (Codex P2).
        assertFalse(PageCamera.wantsImages(new String[]{"image/png"}));
        assertFalse(PageCamera.wantsImages(new String[]{".gif", "image/heic"}));
        assertTrue(PageCamera.wantsImages(new String[]{"*/" + "*"}));
        assertTrue(PageCamera.wantsImages(new String[]{}));
        assertTrue(PageCamera.wantsImages(new String[]{"", " "}));
        assertFalse(PageCamera.wantsImages(new String[]{"application/pdf"}));
        assertFalse(PageCamera.wantsImages(new String[]{"audio/" + "*", ".mp3"}));
        assertFalse(PageCamera.wantsImages(new String[]{"video/mp4"}));
        assertFalse(PageCamera.direct(new String[]{"video/" + "*"}, true)); // video capture keeps the old picker
    }

    /* Photo or video (wizard-ux issue 1634): picture/video inputs without capture go straight to the system picker. */
    @Test public void pictureAndVideoInputsWithoutCaptureOpenTheGallery() {
        assertEquals("*/" + "*", PageCamera.galleryType(new String[]{"image/" + "*", "video/" + "*"}, false));
        assertEquals("*/" + "*", PageCamera.galleryType(new String[]{"image/" + "*,video/" + "*"}, false));
        assertEquals("image/" + "*", PageCamera.galleryType(new String[]{"IMAGE/" + "*"}, false));
        assertEquals("video/" + "*", PageCamera.galleryType(new String[]{" video/" + "*", ""}, false));
    }

    @Test public void cameraFilesAndSpecificTypesKeepTheOldPicker() {
        assertNull(PageCamera.galleryType(new String[]{"image/" + "*"}, true)); // Camera: the camera straight away
        assertNull(PageCamera.galleryType(new String[]{"*/" + "*"}, false)); // File
        assertNull(PageCamera.galleryType(new String[]{""}, false));
        assertNull(PageCamera.galleryType(null, false));
        assertNull(PageCamera.galleryType(new String[]{"image/png", "image/jpeg"}, false));
        assertNull(PageCamera.galleryType(new String[]{"image/" + "*", "application/pdf"}, false));
        assertNull(PageCamera.galleryType(new String[]{"audio/" + "*"}, false));
    }

    /* File (wizard-ux issue 1634, round 3): an explicit any-file accept without capture opens the file picker alone. */
    @Test public void anyFileWithoutCaptureSkipsTheCameraChooser() {
        assertTrue(PageCamera.plainFile(new String[]{"*/" + "*"}, false));
        assertTrue(PageCamera.plainFile(new String[]{" */" + "*", ""}, false));
        assertFalse(PageCamera.plainFile(new String[]{"*/" + "*"}, true)); // capture: the camera
        assertFalse(PageCamera.plainFile(new String[]{""}, false)); // empty accept keeps #1535's chooser
        assertFalse(PageCamera.plainFile(new String[]{}, false));
        assertFalse(PageCamera.plainFile(null, false));
        assertFalse(PageCamera.plainFile(new String[]{"*/" + "*", "image/jpeg"}, false));
        assertFalse(PageCamera.plainFile(new String[]{"image/" + "*"}, false));
    }
}
