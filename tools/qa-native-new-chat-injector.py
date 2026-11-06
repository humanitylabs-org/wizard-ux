#!/usr/bin/env python3
"""Build a QA-only native shell with an AppKit key-event injector on Thales.
Production sources and built 0.5.1 stay unchanged. Only QAHooks commands are added.
"""
import hashlib,pathlib,shutil,subprocess,fcntl,json
from qa_paths import work_root
BASE=pathlib.Path(str(work_root() / 'Projects/wizard-desktop/new-chat-keys'))
SRC=pathlib.Path(str(work_root() / 'Projects/wizard-command-w/mac'))
DEST=BASE/'qa-host'
with open(str(work_root() / 'AndroidBuilds/worker.lock'),'a') as lock:
 fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
 DEST.mkdir(parents=True,exist_ok=True)
 (BASE/'tmp').mkdir(exist_ok=True)
 for name in ['Shared','App','Host','assets']:
  shutil.copytree(SRC/name,DEST/name,dirs_exist_ok=True)
 shutil.copy2(SRC/'build.sh',DEST/'build.sh')
 main=DEST/'App/main.swift';text=main.read_text();orig=hashlib.sha256(text.encode()).hexdigest()
 anchor='        case "ux-state":'
 injection='''        case "key-n", "key-n-shift":
            // QA only: enter AppKit's key-equivalent/responder chain, never dispatch DOM keys.
            controller.window?.makeKeyAndOrderFront(nil)
            NSApp.activate(ignoringOtherApps: true)
            let flags: NSEvent.ModifierFlags = cmd == "key-n-shift" ? [.command, .shift] : [.command]
            let chars = cmd == "key-n-shift" ? "N" : "n"
            if let event = NSEvent.keyEvent(with: .keyDown, location: .zero, modifierFlags: flags,
                                           timestamp: ProcessInfo.processInfo.systemUptime,
                                           windowNumber: controller.window?.windowNumber ?? 0, context: nil,
                                           characters: chars, charactersIgnoringModifiers: "n", isARepeat: false, keyCode: 45) {
                let handled = NSApp.mainMenu?.performKeyEquivalent(with: event) ?? false
                if !handled { NSApp.sendEvent(event) }
                let record: [String: Any] = ["menuHandled": handled,
                    "firstResponder": String(describing: controller.window?.firstResponder),
                    "keyWindow": controller.window?.isKeyWindow ?? false,
                    "chord": cmd]
                if let d = try? JSONSerialization.data(withJSONObject: record, options: .prettyPrinted) {
                    try? d.write(to: URL(fileURLWithPath: "/tmp/wizard-qa-key-n.json"))
                }
            }
            if let up = NSEvent.keyEvent(with: .keyUp, location: .zero, modifierFlags: flags,
                                       timestamp: ProcessInfo.processInfo.systemUptime,
                                       windowNumber: controller.window?.windowNumber ?? 0, context: nil,
                                       characters: chars, charactersIgnoringModifiers: "n", isARepeat: false, keyCode: 45) {
                NSApp.sendEvent(up)
            }
'''
 assert text.count(anchor)==1
 # qa() uses local cmd variable for parsed action. Keep exact production path otherwise.
 main.write_text(text.replace(anchor,injection+anchor))
 subprocess.run(['bash','build.sh'],cwd=DEST,env={**__import__('os').environ,'DMG':'0','TMPDIR':str(BASE/'tmp')},check=True)
 assert hashlib.sha256((SRC/'App/main.swift').read_bytes()).hexdigest()==orig
 (BASE/'evidence/native-build.json').write_text(json.dumps({'host':__import__('socket').gethostname(),'source':str(SRC),'originalMainSha256':orig,'qaMainSha256':hashlib.sha256(main.read_bytes()).hexdigest(),'addedOnly':'QAHooks AppKit key injector','app':str(DEST/'dist/Wizard.app')},indent=2))
 print('NATIVE_QA_BUILD_OK')
