// The launch templates and their player pools.
//
//   node scripts/pull-data.mjs          pinned sources -> .cache/sources/ (Deep Cut's lock)
//   node scripts/build-templates.mjs    -> public/templates.json (+ data/*.json caches)
//
// Pools are ranked from the data (windowScore below), then rules/edits.json
// adds and removes players by hand (one reason each; Jorge approves them).
// Readers see each pool in alphabetical order (by last name), so the order
// never hints at a ranking.
//
// HEADSHOTS (Jorge, Nov 13, 2026): NBA.com head-to-shoulders cutouts
// (cdn.nba.com/headshots/nba/latest/260x190/<id>.png), bottom-aligned on light
// grey, Puzzle Maker's frame. NBA person ids come from NBA Head to Head's
// data/search.json ([id, name, slug, firstSeasonStart, lastSeasonStart, ...]),
// matched by name and first season (namesakes). NBA.com answers an id it has
// no photo for with a grey silhouette (same md5 every time): those players get
// a name-only tile. Both lookups are cached in data/nba-ids.json and
// data/head-check.json (committed), so a rebuild only asks about new players.
//
// Team under each name: the era name for the template's window (or franchise),
// from rules/franchises.json (Minneapolis Lakers, Seattle SuperSonics...).
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { buildPlayers, unitName } from './lib/players.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const src = (id) => JSON.parse(readFileSync(`${ROOT}.cache/sources/${id}.json`, 'utf8'));
const readJson = (f, d) => (existsSync(ROOT + f) ? JSON.parse(readFileSync(ROOT + f, 'utf8')) : d);
const { players } = buildPlayers();
const NOW = 2027;                       // 2026-27 season (seasons stored by ending year)
const rows = (j) => (Array.isArray(j) ? j : Object.values(j));
const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/ \(\d{4}\)$/, '').replace(/[^a-z0-9]+/g, ' ').trim();
const byId = new Map(players.map((p) => [p.id, p]));

// Position and birthday from bio.json, joined by name (namesakes: by draft year).
const bio = new Map();
for (const b of rows(src('bio'))) { const k = norm(b.PLAYER); (bio.get(k) || bio.set(k, []).get(k)).push(b); }
const bioOf = (p) => { const c = bio.get(norm(p.name)) || []; return c.find((b) => +b.DRAFT === p.draftYear) || c[0] || {}; };
// Awards with years, by name + award.
const AW = new Map();
for (const a of rows(src('awards'))) { const k = norm(a['PLAYER / COACH'] || '') + '|' + a.AWARD; (AW.get(k) || AW.set(k, []).get(k)).push(+a.YEAR); }
const awYears = (p, award) => AW.get(norm(p.name) + '|' + award) || [];
for (const p of players) {
  const b = bioOf(p);
  p.pos = b.POS || '';
  p.born = b.BIRTHDAY ? new Date(b.BIRTHDAY) : null;
  p.mvp = awYears(p, 'Most Valuable Player'); p.fmvp = awYears(p, 'Finals MVP');
  p.dpoy = awYears(p, 'Defensive Player of the Year');
}
const isG = (p) => /G/.test(p.pos), isC = (p) => /C/.test(p.pos), isF = (p) => /F/.test(p.pos);
const inW = (y, w) => y >= w[0] && y <= w[1];
const cnt = (arr, w, f = () => true) => arr.filter((x) => inW(x.y ?? x, w) && f(x)).length;

// How much a player mattered in seasons w = [first, last] (ending years),
// optionally only with one franchise code: the crossword's fame weights,
// restricted to the window.
function windowScore(p, w, code = null) {
  const onTeam = (x) => !code || (x.units || [x.unit]).some((u) => u && u.startsWith(code + '|'));
  const ss = p.seasons.filter((s) => inW(s.y, w) && (!code || s.code === code));
  const teamYears = new Set(ss.map((s) => s.y));
  const yr = (ys) => ys.filter((y) => inW(y, w) && (!code || teamYears.has(y))).length;
  return 3 * cnt(p.allStar, w, onTeam) + 3 * cnt(p.allNba, w, onTeam) + 1.5 * cnt(p.allDefense, w, onTeam)
    + 2 * cnt(p.rings, w, onTeam) + 10 * yr(p.mvp) + 6 * yr(p.fmvp) + 3 * yr(p.dpoy)
    + ss.reduce((a, s) => a + (s.min || 0), 0) / 1500;
}
const per = (p, y, k) => { const s = p.seasons.filter((x) => x.y === y); const g = s.reduce((a, x) => a + x.gp, 0); return g ? s.reduce((a, x) => a + (x[k] || 0), 0) / g : 0; };
const gpIn = (p, y) => p.seasons.filter((x) => x.y === y).reduce((a, x) => a + x.gp, 0);
const careerPer = (p, k) => p.seasons.reduce((a, s) => a + (s[k] || 0), 0) / Math.max(1, p.gp);
const age = (p, y) => (p.born ? (new Date(y, 1, 1) - p.born) / 31557600000 : 99);   // age on Feb 1 of the season
function teamLabel(p, w, code) {
  const ss = p.seasons.filter((s) => inW(s.y, w) && (!code || s.code === code));
  const m = new Map(); for (const s of ss) m.set(s.unit, (m.get(s.unit) || 0) + s.gp);
  const top = [...m].sort((a, b) => b[1] - a[1])[0];
  return top ? unitName(top[0]) : '';
}
const isPG = (p) => isG(p) && !/F/.test(p.pos) && careerPer(p, 'ast') >= 5.5;   // guard (not G-F), 5.5+ career assists
const ALL = [1947, NOW];

