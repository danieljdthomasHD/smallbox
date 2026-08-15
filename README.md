# 🧺 Smallbox

Find farmers markets, farm stands, greengrocers, butchers, fishmongers, bakeries
and small independent grocers near you — with the big-box stores and chains
filtered out.

Built on OpenStreetMap. No API keys, no billing, no accounts.

## Running it

```bash
npm install
npm run dev        # http://localhost:3000
```

```bash
npm run build      # production build
npm test           # unit tests for the filtering logic
npm run lint
```

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

Restaurants, cafés and everything else are never queried. `shop=convenience` is
only included when something in its tags or name suggests it actually sells
fresh food — otherwise every gas station in the county turns up.

## How "independent" is decided

This is the interesting part, because **no public dataset has an "independently
owned" field**. Smallbox infers it from three signals, in `src/lib/chains.ts`:

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
   search area is a chain by definition — this catches regional chains nobody
   has added to a list yet, in any country. The penalty is mild on purpose: a
   family bakery with three shops still makes the cut.

Positive signals (`organic`, `shop=farm`, `amenity=marketplace`, listed produce)
push a place up.

The result is a 0–100 score. Anything at 50 or above is shown. **Every listing
carries the reasons for its own score**, visible in the detail panel — the
filter is auditable rather than a black box, which matters when the cost of a
mistake is hiding somebody's shop.

Pass `?all=1` to the API to see chains flagged instead of removed.

## Data sources

- **[Overpass API](https://wiki.openstreetmap.org/wiki/Overpass_API)** for the
  listings. Four public mirrors are queried with *hedging* — if one goes quiet
  for five seconds the next starts in parallel and the first answer wins. Trying
  them strictly in sequence produced a 71-second failure in testing; hedging
  turned the same query into 6 seconds.
- **[Nominatim](https://nominatim.org/)** for place search, proxied server-side
  so it gets the identifying User-Agent its policy requires, and so visitors'
  IPs stay out of a third party's logs.
- **USDA Local Food Directories** *(optional)*. Set `USDA_API_KEY` in
  `.env.local` to fold in the USDA's curated US farmers market directory. Get a
  free key at <https://www.usdalocalfoodportal.com/fe/apikey/>. Everything works
  without it.

Data is © OpenStreetMap contributors, [ODbL](https://www.openstreetmap.org/copyright).

## API

```
GET /api/places?lat=35.5953&lon=-82.5508&radius=8000
      &categories=butcher,bakery   # optional, comma-separated
      &all=1                       # optional, include chains (flagged)

GET /api/geocode?q=Asheville+NC    # search
GET /api/geocode?lat=..&lon=..     # reverse
```

`/api/places` returns places sorted by distance, each with an `independence`
verdict, plus a `chainsFiltered` count.

## Layout

```
src/lib/chains.ts      independence scoring — the core of the app
src/lib/categories.ts  OSM tag → category mapping
src/lib/overpass.ts    Overpass querying with mirror hedging
src/lib/hours.ts       conservative opening_hours reader
src/lib/usda.ts        optional USDA enrichment
src/app/api/           places + geocode routes
src/components/        Explorer shell, Leaflet map, list, filters, detail
tests/                 unit tests for the filtering and hours logic
```

## Known limits

- **Coverage is whatever OSM has.** Dense cities are excellent; rural areas are
  patchy. A missing shop is a missing OSM node — it can be added at
  [openstreetmap.org](https://www.openstreetmap.org/) and will show up here.
- **Opening hours are best-effort.** The full OSM `opening_hours` grammar is
  large; Smallbox reads the common subset and reports `unknown` for anything
  else rather than risk telling you a market is open when it isn't. The raw
  string is always displayed.
- **"Open now" uses your device's clock**, not the shop's timezone. Correct
  nearby, wrong if you're browsing another continent.
- Ownership remains an inference. A wrong call is a bug worth fixing — the
  reasons shown on each listing are there to make that easy.
