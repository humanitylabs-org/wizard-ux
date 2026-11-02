#!/usr/bin/env python3
"""Read prior raw QA logs only; no Android/emulator execution or external calls."""
import argparse
import json
from pathlib import Path
import re
from qa_dictation_insertion_native import statuses, CONTROLS
from qa_dictation_case_isolation import editor_contract


def diagnose(old_root):
    packet = json.loads((old_root/'packet.json').read_text())
    results = {}
    for lane in ('baseline','rejected','candidate'):
        receipt = json.loads(Path(packet[lane]['receipt']).read_text())
        source = Path(receipt['job'])/'source'
        methods = packet['candidate_cases'] if lane == 'candidate' else sorted(CONTROLS)
        contract = editor_contract(source, methods)
        records = statuses((old_root/'native'/(lane+'-instrumentation.txt')).read_text())
        lines = (old_root/'native'/(lane+'-logcat.txt')).read_text().splitlines()
        failures = []
        for row in records:
            if row['code'] == 0: continue
            name = row['test']; stack = row.get('stack','')
            starts = [i for i,s in enumerate(lines) if 'TestRunner: started: '+name+'(' in s]
            ends = [i for i,s in enumerate(lines) if 'TestRunner: failed: '+name+'(' in s]
            if not starts or not ends: raise ValueError('missing exact test timeline: '+name)
            start, end = starts[0], ends[0]
            ime = [{'line':i+1,'raw':lines[i]} for i in range(start,end+1)
                if 'A11yInputMethod:' in lines[i] and any(t in lines[i] for t in
                    ('onStartInput', 'onFinishInput', 'startInput()'))]
            failures.append({'method':name,'start':lines[start],'failure':lines[end],
                'expected_fixture':contract[name],'observed_fixture_modes':re.findall(r'"mode":"([^"]+)"',stack),
                'assertion_excerpt':stack[:1800],'ime_events_during_case':ime})
        results[lane] = {'expected':len(methods),'completed':len(records),
            'passed':sum(r['code']==0 for r in records),'failed':failures}
    baseline = Path(json.loads(Path(packet['baseline']['receipt']).read_text())['job'])/'source/android/app/src/main/java/ai/wizards/os/everywhere/WizardKeyboardService.java'
    text = baseline.read_text()
    start = text.index('public boolean insertText('); end = text.index('ic.commitText(',start)
    ic_preflight = text[start:end]
    if 'if (target == null) return' in ic_preflight or 'getCurrentInputConnection()' not in ic_preflight:
        raise ValueError('baseline IC eligibility changed; do not waive control')
    return {'observed':'previous fixture mode/payload appears in subsequent test failure protocols',
        'causal_limit':'no dispatch timestamp/explicit pre-dispatch fieldId assertion in existing APK; IME restart correlation is not a proven product defect',
        'native_results':results,'production_and_apks_unchanged':True,
        'repair':'fresh target/editor/test processes and absent fixture per case; real service re-enabled after each instrumentation restart',
        'readiness_identity_basis':'first same-package session in fresh process is the sole editor; selection set before focus; audit first actual EditorInfo and case mode',
        'explicit_pre_dispatch_field_probe':False,
        'baseline_eligibility':'baseline insertText still calls real IC without editable-node guard; missingNode remains required',
        'baseline_ic_preflight_source':str(baseline),'baseline_ic_preflight_excerpt':ic_preflight,
        'evidence':[str(old_root/'native'/(lane+'-'+suffix)) for lane in ('baseline','rejected','candidate')
            for suffix in ('instrumentation.txt','logcat.txt','accessibility.txt')],
        'earlier_diagnosis_preserved':str(old_root/'diagnosis.json')}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('old_root',type=Path); parser.add_argument('output',type=Path)
    args = parser.parse_args()
    value = diagnose(args.old_root)
    with args.output.open('x') as stream: stream.write(json.dumps(value,sort_keys=True,indent=2)+'\n')
    print(json.dumps({k:{'expected':v['expected'],'completed':v['completed'],'passed':v['passed'],'failed':len(v['failed'])}
        for k,v in value['native_results'].items()},sort_keys=True,indent=2))
