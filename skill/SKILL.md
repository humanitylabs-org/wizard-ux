---
name: wizard-interface
description: Use when the owner asks what something in Wizard is, where a setting or screen is, or how to do something in Wizard on the phone or computer (Settings pages and rows, Try new features switches like Channels in Chats or Thread tracker, updates, Chats, Home, apps, voice). Generated from the Wizard interface code, so it matches this Wizard's screens.
---

# Wizard interface manual

Every screen, Settings page and feature switch of the Wizard interface (the phone app and the desktop in a browser or the Mac app), with where it is and what it does. Written from the interface code of this Wizard's release.

- Give the exact path the way it reads on screen, e.g. Settings › Appearance › Try new features › Channels in Chats, and how to open Settings on their device: desktop in the AI apps view (the standard one), the cog at the bottom left of the chats sidebar; desktop in the Desks view, the gear in the top bar (⌥,); phone, the gear at the top right of Home.
- Give the exact path the way it reads on screen, e.g. Settings › Appearance › Try new features › Channels in Chats, and how to get there on the device they use (desktop: the gear at the right of the top bar, or ⌥,; phone: the gear at the top right of Home).
- Say the condition when there is one (For testers channel only, Android app only, desktop only, only when the box has it).
- You can't flip these switches or settings for the owner: they are owner-only, on the owner's screen. Tell them what to tap.
- Never invent a setting, page or button. If what they ask for isn't in this manual, say it isn't in the Wizard interface as far as you know, and ask for a screenshot of where they are looking. Don't search your own files for interface text: the interface code isn't in your container.
- Names in Wizard: the agent is 'Wizard' (or the name the owner gave it); 'WizardOS' is the server software; the interface on phone and desktop is just 'Wizard'.

## Screens

