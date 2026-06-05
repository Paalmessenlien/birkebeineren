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
- **Gangrekkefølge optimalisert** (2-opt) for kortest gange – grønn stiplet
  **gangrute** i kartet viser rekkefølgen 1→12 (≈1,3 km totalt).
- **Start ved hull 4.** **Stasjon 12 ligger på hull 18s utkast og skyter samme
  retning som hull 18 kastes (SW)** – innenfor 51/1 (klaring 9 m, banens
  trangeste; krever god standplass-etikette).
- Stasjon 11 er et **langskudd (60 m) i det åpne området under hull 16**, vendt
  NNØ bort fra hyttene i vest og vegen i sør.
- 12 mål på discgolfhull 4, 6, 7, 8, 9, 10, 12, 13, 14, 17, 18 + langskuddet –
  kun innenfor 51/1 / 57/5. Avstander 30–60 m.
- De røde korridorene er **sikkerhetssonene**; den grønne stiplete linja er gangruta.

> Dette er et delt-areal-oppsett med *forvaltet* risiko: det forutsetter
> etikette om at man bare skyter/kaster når den parallelle korridoren foran er
> klar. Skal aktivitetene kunne foregå helt uavhengig samtidig, må de skilles
> fysisk.

Forslaget kan åpnes i `editor.html` (Importer → `fictive_field.geojson`) og
justeres fritt.

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

**Konfliktsjekk mot discgolf:** hver sikkerhetssone testes mot discgolfbanen
(utkast, kurver og fortettede fairway-punkter fra `course.geojson`). Soner som
overlapper et discgolf-element tegnes **røde** med ⚠-varsel som lister hvilke hull
de treffer; klare soner er **oransje** (uten bakstopp) eller **grønne** (naturlig
bakstopp). Pila ved blinket viser **skyteretning**. Tegnforklaringen nede til
høyre forklarer fargene.

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
