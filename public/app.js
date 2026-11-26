// NBA Tier Lists (hoopsmatic.com/tier-lists/). One script for every page:
//   /tier-lists/                       the template list
//   /tier-lists/<slug>/                rank the template's players (S to D)
//   /tier-lists/<slug>/?l=<id>         one published list, with the share block
//   /tier-lists/<slug>/consensus/      the fans' consensus (10+ lists)
//   /tier-lists/make/                  make your own list (Stage 2)
//   /tier-lists/list/?l=<id>           one published custom list (or a ranking of one)
//   /tier-lists/list/?c=<id>           rank that custom list yourself
//   /tier-lists/list/?c=<id>&view=consensus   its consensus (10+ rankings)
// The API is the tier-lists server (hoopsmatic-worker/tier-lists-server),
// /tier-lists/api/*. Templates come from templates.json (scripts/build-templates.mjs).
(() => {
  'use strict';
  const BASE = '/tier-lists/';
  const API = BASE + 'api/';
  const SITE = 'https://hoopsmatic.com' + BASE;
  const NBA = 'https://cdn.nba.com/headshots/nba/latest/260x190/';
  const TIERS = ['S', 'A', 'B', 'C', 'D'];
  // TIERS (Jorge, Nov 26, 2026): 2 to 10 per list, top to bottom, each renamed
  // up to 20 characters (the server filters the words). Colours follow the
  // order: the S to D colours as stops, sampled evenly (tier-lists-server
  // src/card.js tierColors is the same), so five tiers keep the usual five.
  const TIER_MIN = 2, TIER_MAX = 10, TIER_NAME_MAX = 20;
  const STOPS = ['#d12c2c', '#e07a10', '#c29a00', '#1d8a40', '#3b82f6'];
  function tierColors(k) {
    const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
    return Array.from({ length: k }, (_, i) => {
      const f0 = k > 1 ? (i / (k - 1)) * (STOPS.length - 1) : 0, a = Math.floor(f0), f = f0 - a;
      const c0 = rgb(STOPS[a]), c1 = rgb(STOPS[Math.min(a + 1, STOPS.length - 1)]);
      return '#' + c0.map((v, j) => Math.round(v + (c1[j] - v) * f).toString(16).padStart(2, '0')).join('');
    });
  }
  const TIER_HEX = Object.fromEntries(TIERS.map((t, i) => [t, tierColors(5)[i]]));   // the consensus bands
  // POOL SIZE (Jorge, Nov 26, 2026): a template is ranked as its top 10, 25,
  // 50 or all (up to 100), by the order it was picked in (templates.json
  // row[5]); never a hand-picked subset. The server accepts only these.
  const SIZES = [10, 25, 50];
  const sizesOf = (n) => [...SIZES.filter((s) => s < n), n];
  // NAMES ON TILES (Jorge, Nov 26, 2026): last names; where two in the same
  // set share one, a first initial ("P. George", "K. George"); if that still
  // collides, the full name; namesakes keep the data's year tag. Teams show
  // their nickname, typed text as typed. tier-lists-server src/labels.js is the same.
  function tileLabels(ps) {
    const SUF = /\s+(Jr\.?|Sr\.?|II|III|IV)$/, YR = /\s*\(\d{4}\)$/;
    const parts = ps.map((p) => { const full = String(p.name).replace(YR, ''), w = full.replace(SUF, '').split(' '); return { p, full, first: w.length > 1 ? w[0] : '', last: w.length > 1 ? w.slice(1).join(' ') : full.replace(SUF, '') }; });
    const count = (key) => { const m = new Map(); for (const x of parts) if (!x.p.text && !x.p.logo) { const k = key(x); m.set(k, (m.get(k) || 0) + 1); } return m; };
    const init = (x) => (x.first ? x.first[0] + '. ' : '') + x.last;
    const byLast = count((x) => x.last), byInit = count(init), byFull = count((x) => x.full);
    for (const x of parts) {
      x.p.label = x.p.text ? x.p.name : x.p.logo ? String(x.p.name).split(' ').slice(-1)[0]
        : byLast.get(x.last) < 2 ? x.last : byInit.get(init(x)) < 2 ? init(x) : byFull.get(x.full) < 2 ? x.full : x.p.name;
    }
    return ps;
  }
  const NEED = 10;   // lists before a consensus is shown (the server says the same; was 25 until Nov 26, 2026)
  const $ = (id) => document.getElementById(id);
  const app = $('app');
  const page = document.body.dataset.page || 'home';
  const slug = document.body.dataset.slug || '';

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } },
  };
  // A random id this browser keeps; the server stores only a keyed hash of it.
  function device() {
    let d = store.get('tl-device');
    if (typeof d !== 'string' || !/^[A-Za-z0-9_-]{16,64}$/.test(d)) {
      const b = crypto.getRandomValues(new Uint8Array(18));
      d = btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      store.set('tl-device', d);
    }
    return d;
  }
  async function api(path, body) {
    const r = await fetch(API + path, body === undefined ? { cache: 'no-store' } : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    let j = null;
    try { j = await r.json(); } catch (e) { /* not json */ }
    if (!r.ok) { const e = new Error((j && j.error) || 'http_' + r.status); e.status = r.status; throw e; }
    return j;
  }

  // ---------- data ----------
  let DATA = null;
  const P = (row) => ({ id: row[0], name: row[1], nba: row[2], link: row[3], team: row[4], rank: row[5] || 0 });
  // A custom list's item (server: {id, k: p|t|x, name, nba, logo, link}).
  const PC = (x) => ({ id: x.id, name: x.name, nba: x.nba || 0, link: x.link || '', team: x.k === 't' ? 'Team' : '', logo: x.k === 't' ? x.logo : '', text: x.k === 'x' });
  // Stage 2 (custom lists) is open before launch (testing) and from its own moment.
  let CONF = null;
  async function loadConfig() {
    if (CONF) return CONF;
    try { CONF = await (await fetch(BASE + 'config.json', { cache: 'no-cache' })).json(); } catch (e) { CONF = {}; }
    return CONF;
  }
  const customOpen = (c) => { const now = Date.now(), L = Date.parse(c && c.moment || ''), F = Date.parse(c && c.customFrom || ''); return (isFinite(L) && now < L) || (isFinite(F) && now >= F); };
  const LOGO = '/img/nba-headshots/teams/logos/current/svg/';
  // A report goes to us by email, with the list's link.
  function reportLink(url) {
    const p = el('p', 'report');
    const a = el('a', null, 'Report this list'); a.href = 'mailto:hoopsmatic@hoopsmatic.com?subject=' + encodeURIComponent('Report a tier list') + '&body=' + encodeURIComponent('This list should be looked at: ' + url);
    p.append('Something wrong or offensive here? ', a);
    return p;
  }
  async function loadTemplates() {
    if (DATA) return DATA;
    const r = await fetch(BASE + 'templates.json', { cache: 'no-cache' });
    DATA = await r.json();
    return DATA;
  }
  const templateOf = (s) => DATA.templates.find((t) => t.slug === s);

  // ---------- names and the headshot frame ----------
  const SUFFIX = /^(Jr\.?|Sr\.?|II|III|IV)$/;
  function splitName(full) {
    // The data tells namesakes apart with a year ("Larry Johnson (1969)"); it is never shown.
    const parts = String(full).replace(/\s*\(\d{4}\)$/, '').split(' ');
    let i = parts.length - 1;
    if (i > 0 && SUFFIX.test(parts[i])) i--;
    return [parts.slice(0, i).join(' '), parts.slice(i).join(' ')];
  }
  const lastName = (full) => splitName(full)[1];
  // The frame: NBA.com's cutout bottom-aligned on light grey; with no real
  // photo (or one that fails to load) the name sits inside instead.
  function frame(p) {
    const box = el('span', 'ph');
    if (p.text) { box.classList.add('nophoto', 'text'); box.appendChild(el('span', 'ln', p.name)); return box; }
    if (p.logo) {
      const img = el('img'); img.alt = ''; img.decoding = 'async'; img.loading = 'lazy'; img.className = 'logo';
      img.src = LOGO + p.logo + '.svg'; img.onerror = () => { box.textContent = ''; box.classList.add('nophoto'); box.appendChild(el('span', 'ln', p.name)); };
      box.appendChild(img); return box;
    }
    const noPhoto = () => {
      box.textContent = ''; box.classList.add('nophoto');
      const [f, l] = splitName(p.name);
      if (f) box.appendChild(el('span', 'fn', f));
      box.appendChild(el('span', 'ln', l));
    };
    if (!p.nba) { noPhoto(); return box; }
    const img = el('img');
    img.alt = ''; img.decoding = 'async'; img.loading = 'lazy'; img.width = 260; img.height = 190;
    img.src = NBA + p.nba + '.png';
    img.onerror = noPhoto;
    box.appendChild(img);
    return box;
  }
  // A tile: a button while ranking, a link to the player's HoopsMatic page elsewhere.
  function tile(p, opts = {}) {
    const t = el(opts.link ? (p.link ? 'a' : 'span') : 'button', 'tile');
    if (opts.link) { if (p.link) t.href = p.link; t.title = p.name + (p.team ? ', ' + p.team : ''); }
    else { t.type = 'button'; t.dataset.id = p.id; t.setAttribute('aria-label', p.name + (p.team ? ', ' + p.team : '')); }
    t.appendChild(frame(p));
    t.appendChild(el('span', 'nm', p.label || (p.text ? p.name : p.logo ? p.name.split(' ').slice(-1)[0] : lastName(p.name))));
    if (opts.avg != null) t.appendChild(el('span', 'avg', String(Math.round(opts.avg))));
    return t;
  }
  function tabs(active, s) {
    const nav = el('nav', 'tabs'); nav.setAttribute('aria-label', 'Tier list views');
    const add = (key, text, href) => { const a = el('a', key === active ? 'on' : '', text); a.href = href; nav.appendChild(a); };
    const c = /^c:/.test(s) ? s.slice(2) : null;
    add('rank', c ? 'Rank it yourself' : 'Your list', c ? BASE + 'list/?c=' + c : BASE + s + '/');
    add('consensus', "Fans' consensus", c ? BASE + 'list/?c=' + c + '&view=consensus' : BASE + s + '/consensus/');
    add('all', 'All tier lists', BASE);
    return nav;
  }
  // Where a list lives: a template's page, or the custom list page.
  const listHref = (slug, id) => (/^c:/.test(slug) ? BASE + 'list/?l=' : BASE + slug + '/?l=') + encodeURIComponent(id);
  // The board: names = the tiers top to bottom; keys = what a zone is
  // called in data-tier (the names themselves when omitted).
  function board(cls, names = TIERS, keys = names) {
    const long = Math.max(...names.map((n) => String(n).length));
    const b = el('div', 'board' + (cls ? ' ' + cls : '') + (long > 2 ? ' named' : ''));
    const zones = {}, colors = tierColors(names.length);
    names.forEach((n, i) => {
      const row = el('div', 'tier'); row.dataset.tier = keys[i];
      const l = el('div', 'lbl', n); l.style.background = colors[i];
      const d = el('div', 'drop'); d.dataset.tier = keys[i];
      row.append(l, d); b.appendChild(row); zones[keys[i]] = d;
    });
    return { b, zones };
  }
  const fmtDate = (ms) => new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  // ================= the template list =================
  async function home() {
    await loadTemplates();
    app.textContent = '';
    app.appendChild(el('h1', null, 'NBA Tier Lists'));
    app.appendChild(el('p', 'subtitle', 'Rank NBA players in S, A, B, C and D tiers, publish your list and see where the fans land.'));
    if (customOpen(await loadConfig())) {
      const c = el('div', 'msg make-cta');
      c.appendChild(el('b', null, 'Make your own tier list'));
      c.append('Pick your own title and 3 to 100 items: NBA players, teams or anything you type. Then rank them and share it.');
      c.appendChild(el('br'));
      const a = el('a', 'btn', 'Start a list'); a.href = BASE + 'make/'; c.appendChild(a);
      app.appendChild(c);
    }
    let counts = {};
    try { counts = (await api('counts')).counts || {}; } catch (e) { /* counts are a nicety */ }
    const groups = [];
    for (const t of DATA.templates) { let g = groups.find((x) => x.name === t.group); if (!g) groups.push(g = { name: t.group, list: [] }); g.list.push(t); }
    for (const g of groups) {
      const sec = el('section', 'group');
      sec.appendChild(el('h2', null, g.name));
      const cards = el('div', 'cards');
      for (const t of g.list) {
        const c = el('article', 'card');
        const h = el('h3'); const a = el('a', null, t.title); a.href = BASE + t.slug + '/'; h.appendChild(a); c.appendChild(h);
        // Six faces with real photos, in pool order (alphabetical: no ranking hint).
        const faces = el('div', 'faces');
        for (const r of t.players.filter((r) => r[2]).slice(0, 6)) faces.appendChild(frame(P(r)));
        c.appendChild(faces);
        const meta = el('div', 'meta');
        const n = counts[t.slug] || 0;
        meta.appendChild(el('span', null, `${t.players.length} players · ${n} ${n === 1 ? 'list' : 'lists'}`));
        const links = el('span', 'links');
        const r1 = el('a', null, 'Rank them'); r1.href = BASE + t.slug + '/';
        const r2 = el('a', null, 'Consensus'); r2.href = BASE + t.slug + '/consensus/';
        links.append(r1, r2); meta.appendChild(links);
        c.appendChild(meta); cards.appendChild(c);
      }
      sec.appendChild(cards); app.appendChild(sec);
    }
  }

  // ================= ranking =================
  // T: a template ({slug, title, blurb, players: rows}) or a custom list
  // ({slug: 'c:<id>', title, blurb, items: [P]}); T.make: a brand-new list
  // (its items go to the server with the ranking, POST custom).
  function rank(T) {
    const all = T.items || T.players.map(P);
    // A template's pool in the order it was picked (best first); the page still shows it alphabetically.
    const order = T.items ? all : all.slice().sort((a, b) => (a.rank || 1e6) - (b.rank || 1e6));
    const sizes = T.items ? [all.length] : sizesOf(all.length);
    const KEY = 'tl-rank-' + T.slug;
    const saved = store.get(KEY) || {};
    let size = sizes.includes(saved.size) ? saved.size : sizes.includes(25) ? 25 : sizes[sizes.length - 1];
    let uid = 0;
    const mk = (name) => ({ key: 't' + (++uid), name });
    let tiers = Array.isArray(saved.tiers) && saved.tiers.length >= TIER_MIN && saved.tiers.length <= TIER_MAX
      ? saved.tiers.map((x) => mk(String(x.name || '').slice(0, TIER_NAME_MAX))) : TIERS.map(mk);
    // Saved placements: by tier position (old saves by S to D letter).
    let place = {};
    for (const [id, v] of Object.entries(saved.place || {})) {
      const i = typeof v === 'number' ? v : TIERS.indexOf(v);
      if (tiers[i]) place[id] = tiers[i].key;
    }
    let players = [], byId = new Map();
    function setSize() {
      // Alphabetical on the page, the top N by the pool's own order.
      const keep = new Set(order.slice(0, size).map((p) => p.id));
      players = tileLabels(all.filter((p) => keep.has(p.id)));
      byId = new Map(players.map((p) => [p.id, p]));
    }
    setSize();
    let sel = null;

    app.textContent = '';
    if (!T.make) app.appendChild(tabs('rank', T.slug));
    app.appendChild(el('h1', null, T.title));
    const sub = el('p', 'subtitle', (T.blurb ? T.blurb + ' ' : ''));
    sub.appendChild(el('span', null, matchMedia('(pointer: coarse)').matches ? 'Tap a player, then tap a tier.' : 'Drag players into tiers, or click a player and then a tier.'));
    app.appendChild(sub);
    const boardHost = el('div'); app.appendChild(boardHost);
    let b = null, zones = {};
    const selbar = el('div', 'selbar hide'); selbar.setAttribute('aria-live', 'polite'); app.appendChild(selbar);
    // Tiers: rename any, add or remove (2 to 10). Everything stays in the page.
    const tsec = el('section', 'section tiers-edit');
    const th = el('div', 'section-head'); th.appendChild(el('h2', null, 'Tiers'));
    const tcount = el('span', 'count'); th.appendChild(tcount); tsec.appendChild(th);
    const tlist = el('div', 'tier-names'); tsec.appendChild(tlist);
    const tadd = el('button', 'btn ghost small', 'Add a tier'); tadd.type = 'button';
    const tdef = el('button', 'linkbtn', 'Back to S to D'); tdef.type = 'button';
    const trow = el('div', 'tools'); trow.append(tadd, tdef); tsec.appendChild(trow);
    app.appendChild(tsec);
    const sec = el('section', 'section');
    const head = el('div', 'section-head'); head.appendChild(el('h2', null, T.items ? 'Items' : 'Players'));
    const count = el('span', 'count'); head.appendChild(count); sec.appendChild(head);
    // Pool size: the top 10, 25, 50 or all, by the pool's own order.
    const sizeRow = el('div', 'share-sizes pool-size'); sizeRow.setAttribute('role', 'group'); sizeRow.setAttribute('aria-label', 'How many players');
    const szBtn = {};
    for (const n of sizes) {
      const bt = el('button', null, n === all.length ? `All ${n}` : `Top ${n}`); bt.type = 'button'; szBtn[n] = bt;
      bt.addEventListener('click', () => { size = n; setSize(); sel = null; save(); render(); });
      sizeRow.appendChild(bt);
    }
    if (sizes.length > 1) { sec.appendChild(sizeRow); sec.appendChild(el('p', 'note', 'Top 10, 25 or 50 keeps the best of this pool by how it was picked; All ranks every player.')); }
    const pool = el('div', 'pool'); pool.dataset.tier = ''; sec.appendChild(pool);
    app.appendChild(sec);

    const form = el('form', 'publish'); form.autocomplete = 'off';
    const lab = el('label', 'vh', 'Your name (optional)'); lab.htmlFor = 'tl-name';
    const name = el('input'); name.id = 'tl-name'; name.maxLength = 24; name.placeholder = 'Your name (optional)';
    name.value = store.get('tl-name') || '';
    const pub = el('button', 'btn', 'Publish'); pub.type = 'submit';
    form.append(lab, name, pub); app.appendChild(form);
    const note = el('p', 'note'); note.setAttribute('aria-live', 'polite'); app.appendChild(note);
    const tools = el('div', 'tools');
    const reset = el('button', 'linkbtn', 'Start over'); reset.type = 'button';
    const cons = el('a', null, T.make ? 'Change the items' : "See the fans' consensus"); cons.href = T.make ? BASE + 'make/' : /^c:/.test(T.slug) ? BASE + 'list/?c=' + T.slug.slice(2) + '&view=consensus' : BASE + T.slug + '/consensus/'; cons.style.fontSize = '.8rem';
    tools.append(reset, cons); app.appendChild(tools);

    const save = () => store.set(KEY, { size, tiers: tiers.map((x) => ({ name: x.name })), place: Object.fromEntries(Object.entries(place).map(([id, k]) => [id, tiers.findIndex((x) => x.key === k)]).filter(([, i]) => i >= 0)) });
    // The tier editor and the board are rebuilt when the tiers change.
    function drawTiers() {
      const built = board('edit', tiers.map((x) => x.name || ' '), tiers.map((x) => x.key));
      boardHost.textContent = ''; boardHost.appendChild(built.b); b = built.b; zones = built.zones;
      tlist.textContent = '';
      const colors = tierColors(tiers.length);
      tiers.forEach((x, i) => {
        const row = el('div', 'tier-name');
        const sw = el('span', 'sw'); sw.style.background = colors[i]; row.appendChild(sw);
        const inp = el('input', 'field'); inp.maxLength = TIER_NAME_MAX; inp.value = x.name; inp.setAttribute('aria-label', `Tier ${i + 1} name`);
        inp.addEventListener('input', () => { x.name = inp.value.slice(0, TIER_NAME_MAX); const l = b.querySelector(`.tier[data-tier="${x.key}"] .lbl`); if (l) l.textContent = x.name || ' '; b.classList.toggle('named', tiers.some((y) => y.name.length > 2)); note.classList.remove('err'); save(); render(); });
        row.appendChild(inp);
        const rm = el('button', 'linkbtn', 'Remove'); rm.type = 'button'; rm.disabled = tiers.length <= TIER_MIN; rm.setAttribute('aria-label', `Remove tier ${x.name || i + 1}`);
        rm.addEventListener('click', () => {
          // Its players go back to the pool.
          for (const [id, k] of Object.entries(place)) if (k === x.key) delete place[id];
          tiers = tiers.filter((y) => y !== x); save(); drawTiers(); render();
        });
        row.appendChild(rm); tlist.appendChild(row);
      });
      tcount.textContent = `${tiers.length} of ${TIER_MAX} (at least ${TIER_MIN})`;
      tadd.disabled = tiers.length >= TIER_MAX;
    }
    tadd.addEventListener('click', () => { if (tiers.length >= TIER_MAX) return; const used = new Set(tiers.map((x) => x.name)); const next = 'SABCDEFGHIJKLMNOPQRTUVWXYZ'.split('').find((c) => !used.has(c)) || String(tiers.length + 1); tiers.push(mk(next)); save(); drawTiers(); render(); });
    tdef.addEventListener('click', () => { const old = tiers; tiers = TIERS.map(mk); for (const [id, k] of Object.entries(place)) { const i = old.findIndex((x) => x.key === k); if (tiers[i]) place[id] = tiers[i].key; else delete place[id]; } save(); drawTiers(); render(); });
    function render() {
      for (const x of tiers) {
        const z = zones[x.key]; if (!z) continue; z.textContent = '';
        for (const p of players) if (place[p.id] === x.key) z.appendChild(tile(p));
      }
      pool.textContent = '';
      for (const p of players) if (!place[p.id]) pool.appendChild(tile(p));
      for (const n of sizes) szBtn[n].setAttribute('aria-pressed', String(n === size));
      const left = players.filter((p) => !place[p.id]).length;
      if (!left) pool.appendChild(el('span', 'done', 'Every player is ranked.'));
      count.textContent = `${players.length - left} of ${players.length} ranked`;
      const badName = tiers.some((x) => !x.name.trim());
      pub.disabled = left > 0 || badName;
      if (!note.classList.contains('err')) note.textContent = badName ? 'Give every tier a name.' : left ? 'Place every player to publish. Your list gets its own link and a share image.' : 'Ready. Your list gets its own link and a share image.';
      for (const x of app.querySelectorAll('.tile')) x.classList.toggle('sel', x.dataset.id === sel);
      if (b) b.classList.toggle('armed', !!sel);
      selbar.classList.toggle('hide', !sel); selbar.textContent = '';
      const p = sel && byId.get(sel);
      if (p) {
        selbar.appendChild(frame(p));
        const w = el('div', 'who');
        const a = el(p.link ? 'a' : 'b', null, splitName(p.name).filter(Boolean).join(' ')); if (p.link) a.href = p.link; w.appendChild(a);
        w.appendChild(el('small', null, p.team));
        selbar.appendChild(w);
        const act = el('div', 'act');
        act.appendChild(el('span', 'hint', 'Tap a tier'));
        if (place[p.id]) { const back = el('button', 'linkbtn', 'Back to players'); back.type = 'button'; back.addEventListener('click', () => move(p.id, '')); act.appendChild(back); }
        selbar.appendChild(act);
      }
    }
    function move(id, k) {
      if (k) place[id] = k; else delete place[id];
      sel = null; note.classList.remove('err'); save(); render();
    }
    // Tap (or click) to place: a tile selects, then a tier (or the pool) takes it.
    app.addEventListener('click', (e) => {
      if (dragged) return;
      const tl = e.target.closest('button.tile');
      if (tl) { sel = sel === tl.dataset.id ? null : tl.dataset.id; render(); return; }
      if (!sel) return;
      const z = e.target.closest('.tier, .pool');
      if (z && app.contains(z)) move(sel, z.dataset.tier || '');
    });
    // Keyboard: with a player selected, a tier's one-letter name (S, A, B...)
    // or its number (1 to 9, 0 for the tenth) places him; Backspace sends him back.
    document.addEventListener('keydown', (e) => {
      if (!sel || e.target === name || (e.target && e.target.tagName === 'INPUT')) return;
      const k = e.key.toUpperCase();
      const byName = tiers.find((x) => x.name.toUpperCase() === k);
      const byNum = /^[0-9]$/.test(k) ? tiers[(+k + 9) % 10] : null;
      const to = byName || byNum;
      if (to) { e.preventDefault(); const id = sel; move(id, to.key); app.querySelector(`.tile[data-id="${id}"]`)?.focus(); }
      else if (e.key === 'Backspace') { e.preventDefault(); move(sel, ''); }
      else if (e.key === 'Escape') { sel = null; render(); }
    });
    // Drag with a mouse or pen (desktop). Touch stays tap-to-place, so a
    // finger on a tile still scrolls the page.
    let start = null, dragged = false, ghost = null;
    app.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch' || e.button !== 0) return;
      const tl = e.target.closest('button.tile'); if (!tl) return;
      start = { x: e.clientX, y: e.clientY, tl, id: tl.dataset.id }; dragged = false;
    });
    const zoneAt = (x, y) => { const z = document.elementFromPoint(x, y)?.closest('.tier, .pool'); return z && app.contains(z) ? z : null; };
    document.addEventListener('pointermove', (e) => {
      if (!start) return;
      if (!dragged && Math.hypot(e.clientX - start.x, e.clientY - start.y) < 6) return;
      if (!dragged) { dragged = true; ghost = start.tl.cloneNode(true); ghost.className = 'tile drag-img'; document.body.appendChild(ghost); start.tl.classList.add('ghost'); }
      ghost.style.left = e.clientX + 'px'; ghost.style.top = e.clientY + 'px';
      for (const x of app.querySelectorAll('.target')) x.classList.remove('target');
      zoneAt(e.clientX, e.clientY)?.classList.add('target');
    });
    document.addEventListener('pointerup', (e) => {
      if (!start) return;
      if (dragged) {
        ghost.remove(); for (const x of app.querySelectorAll('.target')) x.classList.remove('target');
        const z = zoneAt(e.clientX, e.clientY);
        if (z) move(start.id, z.dataset.tier || ''); else render();
        setTimeout(() => { dragged = false; }, 0);
      }
      start = null;
    });
    reset.addEventListener('click', () => { place = {}; sel = null; save(); render(); });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (players.some((p) => !place[p.id]) || tiers.some((x) => !x.name.trim())) return;
      const out = tiers.map((x) => ({ name: x.name.trim(), ids: players.filter((p) => place[p.id] === x.key).map((p) => p.id) }));
      pub.disabled = true; note.classList.remove('err'); note.textContent = 'Publishing...';
      try {
        const r = T.make ? await api('custom', { device: device(), title: T.title, name: name.value.trim() || null, items: T.make, tiers: out })
          : await api('publish', { device: device(), slug: T.slug, name: name.value.trim() || null, tiers: out });
        if (T.make) { store.set('tl-make', null); if (T.idea) store.set('tl-ideas-used', [...usedIdeas(), T.idea].slice(-200)); }
        store.set('tl-name', name.value.trim());
        // Lists published from this browser: their page says "your list".
        store.set('tl-mine', [...(store.get('tl-mine') || []), r.id].slice(-50));
        // From launch the server seals a badge receipt; the list's own page
        // hands it to the badges (HMGames.badgeResult) once, then forgets it.
        if (typeof r.badge === 'string') store.set('tl-badge', { id: r.id, receipt: r.badge });
        location.href = listHref(T.make ? 'c:' : T.slug, r.id);
      } catch (x) {
        const m = { bad_name: "That name can't be used. Try another, or leave it blank.", too_many: 'Too many lists from here today. Try again tomorrow.', bad_tiers: 'Something is off with this list. Reload the page and try again.',
          bad_tier_name: "One of the tier names can't be used. Change it and try again.",
          bad_title_word: "That title can't be used. Change it and try again.", bad_item_word: "One of the typed items can't be used. Change it and try again.", bad_items: 'Something is off with the items. Go back and check them.', not_yet: 'Making your own list is not open yet.' };
        note.classList.add('err'); note.textContent = m[x.message] || "Couldn't publish right now. Try again in a minute.";
        pub.disabled = false;
      }
    });
    drawTiers();
    render();
  }

  // ================= one published list =================
  async function listView(T, id, L0) {
    app.textContent = '';
    if (T.slug) app.appendChild(tabs('', T.slug));
    let L = L0;
    try { if (!L) L = await api('list/' + encodeURIComponent(id)); } catch (e) {
      app.appendChild(el('h1', null, T.title));
      const m = el('div', 'msg'); m.appendChild(el('b', null, e.status === 404 ? 'This list is not available.' : "This list couldn't load."));
      m.append(e.status === 404 ? 'It may have been removed.' : 'Refresh to try again.');
      const a = el('a', 'btn', 'Make your own list'); a.href = T.slug ? BASE + T.slug + '/' : BASE; m.appendChild(el('br')); m.appendChild(a);
      app.appendChild(m); return;
    }
    const tiers = Array.isArray(L.tiers) ? L.tiers : TIERS.map((n) => ({ name: n, ids: L.tiers[n] || [] }));
    const pool = new Map((T.items || T.players.map(P)).map((p) => [p.id, p]));
    const byId = new Map(tileLabels(tiers.flatMap((x) => x.ids).filter((x) => pool.has(x)).map((x) => ({ ...pool.get(x) }))).map((p) => [p.id, p]));
    app.appendChild(el('h1', null, T.title));
    const sub = el('p', 'subtitle');
    sub.appendChild(el('b', null, L.name ? `${L.name}'s list` : "A fan's list"));
    sub.append(` · ${fmtDate(L.created)}`);
    app.appendChild(sub);
    // The list as its maker named it.
    const keys = tiers.map((_, i) => 'k' + i);
    const { b, zones } = board('', tiers.map((x) => x.name), keys);
    tiers.forEach((x, i) => {
      const ids = x.ids.filter((id) => byId.has(id));
      if (!ids.length) zones[keys[i]].appendChild(el('span', 'empty', 'Nobody'));
      for (const id of ids) zones[keys[i]].appendChild(tile(byId.get(id), { link: true }));
    });
    app.appendChild(b);
    const mine = store.get('tl-mine') || [];
    const own = mine.includes(L.id);
    const sec = el('section', 'section');
    const sh = el('div', 'section-head'); sh.appendChild(el('h2', null, own ? 'Share your list' : 'Share this list')); sec.appendChild(sh);
    const url = 'https://hoopsmatic.com' + listHref(T.slug, L.id);
    sec.appendChild(shareBlock(T.title, L, url)); app.appendChild(sec);
    const tools = el('div', 'tools');
    const custom = /^c:/.test(T.slug) ? T.slug.slice(2) : null;
    const a1 = el('a', 'btn', custom ? 'Rank this list yourself' : own ? 'Edit and republish' : 'Make your own list'); a1.href = custom ? BASE + 'list/?c=' + custom : BASE + T.slug + '/';
    const a2 = el('a', null, "See the fans' consensus"); a2.href = custom ? BASE + 'list/?c=' + custom + '&view=consensus' : BASE + T.slug + '/consensus/'; a2.style.fontSize = '.85rem';
    tools.append(a1, a2); app.appendChild(tools);
    app.appendChild(reportLink(url));
    if (own) makeAnother();
    badges(L.id, own);
  }

  // After publishing: "Make another", three ideas this browser hasn't used.
  async function makeAnother() {
    if (!customOpen(await loadConfig())) return;
    const used = new Set(usedIdeas());
    const pick = ideasToday(await loadIdeas()).filter((i) => !used.has(i.id)).slice(0, 3);
    if (!pick.length) return;
    const sec = el('section', 'section');
    const h = el('div', 'section-head'); h.appendChild(el('h2', null, 'Make another')); sec.appendChild(h);
    const box = el('div', 'ideas'); for (const i of pick) box.appendChild(ideaButton(i)); sec.appendChild(box);
    const a = el('a', 'linkbtn', 'Start from scratch'); a.href = BASE + 'make/'; sec.appendChild(a);
    app.appendChild(sec);
  }

  // ---------- badges (hoopsmatic-badges, game id "tierlists") ----------
  // The receipt from the publish reply goes to the shared games script
  // (/hoopsmatic-games.js), which shows the badge card inside the page, in
  // #games-promo. No pop-up. Only on the maker's own list, only once.
  function badges(listId, own) {
    const pend = store.get('tl-badge');
    if (!own || !pend || pend.id !== listId || typeof pend.receipt !== 'string') return;
    store.set('tl-badge', null);
    const host = el('div'); host.id = 'games-promo'; app.appendChild(host);
    try { if (window.HMGames && typeof window.HMGames.badgeResult === 'function') window.HMGames.badgeResult('tierlists', pend.receipt); } catch (e) { /* badges are extra */ }
  }

  // ---------- the 73-9 share block ----------
  // The six icons, copied from Deep Cut's (the 73-9 game's) share block.
  const SOC_ICON = {
    x:'<svg viewBox="0 0 24 24"><path fill="currentColor" d="M18.9 1.15h3.68l-8.04 9.19L24 22.85h-7.41l-5.8-7.58-6.64 7.58H.47l8.6-9.83L0 1.15h7.59l5.24 6.93zM17.61 20.64h2.04L6.49 3.24H4.3z"/></svg>',
    bsky:'<svg viewBox="0 0 24 24"><path fill="currentColor" d="M12 10.8C10.91 8.69 7.95 4.75 5.2 2.81 2.57.94 1.56 1.27.9 1.57.14 1.91 0 3.08 0 3.77c0 .69.38 5.65.62 6.48.82 2.74 3.71 3.66 6.38 3.36-3.91.58-7.39 2.01-2.83 7.08 5.01 5.19 6.87-1.11 7.82-4.31.95 3.2 2.05 9.27 7.73 4.31 4.27-4.31 1.17-6.5-2.74-7.08 2.67.3 5.57-.63 6.38-3.36C23.62 9.42 24 4.46 24 3.77c0-.69-.14-1.86-.9-2.2-.66-.3-1.66-.62-4.3 1.24C16.05 4.75 13.09 8.69 12 10.8z"/></svg>',
    fb:'<svg viewBox="0 0 24 24"><path fill="currentColor" d="M24 12.07C24 5.4 18.63 0 12 0S0 5.4 0 12.07c0 6.02 4.39 11.01 10.13 11.93v-8.44H7.08v-3.49h3.05V9.41c0-3.02 1.79-4.69 4.53-4.69 1.31 0 2.68.24 2.68.24v2.97h-1.51c-1.49 0-1.96.93-1.96 1.89v2.25h3.33l-.53 3.49h-2.8v8.44C19.61 23.08 24 18.09 24 12.07z"/></svg>',
    wa:'<svg viewBox="0 0 24 24"><path fill="currentColor" d="M17.47 14.38c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15s-.77.97-.94 1.16c-.17.2-.35.22-.64.08-.3-.15-1.26-.47-2.39-1.48-.88-.79-1.48-1.76-1.65-2.06-.17-.3-.02-.46.13-.6.13-.14.3-.35.45-.52.14-.18.19-.3.29-.5.1-.2.05-.37-.02-.52-.08-.15-.67-1.61-.92-2.21-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.79.37-.27.3-1.04 1.02-1.04 2.48s1.07 2.88 1.21 3.07c.15.2 2.1 3.2 5.08 4.49.71.31 1.26.49 1.69.63.71.22 1.36.19 1.87.12.57-.09 1.76-.72 2.01-1.41.25-.7.25-1.29.17-1.41-.07-.13-.27-.2-.57-.35M12.05 21.79h-.01a9.87 9.87 0 0 1-5.03-1.38l-.36-.21-3.74.98 1-3.65-.24-.37a9.86 9.86 0 0 1-1.51-5.26c0-5.45 4.44-9.88 9.89-9.88 2.64 0 5.12 1.03 6.99 2.9a9.83 9.83 0 0 1 2.89 6.99c0 5.45-4.43 9.88-9.88 9.88M20.46 3.49A11.81 11.81 0 0 0 12.05 0C5.5 0 .16 5.34.16 11.89c0 2.1.55 4.14 1.59 5.95L.06 24l6.3-1.65a11.88 11.88 0 0 0 5.68 1.45h.01c6.55 0 11.89-5.34 11.89-11.89a11.82 11.82 0 0 0-3.48-8.42"/></svg>',
    reddit:'<svg viewBox="0 0 24 24"><path fill="currentColor" d="M12 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0zm5.01 4.74c.69 0 1.25.56 1.25 1.25a1.25 1.25 0 0 1-2.5.06l-2.6-.55-.8 3.75c1.83.07 3.48.63 4.68 1.49.31-.31.73-.49 1.21-.49.97 0 1.75.79 1.75 1.75 0 .72-.44 1.33-1.01 1.61.03.17.04.34.04.52 0 2.7-3.13 4.87-7 4.87-3.88 0-7-2.17-7-4.87 0-.18.01-.37.04-.53A1.75 1.75 0 0 1 4.03 12c0-.97.79-1.75 1.75-1.75.46 0 .9.2 1.21.49 1.21-.88 2.88-1.43 4.74-1.49l.89-4.18a.34.34 0 0 1 .14-.2.35.35 0 0 1 .24-.04l2.91.62a1.21 1.21 0 0 1 1.11-.7zM9.25 12c-.69 0-1.25.56-1.25 1.25 0 .69.56 1.25 1.25 1.25.69 0 1.25-.56 1.25-1.25 0-.69-.56-1.25-1.25-1.25zm5.5 0c-.69 0-1.25.56-1.25 1.25 0 .69.56 1.25 1.25 1.25.69 0 1.25-.56 1.25-1.25 0-.69-.56-1.25-1.25-1.25zm-5.47 3.99a.33.33 0 0 0-.23.09.33.33 0 0 0 0 .47c.84.84 2.48.91 2.96.91.48 0 2.11-.06 2.96-.91a.36.36 0 0 0 .03-.47.33.33 0 0 0-.46 0c-.55.53-1.69.73-2.51.73-.83 0-1.98-.2-2.51-.73a.33.33 0 0 0-.24-.09z"/></svg>',
    telegram:'<svg viewBox="0 0 24 24"><path fill="currentColor" d="M11.94 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.06 0zm4.96 7.22c.1 0 .32.02.47.14a.51.51 0 0 1 .17.33c.02.09.04.31.02.47-.18 1.9-.96 6.5-1.36 8.63-.17.9-.5 1.2-.82 1.23-.7.06-1.23-.46-1.9-.9-1.06-.7-1.65-1.12-2.68-1.8-1.19-.78-.42-1.21.26-1.91.18-.18 3.25-2.98 3.31-3.23 0-.03.01-.15-.06-.21-.07-.06-.17-.04-.25-.02-.1.02-1.79 1.14-5.06 3.34-.48.33-.91.49-1.3.48-.43 0-1.25-.24-1.86-.44-.75-.24-1.35-.37-1.3-.79.03-.21.33-.43.89-.66 3.5-1.52 5.83-2.53 7-3.01 3.33-1.39 4.02-1.63 4.48-1.63z"/></svg>'
  };
  const SOC = [['x', 'X'], ['bsky', 'Bluesky'], ['fb', 'Facebook'], ['wa', 'WhatsApp'], ['reddit', 'Reddit'], ['telegram', 'Telegram']];
  // The share panel, in the page under a published list (never a pop-up).
  // The picture is drawn by the tier-lists server (/tier-lists/api/image/
  // <id>.png, headshots through our own proxy): 1080x1350 by default or
  // 1080x1080. The same file is the list link's preview. "Save image"
  // downloads it; on a phone, "Share image" hands the file itself to the
  // share sheet where the browser allows files, else the link.
  function shareBlock(title, L, url) {
    const text = `${L.name ? L.name + "'s" : 'My'} ${title} tier list on HoopsMatic`;
    const box = el('div', 'share-box');
    let size = '1350';
    const sizes = el('div', 'share-sizes'); sizes.setAttribute('role', 'group'); sizes.setAttribute('aria-label', 'Image size');
    const szBtn = {};
    for (const [k, lab] of [['1350', '1080 x 1350'], ['1080', '1080 x 1080']]) {
      const b = el('button', null, lab); b.type = 'button'; b.setAttribute('aria-pressed', String(k === size)); szBtn[k] = b;
      b.addEventListener('click', () => { size = k; for (const x in szBtn) szBtn[x].setAttribute('aria-pressed', String(x === k)); show(); });
      sizes.appendChild(b);
    }
    box.appendChild(sizes);
    const img = el('img', 'share-img'); img.alt = `${title} tier list: the S to D tiers`; img.width = 1080; img.height = 1350; img.decoding = 'async';
    box.appendChild(img);
    const imgUrl = () => API + 'image/' + L.id + '.png' + (size === '1080' ? '?size=1080' : '');
    function show() { img.classList.toggle('sq', size === '1080'); img.height = size === '1080' ? 1080 : 1350; img.src = imgUrl(); }
    show();
    const btns = el('div', 'share-btns');
    const save = el('button', 'btn', 'Save image'); save.type = 'button';
    const share = el('button', 'btn ghost', 'Share image'); share.type = 'button';
    btns.append(save, share); box.appendChild(btns);
    const link = el('div', 'share-link');
    const inp = el('input', 'share-url'); inp.readOnly = true; inp.value = url; inp.setAttribute('aria-label', 'Share link');
    const copy = el('button', 'share-copybtn', 'Copy'); copy.type = 'button';
    link.append(inp, copy); box.appendChild(link);
    const soc = el('div', 'share-social');
    const enc = encodeURIComponent, u = enc(url), t = enc(text), tu = enc(text + ' ' + url);
    const go = { x: 'https://twitter.com/intent/tweet?text=' + t + '&url=' + u, bsky: 'https://bsky.app/intent/compose?text=' + tu, fb: 'https://www.facebook.com/sharer/sharer.php?u=' + u,
      wa: 'https://wa.me/?text=' + tu, reddit: 'https://www.reddit.com/submit?url=' + u + '&title=' + t, telegram: 'https://t.me/share/url?url=' + u + '&text=' + t };
    for (const [k, name] of SOC) {
      const b = el('button', 'soc soc-' + k); b.type = 'button'; b.setAttribute('aria-label', 'Share on ' + name);
      b.innerHTML = SOC_ICON[k]; b.appendChild(el('span', null, name));
      b.addEventListener('click', () => window.open(go[k], '_blank', 'noopener,noreferrer'));
      soc.appendChild(b);
    }
    box.appendChild(soc);
    const msg = el('div', 'share-msg'); msg.setAttribute('aria-live', 'polite'); box.appendChild(msg);
    const fileName = () => (title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'tier-list') + '-' + (size === '1080' ? 'square' : 'tall') + '.png';
    async function file() {
      const r = await fetch(imgUrl());
      if (!r.ok) throw new Error('image');
      return new File([await r.blob()], fileName(), { type: 'image/png' });
    }
    save.addEventListener('click', async () => {
      msg.textContent = 'Getting the image...';
      try {
        const f = await file(); const a = document.createElement('a'); a.href = URL.createObjectURL(f); a.download = f.name;
        document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
        msg.textContent = 'Image saved.';
      } catch (e) { msg.textContent = "The image couldn't be saved. Try again in a moment."; }
    });
    share.addEventListener('click', async () => {
      try {
        const f = await file();
        if (navigator.canShare && navigator.canShare({ files: [f] })) { await navigator.share({ files: [f], title: text, text: text + ' ' + url }); msg.textContent = ''; return; }
        if (navigator.share) { await navigator.share({ title: text, text, url }); return; }
        await navigator.clipboard.writeText(text + ' ' + url); msg.textContent = 'This browser cannot share files: the link is copied instead.';
      } catch (e) { if (!e || e.name !== 'AbortError') msg.textContent = 'Sharing is blocked here. Use Save image or the buttons below.'; }
    });
    inp.addEventListener('click', () => inp.select());
    copy.addEventListener('click', async () => { try { await navigator.clipboard.writeText(text + '\n' + url); msg.textContent = 'Text + link copied.'; } catch (e) { msg.textContent = 'Copy blocked here.'; } });
    return box;
  }

  // ================= make your own list (Stage 2) =================
  // A title (up to 80 characters), then 3 to 100 items: players and teams
  // picked from our database (public/players.json) or typed text (up to 40
  // characters, a text tile). Then the same ranking screen; publishing sends
  // the items with the ranking. The draft is kept in this browser.
  const TITLE_MAX = 80, TEXT_MAX = 40, MIN_ITEMS = 3, MAX_ITEMS = 100;
  // LIST IDEAS (public/ideas.json, built from our data): today's order. The
  // ideas in season this month come first (NBA Cup Nov-Dec, All-Star and the
  // trade deadline Feb, playoffs Apr-Jun, the draft Jun), then the rest; each
  // group in an order that changes every day and is the same for everyone.
  let IDEAS = null;
  async function loadIdeas() {
    if (IDEAS) return IDEAS;
    try { IDEAS = (await (await fetch(BASE + 'ideas.json', { cache: 'no-cache' })).json()).ideas || []; } catch (e) { IDEAS = []; }
    return IDEAS;
  }
  function ideasToday(list, d = new Date()) {
    const day = Math.floor((d.getTime() - d.getTimezoneOffset() * 60000) / 86400000), month = d.getMonth() + 1;
    const h = (s) => { let x = 2166136261 ^ day; for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 16777619); } return x >>> 0; };
    const shuffled = (a) => a.slice().sort((x, y) => h(x.id) - h(y.id));
    const now = list.filter((i) => i.months && i.months.includes(month));
    return [...shuffled(now), ...shuffled(list.filter((i) => !now.includes(i)))];
  }
  const usedIdeas = () => (Array.isArray(store.get('tl-ideas-used')) ? store.get('tl-ideas-used') : []);
  // An idea as a button: its title and what it fills.
  function ideaButton(i, onPick) {
    const b = el(onPick ? 'button' : 'a', 'idea');
    if (onPick) { b.type = 'button'; b.addEventListener('click', () => onPick(i)); } else b.href = BASE + 'make/?idea=' + encodeURIComponent(i.id);
    b.appendChild(el('span', 'nm', i.title));
    const n = (i.items || i.teams || []).length;
    b.appendChild(el('small', null, n ? `${n} ${i.teams ? 'teams' : 'players'} filled in` : 'You add the items'));
    return b;
  }
  async function make() {
    app.textContent = '';
    if (!customOpen(await loadConfig())) {
      app.appendChild(el('h1', null, 'Make your own tier list'));
      const m = el('div', 'msg'); m.appendChild(el('b', null, 'Coming soon')); m.append('Making your own list opens soon. Meanwhile, rank one of ours.');
      m.appendChild(el('br')); const a = el('a', 'btn', 'All tier lists'); a.href = BASE; m.appendChild(a); app.appendChild(m); return;
    }
    const draft = store.get('tl-make') || {};
    let title = typeof draft.title === 'string' ? draft.title.slice(0, TITLE_MAX) : '';
    let items = Array.isArray(draft.items) ? draft.items.filter((x) => x && (x.p || x.t || x.x)).slice(0, MAX_ITEMS) : [];
    let idea = typeof draft.idea === 'string' ? draft.idea : null;
    const save = () => store.set('tl-make', { title, items, idea });
    const nav = el('nav', 'tabs'); const back = el('a', null, 'All tier lists'); back.href = BASE; nav.appendChild(back); app.appendChild(nav);
    app.appendChild(el('h1', null, 'Make your own tier list'));
    app.appendChild(el('p', 'subtitle', 'Give it a title, add 3 to 100 items (NBA players, teams or anything you type), then rank them S to D.'));
    // Ideas: six at a time, in the page (wrapping rows), "More ideas" for the next six.
    const s0 = el('section', 'section');
    const h0 = el('div', 'section-head'); h0.appendChild(el('h2', null, 'Ideas')); s0.appendChild(h0);
    const ideaBox = el('div', 'ideas'); s0.appendChild(ideaBox);
    const more = el('button', 'linkbtn', 'More ideas'); more.type = 'button'; s0.appendChild(more);
    app.appendChild(s0);
    let order = [], at = 0;
    function showIdeas() {
      ideaBox.textContent = '';
      for (let k = 0; k < Math.min(6, order.length); k++) ideaBox.appendChild(ideaButton(order[(at + k) % order.length], applyIdea));
      more.classList.toggle('hide', order.length <= 6);
    }
    more.addEventListener('click', () => { at = (at + 6) % Math.max(1, order.length); showIdeas(); });
    // Title
    const s1 = el('section', 'section');
    const h1 = el('div', 'section-head'); h1.appendChild(el('h2', null, 'Title')); const tc = el('span', 'count'); h1.appendChild(tc); s1.appendChild(h1);
    const ti = el('input', 'field'); ti.maxLength = TITLE_MAX; ti.placeholder = 'Best dunkers of the 2000s'; ti.value = title; ti.setAttribute('aria-label', 'List title');
    s1.appendChild(ti); app.appendChild(s1);
    // Items
    const s2 = el('section', 'section');
    const h2 = el('div', 'section-head'); h2.appendChild(el('h2', null, 'Items')); const ic = el('span', 'count'); h2.appendChild(ic); s2.appendChild(h2);
    const q = el('input', 'field'); q.placeholder = 'Search a player or team, or type anything'; q.maxLength = TEXT_MAX; q.setAttribute('aria-label', 'Add an item'); q.autocomplete = 'off';
    s2.appendChild(q);
    const results = el('div', 'results'); results.setAttribute('aria-live', 'polite'); s2.appendChild(results);
    const chosen = el('div', 'pool chosen'); s2.appendChild(chosen);
    app.appendChild(s2);
    const go = el('button', 'btn', 'Rank them'); go.type = 'button';
    const note = el('p', 'note'); note.setAttribute('aria-live', 'polite');
    const tools = el('div', 'tools'); const clear = el('button', 'linkbtn', 'Start over'); clear.type = 'button'; tools.append(go, clear);
    app.appendChild(tools); app.appendChild(note);

    // The database loads in the background; typing works at once (text
    // items), and the search fills in as soon as it arrives.
    let DB = { players: [], teams: [] }, pById = new Map(), tById = new Map(), idx = [];
    const fold = (s) => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, '');
    const asP = (x) => x.p ? { id: 'p:' + x.p, name: (pById.get(x.p) || [])[1] || x.p, nba: (pById.get(x.p) || [])[2] || 0, link: (pById.get(x.p) || [])[3] || '', team: (pById.get(x.p) || [])[4] || '' }
      : x.t ? { id: 't:' + x.t, name: (tById.get(x.t) || [])[1] || x.t, logo: x.t, link: (tById.get(x.t) || [])[2] || '', team: 'Team' }
      : { id: 'x:' + x.x.toLowerCase(), name: x.x, text: true };
    const has = (key) => items.some((x) => asP(x).id === key);
    function add(x) {
      if (items.length >= MAX_ITEMS) { note.textContent = `That's ${MAX_ITEMS} items, the most a list can have.`; return; }
      if (has(asP(x).id)) { note.textContent = 'Already on the list.'; return; }
      items.push(x); save(); q.value = ''; search(); draw(); q.focus();
    }
    function search() {
      results.textContent = '';
      const v = q.value.trim(), f = fold(v);
      if (!v) return;
      const teams = f.length >= 2 ? DB.teams.filter((r) => fold(r[1]).includes(f) || r[0] === f).slice(0, 3) : [];
      const ps = f.length >= 2 ? idx.filter(([n]) => n.includes(f)).sort((a, b) => (a[0].startsWith(f) ? 0 : 1) - (b[0].startsWith(f) ? 0 : 1) || (b[1][2] ? 1 : 0) - (a[1][2] ? 1 : 0)).slice(0, 8).map((x) => x[1]) : [];
      for (const r of teams) results.appendChild(resultRow({ t: r[0] }, r[1], 'Team'));
      for (const r of ps) results.appendChild(resultRow({ p: r[0] }, r[1], r[4]));
      const typed = el('button', 'res typed'); typed.type = 'button';
      typed.appendChild(el('span', 'nm', `Add "${v}" as text`)); typed.appendChild(el('small', null, 'A text tile, no picture'));
      typed.addEventListener('click', () => add({ x: v.replace(/\s+/g, ' ').slice(0, TEXT_MAX) }));
      results.appendChild(typed);
    }
    function resultRow(x, name, meta) {
      const b = el('button', 'res'); b.type = 'button';
      b.appendChild(frame(asP(x)));
      const w = el('span', 'who'); w.appendChild(el('span', 'nm', name)); w.appendChild(el('small', null, meta || '')); b.appendChild(w);
      b.addEventListener('click', () => add(x));
      return b;
    }
    function draw() {
      tc.textContent = `${ti.value.length} / ${TITLE_MAX}`;
      ic.textContent = `${items.length} of ${MAX_ITEMS} (at least ${MIN_ITEMS})`;
      chosen.textContent = '';
      if (!items.length) chosen.appendChild(el('span', 'empty', 'No items yet.'));
      const labelled = tileLabels(items.map(asP));
      items.forEach((x, i) => {
        const p = labelled[i];
        const tl = el('button', 'tile'); tl.type = 'button'; tl.title = 'Remove ' + p.name; tl.setAttribute('aria-label', 'Remove ' + p.name);
        tl.appendChild(frame(p)); tl.appendChild(el('span', 'nm', p.label));
        tl.appendChild(el('span', 'x', 'Remove'));
        tl.addEventListener('click', () => { items.splice(i, 1); save(); draw(); });
        chosen.appendChild(tl);
      });
      go.disabled = !(ti.value.trim() && items.length >= MIN_ITEMS);
      if (!note.classList.contains('err')) note.textContent = go.disabled ? (ti.value.trim() ? `Add at least ${MIN_ITEMS} items.` : 'Give your list a title.') : 'Tap an item to take it off. Ready to rank?';
    }
    ti.addEventListener('input', () => { title = ti.value; idea = null; save(); note.classList.remove('err'); draw(); });
    // An idea fills the title, and for a data idea the items too (replacing the list).
    function applyIdea(i) {
      title = i.title.slice(0, TITLE_MAX); ti.value = title; idea = i.id;
      if (i.items || i.teams) items = [...(i.items || []).map((p) => ({ p })), ...(i.teams || []).map((t) => ({ t }))].slice(0, MAX_ITEMS);
      save(); note.classList.remove('err'); draw();
      note.textContent = i.items || i.teams ? `Filled in: ${items.length} items. Take any off or add your own, then rank them.` : 'Title filled in. Now add your items.';
      s1.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }
    loadIdeas().then((list) => {
      order = ideasToday(list); showIdeas();
      const want = new URLSearchParams(location.search).get('idea');
      const i = want && list.find((x) => x.id === want);
      if (i) applyIdea(i);
    });
    q.addEventListener('input', search);
    fetch(BASE + 'players.json', { cache: 'force-cache' }).then((r) => r.json()).then((d) => {
      DB = d; pById = new Map(DB.players.map((r) => [r[0], r])); tById = new Map(DB.teams.map((r) => [r[0], r]));
      idx = DB.players.map((r) => [fold(r[1]), r]); draw(); search();
    }).catch(() => { /* typed items still work */ });
    q.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); const first = results.querySelector('.res'); if (first) first.click(); } });
    clear.addEventListener('click', () => { items = []; title = ''; ti.value = ''; save(); draw(); });
    go.addEventListener('click', () => {
      const T = { slug: 'c:new', title: ti.value.trim().slice(0, TITLE_MAX), blurb: '', idea, items: items.map((x, i) => ({ ...asP(x), id: 'i' + i })), make: items.map((x) => (x.p ? { p: x.p } : x.t ? { t: x.t } : { x: x.x })) };
      store.set('tl-rank-c:new', null);
      rank(T); window.scrollTo(0, 0);
    });
    draw();
  }

  // ================= a custom list: its page, ranking it, its consensus =================
  async function customPage() {
    const qs = new URLSearchParams(location.search);
    const l = qs.get('l'), c = qs.get('c');
    const fail = (msg) => { app.textContent = ''; app.appendChild(el('h1', null, 'Tier list')); const m = el('div', 'msg'); m.appendChild(el('b', null, msg)); m.append('It may have been removed.'); m.appendChild(el('br')); const a = el('a', 'btn', 'All tier lists'); a.href = BASE; m.appendChild(a); app.appendChild(m); };
    let L = null, cid = c && /^[A-Za-z0-9]{8}$/.test(c) ? c : null;
    if (l && /^[A-Za-z0-9]{8}$/.test(l)) {
      try { L = await api('list/' + l); } catch (e) { return fail(e.status === 404 ? 'This list is not available.' : "This list couldn't load."); }
      const m = /^c:([A-Za-z0-9]{8})$/.exec(L.slug || '');
      if (!m) { location.replace(BASE + L.slug + '/?l=' + l); return; }
      cid = m[1];
    }
    if (!cid) return fail('This list is not available.');
    let C;
    try { C = await api('custom/' + cid); } catch (e) { return fail(e.status === 404 ? 'This list is not available.' : "This list couldn't load."); }
    const T = { slug: 'c:' + cid, title: C.title, blurb: '', items: C.items.map(PC) };
    if (L) return listView(T, L.id, L);
    if (qs.get('view') === 'consensus') return consensus(T);
    return rank(T);
  }

  // ================= the fans' consensus =================
  async function consensus(T) {
    app.textContent = '';
    app.appendChild(tabs('consensus', T.slug));
    const custom = /^c:/.test(T.slug) ? T.slug.slice(2) : null;
    app.appendChild(el('h1', null, `${T.title}: the fans' consensus`));
    const sub = el('p', 'subtitle'); app.appendChild(sub);
    let C;
    try { C = await api('consensus/' + T.slug); } catch (e) {
      sub.textContent = T.blurb;
      const m = el('div', 'msg'); m.appendChild(el('b', null, "The consensus couldn't load.")); m.append('Refresh to try again.'); app.appendChild(m); return;
    }
    if (!C.ready) {
      sub.textContent = T.blurb;
      const m = el('div', 'msg');
      m.appendChild(el('b', null, 'Not enough lists yet'));
      m.append(`${C.lists} of ${C.need || NEED} lists so far. The fans' consensus appears once ${C.need || NEED} people have ${custom ? 'ranked this list' : 'published theirs'}.`);
      m.appendChild(el('br'));
      const a = el('a', 'btn', custom ? 'Rank this list yourself' : 'Make your list'); a.href = custom ? BASE + 'list/?c=' + custom : BASE + T.slug + '/'; m.appendChild(a);
      app.appendChild(m); return;
    }
    sub.textContent = `The average of ${C.lists.toLocaleString('en-US')} published lists on one scale, whatever their tiers: a list's top tier scores 100, its bottom tier 0, the rest evenly between, and each player is averaged over the lists that ranked him. S from 87.5, A from 62.5, B from 37.5, C from 12.5. ${T.blurb || ''}`;
    // The written intro (built by the server from the votes; the page's HTML carries it too).
    if (C.intro) app.insertBefore(el('p', 'intro', C.intro), sub);
    const pl = new Map((T.items || T.players.map(P)).map((p) => [p.id, p]));
    const byId = new Map(tileLabels(C.players.filter((x) => pl.has(x.id)).map((x) => ({ ...pl.get(x.id) }))).map((p) => [p.id, p]));
    const { b, zones } = board();
    for (const t of TIERS) {
      const ps = C.players.filter((x) => x.tier === t && byId.has(x.id));
      if (!ps.length) zones[t].appendChild(el('span', 'empty', 'Nobody'));
      for (const x of ps) zones[t].appendChild(tile(byId.get(x.id), { link: true, avg: x.avg }));
    }
    app.appendChild(b);
    const sec = el('section', 'section');
    const h = el('div', 'section-head'); h.appendChild(el('h2', null, 'Every player')); h.appendChild(el('span', 'count', 'score · % in a top tier')); sec.appendChild(h);
    const rows = el('div', 'rows');
    C.players.forEach((x, i) => {
      const p = byId.get(x.id); if (!p) return;
      const r = el('div', 'row');
      r.appendChild(el('span', 'rk', String(i + 1)));
      r.appendChild(frame(p));
      const nm = el('span', 'nm'); const chip = el('span', 'chip', x.tier); chip.style.background = TIER_HEX[x.tier]; nm.appendChild(chip);
      const a = el(p.link ? 'a' : 'span', p.link ? null : 'tx', splitName(p.name).filter(Boolean).join(' ')); if (p.link) a.href = p.link; nm.appendChild(a); if (p.team) nm.appendChild(el('small', null, p.team)); r.appendChild(nm);
      const v = el('span', 'v', String(Math.round(x.avg))); v.appendChild(el('small', null, Math.round(x.s * 100) + '% top')); r.appendChild(v);
      rows.appendChild(r);
    });
    sec.appendChild(rows); app.appendChild(sec);
    const tools = el('div', 'tools');
    const a1 = el('a', 'btn', custom ? 'Rank this list yourself' : 'Make your list'); a1.href = custom ? BASE + 'list/?c=' + custom : BASE + T.slug + '/';
    tools.appendChild(a1); app.appendChild(tools);
  }

  // ================= start =================
  (async () => {
    try {
      if (page === 'home') return await home();
      if (page === 'make') return await make();
      if (page === 'custom') return await customPage();
      await loadTemplates();
      const T = templateOf(slug);
      if (!T) return;
      if (page === 'consensus') return await consensus(T);
      const l = new URLSearchParams(location.search).get('l');
      if (l && /^[A-Za-z0-9]{8}$/.test(l)) return await listView(T, l);
      rank(T);
    } catch (e) {
      const m = el('div', 'msg'); m.appendChild(el('b', null, "This page couldn't load.")); m.append('Refresh to try again.'); app.appendChild(m);
    }
  })();
})();
