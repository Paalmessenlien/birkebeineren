/*
 * app.js — render the extracted UDisc markings on a local Kartverket map.
 *
 * Base layers are Kartverket's free open WMTS tiles (the same data behind
 * norgeskart.no). The "webmercator" matrixset matches Leaflet's default
 * EPSG:3857 {z}/{y}/{x} scheme, so no custom CRS is required.
 */

// ---- Kartverket base layers ------------------------------------------------
const KV = 'https://cache.kartverket.no/v1/wmts/1.0.0';
const kvAttr = '© <a href="https://www.kartverket.no/">Kartverket</a>';

const topo = L.tileLayer(`${KV}/topo/default/webmercator/{z}/{y}/{x}.png`, {
  attribution: kvAttr, maxZoom: 20,
});
const gray = L.tileLayer(`${KV}/topograatone/default/webmercator/{z}/{y}/{x}.png`, {
  attribution: kvAttr, maxZoom: 20,
});

// Satellite / aerial. The Norwegian "Norge i bilder" (NIB) WMS needs a Geonorge
// token, so we use Esri World Imagery, which is open and covers Norway in high
// resolution. (Swap in NIB below if you have a token.)
const sat = L.tileLayer(
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  { attribution: 'Imagery © Esri, Maxar, Earthstar Geographics',
    maxZoom: 20, maxNativeZoom: 19 });
// const sat = L.tileLayer.wms('https://wms.geonorge.no/skwms1/wms.nib?', {
//   layers: 'ortofoto', format: 'image/jpeg', version: '1.3.0',
//   attribution: '© Norge i bilder', maxZoom: 20 }); // requires token

// ---- Property parcels (Matrikkelen) as a transparent WMS overlay -----------
// Open Kartverket "Matrikkelkart" WMS. Shows eiendomsteiger (parcels) and
// eiendomsgrenser (boundaries) with matrikkelnummer (gnr/bnr) — i.e. the
// ownership *subdivision*. NB: actual owner names (Grunnboken) are NOT public.
const MATRIKKEL_WMS = 'https://wms.geonorge.no/skwms1/wms.matrikkelkart';
const eiendom = L.tileLayer.wms(MATRIKKEL_WMS + '?', {
  layers: 'teig,eiendomsgrense,grensepunkt',
  format: 'image/png', transparent: true, version: '1.3.0',
  attribution: kvAttr + ' – Matrikkelen', maxZoom: 20, opacity: 0.7,
});

// gnr/bnr labels are drawn client-side (see loadParcelLabels below).
const parcelLabels = L.layerGroup();

const map = L.map('map', { layers: [topo] });
window.map = map; // exposed for debugging / georeferencing
const layersControl = L.control.layers(
  { 'Topografisk': topo, 'Gråtone': gray, 'Satellitt': sat },
  { 'Eiendomsgrenser': eiendom, 'Gnr/bnr-etiketter': parcelLabels },
  { collapsed: false }
).addTo(map);

// ---- "Show my location" control --------------------------------------------
addLocateControl(map);

// ---- Matrikkel GetFeatureInfo helpers --------------------------------------

// Query the teig (parcel) at a lat/lng. Resolves to { mnr, kommune, kommunenr,
// areal, point:[lat,lng] } or null if no parcel there. Uses a small bbox
// centred on the point with a full 256×256 image (i,j = centre): MapServer's
// GetFeatureInfo silently misses on tiny images, so the image must be full-size.
function queryParcelAt(lat, lng) {
  const d = 0.0006;
  const params = new URLSearchParams({
    service: 'WMS', request: 'GetFeatureInfo', version: '1.3.0',
    layers: 'teig', query_layers: 'teig', crs: 'EPSG:4326',
    info_format: 'text/plain', width: 256, height: 256, i: 128, j: 128,
    // WMS 1.3.0 + EPSG:4326 axis order is lat,lon (y,x):
    bbox: `${lat - d},${lng - d},${lat + d},${lng + d}`,
  });
  return fetch(`${MATRIKKEL_WMS}?${params}`)
    .then((r) => r.text())
    .then((text) => {
      const get = (k) => (text.match(new RegExp(k + " = '([^']*)'")) || [])[1];
      const mnr = get('matrikkelnummertekst');
      if (!mnr) return null;
      return {
        mnr,
        kommune: get('kommunenavn') || '',
        kommunenr: get('kommunenummer') || '',
        areal: get('lagretberegnetareal'),
        point: decodeEwkbPoint(get('representasjonspunkt')) || [lat, lng],
      };
    })
    .catch(() => null);
}

