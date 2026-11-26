// The built site follows Jorge's rules. No network.
//   node --test test/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const ROOT = new URL('..', import.meta.url).pathname;
const read = (f) => readFileSync(ROOT + f, 'utf8');
const D = JSON.parse(read('public/templates.json'));
const E = JSON.parse(read('rules/edits.json')).templates;

test('25 templates, fixed S/A/B/C/D tiers, unique slugs', () => {
  assert.equal(D.templates.length, 25);
  assert.deepEqual(D.tiers, ['S', 'A', 'B', 'C', 'D']);
  assert.equal(new Set(D.templates.map((t) => t.slug)).size, 25);
});

test('every pool player links to his HoopsMatic page; ids unique per pool', () => {
  for (const t of D.templates) {
    assert.ok(t.players.length >= 20 && t.players.length <= 100, t.slug + ' pool size (up to 100, Nov 26, 2026)');
    assert.equal(new Set(t.players.map((p) => p[0])).size, t.players.length, t.slug + ' duplicates');
    for (const [id, name, nba, link, team] of t.players) {
      assert.match(link, /^https:\/\/hoopsmatic\.com\//, `${t.slug}: ${name} link`);
      assert.ok(nba === 0 || (Number.isInteger(nba) && nba > 0), `${name} nba id`);
      assert.ok(team, `${name} team`);
    }
  }
});

test('pools are alphabetical by last name (no ranking hint)', () => {
  const last = (n) => n.replace(/ (Jr\.|Sr\.|II|III|IV)$/, '').split(' ').slice(1).join(' ') || n;
  for (const t of D.templates) {
    const names = t.players.map((p) => last(p[1]));
    assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b)), t.slug);
  }
});

test('hand edits are applied and each has a reason', () => {
  for (const [slug, ed] of Object.entries(E)) {
    const t = D.templates.find((x) => x.slug === slug);
    assert.ok(t, slug);
    const ids = new Set(t.players.map((p) => p[0]));
    for (const [id, why] of Object.entries(ed.add || {})) { assert.ok(ids.has(id), `${slug} adds ${id}`); assert.ok(why.length > 8); }
    for (const [id, why] of Object.entries(ed.remove || {})) { assert.ok(!ids.has(id), `${slug} removes ${id}`); assert.ok(why.length > 8); }
  }
  assert.ok(D.templates.find((t) => t.slug === 'best-three-point-shooters-of-all-time').players.every((p) => p[0] !== 'lebron-james'));
});

test('era team names (as they were that season)', () => {
  const lakers = D.templates.find((t) => t.slug === 'lakers-all-time').players;
  assert.equal(lakers.find((p) => p[0] === 'george-mikan')[4], 'Minneapolis Lakers');
  const w = D.templates.find((t) => t.slug === 'warriors-all-time').players;
  assert.equal(w.find((p) => p[0] === 'paul-arizin')[4], 'Philadelphia Warriors');
});

