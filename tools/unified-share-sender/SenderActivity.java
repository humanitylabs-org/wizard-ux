package qa.unifiedshare.sender;

import android.app.Activity;
import android.content.ClipData;
import android.content.ComponentName;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;

/** Separate synthetic source app: genuine ACTION_SEND, content URI and temporary read grant.
 * Explicit target makes this a receiver/bridge test, not a claim about the OS chooser or Gmail. */
public class SenderActivity extends Activity {
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        renderCase();
    }

    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        // am start may deliver to this already-resumed Activity. Both the title
        // and the button's captured payload must belong to the newest Intent.
        setIntent(intent);
        renderCase();
    }

    private void renderCase() {
        String mode = getIntent().getStringExtra("fixture_case");
        boolean genuine = "genuine".equals(mode);
        String name = genuine ? "genuine.pdf" : "x.pdf";
        LinearLayout box = new LinearLayout(this); box.setOrientation(LinearLayout.VERTICAL);
        box.setPadding(30, 150, 30, 30);
        TextView title = new TextView(this);
        title.setText("Synthetic external PDF sender\n" + name + "\nNo owner files or accounts");
        box.addView(title);
        Button button = new Button(this); button.setText("Share synthetic PDF"); box.addView(button);
        button.setOnClickListener(v -> {
            try {
                File f = new File(getFilesDir(), name);
                try (FileOutputStream out = new FileOutputStream(f)) {
                    out.write("%PDF-1.4\n% Synthetic unified-share acceptance only\n".getBytes(StandardCharsets.UTF_8));
                    long[] offsets = new long[5];
                    String[] objects = {
                        "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
                        "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
                        "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Contents 4 0 R /Resources << >> >>\nendobj\n",
                        "4 0 obj\n<< /Length 25165824 >>\nstream\n"
                    };
                    for (int i = 0; i < objects.length; i++) {
                        offsets[i + 1] = out.getChannel().position();
                        out.write(objects[i].getBytes(StandardCharsets.US_ASCII));
                    }
                    byte[] block = new byte[65536]; java.util.Arrays.fill(block, (byte)' ');
                    // Valid blank-page content stream; 24 MiB guarantees multiple native chunks.
                    for (int i = 0; i < 384; i++) out.write(block);
                    out.write("\nendstream\nendobj\n".getBytes(StandardCharsets.US_ASCII));
                    long xref = out.getChannel().position();
                    out.write("xref\n0 5\n0000000000 65535 f \n".getBytes(StandardCharsets.US_ASCII));
                    for (int i = 1; i <= 4; i++) out.write(String.format(java.util.Locale.US, "%010d 00000 n \n", offsets[i]).getBytes(StandardCharsets.US_ASCII));
                    out.write(("trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n" + xref + "\n%%EOF\n").getBytes(StandardCharsets.US_ASCII));
                }
                Uri uri = Uri.parse("content://qa.unifiedshare.sender.files/" + name);
                Intent send = new Intent(Intent.ACTION_SEND).setType("application/pdf")
                    .setComponent(new ComponentName("ai.wizards.os.qa", "ai.wizards.os.share.ShareActivity"))
                    .putExtra(Intent.EXTRA_STREAM, uri)
                    .putExtra(Intent.EXTRA_SUBJECT, name)
                    .putExtra(Intent.EXTRA_TEXT, genuine ? "A genuine shared note mentioning genuine.pdf" : "Emailing x.pdf");
                // Intent.setClipData returns void, unlike the fluent setters above.
                send.setClipData(ClipData.newRawUri("Synthetic PDF", uri));
                send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                startActivity(send);
            } catch (Exception e) { title.setText("Fixture error: " + e.getClass().getSimpleName()); }
        });
        setContentView(box);
    }
}
