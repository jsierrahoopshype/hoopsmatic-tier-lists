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
// This season's team records (the Real Standings repo, pinned in
// data/sources.lock.json as "standings"): each team's latest W-L.
const STAND = src('standings');
const REC = (() => { const d = STAND.dates[STAND.dates.length - 1]; return Object.fromEntries(STAND.order.map((c, i) => [c, STAND.snapshots[d][i]])); })();
const winPct = (code) => { const r = REC[code]; return r && r[0] + r[1] ? r[0] / (r[0] + r[1]) : 0.5; };
const teamNow = (p) => { const s = p.seasons.filter((x) => x.y === NOW); return s.length ? s[s.length - 1].code : null; };
// THREE-POINT SHOOTERS (Jorge, Nov 26, 2026): makes and accuracy together.
// Career threes made, weighted by how far the career 3P% is above the league
// average of the seasons he shot them in (each season's league 3P%, weighted
// by his attempts that season): makes x (1 + 10 x the gap). 42% where the
// league shot 36% counts each make 1.6 times; a below-average shooter's
// makes count for less.
const LG3 = new Map();
for (const p of players) for (const s of p.seasons) { const x = LG3.get(s.y) || [0, 0]; x[0] += s.tpm || 0; x[1] += s.tpa || 0; LG3.set(s.y, x); }
function threeScore(p) {
  const m = p.seasons.reduce((a, s) => a + (s.tpm || 0), 0), att = p.seasons.reduce((a, s) => a + (s.tpa || 0), 0);
  if (!m || !att) return 0;
  const exp = p.seasons.reduce((a, s) => { const l = LG3.get(s.y); return a + (s.tpa || 0) * (l && l[1] ? l[0] / l[1] : 0); }, 0) / att;
  return m * Math.max(0, 1 + 10 * (m / att - exp));
}
const threeMade = (p) => p.seasons.reduce((a, s) => a + (s.tpm || 0), 0);
const isPG = (p) => isG(p) && !/F/.test(p.pos) && careerPer(p, 'ast') >= 5.5;   // guard (not G-F), 5.5+ career assists
const ALL = [1947, NOW];

