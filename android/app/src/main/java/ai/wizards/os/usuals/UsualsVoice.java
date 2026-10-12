package ai.wizards.os.usuals;

import android.content.Context;
import android.util.Log;
import android.widget.Toast;

import java.util.List;

/** Voice into Food (was Usuals): "order my usual kra pao" heard by any orb runs that usual instead of going to Wizard. */
public final class UsualsVoice {
    private UsualsVoice() { }

    /**
     * The usual's id when the words are an order for one; {@link UsualsRunner#NEW} for "order something new"
     * (browse Grab, save the route); else null.
     */
    public static String match(Context c, String said) {
        List<UsualsStore.Usual> l = UsualsStore.all(c);
        // A saved order he named "Lunch" wins over the "order lunch" spell; otherwise the spell opens Grab.
        if (UsualsPolicy.isBrowse(said)) {
            int n = UsualsPolicy.namedExactly(UsualsStore.names(l), said);
            return n >= 0 ? l.get(n).id : UsualsRunner.NEW;
        }
        if (l.isEmpty()) return null;
        int i = UsualsPolicy.matchVoice(UsualsStore.names(l), said);
        return i >= 0 ? l.get(i).id : null;
    }

    public static void start(Context c, String id) {
        UsualsRunner r = UsualsRunner.get(c);
        String b = UsualsRunner.NEW.equals(id) ? r.teach("") : r.run(id);
        if (b.isEmpty()) return;
        String why = "accessibility".equals(b) ? "Food needs Wizard OS accessibility switched on"
                : "grab".equals(b) ? "Grab isn't installed" : "busy".equals(b) ? "Finish teaching first" : "That order is gone";
        Log.i(UsualsRunner.TAG, "voice run refused: " + b);
        Toast.makeText(c, why, Toast.LENGTH_LONG).show();
    }
}
