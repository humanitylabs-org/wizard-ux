package ai.wizards.os;

import java.net.URI;

/** Transport only: the Store validates the repository, SHA and display text and shows a plain error. */
public final class InstallLink {
    private InstallLink() {}
    public static String shellPath(String value) {
        if (value == null || value.length() > 4096) return null;
        try {
            URI u = new URI(value);
            if (!"wizard".equals(u.getScheme()) || !"install".equals(u.getHost()) || u.getRawUserInfo() != null
                    || u.getPort() != -1 || u.getRawFragment() != null || (u.getRawPath() != null && !u.getRawPath().isEmpty())) return null;
            // view cannot be replaced by a second query field. Encoded names are rejected by the Store too.
            String q = u.getRawQuery();
            if (q != null && java.util.regex.Pattern.compile("(^|&)view=", java.util.regex.Pattern.CASE_INSENSITIVE).matcher(q).find()) return null;
            return "/wizard-os-home/?view=install" + (q == null || q.isEmpty() ? "" : "&" + q);
        } catch (Exception e) { return null; }
    }
}
