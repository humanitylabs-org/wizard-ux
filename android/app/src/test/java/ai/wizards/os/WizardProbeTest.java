package ai.wizards.os;

import org.junit.Test;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.io.*;
import static org.junit.Assert.*;

import ai.wizards.os.WizardProbe.Kind;

public class WizardProbeTest {
    /** Status line + headers, body, in the order the probes below ask. */
    private static final String SHELL = "<title>Wizard OS</title><script src='core/shell.js'></script>";
    private static final String[][] ANSWERS = {
        { "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\n", SHELL },
        { "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\n", "<title>Sign in</title>" },
        { "HTTP/1.1 302 Found\r\nLocation: /login\r\nContent-Type: text/html\r\n", SHELL },
        { "HTTP/1.1 403 Forbidden\r\nContent-Type: text/html\r\n", "<title>Forbidden</title>" },
        { "HTTP/1.1 401 Unauthorized\r\nContent-Type: text/html\r\n", "" },
        { "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n", SHELL },
        { "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\n", SHELL },
        { "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\n", "<title>Sign in</title>" },
    };

    @Test public void validateWizardNotJustSuccessfulHttp() throws Exception {
        try (ServerSocket server = new ServerSocket(0, 8, InetAddress.getByName("127.0.0.1"))) {
            server.setSoTimeout(10000);
            final Throwable[] failure = {null};
            Thread fixture = new Thread(() -> {
                try {
                    for (String[] answer : ANSWERS) try (Socket s = server.accept()) {
                        s.setSoTimeout(5000);
                        BufferedReader in = new BufferedReader(new InputStreamReader(s.getInputStream(), StandardCharsets.UTF_8));
                        String line;
                        for (int n = 0; n < 50 && (line = in.readLine()) != null && !line.isEmpty(); n++) { }
                        byte[] body = answer[1].getBytes(StandardCharsets.UTF_8);
                        OutputStream out = s.getOutputStream();
                        out.write((answer[0] + "Content-Length: " + body.length + "\r\nConnection: close\r\n\r\n").getBytes(StandardCharsets.UTF_8));
                        out.write(body); out.flush();
                    }
                } catch (Throwable t) { failure[0] = t; }
            });
            fixture.start();
            String origin = "http://127.0.0.1:" + server.getLocalPort();
            try {
                assertEquals(Kind.OK, WizardProbe.probe(origin).kind);
                assertEquals("Login page accepted", Kind.NOT_WIZARD, WizardProbe.probe(origin).kind);
                WizardProbe.Result redirect = WizardProbe.probe(origin);
                assertEquals("Redirect followed", Kind.HTTP, redirect.kind);
                assertEquals(302, redirect.status);
                assertEquals("another Tailscale user", Kind.REFUSED, WizardProbe.probe(origin).kind);
                assertEquals(Kind.REFUSED, WizardProbe.probe(origin).kind);
                assertEquals("not HTML", Kind.NOT_WIZARD, WizardProbe.probe(origin).kind);
                WizardProbe.check(origin);
                try { WizardProbe.check(origin); fail("Login page accepted"); }
                catch (IOException expected) { assertEquals("127.0.0.1:" + server.getLocalPort() + " answered, but it isn't a Wizard.", expected.getMessage()); }
            } finally { server.close(); fixture.join(12000); }
            assertFalse("fixture still running", fixture.isAlive());
            if (failure[0] != null) throw new AssertionError(failure[0]);
        }
    }

    @Test public void nothingAnsweringIsNotAnAnswer() throws Exception {
        int closed;
        try (ServerSocket s = new ServerSocket(0, 1, InetAddress.getByName("127.0.0.1"))) { closed = s.getLocalPort(); }
        WizardProbe.Result none = WizardProbe.probe("http://127.0.0.1:" + closed);
        assertEquals(Kind.NO_ANSWER, none.kind);
        assertTrue(none.unanswered());
        WizardProbe.Result missing = WizardProbe.probe("https://wizard.example.invalid");
        assertEquals(Kind.NOT_FOUND, missing.kind);
        assertTrue(missing.unanswered());
    }

    @Test public void headersAloneDecideMostAnswers() {
        assertEquals(Kind.OK, WizardProbe.headers(200, "text/html"));
        assertEquals(Kind.OK, WizardProbe.headers(200, "Text/HTML; charset=utf-8"));
        assertEquals(Kind.NOT_WIZARD, WizardProbe.headers(200, "application/json"));
        assertEquals(Kind.NOT_WIZARD, WizardProbe.headers(200, "application/xhtml+xml; note=text/html"));
        assertEquals(Kind.NOT_WIZARD, WizardProbe.headers(200, null));
        assertEquals(Kind.REFUSED, WizardProbe.headers(401, "text/html"));
        assertEquals(Kind.REFUSED, WizardProbe.headers(403, null));
        assertEquals(Kind.HTTP, WizardProbe.headers(302, "text/html"));
        assertEquals(Kind.HTTP, WizardProbe.headers(404, "text/html"));
        assertEquals(Kind.HTTP, WizardProbe.headers(502, "text/html"));
        assertEquals(Kind.NOT_WIZARD, WizardProbe.headers(-1, null));
    }

    @Test public void wordsNameTheRealProblem() {
        String ts = "https://wizard.example-tailnet.ts.net", other = "https://box.example:8443";
        assertEquals("Couldn't find wizard.example-tailnet.ts.net. Make sure Tailscale is on and signed in to the same account as your Wizard.",
                WizardProbe.message(Kind.NOT_FOUND, 0, ts));
        assertEquals("Couldn't find box.example:8443. Check the address.", WizardProbe.message(Kind.NOT_FOUND, 0, other));
        assertEquals("Couldn't reach wizard.example-tailnet.ts.net. Make sure Tailscale is on and signed in to the same account as your Wizard.",
                WizardProbe.message(Kind.NO_ANSWER, 0, ts));
        assertEquals("Couldn't reach box.example:8443. Check the address and your connection.", WizardProbe.message(Kind.NO_ANSWER, 0, other));
        String refused = "This phone isn't allowed into this Wizard. Sign in to Tailscale with your Wizard's account.";
        assertEquals(refused, WizardProbe.message(Kind.REFUSED, 403, ts));
        assertEquals(refused, WizardProbe.message(Kind.REFUSED, 401, other));
        assertEquals("box.example:8443 answered, but didn't open Wizard (HTTP 502).", WizardProbe.message(Kind.HTTP, 502, other));
        assertEquals("wizard.example-tailnet.ts.net answered, but it isn't a Wizard.", WizardProbe.message(Kind.NOT_WIZARD, 200, ts));
        assertEquals("", WizardProbe.message(Kind.OK, 200, ts));
        for (Kind k : Kind.values()) assertFalse(k + " uses curly quotes", WizardProbe.message(k, 500, ts).contains("\u2019"));
    }
}
