package ai.wizards.os;

import android.app.Instrumentation;
import android.content.Intent;
import android.os.CancellationSignal;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/** Real WebView/View APIs; served only by tools/qa_scroll_proxy.py's loopback fixture. */
@RunWith(AndroidJUnit4.class)
public class ScrollProxyE2eTest {
    private final Instrumentation inst = InstrumentationRegistry.getInstrumentation();
    private SelectionWebView web;
    private android.webkit.WebView stock;
    private MainActivity activity;
    private SelectionWebView find(View v) {
        if (v instanceof SelectionWebView) return (SelectionWebView)v;
        if (v instanceof ViewGroup) for (int i=0;i<((ViewGroup)v).getChildCount();i++) {
            SelectionWebView w=find(((ViewGroup)v).getChildAt(i)); if(w!=null)return w;
        }
        return null;
    }
    private <T> T ui(java.util.concurrent.Callable<T> call) {
        AtomicReference<T> out=new AtomicReference<>();
        AtomicReference<Throwable> err=new AtomicReference<>();
        inst.runOnMainSync(()->{try {out.set(call.call());}catch(Throwable t){err.set(t);}});
        if(err.get()!=null)throw new AssertionError(err.get());return out.get();
    }
    private String js(String expr) throws Exception { return js(web,expr); }
    private String js(android.webkit.WebView target, String expr) throws Exception {
        CountDownLatch done=new CountDownLatch(1);AtomicReference<String> result=new AtomicReference<>();
        inst.runOnMainSync(()->target.evaluateJavascript(expr,s->{result.set(s);done.countDown();}));
        assertTrue("JS callback",done.await(5,TimeUnit.SECONDS));return result.get();
    }
    private double top() throws Exception {return Double.parseDouble(js("document.querySelector('.ch-msgs').scrollTop"));}
    private void until(java.util.concurrent.Callable<Boolean> check) throws Exception {
        long deadline=android.os.SystemClock.uptimeMillis()+7000;
        while(android.os.SystemClock.uptimeMillis()<deadline){if(check.call())return;Thread.sleep(60);}
        fail("Timed out waiting for native scroll/diagnostics contract");
    }
    private void pass(String name) {android.util.Log.i("WizardScrollProxyTest","PASS "+name);}

