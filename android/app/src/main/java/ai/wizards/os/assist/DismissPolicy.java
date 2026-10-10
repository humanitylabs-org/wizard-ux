package ai.wizards.os.assist;

/**
 * What happens to a side-button take when its surface goes away (Back, Home, screen off, another app)
 * instead of Cancel. Rule (0.8.3): what James said is never lost. A take that heard speech is sent, exactly
 * as if the pause had ended it; an empty take is dropped; a message already on its way keeps going.
 * Only the Cancel button discards a take on purpose.
 */
final class DismissPolicy {
    enum Action { NONE, SEND, DROP }

    private DismissPolicy() { }

    static Action onDismiss(boolean listening, boolean heardSpeech, boolean qaAudio) {
        if (!listening) return Action.NONE;          // already sending (or idle): the outbox finishes it
        return heardSpeech || qaAudio ? Action.SEND : Action.DROP;
    }
}
