package com.grabtaxi.passenger;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.os.Bundle;
import android.text.Editable;
import android.text.TextWatcher;
import android.util.Log;
import android.view.Gravity;
import android.view.View;
import android.view.inputmethod.EditorInfo;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * QA stand-in for Grab (package com.grabtaxi.passenger). Home with a search box and a promo pop-up on every other
 * launch → results → a long restaurant menu (the usual item needs a scroll) with generic "Add" buttons → basket →
 * checkout with Total and "Place order ฿…". Every screen and the order itself are logged under FakeGrab.
 */
public class Main extends Activity {
    static final String TAG = "FakeGrab";
    private final Map<String, Integer> basket = new LinkedHashMap<>();
    private static final String[][] MENU = {
            {"Tom yum goong", "120"}, {"Tom kha gai", "110"}, {"Pad thai", "80"}, {"Pad see ew", "80"}, {"Khao man gai", "60"},
            {"Massaman curry", "120"}, {"Green curry", "110"}, {"Larb moo", "75"}, {"Som tam thai", "60"},
            {"Kra pao moo saap", "65"}, {"Khao niao", "20"}, {"Thai iced tea", "45"}, {"Mango sticky rice", "90"}};
    private static final String[][] BURGERS = {{"Classic burger", "149"}, {"Cheeseburger", "169"}, {"Fries", "59"}, {"Cola", "35"}};
    private LinearLayout root;
    private final Runnable dumper = this::dumpViews;
    private int dp(int v) { return Math.round(v * getResources().getDisplayMetrics().density); }

    @Override protected void onCreate(Bundle b) {
        super.onCreate(b);
        root = new LinearLayout(this); root.setOrientation(LinearLayout.VERTICAL); root.setBackgroundColor(Color.WHITE);
        root.setFitsSystemWindows(true);
        setContentView(root);
        SharedPreferences p = getSharedPreferences("fake", MODE_PRIVATE);
        int n = p.getInt("launches", 0) + 1; p.edit().putInt("launches", n).apply();
        home();
        if (n % 2 == 1) {
            Log.i(TAG, "screen popup");
            AlertDialog dlg = new AlertDialog.Builder(this).setTitle("50% off your next 3 orders!").setMessage("Use code HUNGRY at checkout.")
                    .setPositiveButton("Not now", (d, w) -> Log.i(TAG, "popup closed")).create();
            dlg.setOnShowListener(d -> root.postDelayed(() -> {
                View btn = dlg.getButton(AlertDialog.BUTTON_POSITIVE);
                int[] xy = new int[2]; btn.getLocationOnScreen(xy);
                Log.i(TAG, "views |Not now@" + (xy[0] + btn.getWidth() / 2) + "," + (xy[1] + btn.getHeight() / 2));
            }, 600));
            dlg.show();
        }
    }

    private String screen = "";
    private void clear(String screen) {
        this.screen = screen.startsWith("menu") ? "menu" : screen;
        root.removeAllViews(); Log.i(TAG, "screen " + screen);
        root.postDelayed(this::dumpViews, 700);
    }

    /** QA reads where things are from here (uiautomator would knock the accessibility service off). */
    void dumpViews() {
        StringBuilder sb = new StringBuilder("views");
        walk(getWindow().getDecorView(), sb);
        Log.i(TAG, sb.toString());
    }

    private void walk(View v, StringBuilder sb) {
        if (v.getVisibility() != View.VISIBLE) return;
        if (v instanceof TextView) {
            CharSequence t = ((TextView) v).getText();
            if (v instanceof EditText && (t == null || t.length() == 0)) t = ((EditText) v).getHint();
            int[] xy = new int[2]; v.getLocationOnScreen(xy);
            if (t != null && t.length() > 0 && v.getHeight() > 0 && xy[1] + v.getHeight() > 0 && xy[1] < getResources().getDisplayMetrics().heightPixels)
                sb.append(" |").append(t.toString().replace('|', '/')).append('@').append(xy[0] + v.getWidth() / 2).append(',').append(xy[1] + v.getHeight() / 2);
        }
        if (v instanceof android.view.ViewGroup) {
            android.view.ViewGroup g = (android.view.ViewGroup) v;
            for (int i = 0; i < g.getChildCount(); i++) walk(g.getChildAt(i), sb);
        }
    }

    private TextView text(String s, int sp, boolean bold) {
        TextView t = new TextView(this); t.setText(s); t.setTextSize(sp); t.setTextColor(Color.rgb(20, 20, 20));
        if (bold) t.setTypeface(null, android.graphics.Typeface.BOLD);
        t.setPadding(dp(16), dp(10), dp(16), dp(10));
        return t;
    }

