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
    private String js(String expr) throws Exception {
        CountDownLatch done=new CountDownLatch(1);AtomicReference<String> result=new AtomicReference<>();
        inst.runOnMainSync(()->web.evaluateJavascript(expr,s->{result.set(s);done.countDown();}));
        assertTrue("JS callback",done.await(5,TimeUnit.SECONDS));return result.get();
    }
    private double top() throws Exception {return Double.parseDouble(js("document.querySelector('.ch-msgs').scrollTop"));}
    private void until(java.util.concurrent.Callable<Boolean> check) throws Exception {
        long deadline=android.os.SystemClock.uptimeMillis()+7000;
        while(android.os.SystemClock.uptimeMillis()<deadline){if(check.call())return;Thread.sleep(60);}
        fail("Timed out waiting for proxy contract");
    }
    private void pass(String name) {android.util.Log.i("WizardScrollProxyTest","PASS "+name);}

    @Test public void realNativeScrollProxyAndSecurity() throws Exception {
        assertTrue("QA build only",BuildConfig.DEBUG);
        activity=(MainActivity)inst.startActivitySync(new Intent(inst.getTargetContext(),MainActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        web=ui(()->find(activity.getWindow().getDecorView()));assertNotNull(web);
        until(()->"true".equals(js("!!window.qaScrollProxyFixture&&!!window.__wosScrollCapture")));
        until(()->ui(()->web.canScrollVertically(1)));
        assertFalse(ui(()->web.canScrollVertically(-1)));
        double dpr=Double.parseDouble(js("devicePixelRatio"));
        int height=(int)Math.round(Double.parseDouble(js("document.querySelector('.ch-msgs').scrollHeight"))*dpr);
        int client=(int)Math.round(Double.parseDouble(js("document.querySelector('.ch-msgs').clientHeight"))*dpr);
        assertEquals(height,(int)ui(()->web.computeVerticalScrollRange()));
        assertEquals(client,(int)ui(()->web.computeVerticalScrollExtent()));
        pass("native canScrollVertically down=true at top; physical metrics mirror inner div");
        ui(()->{web.onPause();return null;});
        assertTrue(ui(()->web.canScrollVertically(1)));
        pass("still-visible paused WebView remains discoverable to screenshot toolbar");
        ui(()->{web.scrollBy(0,350);web.scrollBy(0,175);return null;});
        until(()->top()>100);
        assertEquals(525/dpr,top(),1.1);
        assertEquals(0,Double.parseDouble(js("document.scrollingElement.scrollTop")),0);
        until(()->Math.abs(ui(()->web.computeVerticalScrollOffset())-525)<=3);
        pass("native webView.scrollBy moves inner element only, serial deltas retained");
        ui(()->{web.onResume();return null;});
        double unchangedTop=top();ui(()->{web.scrollBy(0,0);web.scrollBy(20,0);return null;});
        Thread.sleep(150);assertEquals(unchangedTop,top(),1);
        pass("zero and horizontal-only scrollBy never reset inner offset");
        ui(()->{web.scrollTo(0,Integer.MAX_VALUE);return null;});
        until(()->!ui(()->web.canScrollVertically(1)));
        assertTrue(ui(()->web.canScrollVertically(-1)));
        assertEquals((int)ui(()->web.computeVerticalScrollRange()-web.computeVerticalScrollExtent()),
            (int)ui(()->web.computeVerticalScrollOffset()));
        pass("native canScrollVertically down=false at bottom; up=true");
        // A same-origin child frame has the port but cannot replace main-frame metrics.
        int before=ui(()->web.computeVerticalScrollOffset());
        js("(()=>{const f=document.createElement('iframe');f.srcdoc=`<script>wizardScrollPort.postMessage(JSON.stringify({v:1,key:'forged',height:999999,top:0,extent:500,dpr:devicePixelRatio,vw:innerWidth}))</script>`;f.style.display='none';document.body.append(f);return true})()");
        Thread.sleep(300);assertEquals(before,(int)ui(()->web.computeVerticalScrollOffset()));
        pass("child-frame metrics rejected by origin-bound native port");
        ui(()->{activity.getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);return null;});
        assertFalse(ui(()->web.canScrollVertically(-1)));
        double secureTop=top();ui(()->{web.scrollBy(0,-300);return null;});Thread.sleep(200);
        assertEquals(secureTop,top(),1);
        ui(()->{
            ChatScrollCapture capture=new ChatScrollCapture(activity,web);
            for(int i=0;i<55;i++)capture.onScrollCaptureSearch(new CancellationSignal(),r->assertTrue(r.isEmpty()));
            assertEquals(48,ScrollCaptureDiagnostics.snapshot().length);
            assertEquals("search empty: flag-secure",ScrollCaptureDiagnostics.snapshot()[47]);
            activity.getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SECURE);return null;
        });
        pass("FLAG_SECURE blocks proxy and AOSP discovery; diagnostics ring capped at 48");
        js("document.querySelector('.ch-msgs').style.height='650px';document.querySelector('.ch-msgs').innerHTML='<p>Short</p>';true");
        until(()->!ui(()->web.canScrollVertically(1))&&!ui(()->web.canScrollVertically(-1)));
        pass("non-overflowing inner scroller clears native proxy");
        CountDownLatch empty=new CountDownLatch(1);
        ui(()->{new ChatScrollCapture(activity,web).onScrollCaptureSearch(new CancellationSignal(),r->{assertTrue(r.isEmpty());empty.countDown();});return null;});
        assertTrue(empty.await(5,TimeUnit.SECONDS));
        String[] reasons=ScrollCaptureDiagnostics.snapshot();
        assertTrue(reasons[reasons.length-1].contains("js-not-overflowing"));
        pass("empty AOSP callback reports precise JS non-overflow reason");
        // Public/untrusted top-level origin cannot activate this native capability.
        ui(()->{web.loadDataWithBaseURL("https://scroll-proxy-untrusted.invalid/",
            "<meta name='viewport' content='width=device-width'><div data-chats><div class='ch-msgs' style='height:500px;overflow:auto'><div style='height:4000px'>Untrusted</div></div></div>",
            "text/html","UTF-8","https://scroll-proxy-untrusted.invalid/");return null;});
        until(()->ui(()->web.getUrl()!=null&&web.getUrl().contains("scroll-proxy-untrusted.invalid")));
        ui(()->{web.installScrollProxy();return null;});Thread.sleep(200);
        assertFalse("untrusted helper never injected","true".equals(js("!!window.__wosScrollCapture")));
        pass("untrusted top-level origin cannot install scroll proxy");
    }
}
