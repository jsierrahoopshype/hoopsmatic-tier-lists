// Step 1 draft: the 25 launch templates and their player pools, built from
// the same pinned data Deep Cut uses (hoopsmatic-deep-cut data/sources.lock.json,
// downloaded by its scripts/pull-data.mjs into .cache/sources/).
//
//   node scripts/build-templates.mjs [path/to/hoopsmatic-deep-cut]
//
// Writes data/templates.json (pools with name, HoopsMatic link, headshot tag,
// era team label) and prints a coverage report. Nothing here calls the network.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const DC = (process.argv[2] || '/home/user/jsierrahoopshype/hoopsmatic-deep-cut').replace(/\/$/, '') + '/';
const { buildPlayers, unitName } = await import(DC + 'scripts/lib/players.mjs');
const src = (id) => JSON.parse(readFileSync(`${DC}.cache/sources/${id}.json`, 'utf8'));
const { players } = buildPlayers();
const NOW = 2027;                       // 2026-27 season (seasons stored by ending year)
const rows = (j) => (Array.isArray(j) ? j : Object.values(j));
const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/ \(\d{4}\)$/, '').replace(/[^a-z0-9]+/g, ' ').trim();

// Headshot tags from Deep Cut's public players.json (f: face-fill, n: NBA.com).
const head = new Map(JSON.parse(readFileSync(DC + 'public/players.json', 'utf8')).players.map((r) => [r[0], r[6] || null]));
// Position and birthday from bio.json, joined by name (namesakes: first match by draft year).
const bio = new Map();
for (const b of rows(src('bio'))) { const k = norm(b.PLAYER); (bio.get(k) || bio.set(k, []).get(k)).push(b); }
const bioOf = (p) => { const c = bio.get(norm(p.name)) || []; return c.find((b) => +b.DRAFT === p.draftYear) || c[0] || {}; };
// Awards with years (MVP, Finals MVP, DPOY, 6MOY, ROY), by name + year.
const AW = new Map();
for (const a of rows(src('awards'))) { const k = norm(a['PLAYER / COACH'] || '') + '|' + a.AWARD; (AW.get(k) || AW.set(k, []).get(k)).push(+a.YEAR); }
const awYears = (p, award) => AW.get(norm(p.name) + '|' + award) || [];

for (const p of players) {
  const b = bioOf(p);
  p.pos = b.POS || '';
  p.born = b.BIRTHDAY ? new Date(b.BIRTHDAY) : null;
  p.head = head.get(p.id) || null;
  p.mvp = awYears(p, 'Most Valuable Player'); p.fmvp = awYears(p, 'Finals MVP');
  p.dpoy = awYears(p, 'Defensive Player of the Year'); p.smoy = awYears(p, 'Sixth Man of the Year');
}
const isG = (p) => /G/.test(p.pos), isC = (p) => /C/.test(p.pos), isF = (p) => /F/.test(p.pos);
const inW = (y, w) => y >= w[0] && y <= w[1];
const cnt = (arr, w, f = () => true) => arr.filter((x) => inW(x.y ?? x, w) && f(x)).length;

// Window score: how much a player mattered in seasons w = [first, last] (ending
// years), optionally only with one franchise code. Same weights as the
// crossword's fame formula, restricted to the window.
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

// The team label shown under a name: the era name for the template's window
// (or franchise), from rules/franchises.json via unitName().
function teamLabel(p, w, code) {
  const ss = p.seasons.filter((s) => inW(s.y, w) && (!code || s.code === code));
  const m = new Map(); for (const s of ss) m.set(s.unit, (m.get(s.unit) || 0) + s.gp);
  const top = [...m].sort((a, b) => b[1] - a[1])[0];
  return top ? unitName(top[0]) : '';
}
const isPG = (p) => isG(p) && !/F/.test(p.pos) && careerPer(p, 'ast') >= 5.5;   // guard (not G-F) + 5.5+ career assists a game
const ALL = [1947, NOW];

