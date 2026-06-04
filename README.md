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

- **Hele banen ligger innenfor eiendom 51/1 og 57/5** (sjekket mot Kartverkets
  matrikkel-WMS, punkt for punkt langs hver korridor).
- **Ingen skyting over eller mot vei** – korridor + overskytingssone holdes
  innenfor eiendommene (vegen er eiendomsgrense), og langskuddet er vendt bort
  fra hyttene i vest og vegen i sør.
- Hver skytebane er lagt **~26 m til siden** for fairwayen, på siden med best
  klaring. Minste laterale klaring til nærmeste discgolf-punkt: **13–22 m**
  (i tillegg til forskyvningen).
- **Start ved hull 4, slutt ved hull 17.** Stasjon 11 er et **langskudd (60 m)
  i det åpne området under hull 16**.
- 12 mål fordelt på discgolfhull 4, 6, 7, 8, 9 (to standplasser), 10, 12, 13, 14
  og 17 – kun hull som ligger innenfor 51/1 / 57/5. Avstander 30–60 m.
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
