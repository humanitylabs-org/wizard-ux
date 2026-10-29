package ai.wizards.os;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/** Read-only, bounded shell check. Never follows a redirect into an untrusted origin or bypasses TLS. */
public final class WizardProbe {
    private WizardProbe() {}
    public static void check(String origin) throws IOException {
        HttpURLConnection c = (HttpURLConnection) new URL(origin + "/wizard-os-home/").openConnection();
        try {
            c.setConnectTimeout(8000); c.setReadTimeout(8000); c.setInstanceFollowRedirects(false);
            c.setRequestProperty("Accept", "text/html");
            if (c.getResponseCode() != 200) throw new IOException("Wizard did not return its shell. Check the address, Tailscale and owner sign-in.");
            String type = c.getContentType();
            if (type == null || !type.toLowerCase(java.util.Locale.ROOT).contains("text/html")) throw new IOException("This address did not return a Wizard page.");
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            long deadline = System.nanoTime() + 12_000_000_000L;
            try (InputStream in = c.getInputStream()) {
                byte[] buf = new byte[4096]; int n;
                while (out.size() < 262144 && (n = in.read(buf, 0, Math.min(buf.length, 262144 - out.size()))) != -1) {
                    if (System.nanoTime() > deadline) throw new IOException("Wizard shell check timed out.");
                    out.write(buf, 0, n);
                }
            }
            if (!looksLikeWizard(out.toString(StandardCharsets.UTF_8.name()))) throw new IOException("This address answered, but it is not a Wizard shell.");
        } finally { c.disconnect(); }
    }
    public static boolean looksLikeWizard(String html) {
        // The current shell ships a WizCore module and the Wizard OS title. Not a generic 200/login page.
        return html != null && html.contains("Wizard OS") && (html.contains("core/") || html.contains("__wosNativeBack"));
    }
}
