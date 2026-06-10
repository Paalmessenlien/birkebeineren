# Birkebeineren – kart

Lokalt kart over Birkebeineren Discgolfpark med markeringer hentet fra UDisc,
lagt oppå Kartverkets åpne kartfliser (samme data som norgeskart.no). Inkluderer
en editor for å tegne en **feltbueskytingsbane** i nettleseren.

## Filer

| Fil | Hva |
|-----|-----|
| `index.html` + `app.js` | **Kartvisning** – discgolfbane, eiendomsgrenser, gnr/bnr, satellitt |
| `editor.html` + `editor.js` | **Feltbane-editor** – tegn skytestasjoner, lagres i nettleseren |
| `course.geojson` | Discgolfbanen (tees, kurver, fairwayer) |
| `extract.js` | Hvordan dataene ble hentet fra UDisc (for ny henting) |

Alt er statiske filer. Leaflet lastes fra CDN; kartflisene (Kartverket + Esri)
er åpne med CORS, så ingenting trenger en server bortsett fra lokal testing.

## Kjøre lokalt

```bash
cd birkebeineren
python3 -m http.server 8000
# åpne http://127.0.0.1:8000/index.html
```
(En server trengs lokalt fordi `fetch()` av `.geojson` er blokkert under `file://`.)

## Feltbane-editor

`editor.html`: klikk **Ny stasjon**, klikk skytepunkt → blink. Avstanden regnes
ut automatisk (geodesisk lengde i meter). Dra endepunktene for å justere, klikk
en stasjon for å endre nummer/avstand eller slette.

- **Lagring:** automatisk i nettleserens `localStorage` (per maskin/nettleser).
- **Eksporter/Importer:** GeoJSON-fil, for backup eller flytting mellom maskiner.

## Sikkerhet (World Archery) – automatiske soner og konfliktsjekk

For feltbane-filer **uten egne sikkerhetspolygoner** (f.eks.
`birkebeineren-feltbane.geojson`) tegner `app.js` sikkerhetssonen automatisk etter
**World Archery (WA)** sitt prinsipp om en *overskytings-trakt*:

- **Lateral trakt:** trygg halvbredde fra skuddlinja = **avstand ÷ 6** (minimum
  **5 m**) – en konstant ±9,46°-kjegle ut fra skytepelen. (WA-medlemsforbund, jf.
  Archery Australia *Safety Guidelines* sin overshoot-funnel: 90 m→15 m, 60 m→10 m,
  30 m→5 m.)
- **Overskyting bak blink:** **50 m** ryddet sone bak hvert blink (WA: «minst 50 m
  bak lengste blink» når det ikke finnes bakstopp).
- Til orientering: WA anbefaler òg **≥ 20 m** fri sone til hver side av hele
  *field of play*, og at ingen tegner/skyter slik at en utilsiktet løsnet pil kan
  gå **utenfor** overskytingssonen (WA Book 4 §28–29).

**Høydejustering (Kartverket høydedata, 1 m DTM):** overskytingen bak hvert blink
justeres etter terrenget – **kortes ned** der terrenget stiger til en naturlig
bakstopp (≥ 3 m innen 50 m) og **forlenges** på nedoverbakkeskudd der pila bærer
lenger. Stasjoner med naturlig bakstopp tegnes **grønne**, og hellingen vises som
↗/↘-badge ved hver stasjon. Egenskapene (`z_peg`, `z_target`, `slope_deg`,
`backstop_m`, `overshoot_m`, `terrain_note`) ligger lagret i geojson-en.

**Konfliktsjekk mot discgolf – retningsbasert:** hver sikkerhetssone testes mot
discgolfbanen (utkast, kurver og fortettede fairway-punkter fra `course.geojson`).
Men **overlapp = ikke konflikt**: for hvert discgolf-element i sonen sammenlignes
skuddretningen med hullets kasteretning (lengste fairway). Skyter de **samme vei**
(≤ 45°) er det trygt med vanlig oversikt og venting på tur – slik både bueskyttere
og discgolfere allerede praktiserer i åpent terreng. Bare **motgående** retning
(> 90°) tegnes **rødt** som reell konflikt; **kryssende** (45–90°) eller langt/bratt
utløp blir **amber** («krever oversikt»); ellers **grønt** (naturlig bakstopp) eller
**oransje** (samme retning / fri sone). Pila ved blinket viser **skyteretning**.
Tegnforklaringen nede til høyre forklarer fargene.

**Presentasjonsside (`analyse.html`):** en egen SWOT-side med nøkkeltall,
høydeprofil langs gangruta og et kort per mål (avstand, retning, høyde, helling,
bakstopp, overskyting, konflikt, risikonivå + mulige problemer og tiltak).
Regnes live fra geojson-filene, så den følger redigeringer. Åpnes fra knappen
**📊 Sikkerhetsanalyse** i kartet.

> PDGA gir ingen fast tallavstand mellom hull, men discgolfere står langs hele
> fairwayen og kast kan gå langt – derfor regnes ethvert discgolf-punkt inne i en
> bue-sikkerhetssone som en reell konflikt som må løses (flytt stasjon, snu
> retning, eller skill aktivitetene i tid).

## Hosting på GitHub Pages

Fungerer som det er – GitHub Pages serverer statiske filer.

```bash
git init && git add . && git commit -m "Birkebeineren-kart"
git branch -M main
git remote add origin https://github.com/<bruker>/<repo>.git
git push -u origin main
```
Slå så på **Settings → Pages → Branch: main / root**. Siden blir tilgjengelig på
`https://<bruker>.github.io/<repo>/`.

### Om datalagring på Pages
GitHub Pages har **ingen backend/database**. Derfor:

- Editoren lagrer i `localStorage` (kun i din egen nettleser).
- For å **publisere** en feltbane som alle ser: trykk *Eksporter* i editoren,
  legg `feltbane.geojson` i repoet, og last den inn i `app.js` på samme måte som
  `course.geojson`. Da serverer Pages den som en vanlig fil.
- For delt redigering i sanntid trengs en ekstern tjeneste (f.eks. et lite
  API, en GitHub Gist via token, eller Firebase) – utenfor det Pages gir alene.
