/*
 * editor.js — browser editor for the field-archery ("feltbane") course.
 *
 * Draw each station as a shooting lane (skytepunkt → blink). The lane length on
 * the map is the shooting distance, computed automatically (geodesic metres).
 * Everything is stored client-side in localStorage and can be exported/imported
 * as GeoJSON — no server needed, so it runs as-is on GitHub Pages.
 */

// ---- Base layers (Kartverket — same open WMTS as the viewer) ---------------
const KV = 'https://cache.kartverket.no/v1/wmts/1.0.0';
const kvAttr = '© <a href="https://www.kartverket.no/">Kartverket</a>';
const topo = L.tileLayer(`${KV}/topo/default/webmercator/{z}/{y}/{x}.png`, { attribution: kvAttr, maxZoom: 20 });
const gray = L.tileLayer(`${KV}/topograatone/default/webmercator/{z}/{y}/{x}.png`, { attribution: kvAttr, maxZoom: 20 });
const sat = L.tileLayer(
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  { attribution: 'Imagery © Esri', maxZoom: 20, maxNativeZoom: 19 });

const map = L.map('map', { layers: [topo] }).setView([61.1396, 10.5129], 16);
window.map = map; // exposed for debugging
L.control.layers({ 'Topografisk': topo, 'Gråtone': gray, 'Satellitt': sat }, null,
  { collapsed: true }).addTo(map);

// "Show my location" (works over HTTPS) — handy for placing stations on-site
(function addLocate() {
  let watching = false, marker = null, circle = null;
  const Ctl = L.Control.extend({ options: { position: 'topleft' }, onAdd() {
    const a = L.DomUtil.create('a', 'leaflet-bar leaflet-control locate-btn');
    a.href = '#'; a.title = 'Vis min posisjon'; a.textContent = '📍';
    L.DomEvent.on(a, 'click', L.DomEvent.stop);
    L.DomEvent.on(a, 'click', () => {
      watching = !watching; a.classList.toggle('active', watching);
      if (watching) map.locate({ watch: true, setView: true, maxZoom: 18, enableHighAccuracy: true });
      else { map.stopLocate(); if (marker) { map.removeLayer(marker); marker = null; } if (circle) { map.removeLayer(circle); circle = null; } }
    });
    return a;
  } });
  map.addControl(new Ctl());
  map.on('locationfound', (e) => {
    if (!marker) marker = L.circleMarker(e.latlng, { radius: 7, color: '#fff', weight: 2, fillColor: '#1a73e8', fillOpacity: 1 }).addTo(map);
    else marker.setLatLng(e.latlng);
    if (!circle) circle = L.circle(e.latlng, { radius: e.accuracy, color: '#1a73e8', weight: 1, fillOpacity: 0.1 }).addTo(map);
    else { circle.setLatLng(e.latlng); circle.setRadius(e.accuracy); }
  });
  map.on('locationerror', (e) => alert('Fant ikke posisjon: ' + e.message));
})();

// ---- State -----------------------------------------------------------------
const STORE_KEY = 'feltbane_v1';
let stations = [];          // { number, distance, peg:[lat,lng], target:[lat,lng] }
const editLayer = L.layerGroup().addTo(map);
let addMode = false;
let pendingPeg = null;      // first click while adding
let previewLine = null;

// ---- Icons -----------------------------------------------------------------
const pegIcon = L.divIcon({ className: '', html: '<div class="peg-icon"></div>', iconSize: [12, 12], iconAnchor: [6, 6] });
const tgtIcon = L.divIcon({ className: '', html: '<div class="tgt-icon"></div>', iconSize: [16, 16], iconAnchor: [8, 8] });

// ---- Persistence -----------------------------------------------------------
function save() {
  localStorage.setItem(STORE_KEY, JSON.stringify(stations));
  document.getElementById('count').textContent = stations.length;
}
function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) stations = JSON.parse(raw);
  } catch (e) { stations = []; }
}

function nextNumber() {
  const nums = stations.map((s) => parseInt(s.number, 10)).filter((n) => !isNaN(n));
  return nums.length ? Math.max(...nums) + 1 : 1;
}
function distOf(peg, target) {
  return Math.round(L.latLng(peg).distanceTo(L.latLng(target)) * 100) / 100;
}

// ---- Rendering -------------------------------------------------------------
function render() {
  editLayer.clearLayers();
  stations.forEach((s, idx) => {
    const line = L.polyline([s.peg, s.target], { color: '#0b2e7a', weight: 4, opacity: 0.95, lineCap: 'round' });
    const peg = L.marker(s.peg, { icon: pegIcon, draggable: true });
    const tgt = L.marker(s.target, { icon: tgtIcon, draggable: true });

    peg.bindTooltip(labelHtml(s), { permanent: true, direction: 'right', offset: [8, 0], className: 'bue-label' });

    function refresh() {
      s.peg = [peg.getLatLng().lat, peg.getLatLng().lng];
      s.target = [tgt.getLatLng().lat, tgt.getLatLng().lng];
      line.setLatLngs([s.peg, s.target]);
      s.distance = distOf(s.peg, s.target);
      peg.setTooltipContent(labelHtml(s));
    }
    peg.on('drag', () => { line.setLatLngs([peg.getLatLng(), tgt.getLatLng()]); });
    tgt.on('drag', () => { line.setLatLngs([peg.getLatLng(), tgt.getLatLng()]); });
    peg.on('dragend', () => { refresh(); save(); });
    tgt.on('dragend', () => { refresh(); save(); });

    peg.bindPopup(() => editForm(idx));
    line.on('click', () => peg.openPopup());

    editLayer.addLayer(line); editLayer.addLayer(tgt); editLayer.addLayer(peg);
  });
  save();
}
function labelHtml(s) { return `${s.number} <span>${s.distance} m</span>`; }

