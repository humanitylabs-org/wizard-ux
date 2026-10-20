/* Stable, owner-selected topic emoji for Chats rows. Shared by phone and desktop shells. */
(() => {
  'use strict';
  const KEY = 'wos.chats.topicEmoji.v1';
  const categories = Object.freeze([
    { label: 'Work & chat', emoji: ['💬', '🗨️', '📣', '📢', '📧', '📨', '📮', '📝', '📋', '📌', '📍', '✅', '☑️', '🗓️', '📅', '⏰', '⌛', '🔔', '🤝', '👥'] },
    { label: 'Ideas & learning', emoji: ['🧠', '💡', '📚', '📖', '🔬', '🔭', '🧪', '🧬', '🎓', '✏️', '🖊️', '📐', '📊', '🧩', '🗺️', '🔎', '❓', '❗', '🧭', '🏛️'] },
    { label: 'Business & money', emoji: ['📈', '📉', '💹', '💰', '💵', '💳', '🪙', '🏦', '🏢', '💼', '🧾', '🛒', '🏷️', '📦', '🚚', '⚖️', '🔐', '🗝️', '🎯', '🏆'] },
    { label: 'Tech & tools', emoji: ['💻', '🖥️', '⌨️', '🖱️', '📱', '☎️', '📡', '🛰️', '🤖', '⚙️', '🛠️', '🔧', '🔨', '🪛', '🔩', '🔌', '🔋', '💾', '💿', '🧰'] },
    { label: 'Media & creative', emoji: ['🎬', '🎥', '📸', '🖼️', '🎨', '🖌️', '🎭', '🎤', '🎧', '🎵', '🎹', '🎸', '🥁', '📻', '📺', '📰', '✍️', '🏹', '✨', '🪄'] },
    { label: 'Travel & places', emoji: ['✈️', '🚆', '🚄', '🚗', '🚌', '🏍️', '🚲', '🚢', '⛵', '🚀', '🧳', '🏠', '🏡', '🏨', '🏕️', '🏖️', '🏔️', '🌆', '🌍', '🌴'] },
    { label: 'People & wellbeing', emoji: ['😀', '😊', '😂', '🤔', '😎', '🥳', '❤️', '🫶', '🙏', '👋', '👍', '👏', '💪', '🏃', '🏋️', '🧘', '🩺', '💊', '😴', '🛌'] },
    { label: 'Nature & food', emoji: ['☀️', '🌙', '⭐', '⚡', '🔥', '💧', '🌊', '🌈', '🌱', '🌳', '🌸', '🍎', '🥑', '🥗', '🍜', '🍕', '☕', '🍵', '🍷', '🥂'] },
    { label: 'Projects & objects', emoji: ['🚧', '🏗️', '🧱', '🪵', '🧲', '🧯', '🗃️', '🗄️', '📁', '📎', '✂️', '📏', '🔖', '🧷', '🪜', '🔦', '🎁', '🛡️', '🔒', '🔓'] },
    { label: 'Fun & milestones', emoji: ['🎉', '🎊', '🎂', '🎈', '🎆', '🎇', '🥇', '🏅', '🎖️', '🕹️', '🎲', '♟️', '⚽', '🏀', '🎾', '⛳', '🎟️', '🍿', '🚩', '🏁'] },
  ].map(category => Object.freeze({ label: category.label, emoji: Object.freeze(category.emoji) })));
  const choices = Object.freeze(categories.flatMap(category => category.emoji));
  const allowed = new Set(choices);
  // Compact, human-authored names make search useful without relying on platform-specific Unicode labels.
  const keywordData = `
💬:chat message talk conversation|🗨️:speech bubble comment reply|📣:megaphone announce announcement|📢:loudspeaker broadcast announcement|📧:email e-mail message|📨:incoming mail inbox|📮:mailbox post|📝:memo note write draft|📋:clipboard list tasks|📌:pushpin pin important|📍:location map pin place|✅:check done complete success|☑️:checkbox check task done|🗓️:calendar schedule date|📅:calendar event date|⏰:alarm clock reminder time|⌛:hourglass timer wait|🔔:bell alert notification|🤝:handshake deal agreement partner|👥:people team group users|
🧠:brain think thinking mind research|💡:idea light bulb inspiration|📚:books library read study|📖:open book reading|🔬:microscope science research|🔭:telescope space explore|🧪:test tube experiment science|🧬:dna gene biology|🎓:graduation education school learn|✏️:pencil write edit|🖊️:pen write sign|📐:ruler design geometry|📊:chart data analytics|🧩:puzzle problem solution|🗺️:map world plan|🔎:search magnify find inspect|❓:question help unknown|❗:exclamation important alert|🧭:compass direction navigate|🏛️:classical building history museum government|
📈:chart up growth stock market profit|📉:chart down loss decline stock market|💹:market currency exchange chart|💰:money bag cash wealth|💵:cash dollar money banknote|💳:credit card payment money|🪙:coin crypto bitcoin money|🏦:bank finance money|🏢:office building company business|💼:briefcase work business job|🧾:receipt invoice bill|🛒:cart shopping buy|🏷️:tag label price sale|📦:package box parcel delivery|🚚:truck shipping delivery|⚖️:scales law legal balance|🔐:secure lock key privacy|🗝️:key access password|🎯:target goal focus|🏆:trophy winner achievement|
💻:computer laptop code dev software|🖥️:computer desktop monitor screen|⌨️:keyboard type computer|🖱️:mouse click computer|📱:phone mobile smartphone|☎️:telephone call phone|📡:antenna signal network wifi|🛰️:satellite space network|🤖:robot ai bot automation|⚙️:gear settings engineering|🛠️:tools build repair|🔧:wrench tool fix|🔨:hammer tool build|🪛:screwdriver tool repair|🔩:bolt nut hardware|🔌:plug power electricity|🔋:battery power energy|💾:save disk storage|💿:disc cd media storage|🧰:toolbox tools kit|
🎬:movie film video cinema clip|🎥:camera video film|📸:camera photo photography|🖼️:picture image art gallery|🎨:palette art design color|🖌️:paint brush art design|🎭:theatre theater drama masks|🎤:microphone sing podcast voice|🎧:headphones audio music podcast|🎵:music note song|🎹:piano keyboard music|🎸:guitar music|🥁:drum music beat|📻:radio audio broadcast|📺:television tv video|📰:newspaper news article|✍️:write writing author|🏹:bow arrow shorts reel target|✨:sparkles magic new special|🪄:magic wand create|
✈️:plane airplane flight travel|🚆:train railway rail travel|🚄:fast train bullet railway|🚗:car drive road|🚌:bus coach travel|🏍️:motorcycle motorbike ride|🚲:bicycle bike cycling|🚢:ship cruise boat travel|⛵:sailboat sailing boat|🚀:rocket launch space|🧳:luggage suitcase trip travel|🏠:house home|🏡:home garden house|🏨:hotel accommodation|🏕️:camping tent outdoors|🏖️:beach holiday vacation|🏔️:mountain hiking|🌆:city skyline urban|🌍:earth world globe international|🌴:palm tropical island|
😀:happy smile grin face|😊:happy smile warm blush|😂:laugh funny joy tears|🤔:think thinking question curious|😎:cool sunglasses confident|🥳:party celebrate happy|❤️:heart love red|🫶:heart hands love care|🙏:pray thanks please gratitude|👋:wave hello goodbye|👍:thumb up yes approve like|👏:clap applause congratulations|💪:muscle strong fitness health|🏃:run running exercise fitness|🏋️:weights gym workout fitness|🧘:meditate yoga calm wellness|🩺:doctor medical health|💊:pill medicine health|😴:sleep tired rest|🛌:bed sleep rest|
☀️:sun sunny weather day|🌙:moon night sleep|⭐:star favorite|⚡:lightning energy fast power|🔥:fire hot trending|💧:water drop|🌊:wave ocean sea water|🌈:rainbow color hope|🌱:seedling plant grow|🌳:tree nature forest|🌸:flower blossom spring|🍎:apple fruit food|🥑:avocado food healthy|🥗:salad food healthy|🍜:noodles soup food|🍕:pizza food|☕:coffee cafe drink|🍵:tea drink|🍷:wine drink|🥂:cheers toast celebrate|
🚧:construction warning work progress|🏗️:construction build project|🧱:brick wall build|🪵:wood log material|🧲:magnet attract|🧯:fire extinguisher safety|🗃️:file box archive storage|🗄️:file cabinet archive storage|📁:folder file project|📎:paperclip attachment|✂️:scissors cut edit|📏:ruler measure|🔖:bookmark save mark|🧷:safety pin attach|🪜:ladder climb|🔦:flashlight torch light|🎁:gift present|🛡️:shield protect security|🔒:lock closed secure private|🔓:unlock open access|
🎉:party celebrate confetti|🎊:confetti celebration party|🎂:birthday cake milestone|🎈:balloon party birthday|🎆:fireworks celebration|🎇:sparkler celebration|🥇:gold medal first winner|🏅:medal award achievement|🎖️:military medal award|🕹️:joystick game gaming|🎲:dice game random|♟️:chess strategy game|⚽:football soccer sport|🏀:basketball sport|🎾:tennis sport|⛳:golf sport|🎟️:ticket event show|🍿:popcorn movie snack|🚩:flag goal marker|🏁:finish race complete
`;
  const keywords = Object.freeze(Object.fromEntries(keywordData.trim().split('|').map(item => {
    const split = item.trim().indexOf(':');
    return [item.trim().slice(0, split), item.trim().slice(split + 1).toLowerCase()];
  })));
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
  const search = query => {
    const q = String(query || '').trim().toLowerCase();
    if (!q) return categories;
    return categories.map(category => Object.freeze({
      label: category.label,
      emoji: Object.freeze(category.emoji.filter(emoji => `${emoji} ${keywords[emoji] || ''}`.toLowerCase().includes(q))),
    })).filter(category => category.emoji.length);
  };
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
    categories,
    choices,
    search,
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