const T = [];
const add = (slug, title, group, n, pick, w, code = null, note = '') => T.push({ slug, title, group, n, pick, w, code, note });
// Current season
add('2026-27-mvp-race', '2026-27 MVP race', 'This season', 20, (p) => gpIn(p, NOW) >= 5 ? 2 * (per(p, NOW, 'pts') + per(p, NOW, 'reb') + per(p, NOW, 'ast')) + windowScore(p, [2025, 2026]) * 1.5 : -1, [NOW, NOW], null, 'this season per-game PTS+REB+AST, plus the last two seasons\' All-NBA/All-Star/MVP weight');
add('2026-27-rookie-of-the-year-race', '2026-27 Rookie of the Year race', 'This season', 20, (p) => p.firstYear === NOW && gpIn(p, NOW) >= 3 ? per(p, NOW, 'pts') + per(p, NOW, 'reb') + per(p, NOW, 'ast') + (p.pick && p.pick <= 10 ? 4 : 0) : -1, [NOW, NOW], null, 'first-season players, per-game production + top-10 pick');
add('best-players-right-now', 'Best players in the NBA right now', 'This season', 30, (p) => gpIn(p, NOW) >= 3 || p.lastYear >= 2026 ? windowScore(p, [2024, 2026]) + (gpIn(p, NOW) ? per(p, NOW, 'pts') / 2 : 0) : -1, [2025, NOW], null, 'last three seasons\' accolades + this season scoring; must be active');
add('best-young-players', 'Best players 23 and under', 'This season', 24, (p) => gpIn(p, NOW) >= 3 && age(p, NOW) < 24 ? windowScore(p, [2025, 2026]) + per(p, NOW, 'pts') + per(p, NOW, 'reb') / 2 + per(p, NOW, 'ast') / 2 + (p.pick && p.pick <= 3 ? 3 : 0) : -1, [NOW, NOW], null, 'age under 24 on Feb 1, 2027');
// Decades ("2010s" = 2010-11 through 2019-20)
const dec = (d) => [d + 1, d + 10];
add('best-players-of-the-1980s', 'Best players of the 1980s', 'By decade', 25, (p) => windowScore(p, dec(1980)), dec(1980));
add('best-players-of-the-1990s', 'Best players of the 1990s', 'By decade', 25, (p) => windowScore(p, dec(1990)), dec(1990));
add('best-players-of-the-2000s', 'Best players of the 2000s', 'By decade', 25, (p) => windowScore(p, dec(2000)), dec(2000));
add('best-point-guards-of-the-2010s', 'Best point guards of the 2010s', 'By decade', 24, (p) => isPG(p) ? windowScore(p, dec(2010)) : -1, dec(2010), null, 'listed as a guard (not G-F) with 5.5+ career assists a game');
add('best-centers-of-the-1990s', 'Best centers of the 1990s', 'By decade', 20, (p) => isC(p) ? windowScore(p, dec(1990)) : -1, dec(1990));
add('best-forwards-of-the-2000s', 'Best forwards of the 2000s', 'By decade', 24, (p) => isF(p) ? windowScore(p, dec(2000)) : -1, dec(2000));
// All-time by position / skill
add('best-point-guards-of-all-time', 'Best point guards of all time', 'All-time', 25, (p) => isPG(p) ? windowScore(p, ALL) : -1, ALL);
add('best-centers-of-all-time', 'Best centers of all time', 'All-time', 25, (p) => isC(p) ? windowScore(p, ALL) : -1, ALL);
add('best-three-point-shooters-of-all-time', 'Best three-point shooters of all time', 'All-time', 24, (p) => { const t = p.seasons.reduce((a, s) => a + (s.tpm || 0), 0); return t >= 1000 ? t : -1; }, ALL, null, 'the 24 players with the most career threes (the data has no 3PA, so no percentages)');
add('best-defenders-of-all-time', 'Best defenders of all time', 'All-time', 24, (p) => p.allDefense.length + p.dpoy.length >= 4 ? 2 * p.allDefense.length + 5 * p.dpoy.length : -1, ALL, null, 'All-Defensive teams + DPOY awards');
add('best-international-players-of-all-time', 'Best international players of all time', 'All-time', 25, (p) => p.bornIn && p.bornIn !== 'United States' ? windowScore(p, ALL) : -1, ALL, null, 'born outside the U.S.');
// Franchises (era names: Minneapolis Lakers, Philadelphia Warriors, Fort Wayne Pistons...)
for (const [code, nick] of [['BOS', 'Celtics'], ['LAL', 'Lakers'], ['CHI', 'Bulls'], ['GSW', 'Warriors'], ['NYK', 'Knicks'], ['SAS', 'Spurs'], ['MIA', 'Heat'], ['DAL', 'Mavericks']])
  add(`${nick.toLowerCase()}-all-time`, `${nick} all-time`, 'Franchise', 24, (p) => windowScore(p, ALL, code), ALL, code, 'accolades and minutes earned with this franchise only');
// Draft classes
add('2003-draft-class', '2003 draft class', 'Draft class', 20, (p) => p.draftYear === 2003 && p.pick ? windowScore(p, ALL) + (p.pick <= 5 ? 1 : 0) : -1, ALL);
add('1996-draft-class', '1996 draft class', 'Draft class', 20, (p) => p.draftYear === 1996 ? windowScore(p, ALL) : -1, ALL);

const out = [];
for (const t of T) {
  const ranked = players.map((p) => ({ p, s: t.pick(p) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s);
  const pool = ranked.slice(0, t.n);
  const missing = pool.filter((x) => !x.p.head).map((x) => x.p.name);
  // Pool order shown to readers is alphabetical by last name: the builder's
  // ranking must not hint at an answer.
  const last = (n) => n.split(' ').slice(1).join(' ') || n;
  out.push({
    slug: t.slug, title: t.title, group: t.group, tiers: ['S', 'A', 'B', 'C', 'D'], rule: t.note,
    pool: pool.map(({ p }) => ({ id: p.id, name: p.name, link: p.link, head: p.head, team: teamLabel(p, t.w, t.code) }))
      .sort((a, b) => last(a.name).localeCompare(last(b.name))),
    missingHeads: missing,
    examples: pool.slice(0, 5).map((x) => x.p.name),
  });
}
mkdirSync(new URL('../data/', import.meta.url), { recursive: true });
writeFileSync(new URL('../data/templates.json', import.meta.url), JSON.stringify({ _about: 'Step 1 draft of the 25 launch templates (scripts/build-templates.mjs).', templates: out }, null, 1));
for (const t of out) console.log(`${t.title} | ${t.pool.length} | ${t.examples.join(', ')} | no head: ${t.missingHeads.length} ${t.missingHeads.slice(0, 6).join(', ')}`);