// Edit popup for a station
function editForm(idx) {
  const s = stations[idx];
  const div = L.DomUtil.create('div', 'edit-form');
  div.innerHTML =
    `<label>Stasjonsnummer</label><input id="ef-num" value="${s.number}">` +
    `<label>Avstand (m)</label><input id="ef-dist" type="number" step="0.01" value="${s.distance}">` +
    `<button class="save">Lagre</button><button class="del">Slett stasjon</button>`;
  div.querySelector('.save').onclick = () => {
    s.number = div.querySelector('#ef-num').value.trim();
    s.distance = parseFloat(div.querySelector('#ef-dist').value) || s.distance;
    map.closePopup(); render();
  };
  div.querySelector('.del').onclick = () => {
    stations.splice(idx, 1); map.closePopup(); render();
  };
  return div;
}

// ---- Add-station interaction -----------------------------------------------
const addBtn = document.getElementById('addBtn');
const hint = document.getElementById('hint');
addBtn.onclick = () => setAddMode(!addMode);
function setAddMode(on) {
  addMode = on;
  addBtn.classList.toggle('active', on);
  addBtn.textContent = on ? '✓ Ferdig (avslutt)' : '➕ Ny stasjon';
  L.DomUtil[on ? 'addClass' : 'removeClass'](map.getContainer(), 'leaflet-crosshair');
  if (!on) { clearPending(); hint.innerHTML = 'Klikk «Ny stasjon» for å legge til flere.'; }
  else hint.innerHTML = '<b>Klikk skytepunktet</b> i kartet …';
}
function clearPending() {
  if (pendingPeg) { map.removeLayer(pendingPeg.marker); pendingPeg = null; }
  if (previewLine) { map.removeLayer(previewLine); previewLine = null; }
}

map.on('click', (e) => {
  if (!addMode) return;
  if (!pendingPeg) {
    pendingPeg = { latlng: e.latlng, marker: L.marker(e.latlng, { icon: pegIcon }).addTo(map) };
    hint.innerHTML = 'Klikk <b>blinken</b> (målet) …';
  } else {
    const peg = [pendingPeg.latlng.lat, pendingPeg.latlng.lng];
    const target = [e.latlng.lat, e.latlng.lng];
    stations.push({ number: String(nextNumber()), distance: distOf(peg, target), peg, target });
    clearPending();
    render();
    hint.innerHTML = '✓ Lagt til. <b>Klikk skytepunktet</b> til neste stasjon, eller «Ferdig».';
  }
});
map.on('mousemove', (e) => {
  if (!addMode || !pendingPeg) return;
  const pts = [pendingPeg.latlng, e.latlng];
  if (previewLine) previewLine.setLatLngs(pts);
  else previewLine = L.polyline(pts, { color: '#0b2e7a', dashArray: '4 6', weight: 2 }).addTo(map);
});

// ---- Export / Import / Clear ----------------------------------------------
function toGeoJSON() {
  return {
    type: 'FeatureCollection',
    metadata: { name: 'Felt bueskyting', created_with: 'feltbane-editor' },
    features: stations.map((s) => ({
      type: 'Feature',
      properties: { station: s.number, distance: s.distance, layer: 'felt bueskyting' },
      geometry: { type: 'LineString', coordinates: [[s.peg[1], s.peg[0]], [s.target[1], s.target[0]]] },
    })),
  };
}
document.getElementById('exportBtn').onclick = () => {
  const blob = new Blob([JSON.stringify(toGeoJSON(), null, 2)], { type: 'application/geo+json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = 'feltbane.geojson'; a.click();
  URL.revokeObjectURL(a.href);
};
document.getElementById('importBtn').onclick = () => document.getElementById('fileInput').click();
document.getElementById('fileInput').onchange = (e) => {
  const file = e.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const fc = JSON.parse(reader.result);
      stations = (fc.features || []).map((f) => {
        const c = f.geometry.coordinates;
        return { number: String(f.properties.station ?? ''),
                 distance: f.properties.distance ?? distOf([c[0][1], c[0][0]], [c[c.length-1][1], c[c.length-1][0]]),
                 peg: [c[0][1], c[0][0]], target: [c[c.length-1][1], c[c.length-1][0]] };
      });
      render();
      if (stations.length) map.fitBounds(L.latLngBounds(stations.flatMap((s) => [s.peg, s.target])).pad(0.2));
    } catch (err) { alert('Kunne ikke lese filen: ' + err.message); }
  };
  reader.readAsText(file);
  e.target.value = '';
};
document.getElementById('clearBtn').onclick = () => {
  if (confirm('Slette alle stasjoner?')) { stations = []; render(); }
};

// ---- Disc golf reference layer --------------------------------------------
let dgLayer = null;
document.getElementById('dgRef').onchange = (e) => {
  if (e.target.checked) {
    fetch('./course.geojson').then((r) => r.json()).then((fc) => {
      dgLayer = L.geoJSON(fc, {
        style: { color: '#888', weight: 2, opacity: 0.5, dashArray: '3 4' },
        pointToLayer: (f, ll) => L.circleMarker(ll, { radius: 3, color: '#888', opacity: 0.5 }),
      }).addTo(map);
    });
  } else if (dgLayer) { map.removeLayer(dgLayer); dgLayer = null; }
};

// ---- Init ------------------------------------------------------------------
load();
render();
if (stations.length) map.fitBounds(L.latLngBounds(stations.flatMap((s) => [s.peg, s.target])).pad(0.2));
