package ai.wizards.os;

import android.view.MotionEvent;

/** One summary per gesture, never a stream of coordinates. Zero device ID is not proof of injection. */
final class ScrollGestureDiagnostics {
    private int down,move,up;
    private float startY;
    void event(String method, MotionEvent e) {
        if(!ScrollCaptureDiagnostics.armed()) {down=move=up=0;return;}
        int a=e.getActionMasked();
        if(a==MotionEvent.ACTION_DOWN) {down=1;move=up=0;startY=e.getY();}
        else if(a==MotionEvent.ACTION_MOVE)move++;
        else if(a==MotionEvent.ACTION_UP || a==MotionEvent.ACTION_CANCEL)up++;
        // Generic wheel/rotary input is a single event, not a touch gesture.
        if(a==MotionEvent.ACTION_DOWN || a==MotionEvent.ACTION_UP || a==MotionEvent.ACTION_CANCEL || method.equals("dispatchGenericMotionEvent")) {
            ScrollCaptureDiagnostics.record(method,ScrollCaptureDiagnostics.fields("action",a,"source",e.getSource(),
                "toolType",e.getPointerCount()>0?e.getToolType(0):0,"flags",e.getFlags(),"deviceId",e.getDeviceId(),
                "zeroDeviceId",e.getDeviceId()==0,"downCount",down,"moveCount",move,"upCount",up,
                "startY",startY,"endY",e.getY()));
            if(a!=MotionEvent.ACTION_DOWN)down=move=up=0;
        }
    }
}