// Decode an EWKB hex point (little-endian, SRID 4258 ≈ WGS84) → [lat, lng].
function decodeEwkbPoint(hex) {
  if (!hex) return null;
  const buf = new Uint8Array(hex.match(/../g).map((h) => parseInt(h, 16))).buffer;
  const dv = new DataView(buf);
  const le = dv.getUint8(0) === 1;
  const type = dv.getUint32(1, le);
  let off = 5;
  if (type & 0x20000000) off += 4; // skip SRID word when present
  const lng = dv.getFloat64(off, le);
  const lat = dv.getFloat64(off + 8, le);
  return [lat, lng];
}

// Click anywhere (while Eiendomsgrenser is on) for a parcel popup.
map.on('click', (e) => {
  if (!map.hasLayer(eiendom)) return;
  queryParcelAt(e.latlng.lat, e.latlng.lng).then((info) => {
    if (!info) return;
    const html =
      `<b>Eiendom ${info.mnr}</b><br>` +
      `${info.kommune} (kommune ${info.kommunenr || '–'})<br>` +
      (info.areal ? `Areal: ${Math.round(+info.areal).toLocaleString('no')} m²<br>` : '') +
      `<small>Matrikkelnr. (gnr/bnr) · eier ikke offentlig</small>`;
    L.popup({ maxWidth: 300 }).setLatLng(e.latlng).setContent(html).openOn(map);
  });
});

// Populate gnr/bnr labels the first time the layer is switched on. We sample
// the parcel under each tee/basket, dedupe by matrikkelnummer, and drop one
// label at each parcel's official representasjonspunkt.
let parcelLabelsLoaded = false;
parcelLabels.on('add', () => {
  if (parcelLabelsLoaded || !window.__coursePoints) return;
  parcelLabelsLoaded = true;
  const seen = new Map(); // mnr -> point
  Promise.all(window.__coursePoints.map((pt) => queryParcelAt(pt[0], pt[1])))
    .then((results) => {
      for (const info of results) {
        if (info && !seen.has(info.mnr)) seen.set(info.mnr, info.point);
      }
      for (const [mnr, point] of seen) {
        L.marker(point, {
          interactive: false,
          icon: L.divIcon({ className: 'mnr-label', html: mnr,
                            iconSize: [0, 0], iconAnchor: [0, 0] }),
        }).addTo(parcelLabels);
      }
    });
});

// ---- Marker builders -------------------------------------------------------

// Tee: small filled circle in the tee's label colour (purple "Lilla", green "Grønn").
function teeMarker(latlng, props) {
  return L.circleMarker(latlng, {
    radius: 6, weight: 2, color: '#fff',
    fillColor: cssColor(props.color), fillOpacity: 1,
  }).bindPopup(
    `<b>Hull ${props.hole}</b><br>Utkast: ${props.label || '–'}`
  );
}

// Basket: a single divIcon marker = ringed target + hole-number badge.
// (pointToLayer must return ONE marker-like layer, not a LayerGroup.)
function basketMarker(latlng, props) {
  const html =
    `<div class="basket-wrap">` +
      `<div class="basket-icon"></div>` +
      `<div class="hole-badge">${props.hole}</div>` +
    `</div>`;
  return L.marker(latlng, {
    icon: L.divIcon({ className: 'basket-div', html, iconSize: [16, 16], iconAnchor: [8, 8] }),
  }).bindPopup(`<b>Hull ${props.hole}</b><br>Kurv`);
}

// Map UDisc label colours onto displayable CSS colours.
function cssColor(c) {
  return ({ purple: '#7b3fe4', green: '#2e9e3f', blue: '#1f6fde',
            red: '#d63333', orange: '#e07b00', gray: '#888' })[c] || c || '#888';
}

