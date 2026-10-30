package ai.wizards.os;

import android.content.Context;
import android.graphics.Typeface;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;

/**
 * The Wizard logo row (the iPhone app's .brand in ios/www/index.html): the Wizard mark 18dp high + "WIZARD", small,
 * tracked, in a muted colour. Top-left on Connect, the can't-reach screen, its loader and the Tailscale guide.
 */
final class BrandRow {
    private BrandRow() {}

    static LinearLayout build(Context c, int colour) {
        LinearLayout row = new LinearLayout(c);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.CENTER_VERTICAL);
        row.setContentDescription("Wizard");
        row.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_YES);
        ImageView mark = new ImageView(c);
        mark.setImageResource(R.drawable.wizard_mark);
        mark.setAdjustViewBounds(true);
        mark.setScaleType(ImageView.ScaleType.FIT_CENTER);
        mark.setAlpha(0.9f);
        mark.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
        row.addView(mark, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, dp(c, 18)));
        TextView word = new TextView(c);
        word.setText("WIZARD");
        word.setTextSize(TypedValue.COMPLEX_UNIT_SP, 11);
        word.setTextColor(colour);
        word.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
        word.setLetterSpacing(0.22f);
        word.setIncludeFontPadding(false);
        word.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
        LinearLayout.LayoutParams wl = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        wl.leftMargin = dp(c, 8);
        row.addView(word, wl);
        return row;
    }

    private static int dp(Context c, float v) {
        return Math.round(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, c.getResources().getDisplayMetrics()));
    }
}