- **Home**: The start screen: what's Working and Ready, the Resources bars (server and AI accounts), your apps. Desktop: AI apps view: close the open chat (✕, Esc or ⌥`) to get the empty Home with the message box, the orb and your pinned apps; Desks view: the house at the left of the top bar (⌥`). Phone: the first desk; the gear at its top right opens Settings.
- **Chats**: All your conversations with the agent, in sections: Errors, Working, Saved, Ready, Yesterday, Past week, Snoozed, Archive (By day), or Working, Ready, Snoozed, Archive (By status; chosen in the Filter sheet). Search, the Filter button, + New chat, and a Focus strip with All, each agent and your Spaces. Long-press or right-click a chat for Pin, Rename, Mark unread, Snooze, Archive / Restore. Desktop: AI apps view: the chats sidebar on the left (search ⌥K, + New chat ⌥N); Desks view: the Inbox count in the top bar (⌥I). Phone: the Chats desk, or hold the orb and say 'chats'.
- **Work**: Chats opened at a section (a link to Working, Ready, Archive …).
- **Chats › Errors**: Chats whose last reply failed, with Retry (and why, with Why a reply failed on).
- **Chats › Working**: Chats where the agent is still working; order set in Settings › Chats & app screens › Working threads.
- **Chats › Saved**: Messages you sent while Wizard was restarting its Agent Service; they are kept and send by themselves after the restart.
- **Chats › Ready**: Chats with a reply for you (needs you and unread first); its order bar offers Priority, Newest, Oldest, By subject.
- **Chats › Yesterday**: Ready chats from yesterday (By day layout).
- **Chats › Past week**: Ready chats from the past week (By day layout).
- **Chats › Snoozed**: Chats you snoozed (row menu › Snooze, pick when); they come back to Ready at that time, or Restore now.
- **Chats › Archive**: Chats you archived (or done notifications); Restore brings one back. Archive on top moves it first.
- **Chats › Drafts**: An older link name; it opens Chats (unsent words stay in each chat's own box).
- **Apps**: Every installed app, with search; an app opens on a desk of its own (desktop AI apps view: as a panel beside the chat). Desktop: AI apps view: the Apps column on the right (pinned apps, then open ones; + Add an app lists the rest and Get more; Tidy closes apps unused for 24 h, with Undo); any view: search (⌥Space). Phone: swipe the orb up.
- **App Store**: Get new apps for this Wizard: each app's page with Get / Open. Desktop: Apps column › + Add an app › Get more, or search 'App Store' (⌥Space). Phone: swipe the orb up › Get more.
- **App Store install link**: A link that opens one app's page in the App Store to install it.
- **Agents**: The Agents app: your agents (main and others), each with its own chats, look and what it may use.
- **Files**: The Files app: your Wizard's files and folders (on a Mac, the shared Wizard folder).
- **Settings**: See Settings below. Desktop: AI apps view: the cog at the bottom left of the chats sidebar; Desks view: the gear in the top bar (⌥,). Phone: the gear at the top right of Home.
- **Settings › Appearance**: A link straight to the skin picker.
- **Settings › Resources**: A link straight to the Resources (AI usage) page.
- **Gestures & help**: Phone: How Wizard works: tap the orb to talk, hold it for a command, swipe it up for apps, down to hide the bars, sideways between desks; Back is always one step back; Practice again. Desktop: the keys guide (⌥/, or hold ⌥ to see the keys on screen). Desktop: Settings › About & updates › Gestures & help, or ⌥/. Phone: Settings › About & updates › Gestures & help, or say 'help'.
- **Practice tour**: The first-run practice of the orb gestures; start it again from Gestures & help › Practice again.
- **AI apps view (desktop)**: The standard desktop. Left: the chats sidebar (switch Wizard at the top, search ⌥K, ◫ folds it to a rail ⌥L, the cog for Settings and + New chat at the bottom). Middle: the open chat with the message box, the model and the orb. Right: the Apps column (pinned apps, open apps, + Add an app, Tidy). ⌥1–⌥0 pick an app, ⌥W closes, ⌥F makes the app panel wider, ⌥R folds the column, ⌥H hides both sides. Sort options for its sidebar are in Settings › Chats & app screens when this view is on.
- **Apps view**: A view where every open app has its own full-screen window, with a + sheet listing Open, Installed and Get more apps.
- **Orb view**: A view where your apps float as satellites around the orb (phone Home and a desktop scene).
- **Desktop top bar (Desks view)**: Left: Home and your desks (+ New desktop). Right: search (⌥Space, also ⌘K), Talk about this (⌥S; replies to the open chat or asks about the window), Tell the computer (⌥C, local commands like 'next desk'), Dictate (⌥D), New voice chat (⌥V), the Inbox count (⌥I, opens Chats), Settings (⌥,), Keys guide (⌥/). The AI apps view has no top bar.
- **Desks (phone) / desktops**: Separate spaces for apps and chats. Phone: swipe the orb sideways or tap the dots under it (long-press to see all). Desktop (Desks view): the desks in the top bar, + New desktop; ⌥` or ⌥1 Home, ⌥2–⌥9 the next desks.
- **Phone orb**: Tap: talk to Wizard (tap again to send). Hold: a command for the phone (e.g. 'calendar', 'next desk', 'settings'). Swipe up: apps; down: hide the bars; sideways: desks. While recording: Cancel, Pause, Screenshot, Attach.
- **Spaces**: Named groups of chats you make (a chat can be in several); pick one in Chats' Focus strip. Ask the agent to make or fill a Space. With Channels in Chats on, Spaces are the Channels.
- **Snooze and Archive**: From a chat's menu (long-press or right-click): Snooze hides it until a time you pick (Chats › Snoozed); Archive files it (Chats › Archive); Restore brings either back. One-tap Snooze changes Snooze to one tap that parks it at the bottom of Ready.
- **Update card**: At the top of Settings (and a small pop-up on Home): Interface updated · Reload, or WizardOS update · Install / Install now, or Updating WizardOS… with progress.
- **My skin**: Your own skin, made with + New skin in Settings › Appearance › Skin; ask the agent to change it ('make my chat text a little bigger').

## Settings

Open Settings: desktop AI apps view (the standard desktop), the cog at the bottom left of the chats sidebar; desktop Desks view, the gear at the right of the top bar (⌥,); phone, the gear at the top right of Home or an empty desk, or hold the orb and say 'settings'. Settings is a list of pages under System and Preferences; on a wide screen the list is on the left and the page on the right. A page with nothing on it is hidden. Pages are the same on phone and desktop, except rows that only exist on one of them (named below).

### System › Your network
Your network: the computers and devices this Wizard runs on, filled by the apps that report them. (only when an installed app adds something here; with Machines on Home on, Settings › System holds network, AI, security and storage).

### System › AI
AI: settings for the AI accounts and models this Wizard uses, filled by the installed AI connectors. (only when an installed app adds something here).

### System › Network & security
Network & security: how this Wizard is protected, e.g. whether its disk is encrypted. (only when this Wizard reports it).
- Disk: one line saying whether this Wizard's disk is encrypted (e.g. unlocks with the box's security chip, or protected by FileVault on a Mac).
  - Disk encryption: the line written by the box itself

### System › Storage & backups
Storage & backups: disk space and backups, filled by the apps that handle them. (only when an installed app adds something here).

### Appearance
Appearance: the skin (look), colors, mode, background, desktop view, window opacity, and Try new features.
- Skin: pick a skin (a whole look) and one of its colors; + New skin makes your own skin (name, base skin, color, tweaks), which you can then ask the agent to change ('change my <name> skin so…'). Your own skins show here with Edit with your Wizard and Remove skin. Some skins also offer Mode (Dark or Light) and Background (plain, pictures, or your own image).
  - Colors: the colors of the chosen skin
  - Mode: Dark or Light, for skins that have both
  - Background: Plain, pictures, or (some skins) your own image with Choose image
  - Shell view: desktop only: how this desktop is laid out, chosen per device
  - Try new features: the feature switches (For testers channel only), see Feature switches below
  - Desks: the classic desktop: a top bar, desks of windows
  - AI apps: chats in a sidebar on the left, the chat in the middle, apps on the right (like the ChatGPT and Claude apps); the standard desktop view
- Windows › Window opacity: a slider for how see-through every window and app is, on this device; Use skin default puts it back.
- Home: a switch for Machines on Home, shown here only when it is on for everyone.
- Advanced › Import skin JSON: apply a skin file (up to 8 KB) on this device.

### Chats & app screens
Chats & app screens: how Chats behaves and looks, which Chats app is the default, and app screens.
- After actions on your phone: after sending, archiving, snoozing or marking unread on the phone, Stay on this chat or go Back to chats list. Desktop chats stay open.
- Reply style: a note that each agent keeps its own reply style; tell the agent how you like replies and it remembers.
- Working threads › Sort Working: the order of the Working section in Chats, the same on phone and desktop.
- Chats list › Desktop-style Chats list: on the phone, draw the Chats list like the desktop sidebar (one quiet line per chat). On for everyone; switch it off for the older phone list. (phone).
- Notifications › Notifications in Chats: alerts from Notifications and from apps with an inbox show as yellow threads in Chats (Open, Done, Snooze, Resolve this). On for everyone; switch it off to keep them out of Chats.
- Default Chats: which Chats app shows your chats: Wizard Chats (built in) or another Chats app installed from the Store; you confirm before it switches.
  - Store: opens the Store to get another Chats app
- Temporary chats › Offer Incognito: lets you start text-only chats that are never saved, on a private agent that supports them. Off by default. (only when a private agent supports Incognito).
- Your app screens: apps whose screen you (or the agent) changed; Use original goes back to the app's own screen and keeps your version's files. (only when an app has your own screen).
- Workspace sync › Same workspaces on every device: the same desks with the same apps on all your devices (layout and the current desk stay per device), plus Recently closed desks with Reopen. (when the box supports it).

### Notifications
Notifications: for each app that sends notifications, choose Badge (a count on its icon) or Chats (its alerts arrive as threads in Chats). Saved on this device. Chats needs Notifications in Chats on.
- One row per app that sends notifications, each with Badge or Chats.

### Voice & typing
Voice & typing: speech-to-text, which microphone the phone uses, the text selection menu, and the desktop's voice buttons.
- Voice transcription: which speech-to-text service this Wizard uses and whether it is ready.
  - Your speech-to-text service: its name and status
- Text selection menu: what the menu offers when you select words in a chat (Copy, Share, Quote, Look up, Search, Select all), each on or off. (Android app 0.9.7 or later).
  - Quote: quote the words in your reply
- Top bar › Show every voice button: show New voice chat, Dictate and Tell the computer next to the mic in the desktop top bar. Off, they are in the mic's menu (right-click or hold) and on ⌥V, ⌥D and ⌥C. (desktop).
- Microphone: which mic the phone records with: Phone mic only, Any connected mic, or a specific Bluetooth/USB/headset mic when it is connected. (Android app).

### Phones & devices
Phones & devices: connect your phone to this Wizard (over Tailscale, with a QR code), see the devices that can reach it, and turn device access off. (owner only).
- Device access: connect a phone or another device (scan the QR code with the Wizard app; uses Tailscale, private and free). Your devices: the devices on your Tailscale account and whether they are online. Remove a device happens on the Tailscale website. Turn off device access disconnects this Wizard from Tailscale (asks first; chats stay).
  - Remove a device: opens Tailscale's device list in the browser
  - Turn off device access: asks to confirm, then every device loses access until you connect one again

### Connections
Connections: the agents on this Wizard, what each one may use, how apps are linked to each other, and other Wizards you can switch to. (owner only).
- The App Manager's own view: each agent, the apps it may use (Disconnect, Reconnect, agent access), app-to-app links, Restore defaults.
- Wizards › Add a Wizard: connect to a Wizard on another computer; your Wizards then show in the Wizard switcher.

### Unsent & recovered
Unsent & recovered: messages that weren't sent and voice recordings that were cancelled or kept, with Retry, Play, Save and Delete. Its count shows next to the page name.
- Unsent & retained: messages and recordings kept on this device because they weren't delivered, each with Retry, Edit, Play audio, Save audio, Transcribe only, Copy transcript, Open thread or Delete; Retry all when there are several.
- Recovered & cancelled recordings: voice recordings you cancelled or that were saved after a problem, to play, send or delete.

### Resources
Resources (called AI usage on older builds): the same bars as on Home, the server's CPU, memory and disk and how much of each AI account is left; tap a bar for details, devices and reset times.
- The resource bars (server CPU, memory, disk; AI accounts); tap one for details and a manual refresh.

### Schedules
Schedules: jobs the agent runs on a timer (e.g. a daily summary), with their next and last run, Run now, New schedule and Import from Hermes. (only when this Wizard supports schedules).
- The scheduled jobs with their timing, next run and last result; tap one to edit, pause, Run now or delete.
  - New schedule: make a new timed job
  - Import from Hermes: bring over schedules from your own Hermes

### About & updates
About & updates: update WizardOS (Automatic or Ask me), the release channel (For everyone or For testers), versions, connection status, and Gestures & help.
- WizardOS (server): the installed version and whether it is up to date. Updates: Automatic installs WizardOS updates by themselves overnight, never during a chat; Ask me installs nothing until you tap Install. Channel: For everyone gets releases testers have used for about 3 days; For testers gets every release at once and shows Try new features in Appearance. When an update is ready a card at the top of Settings offers Install (or Install now).
  - WizardOS (server) {version}: the installed server version
  - Automatic: updates install overnight, never during a chat
  - Ask me: nothing installs until you tap Install
  - For testers: every new release as soon as it's out; shows Try new features
  - For everyone: releases testers have used for about 3 days
- Wizard: whether this device is connected to your Wizard (Connected, Connecting…, Sign-in needed) and its address; the interface and the server update separately. Technical details shows the interface revision. Gestures & help opens How Wizard works on the phone (orb, desks, Back, Practice again) and the keys guide on the desktop. On the Android app it also shows Recording, Reply notifications and the phone app's version (tap it to update the app).
  - Connected: this device's connection to your Wizard
  - Recording: Android: recording keeps going with the screen off
  - Reply notifications: Android: a notification when the agent answers a chat you sent from the phone
  - Phone app (Android) {version}: Android: the app's version; tap to update it
- Which build of WizardOS this is, for test builds: the commit it was built from and how far it is behind main. (test builds).
- Connection › Change Wizard: connect the phone app to another Wizard (scan its QR code or type its address). (Android app).

### Phone
Phone: things only the Android app can do: Wizard Everywhere (floating orb), side button, voice typing, Wizard ID, Downloads, the orb switcher. (Android app only).
- Identity › Wizard ID: your Wizard ID, a signing key that stays on this phone, with its backup state; tap to set it up. (Android app).
- Assistant: Wizard Everywhere puts a floating Wizard button over your other apps (tap to talk, drag to move; Android asks to let Wizard display over other apps); Voice typing & screenshots lets the orb type into any app; Side button: hold the phone's side button to talk, even when locked. (Android app).
  - Voice typing & screenshots: shown when Wizard Everywhere is on
- Orb switcher: choose what holding or swiping the orb offers on the phone. (phone).
- Downloads: files you downloaded in Wizard apps, with their progress; reopens the Downloads sheet. (Android app).

## Feature switches (Settings › Appearance › Try new features)

Settings › Appearance › Try new features lists unfinished features anyone can switch on to try, A to Z, each 'by <author>'. The group only shows when this Wizard is on the For testers channel (Settings › About & updates › Channel › For testers); on For everyone it is hidden and these switches stay off. The same switches are also in the WizardOS Tracker app (Try it). A choice follows the owner on every device. If the owner can't find Try new features, the first step is Channel › For testers.

- **Apps in Updates**: Settings › About & updates also lists every installed app with its version and the Store's latest, Update now, Retry, Hold, and an Automatic / Ask me choice for app updates.
- **Archive on top**: Archive is the first section of the Chats list in both By day and By status, so switching layouts never moves it.
- **Calm Agent Service restarts**: While Wizard waits for running chats to finish before restarting its Agent Service, you see a quiet 'Restarting when chats finish' note instead of errors; a message sent meanwhile shows as saved and sends after the restart; if the restart is overdue you see what's still running and choose Wait longer or Restart now. Needs a box that supports it.
- **Calm offline card**: The can't-reach-your-Wizard card shows one dotted path (Internet · Tailscale · Wizard), one short next step and a small Check again with the automatic re-check time.
- **Channels in Chats**: Chats gets two tabs, Activity and Channels. Activity is a short what-needs-me list (Working, Ready, Recent, then Snoozed and Archived) with each chat's channel under its title. Channels shows your Spaces one per line (plus General); opening one shows its chats as posts with a reply line, Slack-style. Also brings Needs you in the thread with Mark done, and a read point shared by your devices. Where: Settings › Appearance › Try new features › Channels in Chats; then open Chats and use the Activity / Channels tabs.
- **Continue saved background results**: Work that finished while Wizard was down shows in its own thread with one Continue button. Nothing resumes until you tap it.
- **Machines on Home**: Home shows a slim strip (Wizard, AI fuel, chats, backup, network); Settings › System holds your network, AI, security and storage.
- **Models from your connectors**: The model menu in Chats lists only the main models of the AI connectors you connected (Claude, ChatGPT, Tinfoil); with none connected it says so and links to Connectors.
- **Now playing**: While an app plays audio or video, small moving bars sit on that app's icon in the AI apps view (the desktop apps column; the phone Home dock and grid); click or tap them to pause without opening the app. Option+P pauses or plays what played last on the desktop. Nothing shows while nothing plays.
- **One-tap Snooze · bottom of Ready**: Snooze is one tap and the lowest priority: the thread waits at the bottom of Ready, below approvals, until you restore or reply.
- **Repair the agent's Wizard connection**: When the agent can't reach its Wizard app tools (unauthorized), running `wizard link` again puts this box's connection token back into the agent's settings; `wizard doctor` shows whether they match.
- **Send and go**: On desktop, sending opens a fresh chat.
- **Short answer first**: A long agent reply shows only its one-line plain answer; tap it for the full reply. Choose whether replies start collapsed and how long the short answer is. Where: Settings › Appearance › Try new features › Short answer first; its options show under it when on.
- **Skins are look only**: Skins become a look only. Your own skin stops deciding which features run: only the feature switches here and in the WizardOS Tracker do, the same for every tester. Turning this on carries the choices of the own skin you're wearing into those switches once. Tweaks on the drop list (Two orbs, App borders, No close on desks, Pin buttons, WizardOS name) are off. Skin scripts are paused. Your skin's saved choices and script approval are kept and come back when you switch this off.
- **Tell the team about failed updates**: When an app or WizardOS update fails on this box, the App Manager files a bug for the team (or adds to the open one) with the box, versions, failing step and error, using this box's GitHub login. Your notification then says the team was told.
- **Thread tracker**: A strip under a thread's title listing every ask in that thread (needs you, running, finished; tap one to jump to its reply), dots on chat rows in the Chats list, and Reply on any message. The chat stays an ordinary chat. (main agent's threads only; while Channels in Chats is on, the strip and dots step aside and Needs you shows on the message instead).
- **Why a reply failed**: When a reply fails and Wizard knows why (subscription ended, usage limit, signed out, network), Chats > Errors and the thread say so plainly, with Choose another model first when Retry can't work.

Switches that are ordinary settings or views, not tester switches:
- **Notifications in Chats**: Chats is the inbox: Notifications' alerts and every app with an inbox feed are yellow threads in Chats, labelled with their app; several from one app fold into one row. They open in the chat window with Open, Done, Snooze and Resolve this (the rest from that app listed under, with Done all); done ones under Archive. Where: Settings › Chats & app screens › Notifications › Notifications in Chats (on for everyone).
- **Different shell view - AI apps**: The AI apps view: chats in a sidebar on the left that folds to a slim rail, the chat in a centred column, your apps in a column on the right; an app opens as a panel beside the chat. Where: desktop: Settings › Appearance › Shell view › AI apps (the standard desktop view; Desks is the other choice). (desktop only).
- **Desktop-style Chats list**: The phone Chats list drawn like the desktop sidebar: one quiet line per chat, a dot for unread, muted section headers with an amber Ready count, round New chat. Same chats, same actions; switch it off to get the older phone list back. Where: Settings › Chats & app screens › Chats list › Desktop-style Chats list (phone; on for everyone).

## How do I…

- **Turn on a new feature (e.g. Channels in Chats, Thread tracker)?** Settings › About & updates › Channel › For testers (if not already), then Settings › Appearance › Try new features › the feature's switch.
- **Make Wizard update automatically?** Settings › About & updates › Updates › Automatic (installs overnight, never during a chat). For apps too: switch on Apps in Updates (Try new features), then choose Automatic for apps in About & updates.
- **Update now?** When an update is ready, the card at the top of Settings shows Install (or Install now); tap it. 'Interface updated · Reload' just reloads the screen.
- **Get the newest features first?** Settings › About & updates › Channel › For testers.
- **Use Wizard on my phone?** Settings › Phones & devices: scan the QR code with the Wizard phone app (needs Tailscale; the page walks you through it).
- **Change the look?** Settings › Appearance › Skin and Colors; + New skin to make your own.
- **Switch the desktop layout?** Settings › Appearance › Shell view: AI apps (standard) or Desks.
- **Get alerts in Chats or as badges?** Settings › Notifications, per app; Notifications in Chats (Settings › Chats & app screens) must be on for Chats.
- **Find a message that didn't send?** Settings › Unsent & recovered.
- **See AI usage or server load?** Home's resource bars, or Settings › Resources.
- **Add another Wizard?** Settings › Connections › Wizards › Add a Wizard.
- **Install an app?** Open the App Store (desktop: Apps column › + Add an app › Get more; phone: swipe the orb up › Get more), open the app, Get.
- **See keyboard shortcuts?** Desktop: ⌥/ or hold ⌥.