// ---- YOUR TURN: fairway styling -------------------------------------------
//
// styleFairway(feature) returns a Leaflet path-style object for one fairway
// LineString. This is a real design choice, not boilerplate — the course has
// two tees per hole ("Lilla"/purple and "Grønn"/green), and their fairways
// overlap on the map. How do you keep them readable?
//
// Available on `feature.properties`: { hole, par, distance, color, tee }
//   - color : "purple" | "green" (use cssColor(color) for a hex value)
//   - tee   : "Lilla" | "Grønn"
//   - distance : metres,  par : 3 | 4
//
// Ideas to consider (pick what you like, ~5–10 lines):
//   • colour the line by tee colour (cssColor(feature.properties.color))
//   • dash the shorter/secondary "Grønn" tee so it reads distinctly
//     (Leaflet uses `dashArray: '6 6'`)
//   • vary `weight` or `opacity` by par or distance
//   • add `lineCap: 'round'` for nicer joins
//
// TODO: implement and return a style object, e.g.
//   return { color: '#7b3fe4', weight: 4, opacity: 0.9 };
function styleFairway(feature) {
  const p = feature.properties;
  return {
    color: cssColor(p.color),                    // lilla / grønn etter utkast
    weight: p.par >= 4 ? 5 : 4,                   // tykkere for lengre hull
    opacity: 0.9,
    dashArray: p.tee === 'Grønn' ? '6 6' : null,  // stiple det korte utkastet
    lineCap: 'round',
  };
}

// ---- Load data & draw ------------------------------------------------------
// Disc golf reference points (tees, baskets, densified fairway vertices), used
// to test whether an archery safety zone overlaps the disc golf course. Felt
// overlays wait on dgReady so the conflict check has data to test against.
let dgPoints = [];          // [{ lat, lng, hole }]
let dgHoleBearing = {};     // hole -> disc golf throw bearing (tee→basket, deg)
let dgReadyResolve;
const dgReady = new Promise((res) => { dgReadyResolve = res; });

fetch('./course.geojson')
  .then((r) => r.json())
  .then((fc) => {
    const layer = L.geoJSON(fc, {
      pointToLayer: (f, latlng) =>
        f.properties.kind === 'tee' ? teeMarker(latlng, f.properties)
                                    : basketMarker(latlng, f.properties),
      style: (f) => (f.properties.kind === 'fairway' ? styleFairway(f) : undefined),
      onEachFeature: (f, lyr) => {
        if (f.properties.kind === 'fairway') {
          lyr.bindPopup(
            `<b>Hull ${f.properties.hole}</b> (${f.properties.tee})<br>` +
            `Par ${f.properties.par} · ${f.properties.distance} m`
          );
        }
      },
    }).addTo(map);

    // Make the course a toggleable overlay (on by default).
    layersControl.addOverlay(layer, 'Discgolfbane');

    map.fitBounds(layer.getBounds().pad(0.1));

    // Sample points (tees + baskets) for on-demand gnr/bnr parcel labels.
    window.__coursePoints = fc.features
      .filter((f) => f.properties.kind === 'tee' || f.properties.kind === 'basket')
      .map((f) => [f.geometry.coordinates[1], f.geometry.coordinates[0]]); // [lat,lng]

    // Build the disc golf reference point cloud for archery conflict testing.
    fc.features.forEach((f) => {
      const p = f.properties;
      if (p.kind === 'tee' || p.kind === 'basket') {
        dgPoints.push({ lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0], hole: p.hole });
      } else if (p.kind === 'fairway') {
        const cs = f.geometry.coordinates;            // [lng,lat] pairs
        // Disc golf throw bearing for this hole (tee→basket); keep the longest.
        const tb = fbBearing(cs[0][1], cs[0][0], cs[cs.length-1][1], cs[cs.length-1][0]);
        const tbLen = fbDistM(cs[0][1], cs[0][0], cs[cs.length-1][1], cs[cs.length-1][0]);
        if (!dgHoleBearing[p.hole] || tbLen > dgHoleBearing[p.hole].len) {
          dgHoleBearing[p.hole] = { brg: tb, len: tbLen };
        }
        for (let i = 0; i < cs.length - 1; i++) {
          const a = cs[i], b = cs[i + 1];
          const segM = fbDistM(a[1], a[0], b[1], b[0]);
          const steps = Math.max(1, Math.ceil(segM / 5));   // sample every ~5 m
          for (let s = 0; s <= steps; s++) {
            const t = s / steps;
            dgPoints.push({ lat: a[1] + (b[1] - a[1]) * t,
                            lng: a[0] + (b[0] - a[0]) * t, hole: p.hole });
          }
        }
      }
    });

    document.title =
      `${fc.metadata.course} – ${fc.metadata.layout} (Kartverket)`;
  })
  .catch((e) => alert('Kunne ikke laste course.geojson: ' + e.message))
  .finally(() => dgReadyResolve());