    private void home() {
        clear("home");
        root.addView(text("GrabFood", 24, true));
        EditText q = new EditText(this); q.setHint("Search for dishes or restaurants"); q.setSingleLine(true);
        q.setImeOptions(EditorInfo.IME_ACTION_SEARCH);
        root.addView(q);
        LinearLayout res = new LinearLayout(this); res.setOrientation(LinearLayout.VERTICAL); root.addView(res);
        Runnable show = () -> {
            res.removeAllViews();
            String s = q.getText().toString().trim().toLowerCase();
            if (s.length() < 2) return;
            for (String r : new String[]{"Krua Thai Kitchen", "Som Tam Nua", "Kruang Burger"}) {
                if (!r.toLowerCase().contains(s)) continue;
                Button b = new Button(this); b.setText(r); b.setAllCaps(false);
                b.setOnClickListener(v -> v.post(() -> menu(r))); // like a fragment commit: navigation lands after the click event
                res.addView(b);
            }
        };
        q.addTextChangedListener(new TextWatcher() {
            public void beforeTextChanged(CharSequence s, int a, int b, int c) { }
            public void onTextChanged(CharSequence s, int a, int b, int c) { }
            public void afterTextChanged(Editable e) { show.run(); root.removeCallbacks(dumper); root.postDelayed(dumper, 500); }
        });
        q.setOnEditorActionListener((v, a, e) -> { show.run(); return true; });
        root.addView(text("Popular near you: Burger King · Starbucks · MK Restaurants", 14, false));
    }

    private void menu(String restaurant) {
        clear("menu " + restaurant);
        lastMenu = restaurant;
        root.addView(text(restaurant, 22, true));
        ScrollView sv = new ScrollView(this);
        sv.setOnScrollChangeListener((v, x, y, ox, oy) -> { root.removeCallbacks(dumper); root.postDelayed(dumper, 400); });
        LinearLayout list = new LinearLayout(this); list.setOrientation(LinearLayout.VERTICAL);
        sv.addView(list);
        String[][] items = restaurant.startsWith("Kruang") ? BURGERS : MENU;
        for (String[] m : items) {
            LinearLayout row = new LinearLayout(this); row.setOrientation(LinearLayout.HORIZONTAL); row.setGravity(Gravity.CENTER_VERTICAL);
            row.setPadding(0, dp(18), dp(12), dp(18));
            LinearLayout col = new LinearLayout(this); col.setOrientation(LinearLayout.VERTICAL);
            col.addView(text(m[0], 17, true)); col.addView(text("฿" + m[1], 14, false));
            row.addView(col, new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1));
            Button add = new Button(this); add.setText("Add"); add.setAllCaps(false);
            add.setOnClickListener(v -> { basket.merge(m[0], 1, Integer::sum); Log.i(TAG, "added " + m[0] + " x" + basket.get(m[0])); menuBar(); root.removeCallbacks(dumper); root.postDelayed(dumper, 400); });
            row.addView(add);
            list.addView(row);
        }
        root.addView(sv, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1));
        bar = new LinearLayout(this); root.addView(bar);
        menuBar();
    }

    private LinearLayout bar;

    private void menuBar() {
        bar.removeAllViews();
        int n = 0; for (int v : basket.values()) n += v;
        if (n == 0) return;
        Button view = new Button(this); view.setText("View basket · " + n + (n == 1 ? " item" : " items")); view.setAllCaps(false);
        view.setOnClickListener(v -> v.post(this::checkout));
        bar.addView(view, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT, 1));
    }

    private int price(String item) {
        for (String[] m : MENU) if (m[0].equals(item)) return Integer.parseInt(m[1]);
        for (String[] m : BURGERS) if (m[0].equals(item)) return Integer.parseInt(m[1]);
        return 0;
    }

    private void checkout() {
        clear("checkout");
        root.addView(text("Review order", 22, true));
        int sub = 0;
        for (Map.Entry<String, Integer> e : basket.entrySet()) {
            // A row per dish with Remove beside it (like Grab's basket editor).
            LinearLayout row = new LinearLayout(this); row.setOrientation(LinearLayout.HORIZONTAL); row.setGravity(Gravity.CENTER_VERTICAL);
            row.addView(text(e.getValue() + "× " + e.getKey() + "   ฿" + price(e.getKey()) * e.getValue(), 16, false),
                    new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1));
            Button rm = new Button(this); rm.setText("Remove"); rm.setAllCaps(false);
            final String item = e.getKey();
            rm.setOnClickListener(v -> v.post(() -> { basket.remove(item); Log.i(TAG, "removed " + item); checkout(); }));
            row.addView(rm);
            root.addView(row);
            sub += price(e.getKey()) * e.getValue();
        }
        root.addView(text("Delivery fee   ฿25", 15, false));
        int total = sub + 25;
        root.addView(text("Total", 18, true));
        root.addView(text("฿" + total, 18, true));
        Button place = new Button(this); place.setText("Place order ฿" + total); place.setAllCaps(false);
        final int t = total;
        place.setOnClickListener(v -> {
            StringBuilder s = new StringBuilder(); for (Map.Entry<String, Integer> e : basket.entrySet()) s.append(e.getValue()).append("x ").append(e.getKey()).append("; ");
            Log.i(TAG, "ORDER PLACED total=" + t + " items=" + s);
            clear("placed");
            root.addView(text("Order placed! Your driver is on the way.", 20, true));
        });
        root.addView(place);
        Log.i(TAG, "checkout total=" + total);
    }

    private String lastMenu;
    @Override public void onBackPressed() {
        if (screen.equals("checkout") && lastMenu != null) { menu(lastMenu); return; }
        home();
    }
}
