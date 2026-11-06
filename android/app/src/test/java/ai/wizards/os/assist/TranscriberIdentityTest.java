package ai.wizards.os.assist;

import ai.wizards.os.device.WizardIdentity;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.Test;
import static org.junit.Assert.*;

public class TranscriberIdentityTest {
    // Android's compiler does not expose desktop jdk.httpserver. Exercise real HTTP over java.base.
    @Test public void configuredNameActuallyReachesMultipartAndDictationOmitsPrompt() throws Exception {
        AtomicReference<String> received = new AtomicReference<>();
        AtomicReference<Throwable> failure = new AtomicReference<>();
        try (ServerSocket server = new ServerSocket(0, 2, InetAddress.getByName("127.0.0.1"))) {
            server.setSoTimeout(10000);
            Thread worker = new Thread(() -> {
                try {
                    for (int request = 0; request < 2; request++) {
                        try (Socket socket = server.accept()) {
                            socket.setSoTimeout(10000);
                            InputStream in = socket.getInputStream();
                            ByteArrayOutputStream header = new ByteArrayOutputStream();
                            int b, tail = 0;
                            while ((b = in.read()) != -1) {
                                header.write(b); tail = (tail << 8) | b;
                                if (tail == 0x0d0a0d0a) break;
                                if (header.size() > 65536) throw new AssertionError("oversized headers");
                            }
                            int length = -1;
                            for (String line : header.toString("US-ASCII").split("\r\n")) {
                                if (line.toLowerCase(java.util.Locale.ROOT).startsWith("content-length:"))
                                    length = Integer.parseInt(line.substring(line.indexOf(':') + 1).trim());
                            }
                            if (length < 0 || length > 1048576) throw new AssertionError("invalid content length");
                            byte[] body = in.readNBytes(length);
                            if (body.length != length) throw new AssertionError("truncated request");
                            received.set(new String(body, StandardCharsets.UTF_8));
                            byte[] response = "{\"text\":\"Hello\"}".getBytes(StandardCharsets.UTF_8);
                            socket.getOutputStream().write(("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: " + response.length + "\r\nConnection: close\r\n\r\n").getBytes(StandardCharsets.US_ASCII));
                            socket.getOutputStream().write(response);
                            socket.getOutputStream().flush();
                        }
                    }
                } catch (Throwable e) { failure.set(e); }
            }, "identity-loopback-test");
            worker.setDaemon(true); worker.start();
            Path audio = Files.createTempFile("wizard-identity-", ".aac");
            try {
                Files.write(audio, new byte[]{1, 2, 3}); // Transport fixture, not speech/model evidence.
                String origin = "http://127.0.0.1:" + server.getLocalPort();
                assertEquals("Hello", Transcriber.transcribe(audio.toFile(), origin, WizardIdentity.voicePrompt("Saffron")).text);
                assertTrue(received.get().contains("name=\"prompt\""));
                assertTrue(received.get().contains("spoken to Saffron"));
                assertFalse(received.get().contains("Archimedes"));
                assertFalse(received.get().contains("Bangkok"));
                Transcriber.transcribe(audio.toFile(), origin, "");
                assertFalse(received.get().contains("name=\"prompt\""));
                assertTrue(received.get().contains("name=\"file\""));
                worker.join(2000);
                assertFalse("loopback worker finished", worker.isAlive());
                assertNull(failure.get());
            } finally { Files.deleteIfExists(audio); }
        }
    }
}