const T = [];
// blurb: the one line under the title (what the pool is; no ranking hints).
// POOL SIZE (Jorge, Nov 26, 2026): up to 100 players, where the data has
// that many (a template's own filter decides who qualifies: the rookie and
// draft-class pools stay smaller). The n each line below was built with
// (20 to 30) is kept as the floor the old pools had; every pool is the same
// for everyone who ranks it (templates.json, checked by the server).
const POOL_MAX = 100;
const add = (slug, title, group, n, pick, w, blurb, code = null) => T.push({ slug, title, group, n: POOL_MAX, pick, w, blurb, code });
// MVP race (Jorge, Nov 26, 2026): times (0.5 + his team's win percentage this
// season), so a .750 team counts 1.25 and a .250 team 0.75.
add('2026-27-mvp-race', '2026-27 MVP race', 'This season', 20, (p) => gpIn(p, NOW) >= 5 ? (2 * (per(p, NOW, 'pts') + per(p, NOW, 'reb') + per(p, NOW, 'ast')) + windowScore(p, [2025, 2026]) * 1.5) * (0.5 + winPct(teamNow(p))) : -1, [NOW, NOW], 'The 2026-27 season so far. Teams as of this season.');
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
add('best-three-point-shooters-of-all-time', 'Best three-point shooters of all time', 'All-time', 24, (p) => (threeMade(p) >= 1000 ? threeScore(p) : -1), ALL, 'Whole careers. Each player under the team he played the most games for.');
// Its order for hand additions under the 1,000-make floor (Steve Kerr) is the same score.
T[T.length - 1].rankBy = threeScore;
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
const PINS = readJson('rules/pins.json', { templates: {} }).templates;
const last = (n) => n.replace(/ (Jr\.|Sr\.|II|III|IV)$/, '').split(' ').slice(1).join(' ') || n;
const out = [], problems = [];
for (const t of T) {
  const ed = EDITS[t.slug] || {};
  const removed = new Set(Object.keys(ed.remove || {}));
  for (const id of [...removed, ...Object.keys(ed.add || {})]) if (!byId.has(id)) problems.push(`${t.slug}: unknown player id ${id} in rules/edits.json`);
  // Only players with a HoopsMatic page (every tile links to one).
  const ranked = players.map((p) => ({ p, s: t.pick(p) })).filter((x) => x.s > 0 && x.p.link && !removed.has(x.p.id)).sort((a, b) => b.s - a.s);
  // Hand additions take seats from the data's bottom, so a pool keeps its size.
  const adds = Object.keys(ed.add || {}).filter((id) => byId.has(id));
  const pool = ranked.filter((x) => !adds.includes(x.p.id)).slice(0, Math.max(0, t.n - adds.length)).map((x) => x.p);
  for (const id of Object.keys(ed.add || {})) { const p = byId.get(id); if (p && !pool.includes(p)) pool.push(p); }
  // THE POOL'S ORDER (Jorge, Nov 26, 2026), best first: the order it was
  // picked in (the template's own score), hand additions placed by that same
  // score (one the score does not see goes last). It decides which players a
  // "top 10 / 25 / 50" list ranks; readers still see the pool alphabetically.
  const by = t.rankBy || t.pick;
  const sc = new Map(pool.map((p, i) => [p, [by(p), i]]));
  pool.sort((a, b) => (sc.get(b)[0] > 0 ? sc.get(b)[0] : -1) - (sc.get(a)[0] > 0 ? sc.get(a)[0] : -1) || sc.get(a)[1] - sc.get(b)[1]);
  // PINS (Jorge, Nov 26, 2026): every approved hand addition sits inside the
  // Top 25 (the default size), so a Top 25 list always has it. One the score
  // already puts there keeps its place; one it puts lower goes to the place
  // rules/pins.json gives it (where a fan would expect him), or 25 if none.
  // rules/pins.json can also pin a player the data undersells (ABA years).
  const pins = PINS[t.slug] || {};
  const pinIds = new Set([...Object.keys(ed.add || {}), ...Object.keys(pins)]);
  // Repeated until none is below 25 (moving one up can push another down).
  for (let guard = 0; guard < 6; guard++) {
    const late = pool.filter((p, i) => pinIds.has(p.id) && i >= 25);
    if (!late.length) break;
    // Each its own slot: a pins.json place (1 to 25), else the free slots
    // from 25 upward; then placed from the top down so none moves another.
    const rest = pool.filter((p) => !late.includes(p)), slot = new Map(), taken = new Set();
    // Slots already held by pinned players above stay theirs.
    pool.forEach((p, i) => { if (pinIds.has(p.id) && i < 25 && !late.includes(p)) taken.add(i + 1); });
    for (const p of late) if (pins[p.id] >= 1 && pins[p.id] <= 25 && !taken.has(pins[p.id])) { slot.set(p, pins[p.id]); taken.add(pins[p.id]); }
    let free = 25;
    for (const p of late) if (!slot.has(p)) { while (taken.has(free)) free--; slot.set(p, free); taken.add(free); }
    for (const p of late.sort((a, b) => slot.get(a) - slot.get(b))) rest.splice(Math.min(slot.get(p), rest.length + 1) - 1, 0, p);
    pool.splice(0, pool.length, ...rest);
  }
  for (const p of pool) p.nba = await nbaIdOf(p);
  out.push({ t, pool });
}
// THE PICKER'S DATABASE (Stage 2, "Make your own list"): every player with a
// HoopsMatic page (name without the namesake year, NBA.com id with a real
// photo or 0, page, first and last season) and the 30 current teams (NBA
// code, name, roster page; logos are our own files). public/players.json;
// the tier-lists server checks every picked item against it.
const pickable = players.filter((p) => p.link && p.firstYear);
for (const p of pickable) p.nba = await nbaIdOf(p);
await checkHeads([...out.flatMap((o) => o.pool.map((p) => p.nba)), ...pickable.map((p) => p.nba)]);
const TEAMS = [['atl', 'Atlanta Hawks', 'atlanta'], ['bos', 'Boston Celtics', 'boston'], ['bkn', 'Brooklyn Nets', 'brooklyn'], ['cha', 'Charlotte Hornets', 'charlotte'],
  ['chi', 'Chicago Bulls', 'chicago'], ['cle', 'Cleveland Cavaliers', 'cleveland'], ['dal', 'Dallas Mavericks', 'dallas'], ['den', 'Denver Nuggets', 'denver'],
  ['det', 'Detroit Pistons', 'detroit'], ['gsw', 'Golden State Warriors', 'golden-state'], ['hou', 'Houston Rockets', 'houston'], ['ind', 'Indiana Pacers', 'indiana'],
  ['lac', 'LA Clippers', 'la-clippers'], ['lal', 'Los Angeles Lakers', 'la-lakers'], ['mem', 'Memphis Grizzlies', 'memphis'], ['mia', 'Miami Heat', 'miami'],
  ['mil', 'Milwaukee Bucks', 'milwaukee'], ['min', 'Minnesota Timberwolves', 'minnesota'], ['nop', 'New Orleans Pelicans', 'new-orleans'], ['nyk', 'New York Knicks', 'new-york'],
  ['okc', 'Oklahoma City Thunder', 'oklahoma-city'], ['orl', 'Orlando Magic', 'orlando'], ['phi', 'Philadelphia 76ers', 'philadelphia'], ['phx', 'Phoenix Suns', 'phoenix'],
  ['por', 'Portland Trail Blazers', 'portland'], ['sac', 'Sacramento Kings', 'sacramento'], ['sas', 'San Antonio Spurs', 'san-antonio'], ['tor', 'Toronto Raptors', 'toronto'],
  ['uta', 'Utah Jazz', 'utah'], ['was', 'Washington Wizards', 'washington']];
{
  const rows = pickable.map((p) => [p.id, p.name.replace(/\s*\(\d{4}\)$/, ''), p.nba && heads[p.nba] === 1 ? p.nba : 0, p.link, `${p.firstYear - 1}-${p.lastYear}`])
    .sort((a, b) => a[1].localeCompare(b[1]) || a[4].localeCompare(b[4]));
  writeFileSync(ROOT + 'public/players.json', JSON.stringify({
    _about: 'The picker for custom tier lists (scripts/build-templates.mjs): players [id, name, NBA.com person id with a real photo or 0, HoopsMatic page, seasons first-last] and teams [NBA code, name, HoopsMatic page]. The tier-lists server checks every picked item against this file.',
    v: 1, players: rows, teams: TEAMS.map(([a, n, s]) => [a, n, 'https://hoopsmatic.com/roster/' + s]),
  }) + '\n');
  console.log(`players.json: ${rows.length} players (${rows.filter((r) => r[2]).length} with a photo), ${TEAMS.length} teams`);
}

