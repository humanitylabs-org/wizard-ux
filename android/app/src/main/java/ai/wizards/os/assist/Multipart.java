package ai.wizards.os.assist;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.UUID;

/** Builds the multipart/form-data body Wizard Voice Core expects (file + language + prompt). */
public final class Multipart {
    final String boundary;
    private final ByteArrayOutputStream out = new ByteArrayOutputStream();

    public Multipart() {
        this("wizardlock" + UUID.randomUUID().toString().replace("-", ""));
    }

    Multipart(String boundary) {
        this.boundary = boundary;
    }

    public String contentType() {
        return "multipart/form-data; boundary=" + boundary;
    }

    public Multipart field(String name, String value) throws IOException {
        write("--" + boundary + "\r\n");
        write("Content-Disposition: form-data; name=\"" + safe(name) + "\"\r\n\r\n");
        write(value == null ? "" : value);
        write("\r\n");
        return this;
    }

    public Multipart file(String name, String filename, String mime, byte[] data) throws IOException {
        write("--" + boundary + "\r\n");
        write("Content-Disposition: form-data; name=\"" + safe(name) + "\"; filename=\"" + safe(filename) + "\"\r\n");
        write("Content-Type: " + mime + "\r\n\r\n");
        out.write(data);
        write("\r\n");
        return this;
    }

    public byte[] finish() throws IOException {
        write("--" + boundary + "--\r\n");
        return out.toByteArray();
    }

    private void write(String s) throws IOException {
        out.write(s.getBytes(StandardCharsets.UTF_8));
    }

    private static String safe(String s) {
        return s.replace("\"", "").replace("\r", "").replace("\n", "");
    }
}
