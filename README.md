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

## Feltbane (forslag) – fiktiv bueskytingsbane sammen med discgolf

`fictive_field.geojson` + laget **«Feltbane (forslag)»** er et sikkerhetsvurdert
forslag til en 12-måls feltbane (World Archery field-prinsipp, markerte avstander
≤ 60 m) som **deler løypa med discgolfbanen**.

**Prinsipp:** Pilskyting skjer **parallelt med og i samme retning som
discgolf-kastet** på hvert hull – begge aktiviteter beveger seg samme vei nedover
løypa, så ingen skyter/kaster mot der den andre går. Sikkerheten ligger i
**sideforskyvning**:

- Hver skytebane er lagt **32 m til siden** for fairwayen, på den siden med best
  klaring (sjekket mot både eget og nabohull).
- Korridor + overskytingssone (40 m) holdes innenfor sidestripen – aldri inn på
  en fairway eller sti. Minste laterale klaring til nærmeste discgolf-punkt er
  **10,8–26,7 m** (i tillegg til 32 m forskyvning).
- Skyteavstand maks 60 m, blinken står kort for kurven så oversoner ligger
  ved siden av, ikke på, greenen.
- Banen bruker 12 av 18 discgolfhull (1,2,3,4,5,7,8,9,13,14,17,18); de øvrige 6
  ligger for tett inntil nabohull til å gi trygg klaring.
- De røde korridorene i kartet er **sikkerhetssonene**.

> Dette er et delt-areal-oppsett med *forvaltet* risiko: det forutsetter
> etikette om at man bare skyter/kaster når den parallelle korridoren foran er
> klar. Skal aktivitetene kunne foregå helt uavhengig samtidig, må de skilles
> fysisk.

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
