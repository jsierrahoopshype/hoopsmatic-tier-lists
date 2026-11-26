# hoopsmatic-tier-lists

NBA Tier Lists at hoopsmatic.com/tier-lists/: readers rank a template's players in S, A, B, C and D tiers, publish the list (its own link and a 1080x1080 share image) and see the fans' consensus for each template.

- `public/`: the site (GitHub Pages, served at hoopsmatic.com/tier-lists/ by hoopsmatic-worker). Built pages are committed.
- `scripts/build-templates.mjs`: the 25 launch templates and their pools from the pinned data (`data/sources.lock.json`, Deep Cut's), NBA.com person ids (NBA Head to Head's search.json) and the photo check; then `rules/edits.json` (hand edits, `docs/edits-for-approval.txt`).
- `scripts/build.mjs`: one page per template and per consensus, `config.json` (launch from `rules/launch.json`), sitemap content hashes.
- The API is `hoopsmatic-worker/tier-lists-server` (`/tier-lists/api/*`).

```bash
node scripts/pull-data.mjs          # pinned sources -> .cache/sources/
node scripts/build-templates.mjs    # public/templates.json (+ --list to print the pools)
node scripts/build.mjs              # the pages
node --test test/*.test.mjs
```

Launch: Sunday, Nov 30, 2026, 15:00 Madrid = 9:00 AM ET (`rules/launch.json`, hoopsmatic-worker `TIER_LISTS_LAUNCH`, tier-lists-server `LAUNCH`). Indexing, the sitemap, the menu row, the games roster entry and the privacy paragraph switch on by themselves at that moment, and the consensus starts from zero (lists published before it stop counting and are deleted). Before that every page is noindex. Ranking pages and individual lists are always noindex; a consensus page is indexable only with 25+ lists.

Badges: game id `tierlists` in hoopsmatic-badges. From launch each publish reply carries a sealed receipt; the list's page passes it to `/hoopsmatic-games.js` (`HMGames.badgeResult`), which shows the badge card in the page.

Privacy text for stored lists: `docs/privacy-draft.md`.