test('a page per template and per consensus, canonical on hoopsmatic.com, footer, no third-party fonts', () => {
  const pages = ['public/index.html', ...D.templates.flatMap((t) => [`public/${t.slug}/index.html`, `public/${t.slug}/consensus/index.html`])];
  for (const f of pages) {
    assert.ok(existsSync(ROOT + f), f);
    const h = read(f);
    assert.match(h, /<link rel="canonical" href="https:\/\/hoopsmatic\.com\/tier-lists\/[^"]*">/, f);
    assert.match(h, /<meta property="og:url" content="https:\/\/hoopsmatic\.com\/tier-lists\//, f);
    assert.ok(h.includes('Anything wrong? Email us at <a href="mailto:hoopsmatic@hoopsmatic.com">hoopsmatic@hoopsmatic.com</a>'), f + ' footer 1');
    assert.ok(h.includes('For any other inquiry, contact us at <a href="mailto:ads@hoopsmatic.com">ads@hoopsmatic.com</a>'), f + ' footer 2');
    assert.ok(!/github\.io|fonts\.googleapis/.test(h), f + ' no github.io, no Google Fonts');
    assert.ok(!/\{\{[A-Z]+\}\}/.test(h), f + ' placeholders');
  }
});

// Launch (Jorge, Nov 26, 2026): Sunday, Nov 30, 2026, 15:00 Madrid = 9:00 AM ET,
// the same moment as hoopsmatic-worker's TIER_LISTS_LAUNCH.
test('launch: Nov 30, 2026, 15:00 Madrid (9:00 AM ET)', () => {
  const L = JSON.parse(read('rules/launch.json')), C = JSON.parse(read('public/config.json'));
  assert.equal(L.launch, '2026-11-30');
  assert.equal(L.moment, '2026-11-30T14:00:00Z');
  assert.deepEqual(C, { launch: L.launch, moment: L.moment, customFrom: L.customFrom });
  assert.ok(Date.parse(L.customFrom) >= Date.parse(L.moment), 'Stage 2 opens at launch or later');
  const at = (tz) => new Intl.DateTimeFormat('en-GB', { timeZone: tz, dateStyle: 'short', timeStyle: 'short' }).format(new Date(L.moment));
  assert.equal(at('Europe/Madrid'), '30/11/2026, 15:00');
  assert.equal(at('America/New_York'), '30/11/2026, 09:00');
});

test('international pool: no player born abroad who plays for the U.S. (Boozer, Wilkins, Irving); Duncan stays', () => {
  const ids = D.templates.find((t) => t.slug === 'best-international-players-of-all-time').players.map((p) => p[0]);
  for (const id of ['carlos-boozer', 'dominique-wilkins', 'kyrie-irving']) assert.ok(!ids.includes(id), id);
  assert.ok(ids.includes('tim-duncan'));
});

test('docs/ stays out of what GitHub Pages publishes (public/ only)', () => {
  assert.match(read('.github/workflows/pages.yml'), /path: public\n/);
  assert.ok(!existsSync(ROOT + 'public/docs'));
});

test('the page: no pop-ups, no initials, a consensus threshold of 10, the in-page share panel', () => {
  const js = read('public/app.js'), css = read('public/style.css');
  assert.ok(!/\balert\(|\bconfirm\(|\bprompt\(|<dialog|showModal/.test(js), 'no pop-ups');
  assert.ok(!/initials/i.test(js.replace(/never initials/gi, '')), 'no initials');
  assert.match(js, /const NEED = 10;/);
  assert.ok(js.includes('Not enough lists yet'));
  for (const k of ["['x', 'X']", "['bsky', 'Bluesky']", "['fb', 'Facebook']", "['wa', 'WhatsApp']", "['reddit', 'Reddit']", "['telegram', 'Telegram']"]) assert.ok(js.includes(k), k);
  // The share image is the server's (headshots through our own proxy), two sizes, saved or shared as a file.
  assert.ok(js.includes("API + 'image/' + L.id + '.png'"), 'the share image comes from the tier-lists server');
  assert.ok(js.includes("['1350', '1080 x 1350'], ['1080', '1080 x 1080']"), 'two sizes, 1080x1350 first');
  assert.ok(js.includes("'Save image'") && js.includes('navigator.canShare({ files: [f] })'), 'Save image, and the file to the share sheet where allowed');
  assert.ok(!/<canvas|getContext\(/.test(js), 'no canvas drawing in the page');
  assert.ok(js.includes("el('p', 'intro', C.intro)"), 'the consensus intro');
  assert.ok(!/text-transform:\s*uppercase/.test(css), 'no eyebrow kickers');
  assert.match(css, /--head-bg:#e6e6ea/, 'light-grey headshot background');
  // The 73-9 game's look: its navy gradient, panels, lines, gold/orange buttons and fonts.
  for (const k of ['#1a1a3e', '--panel:#12122a', '--line:#2a2a52', '--gold:#ffd700', '--orange:#ff6b35', "font-family: \"Oswald\"", '.soc-wa{background:#25d366}']) assert.ok(css.includes(k), k);
  assert.ok(!/position:\s*fixed/.test(css.replace(/\.drag-img\{[^}]*\}/, '')), 'no overlays (only the dragged tile follows the finger)');
  assert.ok(!/carousel|swiper/i.test(js + css), 'no carousels');
});

test('badges: the publish receipt goes to HMGames.badgeResult once, in the page (no cards, no footer strip)', () => {
  const js = read('public/app.js'), h = read('public/index.html');
  assert.ok(js.includes("store.set('tl-badge', { id: r.id, receipt: r.badge })"));
  assert.ok(js.includes("window.HMGames.badgeResult('tierlists', pend.receipt)"));
  assert.ok(js.includes("host.id = 'games-promo'"));
  assert.match(h, /<script src="\/hoopsmatic-games\.js" data-hm-game="tierlists" defer><\/script>/);
  assert.ok(!/data-hm-(cards|footer)=/.test(h), 'no auto cards (no carousel), no footer strip');
});

test('Stage 2: make your own list, the custom list page, the picker database', () => {
  const js = read('public/app.js'), P = JSON.parse(read('public/players.json'));
  for (const f of ['public/make/index.html', 'public/list/index.html']) assert.ok(existsSync(ROOT + f), f);
  assert.match(read('public/make/index.html'), /data-page="make"/);
  assert.match(read('public/list/index.html'), /data-page="custom"/);
  assert.ok(P.players.length > 4000 && P.teams.length === 30, 'every player with a page, and the 30 teams');
  for (const r of P.players) { assert.match(r[3], /^https:\/\/hoopsmatic\.com\//); assert.ok(!/\(\d{4}\)$/.test(r[1]), r[1]); }
  assert.match(js, /const TITLE_MAX = 80, TEXT_MAX = 40, MIN_ITEMS = 3, MAX_ITEMS = 100;/);
  assert.ok(js.includes("api('custom', { device: device(), title: T.title"), 'publishing a new list sends its items');
  assert.ok(js.includes("'Rank this list yourself'") && js.includes("&view=consensus"), 'rank it yourself and its consensus');
  assert.ok(js.includes("mailto:hoopsmatic@hoopsmatic.com?subject="), 'a Report link by email');
  assert.ok(!/type\s*=\s*['"]file['"]|FileReader|upload/i.test(js), 'no image uploads');
});

test('list ideas: data ideas fill real items, title-only ideas, calendar months, six at a time', () => {
  const I = JSON.parse(read('public/ideas.json')).ideas, P = JSON.parse(read('public/players.json'));
  const pid = new Set(P.players.map((r) => r[0])), tid = new Set(P.teams.map((r) => r[0]));
  const ids = I.map((i) => i.id);
  assert.equal(new Set(ids).size, ids.length, 'unique ids');
  assert.equal(ids.filter((x) => x.startsWith('roster-')).length, 30, 'all 30 current rosters');
  assert.ok(ids.includes('rookies'), "this season's rookies");
  for (let y = 2000; y <= 2026; y++) assert.ok(ids.includes('draft-' + y), 'draft ' + y);
  assert.equal(ids.filter((x) => x.startsWith('greats-')).length, 8, "the franchise pools' all-time greats");
  for (const t of ['Best NBA arenas', 'Best jerseys of all time', 'Best nicknames', 'Best dunk contest dunks', 'Best playoff series of the 2010s', 'Best sneakers'])
    assert.ok(I.some((i) => i.title === t && !i.items && !i.teams), t);
  for (const i of I) {
    assert.ok(i.title.length <= 80, i.id);
    const n = (i.items || []).length + (i.teams || []).length;
    if (i.items || i.teams) assert.ok(n >= 3 && n <= 100, i.id + ' size');
    for (const p of i.items || []) assert.ok(pid.has(p), `${i.id}: ${p} is in players.json (so it links to its page)`);
    for (const t of i.teams || []) assert.ok(tid.has(t), `${i.id}: team ${t}`);
    for (const m of i.months || []) assert.ok(m >= 1 && m <= 12);
  }
  assert.deepEqual(I.find((i) => i.id === 'teams-cup').months, [11, 12], 'NBA Cup ideas first in Nov-Dec');
  const js = read('public/app.js');
  assert.ok(js.includes("Math.min(6, order.length)") && js.includes("'More ideas'"), 'six at a time, More ideas');
  assert.ok(js.includes("'Make another'") && js.includes('!used.has(i.id)).slice(0, 3)'), 'Make another: three unused ideas');
  assert.ok(!/carousel|swiper|scroll-snap/i.test(js + read('public/style.css')), 'no carousel');
});

test('pool order, sizes, tiers and tile names', () => {
  const js = read('public/app.js');
  for (const t of D.templates) {
    const ranks = t.players.map((p) => p[5]).sort((a, b) => a - b);
    assert.deepEqual(ranks, t.players.map((_, i) => i + 1), t.slug + ': an order 1..n behind the pool');
  }
  assert.match(js, /const TIER_MIN = 2, TIER_MAX = 10, TIER_NAME_MAX = 20;/);
  assert.match(js, /const SIZES = \[10, 25, 50\];/);
  // The page's own label rule: no two tiles read the same, in any pool, at any size.
  const src = js.slice(js.indexOf('  function tileLabels(ps) {'), js.indexOf('    return ps;\n  }') + '    return ps;\n  }'.length);
  const tileLabels = new Function(src + '\nreturn tileLabels;')();
  const sizesOf = (n) => [...[10, 25, 50].filter((s) => s < n), n];
  for (const t of D.templates) {
    const order = t.players.slice().sort((a, b) => a[5] - b[5]);
    for (const n of sizesOf(order.length)) {
      const labels = tileLabels(order.slice(0, n).map((r) => ({ id: r[0], name: r[1] }))).map((p) => p.label);
      assert.equal(new Set(labels).size, labels.length, `${t.slug} top ${n}: ${labels.filter((l, i) => labels.indexOf(l) !== i).join(', ')}`);
    }
  }
  const L = tileLabels([{ name: 'Paul George' }, { name: 'Kenyon George' }, { name: 'Gary Payton' }, { name: 'Gary Payton II' }]).map((p) => p.label);
  assert.deepEqual(L, ['P. George', 'K. George', 'Gary Payton', 'Gary Payton II']);
});

test('pinned hand additions, the three-point and MVP orders', () => {
  const order = (slug) => D.templates.find((t) => t.slug === slug).players.slice().sort((a, b) => a[5] - b[5]);
  // Every approved hand addition sits inside the Top 25 of its pool.
  for (const [slug, ed] of Object.entries(E)) for (const id of Object.keys(ed.add || {})) {
    const r = D.templates.find((t) => t.slug === slug).players.find((p) => p[0] === id);
    assert.ok(r[5] <= 25, `${slug}: ${r[1]} at ${r[5]}`);
  }
  // Makes and accuracy together: the great shooters are all in the Top 25.
  const top3 = order('best-three-point-shooters-of-all-time').slice(0, 25).map((r) => r[1]);
  for (const n of ['Stephen Curry', 'Ray Allen', 'Reggie Miller', 'Kyle Korver', 'Steve Kerr', 'Predrag Stojakovic', 'Klay Thompson']) assert.ok(top3.includes(n), n);
  // MVP race: the team's record counts (the build multiplies by 0.5 + win %, from the pinned standings).
  const src = read('scripts/build-templates.mjs');
  assert.ok(src.includes("* (0.5 + winPct(teamNow(p)))"), 'MVP race x (0.5 + team win %)');
  assert.ok(JSON.parse(read('data/sources.lock.json')).sources.some((s) => s.id === 'standings'), 'standings pinned');
});

test('Stage A: hero, quick boards, preset tiers, placement bar, names never cut', () => {
  const js = read('public/app.js'), css = read('public/style.css'), H = JSON.parse(read('public/hero.json'));
  // 20+ curated debates, each a real board and player, no repeated question, no Wemby yes/no.
  assert.ok(H.debates.length >= 20, 'at least 20 debates');
  assert.equal(new Set(H.debates.map((x) => x.question)).size, H.debates.length, 'no question twice');
  assert.ok(!H.debates.some((x) => /Is Wemby in your MVP tier/.test(x.question)), 'the old question is gone');
  for (const x of H.debates) assert.ok(D.templates.find((t) => t.slug === x.board).players.some((r) => r[0] === x.player), x.id);
  const mvp = D.templates.find((t) => t.slug === '2026-27-mvp-race');
  assert.deepEqual(mvp.tiers, ['MVP favorite', 'In the race', 'Outside the race']);
  assert.deepEqual(D.templates.find((t) => t.slug === '2026-27-rookie-of-the-year-race').tiers, ['Favorite', 'In the mix', 'Long shot']);
  for (const t of D.templates.filter((x) => /-all-time$/.test(x.slug) && x.group === 'Teams')) assert.deepEqual(t.tiers, ['Franchise icon', 'All-time great', 'Fan favorite', 'Role player'], t.slug);
  assert.ok(!D.templates.find((t) => t.slug === 'best-players-of-the-1990s').tiers, 'others: S to D');
  for (const t of D.templates) assert.match(t.cta, /^Rank /, t.slug);
  // Random hero and three cards per load, never the last hero; Resume / Publish wording.
  assert.ok(js.includes("drawDebates(usable, 4, H.inSeasonWeight || 3, store.get('tl-last-hero'))"));
  assert.ok(js.includes("'Publish your list'"));
  // No gradients in the homepage section.
  const homeCss = css.slice(css.indexOf('/* The homepage (Jorge'), css.indexOf('/* The template list */'));
  assert.ok(!/gradient/.test(homeCss), 'flat colours on the homepage');
  // Catalog pictures: team logos, draft No. 1 picks.
  for (const t of D.templates.filter((x) => x.group === 'Teams')) assert.match(t.logo || '', /^[a-z]{3}$/, t.slug);
  assert.equal(D.templates.find((t) => t.slug === '2003-draft-class').no1, 'lebron-james');
  assert.equal(D.templates.find((t) => t.slug === '1996-draft-class').no1, 'allen-iverson');
  assert.match(js, /const QUICK = 10;/);
  assert.ok(js.includes("if (!draftOf(T.slug)) store.set('tl-rank-' + T.slug"), 'the hero never overwrites a draft');
  assert.ok(js.includes('Resume your list ('), 'resume');
  assert.ok(js.includes('const need = Math.min(5, all.length);'), 'publish from 5 placed');
  assert.ok(js.indexOf("app.appendChild(selbar);") > js.indexOf("tools.append(reset, cons); app.appendChild(tools);"), 'the placement bar is last in the page');
  assert.match(css, /\.selbar\{position:sticky;bottom:0/);
  assert.ok(!/\.tile \.nm\{[^}]*ellipsis/.test(css), 'tile names are never cut');
  assert.ok(!/class="faces"|'faces'/.test(js), 'no headshot strips');
});