// ---- Geometry helpers (metre-scale, equirectangular – fine over a course) ---
function fbBearing(aLat, aLng, bLat, bLng) {
  const r = Math.PI / 180, y = Math.sin((bLng - aLng) * r) * Math.cos(bLat * r);
  const x = Math.cos(aLat * r) * Math.sin(bLat * r) -
            Math.sin(aLat * r) * Math.cos(bLat * r) * Math.cos((bLng - aLng) * r);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}
function fbDest(lat, lng, bearingDeg, distM) {
  const br = bearingDeg * Math.PI / 180;
  return [lat + (distM * Math.cos(br)) / 111320,
          lng + (distM * Math.sin(br)) / (111320 * Math.cos(lat * Math.PI / 180))];
}
function fbDistM(aLat, aLng, bLat, bLng) {
  const dLat = (bLat - aLat) * 111320;
  const dLng = (bLng - aLng) * 111320 * Math.cos(((aLat + bLat) / 2) * Math.PI / 180);
  return Math.hypot(dLat, dLng);
}
// Smallest angle between two bearings (0–180°).
function fbAngDiff(a, b) { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; }
// Direction of an archery shot vs a disc golf hole's throw:
//   ≤45° "samme" (same way), ≤90° "kryssende", else "motgående" (opposing).
function fbDirCat(diff) { return diff <= 45 ? 'samme' : diff <= 90 ? 'kryssende' : 'motgående'; }
// Ray-casting point-in-polygon. ring = [[lat,lng], ...]; pt = {lat,lng}.
function pointInPolygon(pt, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const yi = ring[i][0], xi = ring[i][1], yj = ring[j][0], xj = ring[j][1];
    const intersect = ((yi > pt.lat) !== (yj > pt.lat)) &&
      (pt.lng < ((xj - xi) * (pt.lat - yi)) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

// ---- Render a field-archery FeatureCollection into a toggleable layer ------
function renderFeltLayer(fc) {
  const group = L.layerGroup();
  // Only auto-generate safety zones when the file has none of its own.
  const hasSafety = (fc.features || []).some(
    (f) => f.properties && f.properties.kind === 'safety');
  (fc.features || []).forEach((f) => {
    if (f.properties.kind === 'safety') {
      L.geoJSON(f, { style: { color: '#c0392b', weight: 1, fillColor: '#e74c3c',
        fillOpacity: 0.12, opacity: 0.4 } }).addTo(group);
    } else if (f.properties.kind === 'route') {
      L.polyline(f.geometry.coordinates.map((c) => [c[1], c[0]]),
        { color: '#1f7a1f', weight: 3, opacity: 0.85, dashArray: '2 8', lineCap: 'round' })
        .bindPopup('Gangrute').addTo(group);
    } else {
      const cs = f.geometry.coordinates;
      const sLat = cs[0][1], sLng = cs[0][0];
      const tLat = cs[cs.length - 1][1], tLng = cs[cs.length - 1][0];
      const dist = Number(f.properties.distance) || 0;
      const brg = fbBearing(sLat, sLng, tLat, tLng);

      // World Archery overshoot-zone funnel: a cone from the shooting peg whose
      // safe half-width grows as distance/6 (min 5 m), continued FELT_OVERSHOOT
      // metres past the blink. Coloured red where it overlaps the disc golf
      // course (a conflict), orange otherwise.
      if (!hasSafety) {
        const FUNNEL_MIN = 5;
        // Elevation-adjusted overshoot: shorter where the terrain rises into a
        // natural backstop, longer on downhill shots (baked into the geojson by
        // the Kartverket height analysis). Falls back to the WA 50 m minimum.
        const overshoot = Number(f.properties.overshoot_m) || 50;
        const R = dist + overshoot;                      // funnel reach from peg
        const farHalf = Math.max(FUNNEL_MIN, R / 6);
        const farC = fbDest(sLat, sLng, brg, R);
        const ring = [
          fbDest(sLat, sLng, brg - 90, FUNNEL_MIN),
          fbDest(farC[0], farC[1], brg - 90, farHalf),
          fbDest(farC[0], farC[1], brg + 90, farHalf),
          fbDest(sLat, sLng, brg + 90, FUNNEL_MIN),
        ];
        // Which disc golf holes the zone overlaps, and the shot's direction
        // relative to each hole's throw. Same-direction overlaps are NOT a real
        // conflict (both send projectiles the same way, the area is open and
        // both sports wait their turn); only opposing throws are flagged red.
        const hit = {};
        dgPoints.forEach((p) => { if (pointInPolygon(p, ring)) hit[p.hole] = true; });
        const holes = Object.keys(hit).sort((a, b) => a - b);
        const order = { samme: 0, kryssende: 1, 'motgående': 2 };
        let worst = null, worstHoles = [];
        holes.forEach((h) => {
          const hb = dgHoleBearing[h];
          if (!hb) return;
          const cat = fbDirCat(fbAngDiff(brg, hb.brg));
          if (worst === null || order[cat] > order[worst]) { worst = cat; worstHoles = [h]; }
          else if (cat === worst) worstHoles.push(h);
        });
        const backstop = f.properties.backstop_m;
        const slopeNum = Number(f.properties.slope_deg);
        const carryRisk = !backstop && ((slopeNum <= -8) || dist >= 60);  // langt utløp
        const opposing = worst === 'motgående';
        const crossing = worst === 'kryssende';
        // Colour: red = opposing throw (real conflict); amber = needs a look
        // (crossing, or long/steep overshoot); green = natural backstop; orange
        // = clear / same-direction.
        const col = opposing ? '#c0392b'
          : (crossing || carryRisk) ? '#e67e22'
          : (backstop ? '#1f9d55' : '#e8a33d');
        const attention = opposing || crossing || carryRisk;
        const terr = f.properties.terrain_note ? '<br>Terreng: ' + esc(f.properties.terrain_note) : '';
        const slope = Number.isFinite(slopeNum) ? '<br>Helling skudd: ' + slopeNum + '°' : '';
        let dirLine = '';
        if (worst) {
          const label = worst === 'samme' ? 'samme kasteretning som discgolf (håndteres med oversikt og venting)'
            : worst === 'kryssende' ? 'kryssende discgolf-retning – sjekk feltet før skudd'
            : 'motgående discgolf-retning – vent til feltet er klart';
          dirLine = '<br>Discgolf-hull i sonen: ' + esc(holes.join(', ')) +
            '<br>Retning: ' + esc(label);
        }
        const head = opposing ? '<b>⚠ Motgående discgolf-retning</b><br>'
          : crossing ? '<b>Kryssende discgolf-retning</b><br>' : '';
        const popup = head + 'WA-sikkerhetssone · trakt ±' + (dist / 6).toFixed(1) +
          ' m, ' + Math.round(overshoot) + ' m overskyting' + dirLine + slope + terr;
        L.polygon(ring, { color: col, weight: attention ? 2 : 1, fillColor: col,
          fillOpacity: attention ? 0.16 : 0.10, opacity: attention ? 0.7 : 0.5,
          dashArray: attention ? null : '4 5' }).bindPopup(popup).addTo(group);
      }

      // Shooting lane
      L.polyline(cs.map((c) => [c[1], c[0]]),
        { color: '#0b2e7a', weight: 4, opacity: 0.95, lineCap: 'round' })
        .bindPopup('<b>Mål ' + esc(f.properties.station) + '</b><br>' + esc(f.properties.distance) +
          ' m<br>Skyteretning: ' + Math.round(brg) + '°').addTo(group);

      // Firing-direction arrow at the blink
      L.marker([tLat, tLng], { interactive: false, icon: L.divIcon({
        className: 'shoot-arrow', html: '<i style="transform:rotate(' + brg + 'deg)"></i>',
        iconSize: [16, 16], iconAnchor: [8, 8] }) }).addTo(group);

      // Numbered target badge at the blink (the station/target number)
      L.marker([tLat, tLng], { icon: L.divIcon({ className: 'bue-target-div',
        html: '<div class="bue-target">' + esc(f.properties.station) + '</div>',
        iconSize: [20, 20], iconAnchor: [10, 10] }) })
        .bindPopup('<b>Mål ' + esc(f.properties.station) + '</b><br>' +
          esc(f.properties.distance) + ' m · blink').addTo(group);

      // Station label at the lane midpoint, with an uphill/downhill slope badge
      const mid = [(sLat + tLat) / 2, (sLng + tLng) / 2];
      const sd = f.properties.slope_deg;
      const slopeBadge = (sd != null)
        ? ' <span>' + (sd > 1 ? '↗' : sd < -1 ? '↘' : '→') + Math.abs(Math.round(sd)) + '°</span>'
        : '';
      L.marker(mid, { interactive: false, icon: L.divIcon({ className: 'bue-label',
        html: esc(f.properties.station) + ' <span>' + esc(f.properties.distance) + ' m</span>' + slopeBadge,
        iconSize: [0, 0], iconAnchor: [0, 0] }) }).addTo(group);
    }
  });
  return group;
}

// Felt overlays are built only after the disc golf points are cached, so each
// archery safety zone can be tested for conflicts against the disc golf course.
dgReady.then(() => {
  // Birkebeineren feltbane (laget i editoren, lagret som fil)
  fetch('./birkebeineren-feltbane.geojson')
    .then((r) => r.json())
    .then((fc) => layersControl.addOverlay(renderFeltLayer(fc), '🎯 Birkebeineren feltbane'))
    .catch(() => {/* fil mangler – hopp over */});

  // Saved courses from the editor (localStorage library) — each its own overlay
  feltLibList().forEach((entry) => {
    try { layersControl.addOverlay(renderFeltLayer(entry.geojson), '🎯 ' + esc(entry.name)); }
    catch (e) {/* skip malformed */}
  });
});

// ---- Legend explaining the felt safety overlay -----------------------------
const feltLegend = L.control({ position: 'bottomright' });
feltLegend.onAdd = function () {
  const div = L.DomUtil.create('div', 'felt-legend');
  div.innerHTML =
    '<b>Feltbane – sikkerhet (WA)</b>' +
    '<div><span class="lg-arrow"></span> Skyteretning (↗/↘ = helling)</div>' +
    '<div><span class="lg-sw lg-safe"></span> Sikkerhetssone – samme retning som discgolf</div>' +
    '<div><span class="lg-sw lg-backstop"></span> Naturlig bakstopp (terreng stiger bak)</div>' +
    '<div><span class="lg-sw lg-attention"></span> Krever oversikt (kryssende / langt utløp)</div>' +
    '<div><span class="lg-sw lg-conflict"></span> Motgående discgolf-retning</div>';
  return div;
};
feltLegend.addTo(map);

// ---- Geolocation: "show my location" + auto-follow toggle (HTTPS only) -----
function addLocateControl(map) {
  let watching = false, following = false, marker = null, circle = null;
  let btnLoc, btnFol;
  function start() { watching = true; btnLoc.classList.add('active');
    map.locate({ watch: true, enableHighAccuracy: true }); }
  function stop() { watching = false; following = false; map.stopLocate();
    btnLoc.classList.remove('active'); btnFol.classList.remove('active');
    if (marker) { map.removeLayer(marker); marker = null; }
    if (circle) { map.removeLayer(circle); circle = null; } }

  const Ctl = L.Control.extend({ options: { position: 'topleft' }, onAdd() {
    const div = L.DomUtil.create('div', 'leaflet-bar');
    btnLoc = L.DomUtil.create('a', 'locate-btn', div);
    btnLoc.href = '#'; btnLoc.title = 'Vis min posisjon'; btnLoc.textContent = '📍';
    btnFol = L.DomUtil.create('a', 'locate-btn', div);
    btnFol.href = '#'; btnFol.title = 'Følg meg (auto-sentrer)'; btnFol.textContent = '🧭';
    L.DomEvent.on(btnLoc, 'click', L.DomEvent.stop).on(btnLoc, 'click', () => {
      if (watching) stop(); else { start(); following = true; btnFol.classList.add('active'); }
    });
    L.DomEvent.on(btnFol, 'click', L.DomEvent.stop).on(btnFol, 'click', () => {
      if (!watching) start();
      following = !following;
      btnFol.classList.toggle('active', following);
      if (following && marker) map.setView(marker.getLatLng(), Math.max(map.getZoom(), 16));
    });
    return div;
  } });
  map.addControl(new Ctl());

  map.on('locationfound', (e) => {
    if (!marker) marker = L.circleMarker(e.latlng, { radius: 7, color: '#fff', weight: 2,
      fillColor: '#1a73e8', fillOpacity: 1 }).addTo(map);
    else marker.setLatLng(e.latlng);
    if (!circle) circle = L.circle(e.latlng, { radius: e.accuracy, color: '#1a73e8',
      weight: 1, fillOpacity: 0.1 }).addTo(map);
    else { circle.setLatLng(e.latlng); circle.setRadius(e.accuracy); }
    if (following) map.setView(e.latlng, Math.max(map.getZoom(), 16), { animate: true });
  });
  map.on('locationerror', (e) => { alert('Fant ikke posisjon: ' + e.message); stop(); });
  // manual pan turns auto-follow off so it doesn't fight the user
  map.on('dragstart', () => { if (following) { following = false; btnFol.classList.remove('active'); } });
}
