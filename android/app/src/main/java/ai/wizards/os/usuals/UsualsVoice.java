package ai.wizards.os.usuals;

import android.content.Context;
import android.util.Log;
import android.widget.Toast;

import java.util.List;

/** Voice into Usuals: "order my usual kra pao" heard by any orb runs that usual instead of going to Wizard. */
public final class UsualsVoice {
    private UsualsVoice() { }

    /** The usual's id when the words are an order for one, else null. */
    public static String match(Context c, String said) {
        List<UsualsStore.Usual> l = UsualsStore.all(c);
        if (l.isEmpty()) return null;
        int i = UsualsPolicy.matchVoice(UsualsStore.names(l), said);
        return i >= 0 ? l.get(i).id : null;
    }

    public static void start(Context c, String id) {
        String b = UsualsRunner.get(c).run(id);
        if (b.isEmpty()) return;
        String why = "accessibility".equals(b) ? "Usuals needs Wizard OS accessibility switched on"
                : "grab".equals(b) ? "Grab isn't installed" : "busy".equals(b) ? "Finish teaching first" : "That usual is gone";
        Log.i(UsualsRunner.TAG, "voice run refused: " + b);
        Toast.makeText(c, why, Toast.LENGTH_LONG).show();
    }
}
