package ai.wizards.os;

import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.Color;

import org.json.JSONObject;

/**
 * The worn Wizard skin as native colours (Appearance v1 roles), so native screens such as Connect dress like the
 * shell. MainActivity reads the shell's resolved --wz-* tokens and saves them here; with nothing saved yet (first run)
 * the Nebula dark fallback applies. Colours only: no server URLs, scripts or credentials pass through.
 */
final class WizardLook {
    private static final String PREFS = "wizard_look";

    /** Run in the shell page: every role resolved to #rrggbbaa (canvas parses any CSS colour, incl. color-mix). */
    static final String READ_JS = "(()=>{try{const r=document.documentElement,s=getComputedStyle(r),c=document.createElement('canvas');c.width=c.height=1;"
            + "const x=c.getContext('2d',{willReadFrequently:true});"
            + "const px=v=>{v=(v||'').trim();if(!v||v.length>160||/[;{}]|url\\(/i.test(v))return '';x.fillStyle='#010203';x.fillStyle=v;"
            + "if(x.fillStyle==='#010203'&&!/^#010203/i.test(v))return '';x.clearRect(0,0,1,1);x.fillRect(0,0,1,1);const d=x.getImageData(0,0,1,1).data;"
            + "return '#'+[d[0],d[1],d[2],d[3]].map(n=>n.toString(16).padStart(2,'0')).join('')};"
            + "const g=(...k)=>{for(const n of k){const v=px(s.getPropertyValue('--'+n));if(v)return v}return ''};"
            + "return JSON.stringify({skin:/^[a-z0-9-]{1,40}$/.test(r.dataset.skin||'')?r.dataset.skin:'',"
            + "base:g('wz-base','bg'),text:g('wz-text','ink'),text2:g('wz-text-secondary','ink-2'),muted:g('wz-text-muted','ink-3'),"
            + "border:g('wz-border','line-2'),accent:g('wz-accent','violet-2')})}catch(e){return ''}})()";

    final String skin;
    final int base, text, text2, muted, border, accent;

    private WizardLook(String skin, int base, int text, int text2, int muted, int border, int accent) {
        this.skin = skin; this.base = base; this.text = text; this.text2 = text2; this.muted = muted; this.border = border; this.accent = accent;
    }

    static WizardLook nebula() {
        return new WizardLook("nebula", Color.rgb(5, 3, 12), Color.rgb(243, 239, 255), Color.rgb(185, 176, 216),
                Color.rgb(125, 116, 163), Color.argb(61, 205, 190, 255), Color.rgb(185, 155, 255));
    }

    static WizardLook load(Context c) {
        WizardLook d = nebula();
        try {
            String raw = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("look", null);
            return raw == null ? d : parse(new JSONObject(raw), d);
        } catch (Exception e) { return d; }
    }

    /** Saves the result of READ_JS (as handed back by evaluateJavascript). Ignores anything malformed. */
    static void save(Context c, String evaluated) {
        try {
            String json = new org.json.JSONArray("[" + evaluated + "]").getString(0);
            JSONObject o = new JSONObject(json);
            if (colour(o.optString("base")) == null || colour(o.optString("text")) == null) return;
            c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString("look", o.toString()).apply();
        } catch (Exception ignored) { }
    }

    static WizardLook parse(JSONObject o, WizardLook d) {
        Integer base = colour(o.optString("base"));
        // A see-through base would leave the screen black underneath: composite it over the fallback.
        int b = base == null ? d.base : over(base, light(d.base) ? Color.WHITE : Color.BLACK);
        String skin = o.optString("skin", "");
        return new WizardLook(skin.matches("[a-z0-9-]{1,40}") ? skin : d.skin, b,
                or(colour(o.optString("text")), d.text), or(colour(o.optString("text2")), d.text2),
                or(colour(o.optString("muted")), d.muted), or(colour(o.optString("border")), d.border),
                or(colour(o.optString("accent")), d.accent));
    }

    /** #rgb, #rrggbb or #rrggbbaa → ARGB; null when malformed. */
    static Integer colour(String v) {
        if (v == null || !v.matches("#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})")) return null;
        if (v.length() == 4) v = "#" + v.charAt(1) + v.charAt(1) + v.charAt(2) + v.charAt(2) + v.charAt(3) + v.charAt(3);
        long n = Long.parseLong(v.substring(1), 16);
        if (v.length() == 7) return (int) (0xFF000000L | n);
        return (int) (((n & 0xFF) << 24) | (n >>> 8));
    }

    private static int or(Integer v, int d) { return v == null ? d : v; }

    static int over(int top, int under) {
        float a = Color.alpha(top) / 255f;
        return Color.rgb(Math.round(Color.red(top) * a + Color.red(under) * (1 - a)),
                Math.round(Color.green(top) * a + Color.green(under) * (1 - a)),
                Math.round(Color.blue(top) * a + Color.blue(under) * (1 - a)));
    }

    static boolean light(int c) { return (0.299 * Color.red(c) + 0.587 * Color.green(c) + 0.114 * Color.blue(c)) > 150; }

    /** Shell roles derived the same way as core/appearance-host.js. */
    boolean isLight() { return light(base); }
    int surface() { return withAlpha(text, 0.06f); }
    int raised() { return withAlpha(text, 0.10f); }
    int accentSoft() { return withAlpha(accent, 0.16f); }
    int onAccent() { return light(over(accent, base)) ? (isLight() ? Color.rgb(29, 27, 23) : base) : Color.WHITE; }
    /** Signal's shape language: square corners and monospace labels. */
    boolean square() { return "signal".equals(skin); }

    static int withAlpha(int c, float a) { return Color.argb(Math.round(Color.alpha(c) * a), Color.red(c), Color.green(c), Color.blue(c)); }
}
