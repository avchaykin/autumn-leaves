# Autumn Leaves Map

A static web app that maps **modelled autumn leaf colour**. It combines
tree species data, observed temperatures and the weather forecast, and runs a
leaf-senescence model for each place. It starts on northern France / Belgium.

```
npm start          # node scripts/serve.mjs → http://localhost:8080 (no-cache)
npm test           # node --test (model + mapping unit tests)
```

No build step and no API keys. Leaflet is loaded from cdnjs and everything else is plain ES modules.

## What you see

* **Zoom ≤ 11:** a grid (2° / 1° / 0.5° / 0.25° depending on zoom), coloured by the
  regional canopy mix.
* **Zoom ≥ 12:** individual forest polygons from the official forest maps,
  each coloured by its own species.
* **Date slider (1 Sep – 15 Dec)** has three zones:
  * *observed*: the model is driven by reanalysis temperatures up to today
  * *forecast*: the next 16 days of the Open-Meteo forecast
  * *outlook*: after that, 10-year daily normals plus the current anomaly, which fades over about 3 weeks
* **Leaf reference** in the side panel: drawn leaves of the main genera near the map centre
  (or in the forest under it when zoomed in), each filled with its modelled colour for the
  selected date. Leaves of trees that are already bare are faded. The shapes are in `js/leaves.js`.
* **Season selector** replays past autumns (2018 onwards) from observed data.
* **Click anywhere** to open a panel with:
  * the species mix, each genus's stage, its predicted peak date, and how many days early or late that is compared with a normal year
  * a temperature chart: this season vs the 10-year normal band
  * the best date to see colour at that place

## Open data sources

| What | Source | Licence |
|---|---|---|
| Daily temperatures, season so far + 2016–2025 normals | [Open-Meteo](https://open-meteo.com/) Historical API (ERA5 / ERA5-Land) | CC BY 4.0 |
| 16-day forecast | Open-Meteo Forecast API | CC BY 4.0 |
| Forest polygons + species, France | [IGN BD Forêt® V2](https://geoservices.ign.fr/bdforet), Géoplateforme WFS | Licence Ouverte 2.0 |
| Forest polygons + broadleaved/conifer, Wallonia | SPW, *Ancienneté des forêts actuelles* (`FORET/FORETANC`, ArcGIS REST) | Walloon open data |
| Forest polygons + species code, Flanders | ANB *Bosreferentielaag*, Digitaal Vlaanderen WFS | Modellicentie gratis hergebruik |
| Forests elsewhere (fallback) | OpenStreetMap via Overpass | ODbL |
| Regional tree-genus mix | [GBIF](https://www.gbif.org/) occurrence facets per 0.5° cell | CC0 / CC BY |
| Basemap, place names | OpenStreetMap tiles, Nominatim | ODbL |

### Staying within free-tier limits

Open-Meteo's free tier allows about 600 call-units per minute, 5,000 per hour and 10,000 per day.
Higher limits need a paid API key (`customer-api.open-meteo.com`), which a static public app can't keep secret.
Each location counts separately, and every 14 days of data counts as one more unit.

* **Grid size:** the weather grid gets coarser as you zoom out. A zoomed-out view costs about
  300–400 units, and it is cached in the browser for the rest of the day.
* **Pacing:** requests are paced against the per-minute budget, and a 429 "minutely" response
  is retried automatically.
* **Incremental history:** the season's observed temperatures are cached per location and only
  the new days are fetched later. A return visit therefore costs one small forecast request per
  location (~1.6 units) instead of the whole season again.
* **Archive end date:** ERA5 lags a few days behind. If a request runs past the archive's last day,
  the app reads that date from Open-Meteo's error, retries with it, and the forecast API fills the gap.
* **Normals:** these are the expensive part (~100 units per location). They are kept per
  1° cell and fetched once. `data/normals-1deg.json` ships them for 49–52°N, 1–7°E,
  and `node scripts/build-normals.mjs S W N E` builds them for another area.

`data/gbif-genus-counts.json` is a pre-fetched GBIF table for 48.5–52°N,
1–7°E. With it, the start region loads without dozens of GBIF calls, which GBIF rate-limits.
To rebuild it or cover another area, run `node scripts/build-gbif-cache.mjs S W N E`.
Outside the table, the app queries GBIF live, with backoff.

## The model (`js/phenology.js`)

The model belongs to the photoperiod × cold-degree-day family
(Delpierre et al. 2009, *Agric. For. Meteorol.*). Senescence units build up from 15 August,
once day length falls below 13.5 h:

```
rate = max(0, 17 °C − Tmean) + 2 × (13.5 h − daylength) + 10 × max(0, −2 °C − Tmin)
```

Each genus in `js/species.js` has three thresholds and a colour palette:

* **onset**: the first colour shows
* **peak**: the canopy is fully coloured
* **bare**: the leaves have fallen

Colour runs green → early tint → peak colour, then turns brown as the leaves drop.
For a stand, the canopy colour is the average of its species, weighted by the foliage still on the trees.

The thresholds were calibrated on 2016–2025 ERA5 data so that the usual ordering holds:

* Lille / Brussels: beech peaks around 19–23 October and trees are bare around 10 November.
* The Ardennes run about a week earlier.
* Warm autumns such as 2023 come out about 5 days late.

This is a plausibility calibration, not a fit against phenology observations.

### Where the species mix comes from

* **BD Forêt** `essence`, for example *Hêtre* → beech, *Chênes décidus* → oak.
  The generic classes *Feuillus* and *Mixte* use the local broadleaf mix.
* **Wallonia**:
  * broadleaved → local mix
  * conifer → conifer prior
  * ancient sub-natural forest → beech / oak / hornbeam, blended with the local mix
* **Flanders** `BMS`: the layer has no published code list. The codes are read
  from the structure of the 1990 Boskartering legend (11 beech, 12 oak,
  13 poplar, 1x broadleaved, 4x conifers). They were checked against known
  forests but are **not verified**.
* **Local broadleaf mix**: GBIF genus counts, blended (≤ 50 %) with a
  forest-inventory prior for the region. GBIF is heavily biased towards park
  and street trees.

## Known limitations

* The Brussels-Capital Region (for example the Brussels part of the Sonian Forest) has no
  regional forest layer. Those polygons appear only if the OSM fallback works.
  The public Overpass servers are often rate-limited.
* There is no drought stress, so very dry summers that bring early browning are not captured.
* Tmin normals are averages, so the outlook does not predict frost events.
