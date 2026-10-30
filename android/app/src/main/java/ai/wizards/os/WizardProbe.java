package ai.wizards.os;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.net.URL;
import java.net.UnknownHostException;
import java.nio.charset.StandardCharsets;
import java.util.Locale;

/** Read-only, bounded shell check. Never follows a redirect into an untrusted origin or bypasses TLS. */
public final class WizardProbe {
    private WizardProbe() {}

    /**
     * What the check found. Only NOT_FOUND (the name doesn't resolve) and NO_ANSWER (nothing answered: timeout, refused
     * connection, TLS) can be Tailscale's fault; the others answered, so the Tailscale guide doesn't apply to them.
     */
    public enum Kind { OK, NOT_FOUND, NO_ANSWER, REFUSED, HTTP, NOT_WIZARD }

    public static final class Result {
        public final Kind kind;
        /** The HTTP status when something answered, else 0. */
        public final int status;
        Result(Kind kind, int status) { this.kind = kind; this.status = status; }
        public boolean ok() { return kind == Kind.OK; }
        /** Nothing answered: the only results the Tailscale guide is for. */
        public boolean unanswered() { return kind == Kind.NOT_FOUND || kind == Kind.NO_ANSWER; }
    }

    /** Never throws: every failure comes back as a Kind. Blocking; call off the main thread. */
    public static Result probe(String origin) {
        HttpURLConnection c = null;
        try {
            c = (HttpURLConnection) new URL(origin + "/wizard-os-home/").openConnection();
            c.setConnectTimeout(8000); c.setReadTimeout(8000); c.setInstanceFollowRedirects(false);
            c.setRequestProperty("Accept", "text/html");
            int status = c.getResponseCode();
            Kind head = headers(status, c.getContentType());
            if (head != Kind.OK) return new Result(head, status);
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            long deadline = System.nanoTime() + 12_000_000_000L;
            try (InputStream in = c.getInputStream()) {
                byte[] buf = new byte[4096]; int n;
                while (out.size() < 262144 && (n = in.read(buf, 0, Math.min(buf.length, 262144 - out.size()))) != -1) {
                    if (System.nanoTime() > deadline) throw new IOException("Wizard shell check timed out.");
                    out.write(buf, 0, n);
                }
            }
            return new Result(looksLikeWizard(out.toString(StandardCharsets.UTF_8.name())) ? Kind.OK : Kind.NOT_WIZARD, status);
        } catch (UnknownHostException e) {
            return new Result(Kind.NOT_FOUND, 0);
        } catch (IOException | RuntimeException e) {
            return new Result(Kind.NO_ANSWER, 0);
        } finally {
            if (c != null) c.disconnect();
        }
    }

    /** Throws with the owner's message unless `origin` serves the Wizard shell. */
    public static void check(String origin) throws IOException {
        Result r = probe(origin);
        if (!r.ok()) throw new IOException(message(r.kind, r.status, origin));
    }

    /** From the response headers alone: OK to read the body, or why not. The shell is always 200 text/html. */
    static Kind headers(int status, String contentType) {
        if (status == 401 || status == 403) return Kind.REFUSED;
        if (status < 100) return Kind.NOT_WIZARD; // not an HTTP answer at all
        if (status != 200) return Kind.HTTP;
        String type = contentType == null ? "" : contentType.split(";", 2)[0].trim().toLowerCase(Locale.ROOT);
        return type.equals("text/html") ? Kind.OK : Kind.NOT_WIZARD;
    }

    /** The owner's words for a result; the iPhone app says the same (WizardOrigin.swift). Empty for OK. */
    static String message(Kind kind, int status, String origin) {
        String host = host(origin);
        boolean tailscale = ServerOrigin.needsTailscale(origin);
        switch (kind) {
            case NOT_FOUND: return tailscale
                    ? "Couldn't find " + host + ". Make sure Tailscale is on and signed in to the same account as your Wizard."
                    : "Couldn't find " + host + ". Check the address.";
            case NO_ANSWER: return tailscale
                    ? "Couldn't reach " + host + ". Make sure Tailscale is on and signed in to the same account as your Wizard."
                    : "Couldn't reach " + host + ". Check the address and your connection.";
            case REFUSED: return "This phone isn't allowed into this Wizard. Sign in to Tailscale with your Wizard's account.";
            case HTTP: return host + " answered, but didn't open Wizard (HTTP " + status + ").";
            case NOT_WIZARD: return host + " answered, but it isn't a Wizard.";
            default: return "";
        }
    }

    /** "host[:port]" of an origin, as the messages name it. */
    static String host(String origin) {
        try {
            URI u = new URI(origin);
            if (u.getHost() == null) return String.valueOf(origin);
            return u.getHost() + (u.getPort() == -1 ? "" : ":" + u.getPort());
        } catch (Exception e) { return String.valueOf(origin); }
    }

    public static boolean looksLikeWizard(String html) {
        // The current shell ships a WizCore module and the Wizard OS title. Not a generic 200/login page.
        return html != null && html.contains("Wizard OS") && (html.contains("core/") || html.contains("__wosNativeBack"));
    }
}
