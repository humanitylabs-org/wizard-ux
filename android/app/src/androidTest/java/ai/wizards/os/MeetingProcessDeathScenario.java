package ai.wizards.os;

import android.Manifest;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.service.notification.StatusBarNotification;
import androidx.test.platform.app.InstrumentationRegistry;
import ai.wizards.os.mizel.MeetingRecorderService;
import ai.wizards.os.mizel.MizelHub;
import ai.wizards.os.mizel.MizelJournal;
import ai.wizards.os.mizel.MizelStore;
import ai.wizards.os.mizel.Wav;
import org.json.JSONObject;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import static org.junit.Assert.*;

/**
 * wizard-ux#1724 on a real emulator: a phone meeting recording whose app process died mid-meeting continues in the SAME
 * meeting when WizardOS opens again (seq and start_ms carry on, no /stop with process_death), with a "Recording resumed
 * after the app was closed" notice, and still ends normally on the owner's Stop.
 *
 * The killed process is reproduced by what it leaves on disk, the only thing a new process sees: an open journal with
 * finished chunks and a torn last chunk, and no recorder in memory. Uploads go to a disposable localhost meetings server
 * (debug-only files/qa_home.txt), never an owner's Wizard. Run by {@link DeviceBridgeE2eTest} (the CI emulator job's
 * class list) as the first test of the process, so the recorder's uploader is created pointing at this fixture.
 */
final class MeetingProcessDeathScenario {
    private static final String ID = "qa_mt_death_resume";

    static void run() throws Exception {
        Context c = InstrumentationRegistry.getInstrumentation().getTargetContext();
        assertTrue(BuildConfig.DEBUG);
        android.app.UiAutomation ua = InstrumentationRegistry.getInstrumentation().getUiAutomation();
        ua.grantRuntimePermission(c.getPackageName(), Manifest.permission.RECORD_AUDIO);
        if (android.os.Build.VERSION.SDK_INT >= 33) ua.grantRuntimePermission(c.getPackageName(), Manifest.permission.POST_NOTIFICATIONS);
        File home = new File(c.getFilesDir(), "qa_home.txt"), cfg = new File(c.getFilesDir(), "qa_mizel.json");
        try (Meetings server = new Meetings()) {
            write(home, server.origin());
            write(cfg, "{\"fakeMic\": 2, \"staticNotification\": 1, \"noBatteryPrompt\": 1}");

            // What a process killed mid-recording leaves: 2 finished chunks, a torn third, the journal still open.
            MizelStore s = MizelHub.store(c);
            long t0 = System.currentTimeMillis() - 11_000;
            s.beginSession(ID, t0);
            assertTrue(s.noteCapture(ID, BuildConfig.VERSION_CODE, server.origin()));
            for (int seq = 0; seq < 2; seq++) {
                wav(s.chunkFile(ID, seq), Wav.CHUNK_SAMPLES, true);
                assertNotNull(s.chunkDone(ID, seq, Wav.CHUNK_SAMPLES, t0 + 5_000L * (seq + 1)));
            }
            wav(s.tmpFile(ID, 2), 8_000, false);
            assertNull("no recorder runs in the new process", MeetingRecorderService.live());

            c.startActivity(new Intent(c, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK));

            assertTrue("capture never resumed into the same meeting", waitFor(() -> {
                MeetingRecorderService.Live l = MeetingRecorderService.live();
                return l != null && ID.equals(l.meetingId) && !l.paused;
            }, 45_000));
            assertTrue("no new chunk after the resume reached the server", waitFor(() -> server.chunks.containsKey(3), 45_000));
            assertEquals("start_ms continues from the stored media time (2 x 5 s + the torn 0.5 s)", Long.valueOf(10_500), server.chunks.get(3));
            for (int seq = 0; seq <= 3; seq++) assertTrue("seq " + seq + " missing", server.chunks.containsKey(seq));
            assertNull("the meeting was finalized instead of resumed: " + server.stop, server.stop);
            MizelJournal j = s.snapshot(ID);
            assertTrue(j.recording);
            assertNull(j.stopReason);
            assertTrue("no 'Recording resumed after the app was closed' notice", resumedNotice(c));

            // The owner's Stop still ends it normally, with every chunk.
            c.startService(new Intent(c, MeetingRecorderService.class).setAction(MeetingRecorderService.ACTION_STOP).putExtra("meetingId", ID));
            assertTrue("no /stop after the owner's Stop", waitFor(() -> server.stop != null, 45_000));
            JSONObject stop = new JSONObject(server.stop);
            assertEquals("user", stop.getString("reason"));
            int last = stop.getJSONObject("final_seq").getInt("me");
            assertTrue(last >= 3);
            for (int seq = 0; seq <= last; seq++) assertTrue("seq " + seq + " missing before the stop", server.chunks.containsKey(seq));
        } finally {
            //noinspection ResultOfMethodCallIgnored
            home.delete();
            //noinspection ResultOfMethodCallIgnored
            cfg.delete();
        }
    }

