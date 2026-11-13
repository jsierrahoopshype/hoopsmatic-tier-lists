// Renders public/og-card.jpg (1200x630), the link-preview card for every
// Tier Lists page: the five tiers with a few headshots from public/templates.json.
// Run by hand when the look changes (Playwright + Chromium):
//   node scripts/og-card.cjs
const { chromium } = require('playwright');
const { readFileSync } = require('fs');
const ROOT = require('path').join(__dirname, '..');
const T = JSON.parse(readFileSync(ROOT + '/public/templates.json', 'utf8'));
const pick = (slug, ids) => ids.map((id) => T.templates.find((t) => t.slug === slug).players.find((p) => p[0] === id)[2]);
const rows = [
  ['S', '#d12c2c', pick('best-players-right-now', ['nikola-jokic', 'shai-gilgeous-alexander', 'giannis-antetokounmpo'])],
  ['A', '#e07a10', pick('best-players-right-now', ['luka-doncic', 'victor-wembanyama', 'anthony-edwards', 'jayson-tatum'])],
  ['B', '#c29a00', pick('best-players-right-now', ['jalen-brunson', 'stephen-curry', 'donovan-mitchell'])],
  ['C', '#1d8a40', pick('best-players-right-now', ['devin-booker', 'tyrese-maxey'])],
  ['D', '#3b82f6', pick('best-players-right-now', ['paolo-banchero'])],
];
const font = readFileSync(ROOT + '/public/fonts/dm-sans-latin-wght-normal.woff2').toString('base64');
const html = `<html><head><style>
@font-face{font-family:D;src:url(data:font/woff2;base64,${font})}
body{margin:0;width:1200px;height:630px;background:#f5f5f7;font-family:D,sans-serif;display:flex;color:#1d1d1f}
.l{width:470px;padding:64px 0 0 64px;display:flex;flex-direction:column}
h1{font-size:76px;line-height:1;margin:0;letter-spacing:-.03em}
p{font-size:28px;color:#6e6e73;margin:22px 0 0;line-height:1.3}
.b{margin-top:auto;margin-bottom:56px;font-size:40px;font-weight:800}.b span{color:#3b82f6}
.r{flex:1;padding:44px 56px 44px 0;display:flex;flex-direction:column;gap:8px}
.t{flex:1;display:flex;background:#fff;border-radius:14px;overflow:hidden}
.k{width:74px;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:800;font-size:40px}
.f{display:flex;gap:8px;padding:8px}
.f div{width:116px;height:85px;background:#e6e6ea;border-radius:8px;overflow:hidden;display:flex;align-items:flex-end;justify-content:center}
.f img{width:100%;height:100%;object-fit:contain;object-position:center bottom}
</style></head><body>
<div class="l"><h1>NBA Tier Lists</h1><p>Rank the players. Publish your list. See where the fans land.</p><div class="b">Hoops<span>Matic</span></div></div>
<div class="r">${rows.map(([t, c, ids]) => `<div class="t"><div class="k" style="background:${c}">${t}</div><div class="f">${ids.map((id) => `<div><img src="https://cdn.nba.com/headshots/nba/latest/260x190/${id}.png"></div>`).join('')}</div></div>`).join('')}</div>
</body></html>`;
(async () => {
  const b = await chromium.launch(process.env.HTTPS_PROXY ? { proxy: { server: process.env.HTTPS_PROXY } } : {});
  const pg = await b.newPage({ viewport: { width: 1200, height: 630 } });
  // Images through Node's fetch (some sandboxes' headless browsers stall on cdn.nba.com).
  await pg.route('https://cdn.nba.com/**', async (r) => { const res = await fetch(r.request().url()); await r.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from(await res.arrayBuffer()) }); });
  await pg.setContent(html, { waitUntil: 'load' });
  await pg.screenshot({ path: ROOT + '/public/og-card.jpg', type: 'jpeg', quality: 88 });
  await b.close();
})();
