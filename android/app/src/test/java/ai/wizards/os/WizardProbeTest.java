package ai.wizards.os;

import org.junit.Test;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.io.*;
import static org.junit.Assert.*;

public class WizardProbeTest {
    @Test public void validateWizardNotJustSuccessfulHttp() throws Exception {
        try (ServerSocket server = new ServerSocket(0, 8, InetAddress.getByName("127.0.0.1"))) {
            server.setSoTimeout(10000);
            final Throwable[] failure = {null};
            Thread fixture = new Thread(() -> {
                try {
                    for (int mode = 0; mode < 3; mode++) try (Socket s = server.accept()) {
                        s.setSoTimeout(5000);
                        BufferedReader in = new BufferedReader(new InputStreamReader(s.getInputStream(), StandardCharsets.UTF_8));
                        String line;
                        for (int n = 0; n < 50 && (line = in.readLine()) != null && !line.isEmpty(); n++) { }
                        byte[] body = (mode == 0 ? "<title>Wizard OS</title><script src='core/shell.js'></script>" : "<title>Sign in</title>").getBytes(StandardCharsets.UTF_8);
                        OutputStream out = s.getOutputStream();
                        out.write(((mode == 2 ? "HTTP/1.1 302 Found\r\nLocation: /login\r\n" : "HTTP/1.1 200 OK\r\n") + "Content-Type: text/html\r\nContent-Length: " + body.length + "\r\nConnection: close\r\n\r\n").getBytes(StandardCharsets.UTF_8));
                        out.write(body); out.flush();
                    }
                } catch (Throwable t) { failure[0] = t; }
            });
            fixture.start();
            String origin = "http://127.0.0.1:" + server.getLocalPort();
            try {
                WizardProbe.check(origin);
                try { WizardProbe.check(origin); fail("Login page accepted"); } catch (IOException expected) { assertTrue(expected.getMessage().contains("not a Wizard")); }
                try { WizardProbe.check(origin); fail("Redirect followed"); } catch (IOException expected) { assertTrue(expected.getMessage().contains("did not return")); }
            } finally { server.close(); fixture.join(12000); }
            assertFalse("fixture still running", fixture.isAlive());
            if (failure[0] != null) throw new AssertionError(failure[0]);
        }
    }
}