// LIST IDEAS for "Make your own list" (Jorge, Nov 26, 2026): public/ideas.json.
// Data ideas fill the title and the items (players from players.json, so every
// tile links to its HoopsMatic page; teams by code, linking to their roster
// page); title-only ideas leave the items to the reader. months: when an idea
// is in season (it is shown first then): NBA Cup Nov-Dec, All-Star and the
// trade deadline Feb, playoffs Apr-Jun, the draft Jun. Items in alphabetical
// order (no ranking hint). A data idea needs 3 to 100 items, like any list.
{
  const inPick = new Set(pickable.map((p) => p.id));
  const byLast = (a, b) => last(a.name).localeCompare(last(b.name)) || a.name.localeCompare(b.name);
  const ideas = [];
  const dataIdea = (id, title, ps, months = null) => {
    const items = ps.filter((p) => inPick.has(p.id)).sort(byLast).slice(0, 100).map((p) => p.id);
    if (items.length >= 3) ideas.push({ id, title, items, ...(months ? { months } : {}) });
  };
  // This season's rosters (each player under his latest team this season).
  const latestTeam = (p) => { const s = p.seasons.filter((x) => x.y === NOW); return s.length ? s[s.length - 1].code : null; };
  for (const [abbr, name] of TEAMS) dataIdea('roster-' + abbr, `Rank the ${name} roster`, players.filter((p) => latestTeam(p) === abbr.toUpperCase()));
  dataIdea('rookies', "Rank this season's rookies", players.filter((p) => p.firstYear === NOW && gpIn(p, NOW) > 0));
  // This season's All-Stars: only once they are in the data (announced).
  dataIdea('all-stars', "Rank this season's All-Stars", players.filter((p) => p.allStar.some((a) => a.y === NOW)), [1, 2]);
  // First-round draft classes from 2000 (29 picks a round until 2004, 30 since).
  for (let y = NOW - 1; y >= 2000; y--) dataIdea('draft-' + y, `Rank the ${y} draft class`, players.filter((p) => p.draftYear === y && p.pick && p.pick <= (y < 2004 ? 29 : 30)), y >= NOW - 2 ? [6] : null);
  // A team's all-time greats: the existing franchise template pools.
  // Its top 30 by the pool's own data order (the greats, not the whole bench).
  for (const o of out.filter(({ t }) => t.code)) {
    const team = (TEAMS.find(([a]) => a === o.t.code.toLowerCase()) || [])[1] || o.t.title.replace(/ all-time$/, '');
    dataIdea('greats-' + o.t.code.toLowerCase(), `Rank the ${team}${team.endsWith('s') ? "'" : "'s"} all-time greats`, o.pool.slice(0, 30));
  }
  // All 30 teams (NBA Cup season first).
  ideas.push({ id: 'teams-cup', title: 'Rank all 30 teams for the NBA Cup', teams: TEAMS.map(([a]) => a), months: [11, 12] });
  ideas.push({ id: 'teams-now', title: 'Rank all 30 teams right now', teams: TEAMS.map(([a]) => a) });
  // Title-only ideas: the reader adds the items.
  for (const [id, title, months] of [
    ['arenas', 'Best NBA arenas'], ['jerseys', 'Best jerseys of all time'], ['nicknames', 'Best nicknames'],
    ['dunk-contest', 'Best dunk contest dunks', [2]], ['playoff-series-2010s', 'Best playoff series of the 2010s', [4, 5, 6]], ['sneakers', 'Best sneakers'],
    ['cup-moments', 'Best NBA Cup moments', [11, 12]], ['all-star-moments', 'Best All-Star Game moments', [2]],
    ['deadline-deals', 'Best trade deadline deals ever', [2]], ['playoff-runs', 'Best playoff runs of all time', [4, 5, 6]],
    ['draft-steals', 'Biggest draft steals ever', [6]]]) ideas.push({ id, title, ...(months ? { months } : {}) });
  writeFileSync(ROOT + 'public/ideas.json', JSON.stringify({
    _about: 'List ideas for Make your own list (scripts/build-templates.mjs): {id, title, items?: [player ids from players.json], teams?: [team codes], months?: [1-12, in season]}. No items: the reader adds them.',
    v: 1, ideas,
  }) + '\n');
  console.log(`ideas.json: ${ideas.length} ideas (${ideas.filter((i) => i.items || i.teams).length} with items)`);
}

