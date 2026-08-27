# Company Implementation Intelligence

Search how companies actually solve problems. This is a lean MVP testing whether
professionals will use (and eventually pay for) a structured library of real,
sourced implementation research — not a screenshot library, not a policy
database, not an AI tool.

## Run it

```
npm run research
```

Then open http://localhost:4000. (Change the port with `node research/server.js 5000`.)

No build step, no dependencies beyond Node's built-ins — `research/server.js` is
a small static file server plus one `POST /api/event` endpoint that appends
analytics events to `research/data/analytics.log` (git-ignored).

## Add a new research record

Edit `research/data/records.json` and append an object with this shape:

```json
{
  "id": "account-deletion-example",
  "company": "Example Co",
  "industry": "Financial services",
  "problem": "Account deletion",
  "category": "account-deletion",
  "implementation_type": "Settings page",
  "title": "Account deletion — Example Co",
  "summary": "Factual only: what the flow actually is.",
  "analysis": "Editorial only: why it's interesting or unusual.",
  "steps": ["Step 1", "Step 2"],
  "tags": ["account deletion", "fintech"],
  "source_url": "https://example.com/help/close-account",
  "source_type": "Help center article",
  "date_checked": "2026-08-27",
  "images": [],
  "collection_ids": ["account-deletion"]
}
```

No application code needs to change — search, browse, compare, and detail pages
all read this file directly. To add a new research category (a new `category`
value), just start adding records with that category; it appears automatically
on the homepage and in filters. To add or edit a curated collection, edit
`research/data/collections.json`.

**Rules for content, not just format:**
- `summary` is what the source actually documents — no inference, no guessing.
- `analysis` is your own editorial observation — keep it visibly separate.
- `source_url` must be a real, working URL to a public page (help center,
  product blog, documentation) — not a guess, not a third-party summary of it.
- If a company doesn't have a real self-service flow, say so — "you have to
  email support" is a legitimate, interesting finding.

## Structure

```
research/
  data/
    records.json       24 real, sourced implementation records
    collections.json   4 curated groupings
  site/                static HTML/CSS/JS — no framework, no build step
    index.html          homepage + search
    search.html         browse/filter/keyword search + compare picker
    record.html         full record detail
    compare.html         side-by-side comparison table
    collections.html    collection list + collection detail
    company.html         all records for one company
    saved.html           localStorage bookmarks
    js/common.js        data loading, search scoring, save/analytics, shared nav
    css/styles.css      shared design system
  server.js            dependency-free static server + /api/event logger
```

## What this MVP assumes

- 24 records across 2 categories (account deletion, identity verification) is
  enough to test whether the *format* of research is valuable, not whether
  full topic coverage is.
- Keyword/tag/industry/category search is enough to test relevance demand;
  semantic search is deliberately deferred (see brief section 20).
- No accounts: saving is per-browser via localStorage. If people want saves to
  persist across devices, that's a strong signal worth building auth for.
- Evidence is sourced from official help-center documentation rather than
  screenshots, since screenshots would require live test accounts on ~20
  services and risk going stale or being misattributed.

## What to watch

- Do people search in their own words (multi-word natural queries) or by
  company/tag? The `/api/event` log captures every `search` event with the raw
  query string — that's the fastest signal on whether keyword search is
  "good enough" or whether people expect natural-language / semantic search.
- Do people use Compare, or just read one record and leave?
- Do people come back and check Saved, or is bookmarking a one-time click that
  never gets revisited?
- Which of the two categories gets more search volume / dwell time —
  account deletion (broad, universal) or identity verification (narrower,
  more compliance/fintech-coded)? That's an early signal on which audience
  (PM/UX generalists vs. compliance/trust specialists) is the stronger wedge.
