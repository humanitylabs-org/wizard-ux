#!/usr/bin/env python3
"""Writes web/ux-changes.json: which threads made each recent web/ update, so the shell's
"Wizard OS update ready · Reload" banner can link to them (web/core/web-update.js, both shells; James 12 Oct).

Run by tools/write-ux-version.sh whenever ux-version.txt changes; safe to run by hand.
Gitignored, so writing it never dirties the tree.

Shape: {"v":1,"head":<web tree>,"updates":[{"before":<web tree>,"after":<web tree>,"at":<epoch s>,
        "changes":[{"sha":"abc1234","what":"Short summary","thread":<session id>|null,"title":str|null}]}]}
newest first. A client on tree T reads updates until it reaches one whose "before" is T.

Which thread made a commit: the git note in refs/notes/wizard-thread (written at commit time from
HERMES_SESSION_ID by write-ux-version.sh). Commits without one are looked up once in the Hermes session
store (the tool output "[branch abc1234] subject" of the git commit that made it) and the answer is saved as
a note. Subagent sessions resolve to the thread that started them. No session store → no thread links.
"""
import json, os, re, sqlite3, subprocess, sys, time

NOTES = 'refs/notes/wizard-thread'
MAX_UPDATES = 30
MAX_CHANGES = 12


def git(*a, input=None):
    return subprocess.run(['git', *a], input=input, capture_output=True, text=True).stdout


def short(subject):
    s = re.split(r'\s+\(|:\s|\s[—–-]\s|;\s|\.\s', subject.strip(), maxsplit=1)[0].strip()
    if len(s) > 72:
        s = s[:71].rsplit(' ', 1)[0] + '…'
    return s


def store():
    home = os.environ.get('HERMES_REAL_HOME') or os.path.expanduser('~')
    p = os.path.join(os.environ.get('HERMES_HOME') or os.path.join(home, '.hermes'), 'state.db')
    if not os.path.exists(p):
        return None
    try:
        db = sqlite3.connect(f'file:{p}?mode=ro', uri=True, timeout=2)
        db.execute('select 1 from sessions limit 1')
        return db
    except Exception:
        return None


def root(db, sid):
    """Follow subagent → parent until the thread James sees. Returns (id, title)."""
    seen = set()
    while sid and sid not in seen:
        seen.add(sid)
        r = db.execute('select parent_session_id, title, source from sessions where id=?', (sid,)).fetchone()
        if not r:
            return sid, None
        if not r[0]:
            return sid, r[1]
        sid = r[0]
    return sid, None


def find_thread(db, sha, subject):
    """The session that ran the `git commit` for this commit: first the one whose tool call carried the commit
    message (git commit -m "<subject>"), else the one whose commit output printed "[<branch> <sha>]"."""
    words = re.findall(r'[A-Za-z0-9]+', subject)[:8]
    if len(words) >= 3:
        try:
            for sid, is_commit in db.execute(
                    "select m.session_id, m.tool_calls like '%commit%' from messages_fts f join messages m on m.id = f.rowid "
                    "where messages_fts match ? order by m.timestamp limit 10", ('tool_calls : "%s"' % ' '.join(words),)):
                if is_commit:
                    return sid
        except Exception:
            pass
    try:
        rows = db.execute(
            "select m.session_id, m.content from messages_fts f join messages m on m.id = f.rowid "
            "where messages_fts match ? order by m.timestamp limit 40", (f'"{sha[:7]}"',)).fetchall()
    except Exception:
        return None
    pat = re.compile(r'\[[^\]\s]+ ' + re.escape(sha[:7]) + r'[0-9a-f]*\]')
    for sid, content in rows:
        if content and pat.search(content):
            return sid
    return None


def main():
    top = git('rev-parse', '--show-toplevel').strip()
    if not top:
        return
    os.chdir(top)
    fp = [l.split() for l in git('log', '--first-parent', '-n', '400', '--format=%H %P %ct', 'HEAD').splitlines()]
    if not fp:
        return
    # web tree of every first-parent commit and its parent, in one batch.
    want = []
    for row in fp:
        want.append(row[0])
        if len(row) > 2:
            want.append(row[1])
    out = git('cat-file', '--batch-check', input=''.join(f'{c}:web\n' for c in want)).splitlines()
    tree = {}
    for c, line in zip(want, out):
        tree[c] = line.split()[0] if line.endswith(' tree') or ' tree ' in line else None
    db = store()
    updates, now = [], time.time()
    for row in fp:
        c, ct = row[0], int(row[-1])
        p = row[1] if len(row) > 2 else None
        a, b = tree.get(c), tree.get(p) if p else None
        if not a or a == b:
            continue
        rng = f'{p}..{c}' if p else c
        log = git('log', '--no-merges', '-n', str(MAX_CHANGES), f'--notes={NOTES}',
                  '--format=%H%x1f%ct%x1f%s%x1f%N%x1e', rng, '--', 'web')
        changes = []
        for rec in log.split('\x1e'):
            rec = rec.strip('\n')
            if not rec:
                continue
            sha, cts, subj, note = (rec.split('\x1f') + ['', '', '', ''])[:4]
            sid = note.strip() or None
            if not sid and db is not None:
                sid = find_thread(db, sha, subj)
                # Remember the answer; a miss is final once the session store has had time to index it.
                if sid or now - int(cts or 0) > 7200:
                    git('notes', f'--ref={NOTES}', 'add', '-f', '-m', sid or '-', sha)
            if sid == '-':
                sid = None
            title = None
            if sid and db is not None:
                sid, title = root(db, sid)
            changes.append({'sha': sha[:7], 'what': short(subj), 'thread': sid, 'title': title})
        if changes:
            updates.append({'before': b, 'after': a, 'at': ct, 'changes': changes})
        if len(updates) >= MAX_UPDATES:
            break
    head = tree.get(fp[0][0])
    f = os.path.join(top, 'web', 'ux-changes.json')
    data = json.dumps({'v': 1, 'head': head, 'updates': updates}, ensure_ascii=False, separators=(',', ':'))
    try:
        if open(f, encoding='utf-8').read() == data:
            return
    except OSError:
        pass
    with open(f + '.tmp', 'w', encoding='utf-8') as fh:
        fh.write(data)
    os.replace(f + '.tmp', f)


if __name__ == '__main__':
    try:
        main()
    except Exception as e:  # a hook must never fail a commit
        print('write-ux-changes:', e, file=sys.stderr)
