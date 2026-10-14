# Supplied-brand inventory

Designer provenance: docs/brand-provenance.json; exact rasters retained under web/brand. No substitute logo.

Changed UX brand slots: desktop toolbar/Ask palette, Wizard status toasts, transcript route badges, Everywhere settings/update notice, default thread/project badges, favicon, Apple touch and PWA icons. Shared purple mark available at /wizard-os-home/brand/wizard-mark-purple.png.

Preserved semantic art: Chats/Music/calendar/app sigils, custom thread emoji, action/search/rating stars, command bolt, voice/recording orb, backdrop stars. Registry's Chats icon string is a semantic fallback; WizSigil draws Chats, not the Wizard brand.

Changed Android brand slots: five density legacy launchers and safe-zone adaptive foregrounds, supplied-square purple background, API28+ launch layer and API31+ splash, connecting/offline hat, Ask Wizard assistant-screen badge, reply/Everywhere notifications. Error/download/upload/recorder microphone icons remain semantic. Floating overlay uses the interactive recording orb, not a brand-star; preserved with existing shared-orb regression tests.

Native proof is signed ai.wizards.os.brandpreview, version 0.9.12-brand.1-preview (36). Separate package, no production update slot consumed, no handset install or feed/latest.json publication. Sibling Music37 and Shared Resources38 remain reserved/gated. A later production APK must reconcile their approved sources, claim the next coordinated version, rebuild and retest. This proof is not authorized to leapfrog them.

Web deployment: only the web/provenance/regression commit enters daily. Native commit remains isolated until sibling source/release reconciliation. No backend, main, public release or other repositories changed.
