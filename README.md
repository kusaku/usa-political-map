# United States Political Map

A static, single-page WebGL atlas of the United States: twelve presidential elections from 1980 to 2024, the next federal election date and clearly separate national generic-ballot polling.

## Interface

- 50 states and the District of Columbia are shown as lit 3D extrusions with a dark top rim, stable fixed geometry and full polygon hit-testing.
- Alaska is compactly placed beside the north-west mainland; Hawaii is the sole display inset, below Alaska and west of the mainland so the whole map remains visible on narrow screens.
- Hover reveals the state and its current map metric; clicking any part of a state opens its detail card.
- Local SVG flags retain their native aspect ratios in the tooltip, detail card and table.
- The map switches between all twelve presidential elections from 1980 to 2024; it is not a forecast.

## Data

- Boundaries: Census TIGER/Line-derived geometry via [leaflet.us-states](https://github.com/EricDalnas/leaflet.us-states). Alaska is compactly scaled in place, Hawaii is moved for display, and the browser shifts all geometry into one continuous longitude range to avoid an antimeridian seam.
- Results: statewide presidential popular-vote results from 1980–2024. The 1980–2004 cycles use the [MIT Election Lab dataset](https://doi.org/10.7910/DVN/42MVDX); later cycles use the [FiveThirtyEight election-results repository](https://github.com/fivethirtyeight/election-results). Each state retains its cited election-authority link where available; the [FEC national result](https://www.fec.gov/resources/cms-content/documents/2024presgeresults.pdf) is the 2024 reference record. The archive stores one result per party in each state: cross-endorsed Democratic and Republican ballot lines are merged with their nominee; unnamed minor-party lines are grouped rather than represented as fictional parties.
- Election date: [Federal Election Commission](https://www.fec.gov/introduction-campaign-finance/how-to-research-public-records/election-dates/).
- National polling: one clearly dated [Economist / YouGov](https://yougov.com/en-us/content/the-economist) generic-ballot snapshot. It is never assigned to states.
- Flags: public-domain state SVGs from [Flagpedia](https://flagpedia.net/us-states/download); see [`assets/flags/ATTRIBUTION.md`](assets/flags/ATTRIBUTION.md).

The browser reads only local `data/*.json` files. It makes no runtime requests to political-data APIs.

## Run locally

No package install or build step is needed:

```sh
python3 -m http.server 8080
```

## Refresh bundled data

Node.js 22+ is enough:

```sh
node scripts/update-data.mjs

# Refresh only the map geometry.
node scripts/update-data.mjs --geometry
```

The updater serialises stable JSON and leaves files untouched when the fetched data has not changed. The included workflow runs it daily at midnight UTC and commits only real `data/` changes.
