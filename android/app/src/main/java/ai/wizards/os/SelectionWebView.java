package ai.wizards.os;

import android.content.Context;
import android.graphics.Rect;
import android.os.SystemClock;
import android.view.ActionMode;
import android.view.Menu;
import android.view.MenuItem;
import android.view.View;
import android.webkit.WebView;

/**
 * Wizard OS draws its own menu for text selected in chats (Copy · Share · Quote · Search · Select all, chosen in
 * Settings). The page tells this view, through WizardOSNative.selection(state), when a selection is its own; then
 * Android's floating Copy/Share/Select all toolbar is started with an empty menu, so it never shows, while the
 * selection, its handles and dragging stay native. Anywhere else (the composer, a hosted app) the stock toolbar runs
 * untouched, so Paste keeps working.
 */
public class SelectionWebView extends WebView {
    // Set from the JS bridge thread, read on the UI thread.
    private volatile long downAt;
    private volatile boolean downEditable, selOurs;

    private ChatScrollCapture scrollCapture;

    public SelectionWebView(Context c) {
        super(c);
        if (android.os.Build.VERSION.SDK_INT >= 31 && c instanceof android.app.Activity)
            scrollCapture = new ChatScrollCapture((android.app.Activity)c, this);
    }

    void cancelScrollCapture() {
        if (android.os.Build.VERSION.SDK_INT >= 31 && scrollCapture != null) scrollCapture.abort();
    }

    @Override public void onPause() { cancelScrollCapture(); super.onPause(); }
    @Override protected void onDetachedFromWindow() { cancelScrollCapture(); super.onDetachedFromWindow(); }

    /** 1 finger down on page text · 2 finger down in a text field · 3 selection is the page's own · 0 selection gone. */
    public void selectionState(int s) {
        if (s == 1 || s == 2) { downAt = SystemClock.uptimeMillis(); downEditable = s == 2; if (s == 2) selOurs = false; }
        else if (s == 3) selOurs = true;
        else if (s == 0) selOurs = false;
    }

    boolean ours() {
        return SelectionPolicy.ours(selOurs, downEditable, SystemClock.uptimeMillis() - downAt);
    }

    @Override
    public ActionMode startActionMode(ActionMode.Callback cb, int type) {
        return super.startActionMode(type == ActionMode.TYPE_FLOATING && ours() ? new Quiet(cb) : cb, type);
    }

    @Override
    public ActionMode startActionMode(ActionMode.Callback cb) {
        return super.startActionMode(ours() ? new Quiet(cb) : cb);
    }

    /** The stock selection callback with every menu item removed: the selection lives, the toolbar has nothing to show. */
    static final class Quiet extends ActionMode.Callback2 {
        private final ActionMode.Callback cb;
        Quiet(ActionMode.Callback cb) { this.cb = cb; }
        @Override public boolean onCreateActionMode(ActionMode m, Menu menu) { boolean r = cb.onCreateActionMode(m, menu); menu.clear(); return r; }
        @Override public boolean onPrepareActionMode(ActionMode m, Menu menu) { cb.onPrepareActionMode(m, menu); menu.clear(); return true; }
        @Override public boolean onActionItemClicked(ActionMode m, MenuItem item) { return cb.onActionItemClicked(m, item); }
        @Override public void onDestroyActionMode(ActionMode m) { cb.onDestroyActionMode(m); }
        @Override public void onGetContentRect(ActionMode m, View v, Rect out) {
            if (cb instanceof ActionMode.Callback2) ((ActionMode.Callback2) cb).onGetContentRect(m, v, out); else super.onGetContentRect(m, v, out);
        }
    }
}
