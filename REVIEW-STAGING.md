# James review bundle — 24 October 2026

Base: the live serving branch at 47918f27. Live is divergent from current main; applying isolated proposal commits avoids importing unrelated main changes or dropping James's deployed fixes. Nothing changes the live checkout or its services.

Included proposal commits: #436, #434, #444, #445, #441, #443 (Oscar / oscarhenrycollins, for Miguel). Limited conflict resolutions keep both appended CSS/test blocks, use proposal Settings markup, and place owner-layer CSS before skin packages.

#437 (Archimedes / defleur-agents) was attempted, then excluded under the 'if it merges cleanly' condition: conflicts in core/chats.js, core/resources.js, core/settings.js and responsive-feature-inventory.json. #454 is compared as mockups only, not applied to the shell. wizard-app-manager#196 is described, never installed.

Reuse:
- Settings and skin picker: REUSE WosSettings / WosSkin / WosMySkin.
- Resources and updates: EXTEND existing WosResources / WosUpdates via Oscar's proposals.
- App-kind list and owner layer: NEW modules supplied by #441 and #443, documented in COMPONENTS.md.

Read-only preview: a separate immutable snapshot, loopback origin and existing tailnet-only ingress. A clearly labelled staging-only my-release.json and update status demonstrate #443 and #436; those are illustrative, not James's installed release or update availability. Other GETs use the existing read-only upstream tunnel. All mutations are refused server-side. Browser device-local skin choices do not change James's installation.

This is a visual review bundle, not release approval. Full test results and before/after evidence are delivered privately in GUIDE.md.
