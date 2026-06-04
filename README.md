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

## Feltbane (forslag) – fiktiv bueskytingsbane

`fictive_field.geojson` + laget **«Feltbane (forslag)»** i kartvisningen er et
sikkerhetsvurdert forslag til en 12-måls feltbane (World Archery field-prinsipp,
markerte avstander ≤ 60 m), lagt slik at den kan dele området med discgolfbanen.

**Sikkerhetsprinsipp (viktigst):** Alle baner skyter **utover, vekk fra
discgolf-spillefeltet**, slik at både pil-bane og overskytingssone (50 m bak
blinken) lander i skog/vann – aldri tilbake mot discgolfere.

- Skuddretning kun mot **øst→sørøst** (skog + innsjøen som naturlig bakstopp).
  Vest/sørvest (hyttene ved Storhagen, skistadion) og sør (hull 1-korridoren mot
  Sjøsetervegen) brukes **aldri** som skuddretning.
- Vifteformet («diverging fan») oppsett: banene spriker, så ingen bane peker mot
  en annen skytters standplass.
- Hver standplass ligger ≥ 22 m utenfor discgolf-feltet. Korteste avstand fra en
  skuddsone til nærmeste discgolf-punkt i forslaget er **> 200 m**.
- De røde viftene i kartet er **sikkerhetssonene** – de skal aldri overlappe
  discgolf eller stier.

Forslaget kan åpnes i `editor.html` (Importer → `fictive_field.geojson`) og
justeres fritt.

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
