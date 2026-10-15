"""Focused native services/bridge handoff QA. Synthetic meeting PCM, real orb MediaRecorder.
Called by qa_mizel.py on Thales in a disposable API35 guest. No private audio/API writes.
This proves service lifecycle/custody; physical-phone acoustics remain separate.
"""
import base64
import hashlib
import json


def run(pg, sx, top, check, save, origin, pkg, state, lock):
    pg.ev('location.href=' + json.dumps(origin + '/mizel-qa/host.html'))
    assert pg.pump(25, lambda: pg.ev("typeof mz==='function' && typeof WizardOSDevice!=='undefined'"), .5)
    ev = pg.ev
    def cmd(c, mid=None):
        r = ev('mz(' + json.dumps(c) + ',' + json.dumps(mid) + ')')
        assert r and not r.get('error') and not r.get('timeout'), r
        return r
    def status():
        r = cmd('status')
        return r.get('status', r)
    def loan(mid, ident):
        return ev('JSON.parse(WizardOSDevice.recHandoffBegin(' + json.dumps(ident) + ',' + json.dumps(mid) + '))')
    def begin_voice(ident):
        return ev('WizardOSDevice.recStartBorrowed("auto",' + json.dumps(ident) + ')')
    def stop_voice(take):
        return ev('JSON.parse(WizardOSDevice.recStop(' + json.dumps(take) + '))')
    def read_voice(take):
        parts = ev('(()=>{const a=[];let offset=0;while(offset>=0){const r=JSON.parse(WizardOSDevice.recRead(' + json.dumps(take) + ',offset));if(!r?.b64)break;a.push(r.b64);offset=r.next;}return a})()')
        return b''.join(base64.b64decode(p) for p in parts)
    check('handoff', 'versioned native ABI is present', ev('WizardOSDevice.recHandoffVersion()') == 1)
    mid, ident = 'qa_orb_abc', 'handoff-native-abc'
    cmd('start', mid); pg.pump(2)
    check('handoff', 'unborrowed orb is refused during meeting A', not ev("WizardOSDevice.recStart('auto')"))
    borrowed = loan(mid, ident)
    check('handoff', 'borrow acknowledged after flush and pause', bool(borrowed and borrowed['atMediaMs'] > 0 and borrowed['pausedByHandoff']), borrowed)
    assert borrowed
    check('handoff', 'wrong borrow token allocates no voice take', not begin_voice('handoff-wrong-token'))
    take = begin_voice(ident); assert take
    pg.pump(3)
    frozen = status()
    check('handoff', 'meeting media clock is frozen during request B', frozen.get('paused') and frozen.get('mediaMs') == borrowed['atMediaMs'], frozen)
    check('handoff', 'duplicate borrowed start allocates no second take', not begin_voice(ident))
    stopped = stop_voice(take); pg.pump(2)
    resumed = status(); voice = read_voice(take)
    check('handoff', 'send resumes same meeting before network processing', resumed.get('meetingId') == mid and not resumed.get('paused') and resumed.get('mediaMs', 0) > borrowed['atMediaMs'], resumed)
    check('handoff', 'request B original is separately retained', len(voice) > 600, {'take': take, 'bytes': len(voice), 'sha256': hashlib.sha256(voice).hexdigest()})
    cmd('stop'); pg.pump(7)
    with lock:
        chunks = list(sorted(state['chunks'].get(mid, {}).items()))
        final = state['stops'].get(mid)
    checks = [(seq, chunk['start_ms'], chunk['dur_ms']) for seq, chunk in chunks]
    check('handoff', 'A and C share contiguous media time and sequence', len(checks) >= 2 and [r[0] for r in checks] == list(range(len(checks))) and all(abs(b[1] - a[1] - a[2]) <= 1 for a,b in zip(checks, checks[1:])), checks)
    check('handoff', 'partial A chunk ends exactly at interruption marker', any(abs(start+duration-borrowed['atMediaMs']) <= 1 for _,start,duration in checks), checks)
    check('handoff', 'meeting final sequence covers A and C only', bool(final and final['body'].get('final_seq', {}).get('me') == checks[-1][0]), final and final['body'])
    events = ev('JSON.parse(WizardOSDevice.recHandoffEvents())')
    event = json.loads(events[ident])
    check('handoff', 'native event retains exact meeting and request take', event['meetingId'] == mid and event['voiceTakeId'] == take and not event['open'], event)
    # Existing manual pause stays paused after a request.
    mid2, ident2 = 'qa_orb_manual', 'handoff-native-manual'
    cmd('start', mid2); pg.pump(1); cmd('pause')
    before = loan(mid2, ident2); v2 = begin_voice(ident2); assert v2
    pg.pump(1.5); stop_voice(v2); pg.pump(.5)
    check('handoff', 'manual pause is preserved', before['pausedByHandoff'] is False and status().get('paused'))
    cmd('resume'); pg.pump(.5); cmd('stop'); pg.pump(2)
    # Cancel returns microphone without deleting the linked original.
    mid3, ident3 = 'qa_orb_cancel', 'handoff-native-cancel'
    cmd('start', mid3); pg.pump(1); loan(mid3, ident3); v3=begin_voice(ident3); assert v3
    pg.pump(1.5); ev('WizardOSDevice.recCancel(' + json.dumps(v3) + ')'); pg.pump(1)
    check('handoff', 'cancel resumes meeting and retains linked original', not status().get('paused') and len(read_voice(v3)) > 600)
    cmd('stop'); pg.pump(2)
    # Stop wins even when the orb still holds its borrowed microphone.
    mid4, ident4 = 'qa_orb_stop', 'handoff-native-stop'
    cmd('start', mid4); pg.pump(1); loan(mid4, ident4); v4=begin_voice(ident4); assert v4
    pg.pump(1); cmd('stop'); stop_voice(v4); pg.pump(.5)
    check('handoff', 'explicit meeting stop prevents automatic resurrection', not status().get('recording'))
    ev("window.nativeDepth=1;window.__wosNativeBack=()=>{if(nativeDepth){nativeDepth--;return 'back';}return 'root';}")
    sx('input keyevent KEYCODE_BACK'); pg.pump(.3)
    check('handoff', 'nested Back keeps app foreground', ev('nativeDepth') == 0 and pkg in top(), top())
    sx('input keyevent KEYCODE_BACK'); pg.pump(.3)
    check('handoff', 'root Back keeps app foreground', pkg in top(), top())
    ev('location.reload()'); assert pg.pump(20, lambda: pg.ev("typeof mz==='function'"), .3)
    recovered=ev('JSON.parse(WizardOSDevice.recHandoffEvents())')
    check('handoff', 'reload retains correlation and voice bytes', ident in recovered and read_voice(take) == voice)
    save('handoff-native-proof.json', {'scope':'Native service/bridge lifecycle with synthetic meeting PCM and emulator microphone; not shell wiring or handset acoustics', 'borrow':borrowed,'event':event,'chunks':checks,'voiceBytes':len(voice),'voiceSHA256':hashlib.sha256(voice).hexdigest(),'resumed':resumed,'stoppedVoice':stopped})
