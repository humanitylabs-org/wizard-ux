package ai.wizards.os.assist;

import ai.wizards.os.device.WizardIdentity;
import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.Test;
import static org.junit.Assert.*;

public class TranscriberIdentityTest {
    @Test public void configuredNameActuallyReachesMultipartAndDictationOmitsPrompt() throws Exception {
        AtomicReference<String> received = new AtomicReference<>();
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/wizard-os-home/api/transcribe", exchange -> {
            received.set(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
            byte[] response = "{\"text\":\"Hello\"}".getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(200, response.length);
            try (java.io.OutputStream out = exchange.getResponseBody()) { out.write(response); }
        });
        Path audio = Files.createTempFile("wizard-identity-", ".aac");
        try {
            Files.write(audio, new byte[]{1, 2, 3}); // Transport fixture, not speech/model accuracy evidence.
            server.start();
            String origin = "http://127.0.0.1:" + server.getAddress().getPort();
            assertEquals("Hello", Transcriber.transcribe(audio.toFile(), origin, WizardIdentity.voicePrompt("Saffron")).text);
            assertTrue(received.get().contains("name=\"prompt\""));
            assertTrue(received.get().contains("spoken to Saffron"));
            assertFalse(received.get().contains("Archimedes"));
            assertFalse(received.get().contains("Bangkok"));
            Transcriber.transcribe(audio.toFile(), origin, "");
            assertFalse(received.get().contains("name=\"prompt\""));
            assertTrue(received.get().contains("name=\"file\""));
        } finally { server.stop(0); Files.deleteIfExists(audio); }
    }
}
