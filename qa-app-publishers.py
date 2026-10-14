#!/usr/bin/env python3
"""Focused publisher routing checks against a real, disposable SessionDB."""
import ast
import json
import os
from pathlib import Path
import sqlite3
import sys
import tempfile

sys.path.insert(0, '/home/telos/.hermes/hermes-agent')
from hermes_state import SessionDB
ROOT = Path(__file__).resolve().parent

def function(path, name, names):
    node = next(n for n in ast.parse(path.read_text()).body if isinstance(n, ast.FunctionDef) and n.name == name)
    ns = dict(names)
    exec(compile(ast.Module(body=[node], type_ignores=[]), str(path), 'exec'), ns)
    return ns[name]

with tempfile.TemporaryDirectory(prefix='app-publisher-', dir=os.environ.get('TMPDIR', str(Path.home()/'.hermes/cache/scratch'))) as d:
    db_path = Path(d)/'state.db'
    os.environ['WIZARD_STATE_DB'] = str(db_path)
    pub = function(ROOT/'publishers/watch.py', 'publish', dict(Path=Path,os=os,sys=sys,sqlite3=sqlite3,TOPICS_SESSION='wizard_topics',TOPICS_TITLE='Wizard Topics'))
    first=pub(None,'Fixture roundup only','qa:topic-one')
    duplicate=pub(None,'Fixture roundup only','qa:topic-one')
    assert first['session_id']=='wizard_topics' and duplicate['duplicate']
    with sqlite3.connect(db_path) as c:
        row=c.execute('SELECT content,display_metadata FROM messages WHERE id=?',(first['message_id'],)).fetchone()
        assert row[0]=='Fixture roundup only' and json.loads(row[1])['app_id']=='topics'
        assert c.execute('SELECT COUNT(*) FROM messages').fetchone()[0]==1
    store=SessionDB(db_path=db_path)
    try:
        store.create_session('signal-fixture','api_server')
        append=function(ROOT/'publishers/signal_feedback_review.py','append_with_api',dict(SessionDB=SessionDB))
        mid=append(store,'signal-fixture','Fixture Signal report only','qa:signal:2026-W42')
    finally:
        store.close()
    with sqlite3.connect(db_path) as c:
        body,metadata=c.execute('SELECT content,display_metadata FROM messages WHERE id=?',(mid,)).fetchone()
        meta=json.loads(metadata)
        assert body=='Fixture Signal report only' and meta['app_id']=='wizard-signal'
        assert meta['publication_payload_frozen'] is True and meta['report_week']=='2026-W42'
    del os.environ['WIZARD_STATE_DB']
print(json.dumps({'passed':5,'scope':'disposable real SessionDB publisher contracts','production_writes':0}))
