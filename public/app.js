// NBA Tier Lists (hoopsmatic.com/tier-lists/). One script for every page:
//   /tier-lists/                       the template list
//   /tier-lists/<slug>/                rank the template's players (S to D)
//   /tier-lists/<slug>/?l=<id>         one published list, with the share block
//   /tier-lists/<slug>/consensus/      the fans' consensus (25+ lists)
// The API is the tier-lists server (hoopsmatic-worker/tier-lists-server),
// /tier-lists/api/*. Templates come from templates.json (scripts/build-templates.mjs).
(() => {
  'use strict';
  const BASE = '/tier-lists/';
  const API = BASE + 'api/';
  const SITE = 'https://hoopsmatic.com' + BASE;
  const NBA = 'https://cdn.nba.com/headshots/nba/latest/260x190/';
  const TIERS = ['S', 'A', 'B', 'C', 'D'];
  const TIER_HEX = { S: '#d12c2c', A: '#e07a10', B: '#c29a00', C: '#1d8a40', D: '#3b82f6' };
  const NEED = 25;   // lists before a consensus is shown (the server says the same)
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
  const P = (row) => ({ id: row[0], name: row[1], nba: row[2], link: row[3], team: row[4] });
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
    const parts = String(full).split(' ');
    let i = parts.length - 1;
    if (i > 0 && SUFFIX.test(parts[i])) i--;
    return [parts.slice(0, i).join(' '), parts.slice(i).join(' ')];
  }
  const lastName = (full) => splitName(full)[1];
  // The frame: NBA.com's cutout bottom-aligned on light grey; with no real
  // photo (or one that fails to load) the name sits inside instead.
  function frame(p) {
    const box = el('span', 'ph');
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
    const t = el(opts.link ? 'a' : 'button', 'tile');
    if (opts.link) { t.href = p.link; t.title = p.name + (p.team ? ', ' + p.team : ''); }
    else { t.type = 'button'; t.dataset.id = p.id; t.setAttribute('aria-label', p.name + (p.team ? ', ' + p.team : '')); }
    t.appendChild(frame(p));
    t.appendChild(el('span', 'nm', lastName(p.name)));
    if (opts.avg != null) t.appendChild(el('span', 'avg', opts.avg.toFixed(2)));
    return t;
  }
  function tabs(active, s) {
    const nav = el('nav', 'tabs'); nav.setAttribute('aria-label', 'Tier list views');
    const add = (key, text, href) => { const a = el('a', key === active ? 'on' : '', text); a.href = href; nav.appendChild(a); };
    add('rank', 'Your list', BASE + s + '/');
    add('consensus', "Fans' consensus", BASE + s + '/consensus/');
    add('all', 'All tier lists', BASE);
    return nav;
  }
  function board(cls) {
    const b = el('div', 'board' + (cls ? ' ' + cls : ''));
    const zones = {};
    for (const t of TIERS) {
      const row = el('div', 'tier'); row.dataset.tier = t;
      const l = el('div', 'lbl', t); l.style.background = TIER_HEX[t];
      const d = el('div', 'drop'); d.dataset.tier = t;
      row.append(l, d); b.appendChild(row); zones[t] = d;
    }
    return { b, zones };
  }
  const fmtDate = (ms) => new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  // ================= the template list =================
  async function home() {
    await loadTemplates();
    app.textContent = '';
    app.appendChild(el('h1', null, 'NBA Tier Lists'));
    app.appendChild(el('p', 'subtitle', 'Rank NBA players in S, A, B, C and D tiers, publish your list and see where the fans land.'));
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
  function rank(T) {
    const players = T.players.map(P);
    const byId = new Map(players.map((p) => [p.id, p]));
    const KEY = 'tl-rank-' + T.slug;
    const saved = store.get(KEY) || {};
    let place = {};
    for (const [id, t] of Object.entries(saved.place || {})) if (byId.has(id) && TIERS.includes(t)) place[id] = t;
    let sel = null;

    app.textContent = '';
    app.appendChild(tabs('rank', T.slug));
    app.appendChild(el('h1', null, T.title));
    const sub = el('p', 'subtitle', T.blurb + ' ');
    sub.appendChild(el('span', null, matchMedia('(pointer: coarse)').matches ? 'Tap a player, then tap a tier.' : 'Drag players into tiers, or click a player and then a tier.'));
    app.appendChild(sub);
    const { b, zones } = board('edit'); app.appendChild(b);
    const selbar = el('div', 'selbar hide'); selbar.setAttribute('aria-live', 'polite'); app.appendChild(selbar);
    const sec = el('section', 'section');
    const head = el('div', 'section-head'); head.appendChild(el('h2', null, 'Players'));
    const count = el('span', 'count'); head.appendChild(count); sec.appendChild(head);
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
    const cons = el('a', null, "See the fans' consensus"); cons.href = BASE + T.slug + '/consensus/'; cons.style.fontSize = '.8rem';
    tools.append(reset, cons); app.appendChild(tools);

    const save = () => store.set(KEY, { place });
    function render() {
      for (const t of TIERS) {
        const z = zones[t]; z.textContent = '';
        for (const p of players) if (place[p.id] === t) z.appendChild(tile(p));
      }
      pool.textContent = '';
      for (const p of players) if (!place[p.id]) pool.appendChild(tile(p));
      const left = players.filter((p) => !place[p.id]).length;
      if (!left) pool.appendChild(el('span', 'done', 'Every player is ranked.'));
      count.textContent = `${players.length - left} of ${players.length} ranked`;
      pub.disabled = left > 0;
      if (!note.classList.contains('err')) note.textContent = left ? 'Place every player to publish. Your list gets its own link and a share image.' : 'Ready. Your list gets its own link and a share image.';
      for (const x of app.querySelectorAll('.tile')) x.classList.toggle('sel', x.dataset.id === sel);
      b.classList.toggle('armed', !!sel);
      selbar.classList.toggle('hide', !sel); selbar.textContent = '';
      const p = sel && byId.get(sel);
      if (p) {
        selbar.appendChild(frame(p));
        const w = el('div', 'who');
        const a = el('a', null, p.name); a.href = p.link; w.appendChild(a);
        w.appendChild(el('small', null, p.team));
        selbar.appendChild(w);
        const act = el('div', 'act');
        act.appendChild(el('span', 'hint', 'Tap a tier'));
        if (place[p.id]) { const back = el('button', 'linkbtn', 'Back to players'); back.type = 'button'; back.addEventListener('click', () => move(p.id, '')); act.appendChild(back); }
        selbar.appendChild(act);
      }
    }
    function move(id, t) {
      if (t) place[id] = t; else delete place[id];
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
    // Keyboard: with a player selected, S/A/B/C/D place him, 0 or Backspace sends him back.
    document.addEventListener('keydown', (e) => {
      if (!sel || e.target === name) return;
      const k = e.key.toUpperCase();
      if (TIERS.includes(k)) { e.preventDefault(); const id = sel; move(id, k); app.querySelector(`.tile[data-id="${id}"]`)?.focus(); }
      else if (k === '0' || e.key === 'Backspace') { e.preventDefault(); move(sel, ''); }
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
      if (players.some((p) => !place[p.id])) return;
      const tiers = Object.fromEntries(TIERS.map((t) => [t, players.filter((p) => place[p.id] === t).map((p) => p.id)]));
      pub.disabled = true; note.classList.remove('err'); note.textContent = 'Publishing...';
      try {
        const r = await api('publish', { device: device(), slug: T.slug, name: name.value.trim() || null, tiers });
        store.set('tl-name', name.value.trim());
        // Lists published from this browser: their page says "your list".
        store.set('tl-mine', [...(store.get('tl-mine') || []), r.id].slice(-50));
        location.href = BASE + T.slug + '/?l=' + encodeURIComponent(r.id);
      } catch (x) {
        const m = { bad_name: "That name can't be used. Try another, or leave it blank.", too_many: 'Too many lists from here today. Try again tomorrow.', bad_tiers: 'Something is off with this list. Reload the page and try again.' };
        note.classList.add('err'); note.textContent = m[x.message] || "Couldn't publish right now. Try again in a minute.";
        pub.disabled = false;
      }
    });
    render();
  }

  // ================= one published list =================
  async function listView(T, id) {
    app.textContent = '';
    app.appendChild(tabs('', T.slug));
    let L;
    try { L = await api('list/' + encodeURIComponent(id)); } catch (e) {
      app.appendChild(el('h1', null, T.title));
      const m = el('div', 'msg'); m.appendChild(el('b', null, e.status === 404 ? 'This list is not available.' : "This list couldn't load."));
      m.append(e.status === 404 ? 'It may have been removed.' : 'Refresh to try again.');
      const a = el('a', 'btn', 'Make your own list'); a.href = BASE + T.slug + '/'; m.appendChild(el('br')); m.appendChild(a);
      app.appendChild(m); return;
    }
    const byId = new Map(T.players.map((r) => [r[0], P(r)]));
    app.appendChild(el('h1', null, T.title));
    const sub = el('p', 'subtitle');
    sub.appendChild(el('b', null, L.name ? `${L.name}'s list` : "A fan's list"));
    sub.append(` · ${fmtDate(L.created)}`);
    app.appendChild(sub);
    const { b, zones } = board();
    for (const t of TIERS) {
      const ids = (L.tiers[t] || []).filter((x) => byId.has(x));
      if (!ids.length) zones[t].appendChild(el('span', 'empty', 'Nobody'));
      for (const x of ids) zones[t].appendChild(tile(byId.get(x), { link: true }));
    }
    app.appendChild(b);
    const mine = store.get('tl-mine') || [];
    const own = mine.includes(L.id);
    const sec = el('section', 'section');
    const sh = el('div', 'section-head'); sh.appendChild(el('h2', null, own ? 'Share your list' : 'Share this list')); sec.appendChild(sh);
    sec.appendChild(shareBlock(T, L, byId)); app.appendChild(sec);
    const tools = el('div', 'tools');
    const a1 = el('a', 'btn', own ? 'Edit and republish' : 'Make your own list'); a1.href = BASE + T.slug + '/';
    const a2 = el('a', null, "See the fans' consensus"); a2.href = BASE + T.slug + '/consensus/'; a2.style.fontSize = '.85rem';
    tools.append(a1, a2); app.appendChild(tools);
  }

  // ---------- the share image (1080x1080) ----------
  // Headshots come through the tier-lists server (/tier-lists/api/head/<id>),
  // same origin, so the canvas can be saved (NBA.com sends no CORS headers).
  function loadImg(src) {
    return new Promise((res) => {
      const i = new Image(); let done = false;
      const fin = (v) => { if (!done) { done = true; res(v); } };
      i.onload = () => fin(i); i.onerror = () => fin(null); setTimeout(() => fin(null), 8000);
      i.src = src;
    });
  }
  function fitText(g, text, max, size, weight, family) {
    let s = size;
    do { g.font = `${weight} ${s}px ${family}`; if (g.measureText(text).width <= max) break; s -= 1; } while (s > 8);
    return s;
  }
  function wrapLines(g, text, max) {
    const words = String(text).split(' '); const lines = []; let line = '';
    for (const w of words) { const t = line ? line + ' ' + w : w; if (g.measureText(t).width > max && line) { lines.push(line); line = w; } else line = t; }
    if (line) lines.push(line);
    return lines;
  }
  async function shareCanvas(T, L, byId) {
    const W = 1080, H = 1080, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const g = cv.getContext('2d');
    try { await Promise.all([document.fonts.load('700 40px "DM Sans"'), document.fonts.load('500 20px "DM Sans"'), document.fonts.load('700 20px "JetBrains Mono"')]); } catch (e) { /* system font */ }
    const F = '"DM Sans", -apple-system, sans-serif', M = '"JetBrains Mono", monospace';
    g.fillStyle = '#f5f5f7'; g.fillRect(0, 0, W, H);
    // Header: the title (up to two lines) and the byline.
    const X = 48;
    g.fillStyle = '#1d1d1f'; g.textBaseline = 'alphabetic';
    let ts = 50; g.font = `700 ${ts}px ${F}`;
    let lines = wrapLines(g, T.title, W - 2 * X);
    while (lines.length > 2 && ts > 30) { ts -= 2; g.font = `700 ${ts}px ${F}`; lines = wrapLines(g, T.title, W - 2 * X); }
    let y = 40 + ts;
    for (const l of lines.slice(0, 2)) { g.fillText(l, X, y); y += ts * 1.12; }
    g.fillStyle = '#6e6e73'; g.font = `500 26px ${F}`;
    g.fillText(L.name ? `${L.name}'s tier list` : 'A fan’s tier list', X, y + 4);
    const top = y + 30, bottom = H - 92;
    // Tiles: one size for every tier, the largest that fits all rows.
    const ids = Object.fromEntries(TIERS.map((t) => [t, (L.tiers[t] || []).filter((x) => byId.has(x))]));
    const LBL = 84, GAP = 8, PAD = 10, availW = W - 2 * X - LBL - 2 * PAD;
    let tw = 150, layout;
    for (; tw >= 44; tw -= 2) {
      const th = Math.round(tw * 190 / 260) + Math.round(tw * 0.2);
      const cols = Math.max(1, Math.floor((availW + GAP) / (tw + GAP)));
      const rows = TIERS.map((t) => Math.max(1, Math.ceil(ids[t].length / cols)));
      const need = rows.reduce((a, r) => a + r * (th + GAP) - GAP + 2 * PAD, 0) + 4 * 6;
      if (need <= bottom - top) { layout = { th, cols, rows, need }; break; }
    }
    if (!layout) layout = { th: 44, cols: Math.floor((availW + GAP) / (44 + GAP)), rows: TIERS.map(() => 1), need: bottom - top };
    const extra = (bottom - top - layout.need) / 5;   // spread spare height over the tiers
    const all = TIERS.flatMap((t) => ids[t]);
    const imgs = new Map(await Promise.all(all.map(async (id) => { const p = byId.get(id); return [id, p.nba ? await loadImg(API + 'head/' + p.nba) : null]; })));
    const photoH = Math.round(tw * 190 / 260);
    let ty = top;
    TIERS.forEach((t, i) => {
      const bandH = layout.rows[i] * (layout.th + GAP) - GAP + 2 * PAD + extra;
      g.fillStyle = '#ffffff'; roundRect(g, X, ty, W - 2 * X, bandH, 14); g.fill();
      g.fillStyle = TIER_HEX[t]; roundRect(g, X, ty, LBL, bandH, [14, 0, 0, 14]); g.fill();
      g.fillStyle = '#fff'; g.font = `700 44px ${M}`; g.textAlign = 'center'; g.fillText(t, X + LBL / 2, ty + bandH / 2 + 15); g.textAlign = 'left';
      ids[t].forEach((id, k) => {
        const p = byId.get(id), c = k % layout.cols, r = Math.floor(k / layout.cols);
        const x = X + LBL + PAD + c * (tw + GAP), yy = ty + PAD + r * (layout.th + GAP);
        const im = imgs.get(id);
        g.fillStyle = '#e6e6ea'; roundRect(g, x, yy, tw, im ? photoH : layout.th, 8); g.fill();
        const [fn, ln] = splitName(p.name);
        if (im) {
          g.save(); roundRect(g, x, yy, tw, photoH, 8); g.clip();
          const s = Math.min(tw / im.naturalWidth, photoH / im.naturalHeight), w = im.naturalWidth * s, h = im.naturalHeight * s;
          g.drawImage(im, x + (tw - w) / 2, yy + photoH - h, w, h); g.restore();
          g.fillStyle = '#1d1d1f'; g.textAlign = 'center';
          const fs = fitText(g, ln, tw, Math.max(10, Math.round(tw * 0.15)), 600, F);
          g.font = `600 ${fs}px ${F}`; g.fillText(ln, x + tw / 2, yy + photoH + fs + 2); g.textAlign = 'left';
        } else {
          // Name-only tile: the name inside the frame, the same size as a photo tile.
          g.textAlign = 'center';
          const ls = fitText(g, ln, tw - 8, Math.max(10, Math.round(tw * 0.16)), 700, F);
          const fs = Math.max(9, Math.round(ls * 0.75));
          g.fillStyle = '#6e6e73'; g.font = `500 ${fs}px ${F}`; if (fn) g.fillText(fitStr(g, fn, tw - 8), x + tw / 2, yy + layout.th / 2 - 2);
          g.fillStyle = '#1d1d1f'; g.font = `700 ${ls}px ${F}`; g.fillText(ln, x + tw / 2, yy + layout.th / 2 + ls - (fn ? 0 : ls / 2));
          g.textAlign = 'left';
        }
      });
      ty += bandH + 6;
    });
    // Footer: HoopsMatic branding.
    g.fillStyle = '#1d1d1f'; g.font = `800 34px ${F}`;
    g.fillText('Hoops', X, H - 40); const hw = g.measureText('Hoops').width;
    g.fillStyle = '#3b82f6'; g.fillText('Matic', X + hw, H - 40);
    g.fillStyle = '#6e6e73'; g.font = `500 24px ${F}`; g.textAlign = 'right';
    g.fillText('hoopsmatic.com/tier-lists', W - X, H - 42); g.textAlign = 'left';
    return cv;
  }
  function fitStr(g, s, max) { if (g.measureText(s).width <= max) return s; while (s.length > 1 && g.measureText(s + '.').width > max) s = s.slice(0, -1); return s + '.'; }
  function roundRect(g, x, y, w, h, r) { g.beginPath(); if (g.roundRect) g.roundRect(x, y, w, h, r); else g.rect(x, y, w, h); }

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
  function shareBlock(T, L, byId) {
    const url = SITE + T.slug + '/?l=' + L.id;
    const text = `${L.name ? L.name + "'s" : 'My'} ${T.title} tier list on HoopsMatic`;
    const box = el('div', 'share-box');
    const img = el('img', 'share-img'); img.alt = `${T.title} tier list: the S to D tiers with headshots`; box.appendChild(img);
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
    const btns = el('div', 'share-btns');
    const dl = el('button', 'btn', 'Download'); dl.type = 'button';
    const cimg = el('button', 'btn ghost', 'Copy image'); cimg.type = 'button';
    btns.append(dl, cimg); box.appendChild(btns);
    const msg = el('div', 'share-msg'); msg.setAttribute('aria-live', 'polite'); box.appendChild(msg);
    let blob = null;
    shareCanvas(T, L, byId).then((cv) => {
      try { img.src = cv.toDataURL('image/png'); cv.toBlob((b) => { blob = b; }, 'image/png'); } catch (e) { img.classList.add('hide'); }
    });
    if (!(navigator.clipboard && window.ClipboardItem)) cimg.classList.add('hide');
    inp.addEventListener('click', () => inp.select());
    copy.addEventListener('click', async () => { try { await navigator.clipboard.writeText(text + '\n' + url); msg.textContent = 'Text + link copied.'; } catch (e) { msg.textContent = 'Copy blocked here.'; } });
    dl.addEventListener('click', () => { if (!img.src) return; const a = document.createElement('a'); a.href = img.src; a.download = T.slug + '-tier-list.png'; document.body.appendChild(a); a.click(); a.remove(); msg.textContent = 'Saved to your downloads.'; });
    cimg.addEventListener('click', async () => { try { await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]); msg.textContent = 'Image copied.'; } catch (e) { msg.textContent = 'Copy blocked here. Use Download.'; } });
    return box;
  }

  // ================= the fans' consensus =================
  async function consensus(T) {
    app.textContent = '';
    app.appendChild(tabs('consensus', T.slug));
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
      m.append(`${C.lists} of ${C.need || NEED} lists so far. The fans' consensus appears once ${C.need || NEED} people have published theirs.`);
      m.appendChild(el('br'));
      const a = el('a', 'btn', 'Make your list'); a.href = BASE + T.slug + '/'; m.appendChild(a);
      app.appendChild(m); return;
    }
    sub.textContent = `The average of ${C.lists.toLocaleString('en-US')} published lists: S = 5 points, A = 4, B = 3, C = 2, D = 1. ${T.blurb}`;
    const byId = new Map(T.players.map((r) => [r[0], P(r)]));
    const { b, zones } = board();
    for (const t of TIERS) {
      const ps = C.players.filter((x) => x.tier === t && byId.has(x.id));
      if (!ps.length) zones[t].appendChild(el('span', 'empty', 'Nobody'));
      for (const x of ps) zones[t].appendChild(tile(byId.get(x.id), { link: true, avg: x.avg }));
    }
    app.appendChild(b);
    const sec = el('section', 'section');
    const h = el('div', 'section-head'); h.appendChild(el('h2', null, 'Every player')); h.appendChild(el('span', 'count', 'avg · % in S')); sec.appendChild(h);
    const rows = el('div', 'rows');
    C.players.forEach((x, i) => {
      const p = byId.get(x.id); if (!p) return;
      const r = el('div', 'row');
      r.appendChild(el('span', 'rk', String(i + 1)));
      r.appendChild(frame(p));
      const nm = el('span', 'nm'); const chip = el('span', 'chip', x.tier); chip.style.background = TIER_HEX[x.tier]; nm.appendChild(chip);
      const a = el('a', null, p.name); a.href = p.link; nm.appendChild(a); nm.appendChild(el('small', null, p.team)); r.appendChild(nm);
      const v = el('span', 'v', x.avg.toFixed(2)); v.appendChild(el('small', null, Math.round(x.s * 100) + '% S')); r.appendChild(v);
      rows.appendChild(r);
    });
    sec.appendChild(rows); app.appendChild(sec);
    const tools = el('div', 'tools');
    const a1 = el('a', 'btn', 'Make your list'); a1.href = BASE + T.slug + '/';
    tools.appendChild(a1); app.appendChild(tools);
  }

  // ================= start =================
  (async () => {
    try {
      if (page === 'home') return await home();
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
