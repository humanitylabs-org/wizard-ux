package ai.wizards.os;

import android.os.Bundle;
import android.view.accessibility.AccessibilityNodeInfo;
import android.view.accessibility.AccessibilityNodeProvider;
import java.util.List;

/** Observe Chromium's virtual tree without replacing nodes, IDs, actions or text. */
final class ScrollAccessibilityProvider extends AccessibilityNodeProvider {
    final AccessibilityNodeProvider delegate;
    private final SelectionWebView web;
    ScrollAccessibilityProvider(SelectionWebView web,AccessibilityNodeProvider delegate) { this.web=web;this.delegate=delegate; }
    static void node(String method, int id, AccessibilityNodeInfo n) {
        ScrollCaptureDiagnostics.record(method,ScrollCaptureDiagnostics.fields("virtualId",id,"present",n!=null,
            "scrollable",n!=null && n.isScrollable(),"actions",n==null?0:n.getActions(),
            "childCount",n==null?0:n.getChildCount()));
    }
    @Override public AccessibilityNodeInfo createAccessibilityNodeInfo(int id) {
        AccessibilityNodeInfo n=delegate.createAccessibilityNodeInfo(id);
        if(id==HOST_VIEW_ID && n!=null)web.initializeProxyAccessibilityNode(n);
        node("virtual.createAccessibilityNodeInfo",id,n);return n;
    }
    @Override public boolean performAction(int id,int action,Bundle args) {
        ScrollCaptureDiagnostics.arm("virtual-accessibility-action");web.recordProxyState();
        boolean result=(id==HOST_VIEW_ID && web.performProxyAccessibilityAction(action)) || delegate.performAction(id,action,args);
        ScrollCaptureDiagnostics.record("virtual.performAccessibilityAction",ScrollCaptureDiagnostics.fields(
            "virtualId",id,"action",action,"arguments",ScrollCaptureDiagnostics.arguments(args),"result",result));return result;
    }
    @Override public AccessibilityNodeInfo findFocus(int focus) {
        AccessibilityNodeInfo n=delegate.findFocus(focus);node("virtual.findFocus",focus,n);return n;
    }
    @Override public List<AccessibilityNodeInfo> findAccessibilityNodeInfosByText(String text,int id) {
        List<AccessibilityNodeInfo> nodes=delegate.findAccessibilityNodeInfosByText(text,id);
        ScrollCaptureDiagnostics.record("virtual.findAccessibilityNodeInfosByText",ScrollCaptureDiagnostics.fields(
            "virtualId",id,"count",nodes==null?0:nodes.size()));return nodes;
    }
    @Override public void addExtraDataToAccessibilityNodeInfo(int id,AccessibilityNodeInfo info,String key,Bundle args) {
        delegate.addExtraDataToAccessibilityNodeInfo(id,info,key,args);node("virtual.addExtraData",id,info);
    }
}