const T = [];
// blurb: the one line under the title (what the pool is; no ranking hints).
const add = (slug, title, group, n, pick, w, blurb, code = null) => T.push({ slug, title, group, n, pick, w, blurb, code });
add('2026-27-mvp-race', '2026-27 MVP race', 'This season', 20, (p) => gpIn(p, NOW) >= 5 ? 2 * (per(p, NOW, 'pts') + per(p, NOW, 'reb') + per(p, NOW, 'ast')) + windowScore(p, [2025, 2026]) * 1.5 : -1, [NOW, NOW], 'The 2026-27 season so far. Teams as of this season.');
add('2026-27-rookie-of-the-year-race', '2026-27 Rookie of the Year race', 'This season', 20, (p) => p.firstYear === NOW && gpIn(p, NOW) >= 3 ? per(p, NOW, 'pts') + per(p, NOW, 'reb') + per(p, NOW, 'ast') + (p.pick && p.pick <= 10 ? 4 : 0) : -1, [NOW, NOW], 'First-year players in 2026-27.');
add('best-players-right-now', 'Best players in the NBA right now', 'This season', 30, (p) => gpIn(p, NOW) >= 3 || p.lastYear >= 2026 ? windowScore(p, [2024, 2026]) + (gpIn(p, NOW) ? per(p, NOW, 'pts') / 2 : 0) : -1, [2025, NOW], 'Active players, 2026-27.');
add('best-young-players', 'Best players 23 and under', 'This season', 24, (p) => gpIn(p, NOW) >= 3 && age(p, NOW) < 24 ? windowScore(p, [2025, 2026]) + per(p, NOW, 'pts') + per(p, NOW, 'reb') / 2 + per(p, NOW, 'ast') / 2 + (p.pick && p.pick <= 3 ? 3 : 0) : -1, [NOW, NOW], 'Players 23 or younger on Feb. 1, 2027.');
const dec = (d) => [d + 1, d + 10];   // "2010s" = 2010-11 through 2019-20
add('best-players-of-the-1980s', 'Best players of the 1980s', 'By decade', 25, (p) => windowScore(p, dec(1980)), dec(1980), 'Seasons 1980-81 to 1989-90. Teams as they were then.');
add('best-players-of-the-1990s', 'Best players of the 1990s', 'By decade', 25, (p) => windowScore(p, dec(1990)), dec(1990), 'Seasons 1990-91 to 1999-2000. Teams as they were then.');
add('best-players-of-the-2000s', 'Best players of the 2000s', 'By decade', 25, (p) => windowScore(p, dec(2000)), dec(2000), 'Seasons 2000-01 to 2009-10. Teams as they were then.');
add('best-point-guards-of-the-2010s', 'Best point guards of the 2010s', 'By decade', 24, (p) => isPG(p) ? windowScore(p, dec(2010)) : -1, dec(2010), 'Seasons 2010-11 to 2019-20. Teams as they were then.');
add('best-centers-of-the-1990s', 'Best centers of the 1990s', 'By decade', 20, (p) => isC(p) ? windowScore(p, dec(1990)) : -1, dec(1990), 'Seasons 1990-91 to 1999-2000. Teams as they were then.');
add('best-forwards-of-the-2000s', 'Best forwards of the 2000s', 'By decade', 24, (p) => isF(p) ? windowScore(p, dec(2000)) : -1, dec(2000), 'Seasons 2000-01 to 2009-10. Teams as they were then.');
add('best-point-guards-of-all-time', 'Best point guards of all time', 'All-time', 25, (p) => isPG(p) ? windowScore(p, ALL) : -1, ALL, 'Whole careers. Each player under the team he played the most games for.');
add('best-centers-of-all-time', 'Best centers of all time', 'All-time', 25, (p) => isC(p) ? windowScore(p, ALL) : -1, ALL, 'Whole careers. Each player under the team he played the most games for.');
add('best-three-point-shooters-of-all-time', 'Best three-point shooters of all time', 'All-time', 24, (p) => { const t = p.seasons.reduce((a, s) => a + (s.tpm || 0), 0); return t >= 1000 ? t : -1; }, ALL, 'Whole careers. Each player under the team he played the most games for.');
add('best-defenders-of-all-time', 'Best defenders of all time', 'All-time', 24, (p) => p.allDefense.length + p.dpoy.length >= 4 ? 2 * p.allDefense.length + 5 * p.dpoy.length : -1, ALL, 'Whole careers. Each player under the team he played the most games for.');
add('best-international-players-of-all-time', 'Best international players of all time', 'All-time', 25, (p) => p.bornIn && p.bornIn !== 'United States' ? windowScore(p, ALL) : -1, ALL, 'Players born outside the U.S. Whole careers.');
for (const [code, nick, city] of [['BOS', 'Celtics', 'Boston'], ['LAL', 'Lakers', 'Minneapolis and Los Angeles'], ['CHI', 'Bulls', 'Chicago'], ['GSW', 'Warriors', 'Philadelphia, San Francisco and Golden State'], ['NYK', 'Knicks', 'New York'], ['SAS', 'Spurs', 'San Antonio'], ['MIA', 'Heat', 'Miami'], ['DAL', 'Mavericks', 'Dallas']])
  add(`${nick.toLowerCase()}-all-time`, `${nick} all-time`, 'Franchise', 24, (p) => windowScore(p, ALL, code), ALL, `Only what each player did with the ${city} ${nick}.`, code);
