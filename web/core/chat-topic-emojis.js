/* Stable, owner-selected topic emoji for Chats rows. Shared by phone and desktop shells. */
(() => {
  'use strict';
  const KEY = 'wos.chats.topicEmoji.v1';
  const choices = Object.freeze(['💬', '💻', '🏹', '🚆', '📝', '🎬', '📦', '📈', '💪', '🎧', '📚', '🧠', '✈️', '🏠', '⚡', '🔬']);
  const allowed = new Set(choices);
  const rules = [
    [/(?:\bdev\b|develop|code|coding|software|github|bug|build|deploy|server|hermes|wizard\s*os)/i, '💻'],
    [/(?:shorts?|reels?|tiktok|vertical\s+video)/i, '🏹'],
    [/(?:rail|railway|train|trans[- ]?siberian)/i, '🚆'],
    [/(?:video|film|movie|clip|youtube|media)/i, '🎬'],
    [/(?:ship|shipment|delivery|parcel|package|order)/i, '📦'],
    [/(?:market|fund|portfolio|stock|invest|finance|trading)/i, '📈'],
    [/(?:health|fitness|workout|gym|sleep|energy)/i, '💪'],
    [/(?:music|audio|song|playlist|podcast)/i, '🎧'],
    [/(?:book|read|library|canon|wisdom)/i, '📚'],
    [/(?:research|idea|think|strategy)/i, '🧠'],
    [/(?:travel|flight|trip|hotel|airbnb)/i, '✈️'],
  ];
  let selected = {};
  try {
    const value = JSON.parse(localStorage.getItem(KEY) || '{}');
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      selected = Object.fromEntries(Object.entries(value).filter(([key, emoji]) => key && allowed.has(emoji)));
    }
  } catch (_) {}
  const save = () => {
    try { localStorage.setItem(KEY, JSON.stringify(selected)); return true; } catch (_) { return false; }
  };
  const infer = (text, fallback = '💬') => {
    const value = String(text || '');
    for (const [pattern, emoji] of rules) if (pattern.test(value)) return emoji;
    return allowed.has(fallback) ? fallback : '💬';
  };
  window.WosTopicEmoji = Object.freeze({
    choices,
    infer,
    get(key, text, fallback = '💬') { return selected[String(key || '')] || infer(text, fallback); },
    set(key, emoji) {
      key = String(key || '');
      if (!key || !allowed.has(emoji)) return false;
      const before = selected[key]; selected[key] = emoji;
      if (save()) return true;
      if (before) selected[key] = before; else delete selected[key];
      return false;
    },
  });
})();
