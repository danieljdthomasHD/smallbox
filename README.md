# 🧺 Smallbox

Find farmers markets, farm stands, greengrocers, butchers, fishmongers, bakeries
and small independent grocers near you — including the pop-ups and one-off
markets that never make it onto a map.

Big-box stores and chains are filtered out.

## Running it

```bash
npm install
npm run dev        # http://localhost:3000
```

### Getting a hosted link

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FdanieljdthomasHD%2Fsmallbox&project-name=smallbox&repository-name=smallbox)

Deploys with no configuration. One caveat: serverless filesystems are
read-only, so the SQLite submissions store can't persist there — the app
detects this, reports "Community submissions" as unavailable in the sources
panel, and everything else works normally. Point `src/lib/db.ts` at a hosted
Postgres to get submissions back.

```bash
npm run build      # production build
npm test           # unit tests for the filtering, hours and merge logic
npm run lint
```

**No API keys are needed.** With none configured, Smallbox runs on OpenStreetMap
plus community submissions. Each key in `.env.example` switches on one more
source; the app tells you in the UI which are on, which are off, and why.

## Where listings come from

Six sources are queried in parallel and merged into one result set.

| Source | Needs a key | What it adds |
| --- | --- | --- |
| **OpenStreetMap** (Overpass) | no | The backbone. Global, and the only source carrying the brand tags the chain filter relies on. |
| **Community submissions** | no | Places people added through the app, and corrections to everything else. Outranks every automated source. |
| **USDA Local Food Directory** | `USDA_API_KEY` (free) | Curated US farmers markets, with better schedules than OSM. |
| **Google Places** | `GOOGLE_PLACES_API_KEY` (billed) | Best coverage and opening hours. Never written to the database — their terms restrict storing results. |
| **Local news** | `ANTHROPIC_API_KEY` | Pop-ups, seasonal markets and brand-new openings, read out of Google News coverage. |
| **Festivals & events** | `TICKETMASTER_API_KEY` (free) + `ANTHROPIC_API_KEY` | Harvest festivals and night markets that include a produce row. |

A provider that fails is reported as degraded — it never takes down the search.
If Overpass is having a bad morning, you still get everything else.

### Reading listings out of prose

Some markets only ever exist in print. A stand running three Saturdays in August
is never going to be an OSM node, but the local paper announces it.

Google News' RSS endpoint is free and needs no key, so Smallbox queries it per
area and hands the articles to Claude with a strict schema (`src/lib/extract.ts`),
which pulls out the market name, category, venue, and the actual dates — resolving
"this Saturday" against the article's publication date. Venues are then geocoded
through Nominatim.

This is the least reliable source by construction, and it is labelled that way
throughout: everything from news or events is a **lead**, shown with an
"Unverified" badge and a note suggesting you call ahead. A lead is promoted to
"Reported" only when a second independent source describes the same place.

### How duplicates are handled

The same market can arrive from four sources under four slightly different names.
`src/lib/merge.ts` matches on name + proximity — stripping filler words, so
"Asheville City Market" and "The Asheville City Farmers Market" collapse into one
— then merges field by field, preferring the source with more structural detail.

Every contributing source is kept on the record, which is what lets the detail
panel show its own provenance instead of asking you to take it on faith.

## How "independent" is decided

**No public dataset has an "independently owned" field.** Smallbox infers it from
four signals, in `src/lib/chains.ts`:

1. **Brand tags — the workhorse.** OSM mappers add `brand:wikidata` and `brand`
   almost exclusively to chain locations, since the whole point of those tags is
   to tie many branches to one brand entity. This catches chains worldwide with
   no list to maintain. In an Asheville test it correctly rejected all 19 chains
   present with zero false positives.
2. **A name denylist**, for chains mapped without brand tags (Earth Fare, Key
   Food, C-Town, Piggly Wiggly, Tesco, Carrefour…). Ambiguous names are matched
   only as a whole word, so "Giant Peach Produce" survives while "Giant Food"
   does not, and "Aldine Grocery" is never mistaken for "Aldi".
3. **A repeat detector.** Any name appearing at three or more addresses in one
   search area is a chain by definition — this catches regional chains nobody has
   added to a list yet, in any country. The penalty is mild on purpose: a family
   bakery with three shops still makes the cut.
