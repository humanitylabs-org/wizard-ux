# Quote-only actions

Standard bounded UX feature; triggers checked: no new external transmission route, data mutation, auth or navigation contract. Direct implementation using existing rich-copy and native/web share helpers.

Acceptance: each Markdown quote has an indented Copy/Share footer; it exports only that quote with formatting/links intact; full-message actions stay unchanged; nested/multiple quotes, fenced code, cancellation and copy fallback remain correct on phone and desktop. Ship web-only by PR to daily; no VM rebuild or gateway restart. Focused browser QA on Thales with clipboard/share intercepted, then live asset/readback QA.
