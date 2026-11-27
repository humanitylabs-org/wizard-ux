package ai.wizards.os.audio;

/**
 * Every phone background-audio request gets exactly one answer, a refusal included: a request dropped in silence
 * left the app's player frozen on an old song for 20 s (issue 115).
 */
final class AudioReply {
    /** How long a request may wait for the phone player before it is answered with an error. */
    static final long TIMEOUT_MS=5000;
    static final String REFUSED="Audio request refused";
    static final String NO_ANSWER="Music player did not answer";
    private boolean done;

    /** Why a request is refused before it reaches the player, or null when it may go on. */
    static String refusal(boolean parsed,boolean detached,boolean mainFrame,String source,String origin,boolean shellPage) {
        return !parsed || detached || !mainFrame || source==null || !source.equals(origin) || !shellPage ? REFUSED : null;
    }

    /** True only for the first of the player's reply and the timeout, so a request is answered once. */
    boolean claim() { if(done) return false; done=true; return true; }
}
