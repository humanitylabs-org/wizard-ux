/* Food rules (was android/.../usuals/UsualsPolicy.java): turn a recording of the owner's taps in Grab into a saved
 * order, name it, describe its basket, and decide which saved order a spoken phrase asks for. Pure functions, no DOM,
 * no device: unit-tested with node (tests/food-rules.test.mjs).
 *
 * Not the money boundary. Wizard never presses a button that spends money; that rule is enforced natively by the
 * device.automation capability for every caller (AutomationPolicy.isCommit). The commit words here only keep such
 * taps out of a recipe so the native refusal never has to fire. */
(function (root) {
  'use strict';
  const GRAB = 'com.grabtaxi.passenger';
  const COMMIT = ['place order', 'place my order', 'place delivery order', 'order now', 'confirm order', 'confirm and pay',
    'confirm payment', 'pay now', 'pay ฿', 'pay thb', 'pay $', 'checkout and pay', 'book and pay', 'swipe to order',
    'ยืนยันคำสั่งซื้อ', 'ยืนยันการสั่งซื้อ', 'สั่งอาหาร', 'สั่งเลย', 'สั่งซื้อ', 'ชำระเงิน'];
  const DISMISS = ['not now', 'maybe later', 'no thanks', 'no, thanks', 'skip', 'close', 'later', 'dismiss', 'got it', 'ok', 'okay',
    'ไม่ใช่ตอนนี้', 'ไว้ทีหลัง', 'ข้าม', 'ปิด', 'ตกลง'];
  /** Controls that name nothing in particular: the recorder also remembers the text beside them ("word *" = prefix). */
  const AMBIGUOUS = ['add', 'add to basket', 'add to cart', 'เพิ่ม', 'plus', 'increase', 'more', 'select', 'เลือก',
    '-', '−', '–', 'minus', 'decrease', 'remove', 'remove *', 'delete', 'ลบ', 'ลด'];
  const MONEY = /(฿|THB|\$|RM|S\$|Rp)\s?([0-9][0-9,]*(\.[0-9]{1,2})?)|([0-9][0-9,]*(\.[0-9]{1,2})?)\s?(฿|THB|บาท)/;
  const LETTER = /\p{L}/u;

  const norm = s => s == null ? '' : String(s).normalize('NFKC').toLowerCase().replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  const isLetter = c => LETTER.test(c);

  function isCommit(label) {
    const n = norm(label);
    if (!n || n.length > 60) return false;
    for (const raw of COMMIT) {
      const c = norm(raw);
      if (!n.startsWith(c)) continue;
      if (n.length === c.length) return true;
      const next = n.charAt(c.length);
      if (!isLetter(next) || c.endsWith(' ') || c.endsWith('฿') || c.endsWith('$')) return true;
    }
    return false;
  }
  const isDismiss = label => { const n = norm(label); return DISMISS.some(d => n === norm(d)); };
  function isPrice(label) {
    const n = norm(label); const m = MONEY.exec(n.toUpperCase());
    return !!m && m.index === 0 && n.length <= 16;
  }
  function isGeneric(label) {
    const n = norm(label);
    if (n.length <= 2) return true;
    return ['add', 'add to basket', 'add to cart', norm('เพิ่ม'), 'plus', 'increase', 'more', 'select', norm('เลือก')].includes(n) || isPrice(n);
  }
  function isRemoveLabel(label) {
    const n = norm(label);
    return ['-', '−', '–', 'minus', 'decrease', 'remove', 'delete', norm('ลบ'), norm('ลด')].includes(n) || n.startsWith('remove ');
  }
  function isAddLabel(label) {
    const n = norm(label);
    if (!n || isCommit(label) || isRemoveLabel(label)) return false;
    return n === '+' || n === 'plus' || n === 'increase' || n === 'add'
      || /^add to (basket|cart|order)\b/.test(n) || /^add\s*[·•|-]?\s*(฿|\$|thb)?\s*[0-9]/.test(n)
      || /^add [0-9]+ (item|items )?to (basket|cart|order)\b/.test(n)
      || n === norm('เพิ่ม') || n.startsWith(norm('เพิ่มลง')) || n.startsWith(norm('ใส่ตะกร้า'));
  }
  const tap = s => s && s.type === 'tap';
  const isAdd = s => tap(s) && !isRemoveLabel(s.label) && (isAddLabel(s.label) || (!!s.near && isPrice(s.label)));
  const isRemove = s => tap(s) && isRemoveLabel(s.label);
  const optional = s => tap(s) && isDismiss(s.label);
  function money(s) {
    if (s == null) return null;
    const m = MONEY.exec(String(s)); if (!m) return null;
    if (m[2] != null) return (/^thb$/i.test(m[1]) ? '฿' : m[1]) + m[2];
    return '฿' + m[4];
  }

  const step = (type, label, id, near) => ({ type: type || 'tap', label: label || '', id: id || '', near: near || '' });

  /* ---------------------------------------------------------------- written form */

  /** One step per line: "tap Som Tam Nua", "tap Add @ Gai yang", "type som tam", "wait 1500", "search". */
  function parse(text) {
    const out = [];
    for (const raw of String(text || '').split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const low = line.toLowerCase();
      if (low.startsWith('type ')) { out.push(step('type', line.slice(5).trim())); continue; }
      if (low.startsWith('wait ')) {
        const ms = line.slice(5).trim().replace(/[^0-9]/g, '');
        if (ms) out.push(step('wait', String(Math.min(10000, parseInt(ms.length > 6 ? '10000' : ms, 10)))));
        continue;
      }
      if (low === 'search' || low === 'enter') { out.push(step('enter')); continue; }
      let body = low.startsWith('tap ') ? line.slice(4).trim() : line, near = '';
      const at = body.indexOf(' @ ');
      if (at > 0) { near = body.slice(at + 3).trim(); body = body.slice(0, at).trim(); }
      if (isCommit(body)) continue; // never written into a recipe
      out.push(step('tap', body, '', near));
    }
    return out;
  }
  function write(steps) {
    return steps.map(s => s.type === 'type' ? 'type ' + s.label : s.type === 'wait' ? 'wait ' + s.label : s.type === 'enter' ? 'search'
      : 'tap ' + (s.label || s.id) + (s.near ? ' @ ' + s.near : '')).join('\n');
  }

  /** Typing collapses to its final text; commit and remove taps are dropped; two taps on "+" stay (quantity two). */
  function tidy(input) {
    const out = [];
    for (const s of input) {
      if (tap(s) && isCommit(s.label)) continue;
      if (isRemove(s)) continue;
      if (tap(s) && !s.label && !s.id) continue;
      if (s.type === 'type' && out.length && out[out.length - 1].type === 'type') { out[out.length - 1] = s; continue; }
      out.push(s);
    }
    while (out.length && out[out.length - 1].type === 'type' && !out[out.length - 1].label) out.pop();
    return out;
  }

  /* ---------------------------------------------------------------- browse-first recording */

  /** Native outcome events ({t, screen} | {t, step}) → recs ({sig, step, t}); steps get their own identity. */
  const recsOf = events => (events || []).map(e => e.step ? { sig: null, step: step(e.step.type, e.step.label, e.step.id, e.step.near), t: +e.t || 0 }
    : { sig: String(e.screen || ''), step: null, t: +e.t || 0 });

  const byTime = recs => recs.map((r, i) => [r, i]).sort((a, b) => a[0].t - b[0].t || a[1] - b[1]).map(x => x[0]);

  /** Which dish each add (or remove) was for: the text beside it, else the tap that opened the dish's page. */
  function items(recsIn) {
    const itemOf = new Map();
    let lastTap = '', screenItem = '', sig = null;
    for (const r of byTime(recsIn)) {
      if (!r.step) { if (r.sig && r.sig !== sig) { sig = r.sig; screenItem = lastTap; } continue; }
      const s = r.step;
      if (!tap(s)) continue;
      if (isAdd(s) || isRemove(s)) itemOf.set(s, s.near ? s.near : screenItem && isAdd(s) ? screenItem : isAdd(s) ? lastTap : '');
      else if (!optional(s) && !isCommit(s.label) && !isGeneric(s.label)) lastTap = s.label;
    }
    return itemOf;
  }

  const CAUSE_MS = 4000;

  /** The route to the basket with the browsing taken out (see UsualsPolicyTest history for the cases). */
  function path(recsIn, finalTexts) {
    const recs = byTime(recsIn);
    const itemOf = items(recs);
    const bt = finalTexts ? finalTexts.map(t => ' ' + norm(t)).join('') : '';
    const kept = item => {
      if (!bt || !item) return true;
      const n = norm(item);
      if (bt.includes(n)) return true;
      const w = n.split(' ');
      return (n.length > 12 && bt.includes(n.slice(0, 12))) || (w.length >= 2 && bt.includes(w[0] + ' ' + w[1]));
    };
    const sigs = [], since = [], visits = [];
    for (const r of recs) {
      if (r.step) {
        if (!visits.length) { sigs.push(''); since.push(r.t); visits.push([]); }
        visits[visits.length - 1].push(r);
        continue;
      }
      const g = r.sig;
      if (!g) continue;
      if (sigs.length && g === sigs[sigs.length - 1]) continue;
      const j = sigs.lastIndexOf(g);
      if (j >= 0) {
        let productive = false;
        for (let v = j + 1; v < visits.length && !productive; v++) for (const x of visits[v]) if (isAdd(x.step) && kept(itemOf.get(x.step))) { productive = true; break; }
        if (!productive) {
          const left = since[j + 1], on = visits[j];
          let tapped = false;
          if (on.length) {
            const last = on[on.length - 1];
            if (tap(last.step) && !isAdd(last.step) && !optional(last.step) && left - last.t <= CAUSE_MS) { on.pop(); tapped = true; }
          }
          const keep = [];
          for (let v = j + 1; v < visits.length; v++) for (const x of visits[v]) if (optional(x.step) || (!tapped && !tap(x.step))) keep.push(x);
          sigs.length = j + 1; since.length = j + 1; visits.length = j + 1;
          on.push(...keep);
          continue;
        }
      }
      sigs.push(g); since.push(r.t); visits.push([]);
    }
    const out = [];
    for (const v of visits) for (const x of v) out.push(x.step);
    // "−" / Remove takes back the latest add of that item; the tap itself never goes in a recipe.
    for (let i = 0; i < out.length; i++) {
      const s = out[i];
      if (!isRemove(s)) continue;
      const item = itemOf.get(s);
      out.splice(i--, 1);
      if (!item) continue;
      for (let k = i; k >= 0; k--) {
        const a = out[k], ai = itemOf.get(a);
        if (isAdd(a) && ai && (item === ai || norm(item).includes(norm(ai)))) { out.splice(k, 1); i--; break; }
      }
    }
    if (bt) {
      const anyKept = out.some(s => isAdd(s) && itemOf.has(s) && itemOf.get(s) && kept(itemOf.get(s)));
      if (anyKept) return out.filter(s => !(itemOf.has(s) && !kept(itemOf.get(s))));
    }
    return out;
  }

  function basket(steps, itemOf) {
    const m = new Map();
    let lastItem = '';
    for (const s of steps) {
      if (!tap(s)) continue;
      if (isAdd(s)) {
        const item = itemOf && itemOf.has(s) ? itemOf.get(s) : s.near ? s.near : lastItem;
        if (item) m.set(item, (m.get(item) || 0) + 1);
      } else if (!isGeneric(s.label) && !optional(s) && !isCommit(s.label)) lastItem = s.label;
    }
    return m;
  }
  const basketLine = (steps, itemOf) => [...basket(steps, itemOf)].map(([k, v]) => v + '× ' + k).join(' · ');

  function place(steps, itemOf) {
    const first = steps.find(s => tap(s) && isAdd(s));
    const dish = !first ? '' : itemOf && itemOf.has(first) ? itemOf.get(first) : first.near;
    let last = '';
    for (const s of steps) {
      if (s === first) break;
      if (!tap(s)) continue;
      if (dish && !first.near && s.label === dish) break;
      if (isGeneric(s.label) || optional(s) || s.label.length > 60) continue;
      last = s.label;
    }
    return last;
  }
  const clip = s => s.length > 40 ? s.slice(0, 39).trim() + '…' : s;
  function suggestName(steps, itemOf) {
    const b = basket(steps, itemOf), names = [...b.keys()];
    if (!names.length) { const p = place(steps, itemOf); return p ? clip(p) : 'Grab order'; }
    let first = names[0];
    for (const i of names) if (b.get(i) > b.get(first)) first = i;
    if (names.length === 1) return clip(first);
    const other = names[0] === first ? names[1] : names[0];
    if (names.length === 2) return clip(first + ' + ' + other);
    return clip(first + ' + ' + (names.length - 1) + ' more');
  }

  /** A native recording outcome → the parts of a saved order (steps, basket, place, suggested name, total). */
  function fromRecording(outcome) {
    const recs = recsOf(outcome && outcome.events);
    const checkout = Array.isArray(outcome && outcome.checkout) ? outcome.checkout : null;
    const itemOf = items(recs);
    const steps = tidy(path(recs, checkout));
    const total = (outcome && outcome.total) || totalOf(checkout || []) || '';
    return { steps, basket: basketLine(steps, itemOf), place: place(steps, itemOf), suggested: suggestName(steps, itemOf), total };
  }
  function totalOf(texts) {
    for (let i = 0; i < texts.length; i++) {
      const n = norm(texts[i]);
      if ((n.startsWith('total') || n.startsWith(norm('ยอดรวม')) || n.startsWith(norm('รวมทั้งหมด'))) && !n.startsWith('total savings')) {
        const here = money(texts[i]); if (here) return here;
        for (let j = i + 1; j < Math.min(texts.length, i + 4); j++) { const m = money(texts[j]); if (m) return m; }
      }
    }
    for (const t of texts) if (isCommit(t)) { const m = money(t); if (m) return m; }
    return null;
  }

  /* ---------------------------------------------------------------- voice */

  /** The phrase as native compares it (AutomationPolicy.phrase, after the caller removed the wake words). */
  const phrase = s => norm(s).replace(/[\u2019\u2018]/g, "'").replace(/[.!?,;:"“”]+/g, ' ').replace(/\s+/g, ' ').trim();
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  /* "order food", "order grab", "order lunch", "get me some food from Grab": browse Grab and save the route. "I want
   * something else" on its own is ordinary talk, not food (James, 12 Oct). */
  const SPELL = "(?!(?:.* )?get (?:me |us )?something$)(?:(?:please |can you |could you |let'?s |i(?: want to| wanna| would like to|'d like to) )?(?:order|get)(?: me| us)? (?:some |a |my )?(?:food|foods|grab|grab ?food|lunch|dinner|breakfast|brunch|supper|a snack|snacks|takeout|takeaway|take out|take away|delivery|food delivery|something(?: new| different| else)?(?: to eat)?)(?: (?:from|on|with|through) grab)?|order (?:from|on) grab|(?:a )?(?:food|grab|grab food) order|grab (?:me )?(?:some )?food|grab me something(?: new)? to eat|new (?:food|grab) order)";
  const POLITE = '(?: (?:please|now|for me))?';
  const VERB = "(?:please )?(?:can you |could you )?(?:re-?order|order(?: me)?|get(?: me)?|grab(?: me)?|i want|i'd like|i would like) ";
  const USUAL = '(?:(?:my |the |our )?(?:usual|usuals|regular|normal)(?: order)?(?: of| from)? )?';
  const ART = '(?:(?:my|the|a|an|some) )?';
  const TAIL = '(?: (?:from grab|on grab|please|again|for me))?';
  const SAID_USUAL = '(?=.*(?:usual|regular)|re-?order)';
  const PRI = { spellNamed: 300, spell: 200, exact: 100, subset: 50, usualOnly: 100, usualPartial: 10 };

  /**
   * The voice table both orbs share: web's words as anchored patterns with priorities. The in-app orb matches with
   * this table here; native gets the same table (device.automation.shortcuts) for the floating orb and the side
   * button. Highest priority wins; two different saved orders tied at the top means "ask", so nothing runs.
   * @param recipes [{id, name}] in list order. Returns [{pattern, priority, action}] with action a recipe id or '+new'.
   */
  function voiceTable(recipes) {
    const out = [{ pattern: '^' + SPELL + POLITE + '$', priority: PRI.spell, action: '+new' }];
    const list = (recipes || []).filter(r => r && phrase(r.name));
    if (list.length === 1) out.push({ pattern: '^' + VERB + '(?:my |the |our )?(?:usual|usuals|regular|normal)(?: order)?' + TAIL + '$', priority: PRI.usualOnly, action: list[0].id });
    for (const r of list) {
      const n = phrase(r.name), words = [...new Set(n.split(' ').filter(w => w.length > 1))];
      out.push({ pattern: '^(?=' + SPELL + POLITE + '$).* ' + esc(n) + POLITE + '$', priority: PRI.spellNamed, action: r.id });
      out.push({ pattern: '^' + VERB + USUAL + ART + esc(n) + TAIL + '$', priority: PRI.exact, action: r.id });
      if (!words.length) continue;
      const W = '(?:' + words.map(esc).join('|') + ')';
      // Every word said is in the name ("order kra pao" for "Kra pao moo saap"): more words, more specific.
      for (let k = 1; k <= Math.min(words.length, 6); k++) out.push({ pattern: '^' + VERB + USUAL + ART + W + '(?: ' + W + '){' + (k - 1) + '}' + TAIL + '$', priority: PRI.subset + k, action: r.id });
      // Every word of the name said, with more ("order kra pao chicken" for "Kra pao").
      const has = words.map(w => '(?=(?:.* )?' + esc(w) + '(?: |$))').join('');
      out.push({ pattern: '^' + VERB + USUAL + ART + has + '\\S+(?: \\S+)*' + TAIL + '$', priority: PRI.subset + words.length, action: r.id });
      // "order my usual … kra …": a weaker hint, only with "usual"/"regular"/"reorder" said.
      out.push({ pattern: '^' + SAID_USUAL + VERB + '(?=(?:.* )?' + W + '(?: |$)).+$', priority: PRI.usualPartial + 1, action: r.id });
    }
    return out;
  }

  /** The action for a phrase with a voice table: the same rule as AutomationShortcuts.match on the phone. */
  function matchTable(table, said) {
    const p = phrase(said);
    if (!p) return null;
    let best = null, tie = false;
    for (const e of table) {
      if (!new RegExp(e.pattern).test(p)) continue;
      if (!best || e.priority > best.priority) { best = e; tie = false; }
      else if (e.priority === best.priority && e.action !== best.action) tie = true;
    }
    return best && !tie ? best.action : null;
  }

  const api = { GRAB, AMBIGUOUS, norm, isCommit, isDismiss, isPrice, isGeneric, isAddLabel, isRemoveLabel, isAdd, isRemove, optional, money,
    step, parse, write, tidy, recsOf, items, path, basket, basketLine, place, suggestName, fromRecording, totalOf, phrase, voiceTable, matchTable };
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.WosFoodRules = api;
})(typeof window !== 'undefined' ? window : globalThis);
