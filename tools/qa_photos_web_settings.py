"""Real WebView Photos settings parity, invoked by the Thales-only disposable rig.
No fake bridge: touch the candidate form, read Android preferences, and read the
synthetic Immich inventory after the real BackupWorker runs. Never an owner phone.
"""
import json
import time
import xml.etree.ElementTree as ET
from typing import Any


def exercise(em, page, out, api, token):
    from qa_aa_lib import ADB, wait

    assert em.pkg == 'ai.wizards.os.qa'
    assert em.sx('getprop ro.hardware').strip() in ('ranchu', 'goldfish')
    fixture = json.loads(em.sh(ADB, '-s', em.S, 'exec-out', 'run-as', em.pkg,
                               'cat', 'files/photos-web-fixture.json'))
    evidence: dict[str, Any] = {'status': 'running', 'coverage': 'real Android WebView, bridge, preferences, WorkManager and disposable Immich'}

    def save():
        (out / 'web-settings.json').write_text(json.dumps(evidence, indent=2) + '\n')

    def prefs():
        # Parse locally; never persist the XML or return encrypted credentials / OAuth to JS.
        raw = em.sh(ADB, '-s', em.S, 'exec-out', 'run-as', em.pkg,
                    'cat', 'shared_prefs/photos_backup.xml')
        tree = ET.fromstring(raw)
        result = {}
        for e in tree:
            name = e.attrib.get('name')
            if name in ('enabled', 'wifi', 'charge'):
                result[name] = e.attrib.get('value') == 'true'
            elif name == 'albums':
                result[name] = sorted(s.text or '' for s in e)
            elif name == 'last_sync':
                result[name] = int(e.attrib['value'])
        return result

    def state():
        return page.ev('window.WosPhotos?.state.status')

    def touch(sel):
        # A trusted touch on a visible, unobstructed target; never JS .click().
        quoted = json.dumps(sel)
        expr = """(() => { const e=document.querySelector(%s); if(!e || e.disabled) return false;
          e.scrollIntoView({block:'center'}); const b=e.getBoundingClientRect();
          const h=document.elementFromPoint(b.x+b.width/2,b.y+b.height/2);
          return b.height>0 && b.y>=0 && b.bottom<=innerHeight && !!h && e.contains(h); })()""" % quoted
        assert wait(lambda: page.ev(expr), 25), 'Not visible/hittable: ' + sel
        assert page.tap(sel)
        assert wait(lambda: page.ev('!window.WosPhotos.state.busy'), 25)
        err = page.ev('window.WosPhotos.state.error')
        assert not err, err

    def open_photos():
        page.ev("window.__wosHandoff({action:'settings',focus:'photos-backup'})")
        assert wait(lambda: page.ev("!!document.querySelector('[data-ph=enabled]') && window.WosPhotos?.state.mode==='v1'"), 25)
        assert '.MainActivity' in em.top(), 'Must stay in the web shell, not native PhotosActivity'
        assert state()['server'] == 'http://localhost:2286'

    def names():
        return {i['originalFileName'] for i in api('/search/metadata', {'size': 100, 'page': 1}, token)['assets']['items']}

    save()
    try:
        open_photos()
        before = prefs()
        assert before['enabled'] is False and before['albums'] == []
        for key in ('enabled', 'wifi', 'charge'):
            assert state()[key] == before[key]
        evidence['initial_read'] = before
        assert not {'wizard-web-chosen.jpg', 'wizard-web-excluded.jpg'} & names()
        # Both option directions persist in exactly the preferences BackupWorker consumes.
        for key in ('wifi', 'charge'):
            for on in (False, True):
                touch('[data-ph="%s"]' % key)
                assert wait(lambda: prefs()[key] == on and state()[key] == on, 20), key
        evidence['options_roundtrip'] = 'pass: Wi-Fi and charging off/on, Android preferences and web agree'
        touch('[data-ph=enabled]')
        assert wait(lambda: prefs()['enabled'] and state()['enabled'], 20)
        # An explicitly empty album set must upload nothing, even though enabled.
        sync_before = prefs().get('last_sync', 0)
        touch('[data-ph=run]')
        assert wait(lambda: prefs().get('last_sync', 0) > sync_before, 90), 'Empty-album worker never completed'
        assert not {'wizard-web-chosen.jpg', 'wizard-web-excluded.jpg'} & names()
        evidence['empty_albums'] = 'pass: real worker completes without uploading either generated photo'
        touch('[data-ph=albums]')
        chosen_sel = '[data-ph-album="%s"]' % fixture['chosen']
        excluded_sel = '[data-ph-album="%s"]' % fixture['excluded']
        assert wait(lambda: page.ev('!!document.querySelector(%s)' % json.dumps(chosen_sel)), 20)
        touch(chosen_sel)
        assert wait(lambda: prefs()['albums'] == [fixture['chosen']], 20)
        assert page.ev('document.querySelector(%s).getAttribute("aria-checked")' % json.dumps(excluded_sel)) == 'false'
        assert wait(lambda: 'wizard-web-chosen.jpg' in names(), 180), 'Selected generated photo never uploaded'
        assert 'wizard-web-excluded.jpg' not in names(), 'Unselected folder was uploaded'
        assert wait(lambda: state()['lastSync'] > sync_before, 20), 'Worker progress never reached web status'
        evidence['folder_worker_parity'] = 'pass: only selected generated album uploaded; excluded album absent'
        touch('[data-ph=albums]')
        sync_before = prefs().get('last_sync', 0)
        touch('[data-ph=run]')
        assert wait(lambda: prefs().get('last_sync', 0) > sync_before, 90)
        evidence['run_now'] = 'pass: web Back up now completes a real repeat worker run'
        touch('[data-ph=enabled]')
        assert wait(lambda: not prefs()['enabled'] and not state()['enabled'], 20)
        evidence['disable'] = 'pass: backup disabled durably through the web switch'
        # Native-to-web read after document recreation (no fixture bridge injection).
        page.ev('location.reload(); true')
        assert wait(lambda: page.ev("!!window.WosPhotos && !!window.__wosHandoff"), 25)
        open_photos()
        assert state()['enabled'] is False and state()['wifi'] is True and state()['charge'] is True
        touch('[data-ph=albums]')
        assert wait(lambda: page.ev('document.querySelector(%s)?.getAttribute("aria-checked")==="true"' % json.dumps(chosen_sel)), 20)
        assert page.ev('document.querySelector(%s).getAttribute("aria-checked")' % json.dumps(excluded_sel)) == 'false'
        touch('[data-ph=albums]')
        evidence['reload_readback'] = 'pass: enabled, options and exact album selection survive reload'
        evidence['skins'] = {}
        for skin in ('nebula', 'obsidian-light'):
            assert page.ev('window.WosSkin.set(%s)' % json.dumps(skin)) == skin
            # Wait for package styles/fonts and capture the actual screen, not a component mock.
            page.ev('document.fonts.ready.then(() => true)')
            time.sleep(1)
            page.ev("document.querySelector('[data-ph=enabled]').scrollIntoView({block:'center'})")
            colors = page.ev("(() => { const e=document.querySelector('.ph'); const s=getComputedStyle(e); const r=getComputedStyle(document.documentElement); return {skin:document.documentElement.dataset.skin,color:s.color,background:s.backgroundColor,token:s.getPropertyValue('--wz-text').trim()}; })()")
            em.shot(out, 'web-photos-' + skin)
            evidence['skins'][skin] = colors
        assert evidence['skins']['nebula']['color'] != evidence['skins']['obsidian-light']['color'], 'Skin change did not redress Photos'
        # Real Android hardware Back from the nested page must return in-app.
        em.sx('input keyevent KEYCODE_BACK')
        assert wait(lambda: page.ev("document.querySelector('[data-settings-root]')?.dataset.settingsPage === ''"), 15), 'Back did not return to Settings index'
        assert '.MainActivity' in em.top()
        em.shot(out, 'web-photos-back-settings')
        for _ in range(4):
            em.sx('input keyevent KEYCODE_BACK')
            assert wait(lambda: '.MainActivity' in em.top(), 10), 'Root Back exited the app'
        em.shot(out, 'web-photos-root-back')
        evidence['back'] = 'pass: Photos/Phone → Settings index → shell; repeated root Back stays foreground'
        evidence['final_preferences'] = prefs()
        evidence['oauth'] = 'not exercised: no disposable OIDC provider; encrypted synthetic key bound natively by BackupE2eTest'
        evidence['status'] = 'pass'
        return evidence
    except Exception as exc:
        evidence.update(status='fail', error=str(exc))
        em.shot(out, 'web-photos-failure')
        raise
    finally:
        save()