    private static boolean resumedNotice(Context c) throws InterruptedException {
        long end = System.currentTimeMillis() + 10_000;
        while (System.currentTimeMillis() < end) {
            for (StatusBarNotification n : c.getSystemService(NotificationManager.class).getActiveNotifications()) {
                CharSequence t = n.getNotification().extras.getCharSequence(android.app.Notification.EXTRA_TITLE);
                if (t != null && t.toString().equals("Recording resumed after the app was closed")) return true;
            }
            Thread.sleep(300);
        }
        return false;
    }

    private interface Check { boolean ok() throws Exception; }

    private static boolean waitFor(Check check, long ms) throws Exception {
        long end = System.currentTimeMillis() + ms;
        while (System.currentTimeMillis() < end) { if (check.ok()) return true; Thread.sleep(250); }
        return check.ok();
    }

    private static void write(File f, String text) throws IOException {
        try (FileOutputStream o = new FileOutputStream(f)) { o.write(text.getBytes(StandardCharsets.UTF_8)); }
    }

    /** A chunk as the recorder writes it; {@code finished} false = the torn one (header never fixed). */
    private static void wav(File f, long samples, boolean finished) throws IOException {
        //noinspection ResultOfMethodCallIgnored
        f.getParentFile().mkdirs();
        try (RandomAccessFile r = new RandomAccessFile(f, "rw")) {
            r.write(Wav.header(finished ? samples * 2 : 0));
            byte[] pcm = new byte[(int) samples * 2];
            for (int i = 0; i < pcm.length; i += 2) pcm[i] = (byte) (i % 64);
            r.write(pcm);
        }
    }

    /** Disposable meetings server on localhost: records chunk seq → start_ms and the stop body; shell page is a stub. */
    private static final class Meetings implements AutoCloseable {
        final ServerSocket socket = new ServerSocket(0, 20, InetAddress.getByName("127.0.0.1"));
        final Map<Integer, Long> chunks = new ConcurrentHashMap<>();
        volatile String stop;
        volatile boolean running = true;

        Meetings() throws IOException {
            new Thread(() -> { while (running) try { Socket s = socket.accept(); new Thread(() -> respond(s), "MeetingsFixture").start(); } catch (IOException ignored) {} }, "MeetingsAccept").start();
        }

        String origin() { return "http://localhost:" + socket.getLocalPort(); }

        private void respond(Socket s) {
            try (Socket client = s) {
                client.setSoTimeout(5000);
                InputStream in = new BufferedInputStream(client.getInputStream());
                String request = line(in); if (request == null) return;
                int length = 0; String h;
                while ((h = line(in)) != null && !h.isEmpty()) {
                    int colon = h.indexOf(':');
                    if (colon > 0 && h.substring(0, colon).trim().equalsIgnoreCase("content-length")) length = Integer.parseInt(h.substring(colon + 1).trim());
                }
                byte[] body = new byte[length];
                for (int got = 0; got < length; ) { int n = in.read(body, got, length - got); if (n < 0) break; got += n; }
                String[] parts = request.split(" ");
                URI u = URI.create(parts.length > 1 ? parts[1] : "/");
                String path = u.getPath(), out = "{}", type = "application/json";
                if (parts[0].equals("POST") && path.matches("/meetings/api/meetings/" + ID + "/chunks")) {
                    int seq = -1; long start = -1;
                    for (String kv : u.getQuery().split("&")) {
                        if (kv.startsWith("seq=")) seq = Integer.parseInt(kv.substring(4));
                        if (kv.startsWith("start_ms=")) start = Long.parseLong(kv.substring(9));
                    }
                    chunks.put(seq, start);
                } else if (parts[0].equals("POST") && path.equals("/meetings/api/meetings/" + ID + "/stop")) {
                    stop = new String(body, StandardCharsets.UTF_8);
                } else if (path.startsWith("/meetings/api/meetings/")) {
                    out = "{\"id\":\"" + ID + "\",\"status\":\"processing\"}";
                } else {
                    out = "<!doctype html><title>WizardOS</title><!-- core/ synthetic fixture --><body>Meeting fixture</body>";
                    type = "text/html";
                }
                byte[] bytes = out.getBytes(StandardCharsets.UTF_8);
                OutputStream o = client.getOutputStream();
                o.write(("HTTP/1.1 200 OK\r\nContent-Type: " + type + "\r\nContent-Length: " + bytes.length + "\r\nConnection: close\r\n\r\n").getBytes(StandardCharsets.UTF_8));
                o.write(bytes); o.flush();
            } catch (IOException ignored) { }
        }

        private static String line(InputStream in) throws IOException {
            ByteArrayOutputStream b = new ByteArrayOutputStream(); int ch;
            while ((ch = in.read()) >= 0 && ch != '\n') if (ch != '\r') b.write(ch);
            return ch < 0 && b.size() == 0 ? null : b.toString("UTF-8");
        }

        @Override public void close() throws IOException { running = false; socket.close(); }
    }
}
