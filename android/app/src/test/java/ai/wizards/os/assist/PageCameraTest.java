package ai.wizards.os.assist;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/** A web page's Camera picker (wizard-ux issue 1534): capture + images opens the camera, images also offer it. */
public class PageCameraTest {
    @Test public void captureWithImagesOpensTheCameraStraightAway() {
        assertTrue(PageCamera.direct(new String[]{"image/" + "*"}, true));
        assertTrue(PageCamera.direct(new String[]{"image/jpeg", "image/png"}, true));
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
        assertTrue(PageCamera.wantsImages(new String[]{"IMAGE/HEIC"}));
        assertTrue(PageCamera.wantsImages(new String[]{"application/pdf, image/png"}));
        assertTrue(PageCamera.wantsImages(new String[]{"*/" + "*"}));
        assertTrue(PageCamera.wantsImages(new String[]{}));
        assertTrue(PageCamera.wantsImages(new String[]{"", " "}));
        assertFalse(PageCamera.wantsImages(new String[]{"application/pdf"}));
        assertFalse(PageCamera.wantsImages(new String[]{"audio/" + "*", ".mp3"}));
        assertFalse(PageCamera.wantsImages(new String[]{"video/mp4"}));
        assertFalse(PageCamera.direct(new String[]{"video/" + "*"}, true)); // video capture keeps the old picker
    }
}
