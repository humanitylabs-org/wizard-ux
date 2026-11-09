package ai.wizards.os;

import java.util.List;

/**
 * Browser panel trial (James, 9 Nov 2026; WizardOS settings.json {@code links.panel}). Which browser draws the Custom Tab
 * an outside link opens in, over Wizard: Brave when installed (his logins and speed), else the phone's default browser
 * when it offers Custom Tabs, else null, meaning the existing plain browser open. Pure so it is unit-tested on the JVM.
 */
public final class PanelLinks {
    private PanelLinks() { }

    /** Brave's release channel first; beta and nightly only when release is absent. */
    static final String[] BRAVE = {"com.brave.browser", "com.brave.browser_beta", "com.brave.browser_nightly"};

    /** Custom Tabs owns the panel's dark top bar and navigation bar: the app's own background colour. */
    public static final int TOOLBAR = 0xFF05030C;

    /**
     * @param providers packages offering a Custom Tabs service (CustomTabsService.ACTION_CUSTOM_TABS_CONNECTION)
     * @param defaultBrowser the package resolving a plain https VIEW (may be null, "android" = the chooser)
     * @param self this app, never a candidate
     */
    public static String pick(List<String> providers, String defaultBrowser, String self) {
        if (providers == null || providers.isEmpty()) return null;
        for (String brave : BRAVE) if (providers.contains(brave) && !brave.equals(self)) return brave;
        if (defaultBrowser != null && !defaultBrowser.isEmpty() && !"android".equals(defaultBrowser)
                && !defaultBrowser.equals(self) && providers.contains(defaultBrowser)) return defaultBrowser;
        return null;
    }

    /** Only web links go into the panel; anything else keeps its existing route. */
    public static boolean web(String scheme) { return "https".equals(scheme) || "http".equals(scheme); }
}