add('2003-draft-class', '2003 draft class', 'Draft class', 20, (p) => p.draftYear === 2003 && p.pick ? windowScore(p, ALL) + (p.pick <= 5 ? 1 : 0) : -1, ALL, 'Whole careers. Each player under the team he played the most games for.');
add('1996-draft-class', '1996 draft class', 'Draft class', 20, (p) => p.draftYear === 1996 ? windowScore(p, ALL) : -1, ALL, 'Whole careers, drafted or undrafted. Each player under the team he played the most games for.');

// ---------- NBA person ids (NBA Head to Head search.json) ----------
const idCache = readJson('data/nba-ids.json', {});
let search = null;
async function nbaIdOf(p) {
  if (p.id in idCache) return idCache[p.id];
  if (!search) {
    search = await (await fetch('https://jsierrahoopshype.github.io/nba-head-to-head/data/search.json')).json();
    if (!Array.isArray(search) || search.length < 4000) throw new Error('head-to-head search.json looks wrong');
  }
  // Head to Head stores a season by its starting year; ours by its ending year.
  const years = (s) => Math.abs(s[3] - (p.firstYear - 1)) <= 1;
  // Even a single candidate must start within a season of ours (Jabari Smith
  // Jr. is "Jabari Smith" here; Head to Head's Jabari Smith is the 2000 one).
  const pick = (c) => c.find(years) || null;
  // 1. same name; 2. same name without spaces, dots and suffixes (B.J. / BJ,
  // Jimmy Butler III); 3. same last name and the same first and last seasons
  // (Peja / Predrag Stojakovic, Patty / Patrick Mills, Tiny / Nate Archibald).
  const compact = (n) => norm(n).replace(/ (jr|sr|ii|iii|iv)$/, '').replace(/ /g, '');
  const lastOf = (n) => norm(n).replace(/ (jr|sr|ii|iii|iv)$/, '').split(' ').pop();
  let hit = pick(search.filter((s) => norm(s[1]) === norm(p.name)))
    || pick(search.filter((s) => compact(s[1]) === compact(p.name)));
  if (!hit) {
    const c = search.filter((s) => lastOf(s[1]) === lastOf(p.name) && years(s) && Math.abs(s[4] - (p.lastYear - 1)) <= 1);
    hit = c.length === 1 ? c[0] : null;
  }
  return (idCache[p.id] = hit ? hit[0] : 0);
}
// ---------- real photo or silhouette ----------
const SILHOUETTE = new Set(['7475ba9619305909d7998dd9dba02481']);   // NBA.com's 260x190 placeholder (Nov 2026)
const heads = readJson('data/head-check.json', {});
async function checkHeads(ids) {
  const todo = [...new Set(ids.filter((id) => id && !(id in heads)))];
  for (let i = 0; i < todo.length; i += 16) {
    await Promise.all(todo.slice(i, i + 16).map(async (id) => {
      try {
        const r = await fetch(`https://cdn.nba.com/headshots/nba/latest/260x190/${id}.png`);
        if (!r.ok) { if (r.status === 404 || r.status === 403) heads[id] = 0; return; }
        heads[id] = SILHOUETTE.has(createHash('md5').update(Buffer.from(await r.arrayBuffer())).digest('hex')) ? 0 : 1;
      } catch (e) { /* network: unknown this run, asked again next build */ }
    }));
  }
}