let slots = 0, photo = 0;
const templates = out.map(({ t, pool }) => {
  const list = pool.map((p, rank) => {
    const hasPhoto = p.nba && heads[p.nba] === 1;
    slots++; if (hasPhoto) photo++;
    // [id, name, NBA id with a real photo (else 0), HoopsMatic page, team label, order (1 = best)]
    return [p.id, p.name, hasPhoto ? p.nba : 0, p.link || '', teamLabel(p, t.w, t.code), rank + 1];
  }).sort((a, b) => last(a[1]).localeCompare(last(b[1])) || a[1].localeCompare(b[1]));
  for (const r of list) if (!r[3]) problems.push(`${t.slug}: ${r[1]} has no HoopsMatic page`);
  return { slug: t.slug, title: t.title, group: t.group, blurb: t.blurb, players: list };
});
const sorted = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => (isNaN(a) ? a.localeCompare(b) : a - b)));
writeFileSync(ROOT + 'data/nba-ids.json', JSON.stringify(sorted(idCache)) + '\n');
writeFileSync(ROOT + 'data/head-check.json', JSON.stringify(sorted(heads)) + '\n');
writeFileSync(ROOT + 'public/templates.json', JSON.stringify({
  _about: 'Tier Lists templates (scripts/build-templates.mjs). players, shown alphabetically: [id, name, NBA.com person id with a real photo or 0, HoopsMatic page, team as it was, order (1 = best, how the pool was picked; a top 10/25/50 list ranks the first N)]. The tier-lists server checks every published list against this file.',
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
