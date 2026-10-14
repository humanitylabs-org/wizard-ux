package ai.wizards.os.assist;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

import org.json.JSONObject;

/**
 * Sends one recording to Wizard Voice Core (Tinfoil-attested Voxtral) through the private,
 * tailnet-only Wizard OS endpoint. The phone must be on Tailscale. Nothing else leaves the phone.
 */
public final class Transcriber {
    static final String PATH = "/wizard-os-home/api/transcribe";
    /** Speech-to-text hint: who the request is for and the names this Wizard knows (device/OwnerProfile). */
    static String prompt() {
        return "Wizard voice request spoken to " + ai.wizards.os.device.OwnerProfile.agent() + " on a phone lock screen. "
                + ai.wizards.os.device.OwnerProfile.names();
    }

    public static final class Result {
        public final String text;
        public final long ms;
        Result(String text, long ms) { this.text = text; this.ms = ms; }
    }

    static Result transcribe(File audio) throws IOException { return transcribe(audio, ai.wizards.os.device.AppState.live(ai.wizards.os.device.WizardAddress.origin()), prompt()); }

    /** origin is the private Wizard origin (a local fake in unit tests). */
    public static Result transcribe(File audio, String origin, String prompt) throws IOException {
        byte[] data = readAll(audio);
        Multipart mp = new Multipart();
        mp.file("file", "voice" + TakeRecovery.ext(audio.getName()), TakeRecovery.mime(audio.getName()), data).field("language", "en");
        if (prompt != null && !prompt.isEmpty()) mp.field("prompt", prompt); // dictation sends none, as Archimedes Anywhere
        byte[] body = mp.finish();
        long t0 = System.nanoTime();
        HttpURLConnection c = (HttpURLConnection) new URL(origin + PATH).openConnection();
        try {
            c.setConnectTimeout(8000);
            c.setReadTimeout(90000);
            c.setDoOutput(true);
            c.setRequestMethod("POST");
            c.setRequestProperty("Content-Type", mp.contentType());
            c.setRequestProperty("Origin", origin);
            c.setFixedLengthStreamingMode(body.length);
            try (OutputStream os = c.getOutputStream()) { os.write(body); }
            int code = c.getResponseCode();
            InputStream is = code >= 400 ? c.getErrorStream() : c.getInputStream();
            String resp = is == null ? "" : new String(readAll(is), StandardCharsets.UTF_8);
            if (code != 200) throw new IOException("Wizard voice returned " + code);
            JSONObject j = new JSONObject(resp);
            return new Result(j.optString("text", "").trim(), (System.nanoTime() - t0) / 1_000_000);
        } catch (org.json.JSONException e) {
            throw new IOException("bad reply from Wizard voice");
        } finally {
            c.disconnect();
        }
    }

    private static byte[] readAll(File f) throws IOException {
        try (InputStream in = new FileInputStream(f)) { return readAll(in); }
    }

    private static byte[] readAll(InputStream in) throws IOException {
        ByteArrayOutputStream b = new ByteArrayOutputStream();
        byte[] buf = new byte[16384];
        int n;
        while ((n = in.read(buf)) > 0) b.write(buf, 0, n);
        return b.toByteArray();
    }
}