// ---------- build ----------
const EDITS = readJson('rules/edits.json', { templates: {} }).templates;
const last = (n) => n.replace(/ (Jr\.|Sr\.|II|III|IV)$/, '').split(' ').slice(1).join(' ') || n;
const out = [], problems = [];
for (const t of T) {
  const ed = EDITS[t.slug] || {};
  const removed = new Set(Object.keys(ed.remove || {}));
  for (const id of [...removed, ...Object.keys(ed.add || {})]) if (!byId.has(id)) problems.push(`${t.slug}: unknown player id ${id} in rules/edits.json`);
  const ranked = players.map((p) => ({ p, s: t.pick(p) })).filter((x) => x.s > 0 && !removed.has(x.p.id)).sort((a, b) => b.s - a.s);
  // Hand additions take seats from the data's bottom, so a pool keeps its size.
  const adds = Object.keys(ed.add || {}).filter((id) => byId.has(id));
  const pool = ranked.filter((x) => !adds.includes(x.p.id)).slice(0, Math.max(0, t.n - adds.length)).map((x) => x.p);
  for (const id of Object.keys(ed.add || {})) { const p = byId.get(id); if (p && !pool.includes(p)) pool.push(p); }
  for (const p of pool) p.nba = await nbaIdOf(p);
  out.push({ t, pool });
}
await checkHeads(out.flatMap((o) => o.pool.map((p) => p.nba)));

let slots = 0, photo = 0;
const templates = out.map(({ t, pool }) => {
  const list = pool.map((p) => {
    const hasPhoto = p.nba && heads[p.nba] === 1;
    slots++; if (hasPhoto) photo++;
    // [id, name, NBA id with a real photo (else 0), HoopsMatic page, team label]
    return [p.id, p.name, hasPhoto ? p.nba : 0, p.link || '', teamLabel(p, t.w, t.code)];
  }).sort((a, b) => last(a[1]).localeCompare(last(b[1])) || a[1].localeCompare(b[1]));
  for (const r of list) if (!r[3]) problems.push(`${t.slug}: ${r[1]} has no HoopsMatic page`);
  return { slug: t.slug, title: t.title, group: t.group, blurb: t.blurb, players: list };
});
const sorted = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => (isNaN(a) ? a.localeCompare(b) : a - b)));
writeFileSync(ROOT + 'data/nba-ids.json', JSON.stringify(sorted(idCache)) + '\n');
writeFileSync(ROOT + 'data/head-check.json', JSON.stringify(sorted(heads)) + '\n');
writeFileSync(ROOT + 'public/templates.json', JSON.stringify({
  _about: 'Tier Lists templates (scripts/build-templates.mjs). players: [id, name, NBA.com person id with a real photo or 0, HoopsMatic page, team as it was]. The tier-lists server checks every published list against this file.',
  v: 1, tiers: ['S', 'A', 'B', 'C', 'D'], templates,
}) + '\n');
if (problems.length) { console.error(problems.join('\n')); process.exit(1); }
console.log(`templates ${templates.length}, player slots ${slots}, with a real photo ${photo} (${(100 * photo / slots).toFixed(1)}%), name-only ${slots - photo}`);
if (process.argv.includes('--list')) for (const t of templates) console.log(`\n## ${t.title} (${t.players.length})\n` + t.players.map((r) => `${r[1]}${r[2] ? '' : ' [name only]'} · ${r[4]}`).join('\n'));

// The hand edits as plain text for Jorge (docs/edits-for-approval.txt).
{
  const titleOf = new Map(T.map((t) => [t.slug, t.title]));
  const nameOf = (id) => (byId.get(id) || { name: id }).name;
  const lines = ['Tier Lists: hand edits to the data-built pools (rules/edits.json), for approval before launch.', ''];
  for (const [slug, ed] of Object.entries(EDITS)) {
    lines.push(titleOf.get(slug) || slug);
    for (const [id, why] of Object.entries(ed.add || {})) lines.push(`  + add ${nameOf(id)}: ${why}`);
    for (const [id, why] of Object.entries(ed.remove || {})) lines.push(`  - remove ${nameOf(id)}: ${why}`);
    lines.push('');
  }
  writeFileSync(ROOT + 'docs/edits-for-approval.txt', lines.join('\n'));
}
