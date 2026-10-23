package ai.wizards.os.automation;

import android.app.Activity;
import android.os.Bundle;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

/**
 * A dummy food-ordering app for AutomationE2eTest. It ships in the instrumentation APK (ai.wizards.os.qa.test, the
 * debug-only automation target), so its windows belong to another package, exactly like Grab's. No network, no data.
 * Screens change after the click is reported (posted), as in a real app: rebuilding inside onClick detaches the
 * button before Android sends TYPE_VIEW_CLICKED, so no recorder would ever see the tap.
 * Home → menu (Kra pao / Pad thai rows with "Add", an Express row that wraps "Pay now") → checkout (Total, Place order).
 */
public class DummyFoodActivity extends Activity {
    private int kraPao, padThai;
    private LinearLayout root;

    @Override protected void onCreate(Bundle b) {
        super.onCreate(b);
        root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(32, 160, 32, 32);
        setContentView(root);
        home();
    }

    private TextView text(String s) { TextView t = new TextView(this); t.setText(s); t.setTextSize(18); root.addView(t); return t; }

    private Button button(String s, Runnable r) {
        Button x = new Button(this); x.setText(s); x.setAllCaps(false); x.setOnClickListener(v -> v.post(r)); root.addView(x); return x;
    }

    private LinearLayout row() {
        LinearLayout l = new LinearLayout(this); l.setOrientation(LinearLayout.HORIZONTAL);
        l.setPadding(0, 24, 0, 24);
        root.addView(l, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        return l;
    }

    private void dish(String name, Runnable add) {
        LinearLayout l = row();
        TextView t = new TextView(this); t.setText(name); t.setTextSize(18);
        l.addView(t, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        Button a = new Button(this); a.setText("Add"); a.setAllCaps(false); a.setOnClickListener(v -> { add.run(); v.post(this::menu); });
        l.addView(a);
    }

    void home() {
        root.removeAllViews();
        text("Dummy Food home");
        button("Krua Thai Kitchen", this::menu);
    }

    void menu() {
        root.removeAllViews();
        text("Krua Thai Kitchen menu");
        dish("Kra pao", () -> kraPao++);
        dish("Pad thai", () -> padThai++);
        // A control whose own label is harmless but which wraps a payment button: the live-node guard must refuse it.
        LinearLayout express = row();
        express.setClickable(true);
        express.setOnClickListener(v -> v.post(() -> paid("PAID BY EXPRESS")));
        TextView e = new TextView(this); e.setText("Express"); e.setTextSize(18); express.addView(e);
        TextView p = new TextView(this); p.setText("  Pay now ฿90"); p.setTextSize(18); express.addView(p);
        button("View basket · " + (kraPao + padThai) + " items", this::checkout);
    }

    void checkout() {
        root.removeAllViews();
        text("Review order");
        if (kraPao > 0) text(kraPao + "× Kra pao   ฿65");
        if (padThai > 0) text(padThai + "× Pad thai   ฿70");
        text("Delivery fee ฿25");
        text("Total ฿" + (kraPao * 65 + padThai * 70 + 25));
        button("Place order ฿" + (kraPao * 65 + padThai * 70 + 25), () -> paid("ORDER PLACED"));
    }

    void paid(String what) {
        root.removeAllViews();
        text(what);
        text("Tracking your food");
    }
}
