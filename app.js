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

    document.title =
      `${fc.metadata.course} – ${fc.metadata.layout} (Kartverket)`;
  })
  .catch((e) => alert('Kunne ikke laste course.geojson: ' + e.message));

// ---- Feltbane (forslag) – fiktiv bueskytingsbane, sikkerhetsvurdert --------
fetch('./fictive_field.geojson')
  .then((r) => r.json())
  .then((fc) => {
    const group = L.layerGroup();
    fc.features.forEach((f) => {
      if (f.properties.kind === 'safety') {
        L.geoJSON(f, { style: { color: '#c0392b', weight: 1, fillColor: '#e74c3c',
          fillOpacity: 0.12, opacity: 0.4 } }).addTo(group);
      } else if (f.properties.kind === 'route') {
        // walking route between shooting positions (4 → … → 18)
        L.polyline(f.geometry.coordinates.map((c) => [c[1], c[0]]),
          { color: '#1f7a1f', weight: 3, opacity: 0.85, dashArray: '2 8', lineCap: 'round' })
          .bindPopup('Gangrute (rekkefølge 1→12)').addTo(group);
      } else {
        const cs = f.geometry.coordinates;
        L.polyline(cs.map((c) => [c[1], c[0]]),
          { color: '#0b2e7a', weight: 4, opacity: 0.95, lineCap: 'round' })
          .bindPopup(`<b>Mål ${f.properties.station}</b><br>${f.properties.distance} m`).addTo(group);
        const mid = [(cs[0][1] + cs[1][1]) / 2, (cs[0][0] + cs[1][0]) / 2];
        L.marker(mid, { interactive: false, icon: L.divIcon({ className: 'bue-label',
          html: `${f.properties.station} <span>${f.properties.distance} m</span>`,
          iconSize: [0, 0], iconAnchor: [0, 0] }) }).addTo(group);
      }
    });
    layersControl.addOverlay(group, 'Feltbane (forslag)');
  })
  .catch(() => {/* fil mangler – hopp over */});

// ---- Geolocation: "show my location" (works over HTTPS) --------------------
function addLocateControl(map) {
  let watching = false, marker = null, circle = null;
  const Ctl = L.Control.extend({
    options: { position: 'topleft' },
    onAdd() {
      const a = L.DomUtil.create('a', 'leaflet-bar leaflet-control locate-btn');
      a.href = '#'; a.title = 'Vis min posisjon'; a.textContent = '📍';
      L.DomEvent.on(a, 'click', L.DomEvent.stop);
      L.DomEvent.on(a, 'click', () => {
        watching = !watching;
        a.classList.toggle('active', watching);
        if (watching) {
          map.locate({ watch: true, setView: true, maxZoom: 17, enableHighAccuracy: true });
        } else {
          map.stopLocate();
          if (marker) { map.removeLayer(marker); marker = null; }
          if (circle) { map.removeLayer(circle); circle = null; }
        }
      });
      return a;
    },
  });
  map.addControl(new Ctl());
  map.on('locationfound', (e) => {
    if (!marker) marker = L.circleMarker(e.latlng, { radius: 7, color: '#fff', weight: 2,
      fillColor: '#1a73e8', fillOpacity: 1 }).addTo(map);
    else marker.setLatLng(e.latlng);
    if (!circle) circle = L.circle(e.latlng, { radius: e.accuracy, color: '#1a73e8',
      weight: 1, fillOpacity: 0.1 }).addTo(map);
    else { circle.setLatLng(e.latlng); circle.setRadius(e.accuracy); }
  });
  map.on('locationerror', (e) => alert('Fant ikke posisjon: ' + e.message));
}