    private long tile(ChatScrollCapture capture,android.view.ScrollCaptureSession session,
                      android.media.ImageReader reader,android.graphics.Rect request) throws Exception {
        CountDownLatch done=new CountDownLatch(1);AtomicReference<android.graphics.Rect> result=new AtomicReference<>();
        ui(()->{capture.onScrollCaptureImageRequest(session,new CancellationSignal(),request,r->{result.set(r);done.countDown();});return null;});
        assertTrue("PixelCopy completion",done.await(5,TimeUnit.SECONDS));
        assertNotNull(result.get());assertFalse("capture cannot return an empty tile",result.get().isEmpty());
        android.media.Image image=null;
        for(int i=0;i<40&&image==null;i++){image=reader.acquireLatestImage();if(image==null)Thread.sleep(25);}
        assertNotNull("capture posted a real surface buffer",image);
        try {
            android.media.Image.Plane plane=image.getPlanes()[0];java.nio.ByteBuffer bytes=plane.getBuffer();
            java.util.zip.CRC32 crc=new java.util.zip.CRC32();
            byte[] row=new byte[image.getWidth()*plane.getPixelStride()];
            for(int y=0;y<image.getHeight();y++){bytes.position(y*plane.getRowStride());bytes.get(row);crc.update(row);}
            return crc.getValue();
        } finally {image.close();}
    }
    @Test public void stockWebViewAndDiagnosticsSecurity() throws Exception {
        assertTrue("QA build only",BuildConfig.DEBUG);
        inst.getUiAutomation(); // connect Android's real accessibility service before Chromium starts
        activity=(MainActivity)inst.startActivitySync(new Intent(inst.getTargetContext(),MainActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        web=ui(()->find(activity.getWindow().getDecorView()));assertNotNull(web);
        until(()->"true".equals(js("!!window.qaScrollProxyFixture&&!!window.__wosScrollCapture")));
        assertFalse("scroll proxy is retired",SelectionWebView.SCROLL_PROXY);
        // Compare against an actual unmodified Chromium WebView with identical HTML,
        // dimensions and settings, rather than assuming root scrollability from inner DOM.
        String html=new org.json.JSONTokener(js("document.documentElement.outerHTML")).nextValue().toString();
        String origin=new org.json.JSONTokener(js("location.origin")).nextValue().toString();
        ui(()->{
            stock=new android.webkit.WebView(activity);
            stock.getSettings().setJavaScriptEnabled(true);
            stock.getSettings().setUseWideViewPort(web.getSettings().getUseWideViewPort());
            stock.getSettings().setLoadWithOverviewMode(web.getSettings().getLoadWithOverviewMode());
            ((ViewGroup)web.getParent()).addView(stock,new ViewGroup.LayoutParams(web.getWidth(),web.getHeight()));
            stock.loadDataWithBaseURL(origin,"<!doctype html>"+html,"text/html","UTF-8",null);return null;
        });
        until(()->"true".equals(js(stock,"document.readyState==='complete'&&!!window.qaScrollProxyFixture")));
        until(()->ui(()->stock.getHeight()==web.getHeight()&&stock.getWidth()==web.getWidth()));
        ui(()->{ScrollCaptureDiagnostics.arm("qa-probe");return null;});
        assertEquals(ui(()->stock.canScrollVertically(1)),ui(()->web.canScrollVertically(1)));
        assertEquals(ui(()->stock.canScrollVertically(-1)),ui(()->web.canScrollVertically(-1)));
        assertEquals(ui(()->stock.getContentHeight()).intValue(),ui(()->web.getContentHeight()).intValue());
        assertTrue("native range is not the huge inner chat",ui(()->web.computeVerticalScrollRange())<
            Double.parseDouble(js("document.querySelector('.ch-msgs').scrollHeight")));
        pass("nested chat does not spoof stock View scrollability or range");
        js("document.querySelector('.ch-msgs').scrollTop=300");
        js(stock,"document.querySelector('.ch-msgs').scrollTop=300");
        double unchangedTop=top();
        ui(()->{web.scrollBy(0,350);stock.scrollBy(0,350);web.scrollBy(0,0);stock.scrollBy(0,0);
            web.scrollBy(20,0);stock.scrollBy(20,0);return null;});
        Thread.sleep(200);assertEquals(unchangedTop,top(),1);
        assertEquals(ui(()->stock.getScrollY()).intValue(),ui(()->web.getScrollY()).intValue());
        ui(()->{web.scrollTo(0,0);stock.scrollTo(0,0);return null;});
        // A real root-scrolling document still exposes normal Chromium View scrolling.
        String rootScroll="document.documentElement.style.cssText='overflow:auto;height:auto';document.body.style.cssText='margin:0;height:4000px;overflow:visible';true";
        js(rootScroll);js(stock,rootScroll);
        until(()->ui(()->web.canScrollVertically(1)&&stock.canScrollVertically(1)));
        ui(()->{web.scrollBy(0,350);stock.scrollBy(0,350);return null;});
        until(()->ui(()->web.getScrollY()>0&&stock.getScrollY()>0));
        assertEquals(ui(()->stock.getScrollY()).intValue(),ui(()->web.getScrollY()).intValue());
        assertEquals(ui(()->stock.canScrollVertically(-1)),ui(()->web.canScrollVertically(-1)));
        ui(()->{web.scrollTo(0,700);stock.scrollTo(0,700);return null;});
        Thread.sleep(200);assertEquals(ui(()->stock.getScrollY()).intValue(),ui(()->web.getScrollY()).intValue());
        assertEquals(unchangedTop,top(),1);
        pass("stock root scrollBy/scrollTo retained; nested chat never moved by native methods");
        ui(()->{web.scrollTo(0,0);((ViewGroup)stock.getParent()).removeView(stock);stock.destroy();return null;});
        js("document.documentElement.style.cssText='';document.body.style.cssText='';document.querySelector('.ch-msgs').scrollTop=0;true");
        until(()->"true".equals(js("!!__wosScrollCapture.search()")));
        assertEquals("false",js("__wosScrollCapture.proxyScroll('forged','to',900)"));
        // Both JS visibility and native pause must survive the screenshot UI taking focus.
        ChatScrollCapture capture=ui(()->{
            java.lang.reflect.Field field=SelectionWebView.class.getDeclaredField("scrollCapture");
            field.setAccessible(true);return (ChatScrollCapture)field.get(web);
        });
        CountDownLatch found=new CountDownLatch(1);AtomicReference<android.graphics.Rect> bounds=new AtomicReference<>();
        ui(()->{capture.onScrollCaptureSearch(new CancellationSignal(),r->{bounds.set(r);found.countDown();});return null;});
        assertTrue(found.await(5,TimeUnit.SECONDS));assertNotNull(bounds.get());assertFalse(bounds.get().isEmpty());
        android.media.ImageReader reader=android.media.ImageReader.newInstance(bounds.get().width(),bounds.get().height(),android.graphics.PixelFormat.RGBA_8888,2,android.hardware.HardwareBuffer.USAGE_CPU_READ_OFTEN|android.hardware.HardwareBuffer.USAGE_GPU_COLOR_OUTPUT);
        android.view.ScrollCaptureSession session=new android.view.ScrollCaptureSession(reader.getSurface(),bounds.get(),new android.graphics.Point(0,0));
        CountDownLatch started=new CountDownLatch(1);
        ui(()->{capture.onScrollCaptureStart(session,new CancellationSignal(),started::countDown);return null;});
        assertTrue(started.await(5,TimeUnit.SECONDS));
        assertEquals("true",js("!!document.querySelector('.ch-msgs').dataset.wosScrollCapture"));
        android.graphics.Rect port=bounds.get();
        tile(capture,session,reader,new android.graphics.Rect(0,0,port.width(),port.height()));
        pass("unpaused PixelCopy control delivered a real surface buffer");
        ui(()->{activity.onPause();return null;});
        assertEquals("true",js("!!__wosScrollCapture.check(document.querySelector('.ch-msgs').dataset.wosScrollCapture)"));
        long firstTile=tile(capture,session,reader,new android.graphics.Rect(0,0,port.width(),port.height()));
        long nextTile=tile(capture,session,reader,new android.graphics.Rect(0,port.height(),port.width(),2*port.height()));
        assertNotEquals("paused capture must deliver different real compositor pixels after scroll",firstTile,nextTile);
        ui(()->{activity.onResume();return null;});
        CountDownLatch ended=new CountDownLatch(1);
        ui(()->{capture.onScrollCaptureEnd(ended::countDown);return null;});
        assertTrue(ended.await(5,TimeUnit.SECONDS));reader.close();
        pass("native Activity pause does not abort an OS-owned capture session");
        org.json.JSONArray events=new org.json.JSONObject(ScrollCaptureDiagnostics.snapshot()[0]).getJSONArray("events");
        boolean sawCan=false,sawBy=false;
        for(int i=0;i<events.length();i++) {
            String method=events.getJSONObject(i).getString("method");
            sawCan|=method.equals("canScrollVertically");sawBy|=method.equals("scrollBy");
        }
        assertTrue(sawCan && sawBy);
        ui(()->{activity.onPause();activity.onResume();return null;});
        // The Python harness verifies the actual HTTP body and persisted readback, not a log line.
        until(ScrollCaptureDiagnostics::hasDeliveredForQa);
        pass("recorder includes native probes and resume schedules private diagnostic upload");
        ui(()->{activity.getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);return null;});
        double secureTop=top();ui(()->{web.scrollBy(0,-300);return null;});Thread.sleep(200);
        assertEquals(secureTop,top(),1);
        ui(()->{
            ChatScrollCapture secureCapture=new ChatScrollCapture(activity,web);
            for(int i=0;i<55;i++)secureCapture.onScrollCaptureSearch(new CancellationSignal(),r->assertTrue(r.isEmpty()));
            assertTrue(ScrollCaptureDiagnostics.RING.size()<=400);
            assertTrue(ScrollCaptureDiagnostics.snapshot()[0].contains("flag-secure"));
            activity.getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SECURE);return null;
        });
        pass("FLAG_SECURE blocks AOSP discovery; diagnostics ring capped at 400");
        js("document.querySelector('.ch-msgs').style.height='650px';document.querySelector('.ch-msgs').innerHTML='<p>Short</p>';true");
        until(()->!ui(()->web.canScrollVertically(1))&&!ui(()->web.canScrollVertically(-1)));
        pass("non-overflowing inner scroller still uses stock WebView");
        CountDownLatch empty=new CountDownLatch(1);
        ui(()->{new ChatScrollCapture(activity,web).onScrollCaptureSearch(new CancellationSignal(),r->{assertTrue(r.isEmpty());empty.countDown();});return null;});
        assertTrue(empty.await(5,TimeUnit.SECONDS));
        assertEquals("null",js("__wosScrollCapture.searchDetail()"));
        org.json.JSONArray latest=new org.json.JSONObject(ScrollCaptureDiagnostics.snapshot()[0]).getJSONArray("events");
        org.json.JSONObject detail=null;
        for(int i=latest.length()-1;i>=0;i--)if("search.detail".equals(latest.getJSONObject(i).optString("method"))){detail=latest.getJSONObject(i).getJSONObject("data");break;}
        assertNotNull("native search emitted detail",detail);assertTrue("non-overflow uploads JSON-null detail",detail.isNull("detail"));
        String[] reasons=ScrollCaptureDiagnostics.snapshot();
        assertTrue(reasons[0].contains("js-not-overflowing"));
        pass("empty AOSP callback reports precise JS non-overflow reason");
        // Public/untrusted top-level origin cannot activate this native capability.
        ui(()->{web.loadDataWithBaseURL("https://scroll-proxy-untrusted.invalid/",
            "<meta name='viewport' content='width=device-width'><div data-chats><div class='ch-msgs' style='height:500px;overflow:auto'><div style='height:4000px'>Untrusted</div></div></div>",
            "text/html","UTF-8","https://scroll-proxy-untrusted.invalid/");return null;});
        until(()->ui(()->web.getUrl()!=null&&web.getUrl().contains("scroll-proxy-untrusted.invalid")));
        ui(()->{web.installScrollProxy();return null;});Thread.sleep(200);
        assertFalse("untrusted helper never injected","true".equals(js("!!window.__wosScrollCapture")));
        pass("untrusted top-level origin cannot install capture helper");
    }
}