4. **Community corrections.** Anyone can report a listing as a chain, as
   independent, or as closed, and that judgement overrides the heuristic for
   everyone.

The result is a 0–100 score; anything at 50 or above is shown. **Every listing
carries the reasons for its own score**, visible in the detail panel — the filter
is auditable rather than a black box, which matters when the cost of a mistake is
hiding somebody's shop.

Pass `?all=1` to the API to see chains flagged instead of removed.

## What it looks for

| Category | OSM tags behind it |
| --- | --- |
| Farmers markets | `amenity=marketplace` |
| Farm stands | `shop=farm`, `shop=honey` |
| Produce | `shop=greengrocer`, `shop=fruit`, `shop=vegetables` |
| Butchers | `shop=butcher` |
| Fishmongers | `shop=seafood`, `shop=fishmonger` |
| Bakeries | `shop=bakery`, `shop=pastry` |
| Cheese & dairy | `shop=cheese`, `shop=dairy` |
| Corner grocers | `shop=grocery`, `deli`, `health_food`, `supermarket`, `convenience` |

Restaurants and cafés are never queried. `shop=convenience` is only included when
something in its tags or name suggests it actually sells fresh food — otherwise
every gas station in the county turns up.

## API

```
GET /api/places?lat=35.5953&lon=-82.5508&radius=8000
      &categories=butcher,bakery    # optional
      &sources=osm,news             # optional, restrict to named sources
      &area=Asheville,+NC           # optional, saves a reverse-geocode
      &all=1                        # optional, include chains (flagged)

GET  /api/geocode?q=Asheville+NC    # search
GET  /api/geocode?lat=..&lon=..     # reverse

GET  /api/submissions               # whether submissions are available
POST /api/submissions               # add a place, or correct an existing one
```

`/api/places` returns places sorted by distance, each with an `independence`
verdict, a `confidence` level, and the full list of `sources` that contributed —
plus a per-source status block so it's clear what ran and what didn't.

## Layout

```
src/lib/chains.ts       independence scoring — the core of the app
src/lib/merge.ts        cross-source dedupe and provenance
src/lib/extract.ts      Claude structured extraction from article prose
src/lib/categories.ts   OSM tag → category mapping
src/lib/overpass.ts     Overpass querying with mirror hedging
src/lib/geocode.ts      rate-limited Nominatim client
src/lib/hours.ts        conservative opening_hours reader
src/lib/occurrences.ts  pop-up date formatting
src/lib/db.ts           SQLite store for submissions
src/lib/sources/        one file per provider, behind a shared interface
src/app/api/            places, geocode and submissions routes
src/components/         Explorer shell, Leaflet map, list, filters, detail
tests/                  unit tests for filtering, hours and merge
```

## Known limits

- **Submissions need a writable disk.** SQLite keeps the repo dependency-free,
  but serverless hosts (Vercel, Netlify) have a read-only filesystem, so
  submissions won't persist there. Everything is behind `src/lib/db.ts` — moving
  to Postgres means reimplementing that one file.
- **News extraction is unverified by design.** It reads RSS summaries, not full
  article text, and the model can misread a mention. That's why nothing from it
  is presented as fact.
- **News and event sources are slow** — several network hops plus a model call.
  The route allows 60 seconds and reports anything that doesn't finish.
- **Coverage is whatever the sources have.** Dense cities are excellent; rural
  areas are patchy. A missing shop can be added right in the app, or mapped on
  [OpenStreetMap](https://www.openstreetmap.org/).
- **Opening hours are best-effort.** The full OSM `opening_hours` grammar is
  large; Smallbox reads the common subset and reports `unknown` for anything else
  rather than risk telling you a market is open when it isn't.
- **"Open now" uses your device's clock**, not the shop's timezone. Correct
  nearby, wrong if you're browsing another continent.
- Ownership remains an inference. A wrong call is a bug worth fixing — the
  reasons shown on each listing are there to make that easy, and the report
  buttons are there to fix it permanently.

## Attribution

Place data © OpenStreetMap contributors,
[ODbL](https://www.openstreetmap.org/copyright). Geocoding by
[Nominatim](https://nominatim.org/). Other sources as configured.
