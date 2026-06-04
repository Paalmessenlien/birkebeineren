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

// "Show my location" + auto-follow toggle (works over HTTPS) — handy on-site
(function addLocate() {
  let watching = false, following = false, marker = null, circle = null, btnLoc, btnFol;
  function start() { watching = true; btnLoc.classList.add('active'); map.locate({ watch: true, enableHighAccuracy: true }); }
  function stop() { watching = false; following = false; map.stopLocate(); btnLoc.classList.remove('active'); btnFol.classList.remove('active');
    if (marker) { map.removeLayer(marker); marker = null; } if (circle) { map.removeLayer(circle); circle = null; } }
  const Ctl = L.Control.extend({ options: { position: 'topleft' }, onAdd() {
    const div = L.DomUtil.create('div', 'leaflet-bar');
    btnLoc = L.DomUtil.create('a', 'locate-btn', div); btnLoc.href = '#'; btnLoc.title = 'Vis min posisjon'; btnLoc.textContent = '📍';
    btnFol = L.DomUtil.create('a', 'locate-btn', div); btnFol.href = '#'; btnFol.title = 'Følg meg (auto-sentrer)'; btnFol.textContent = '🧭';
    L.DomEvent.on(btnLoc, 'click', L.DomEvent.stop).on(btnLoc, 'click', () => {
      if (watching) stop(); else { start(); following = true; btnFol.classList.add('active'); }
    });
    L.DomEvent.on(btnFol, 'click', L.DomEvent.stop).on(btnFol, 'click', () => {
      if (!watching) start();
      following = !following; btnFol.classList.toggle('active', following);
      if (following && marker) map.setView(marker.getLatLng(), Math.max(map.getZoom(), 17));
    });
    return div;
  } });
  map.addControl(new Ctl());
  map.on('locationfound', (e) => {
    if (!marker) marker = L.circleMarker(e.latlng, { radius: 7, color: '#fff', weight: 2, fillColor: '#1a73e8', fillOpacity: 1 }).addTo(map);
    else marker.setLatLng(e.latlng);
    if (!circle) circle = L.circle(e.latlng, { radius: e.accuracy, color: '#1a73e8', weight: 1, fillOpacity: 0.1 }).addTo(map);
    else { circle.setLatLng(e.latlng); circle.setRadius(e.accuracy); }
    if (following) map.setView(e.latlng, Math.max(map.getZoom(), 17), { animate: true });
  });
  map.on('locationerror', (e) => { alert('Fant ikke posisjon: ' + e.message); stop(); });
  map.on('dragstart', () => { if (following) { following = false; btnFol.classList.remove('active'); } });
})();

// ---- State -----------------------------------------------------------------
const STORE_KEY = 'feltbane_v1';
let stations = [];          // { number, distance, peg:[lat,lng], target:[lat,lng] }
const editLayer = L.layerGroup().addTo(map);
let addMode = false;
let pendingPeg = null;      // first click while adding
let previewLine = null;

// ---- Icons -----------------------------------------------------------------
const pegIcon = L.divIcon({ className: '', html: '<div class="peg-icon"></div>', iconSize: [18, 18], iconAnchor: [9, 9] });
const tgtIcon = L.divIcon({ className: '', html: '<div class="tgt-icon"></div>', iconSize: [22, 22], iconAnchor: [11, 11] });
const moveIcon = L.divIcon({ className: '', html: '<div class="move-icon">✥</div>', iconSize: [24, 24], iconAnchor: [12, 12] });

// distance (m) between two [lat,lng]
function liveDist(a, b) { return Math.round(L.latLng(a).distanceTo(L.latLng(b)) * 100) / 100; }
// reposition a station's target along its current bearing to a new distance
function reposTarget(s, newDist) {
  const mlat = 111320, mlng = 111320 * Math.cos(s.peg[0] * Math.PI / 180);
  const de = (s.target[1] - s.peg[1]) * mlng, dn = (s.target[0] - s.peg[0]) * mlat;
  const len = Math.hypot(de, dn) || 1, ue = de / len, un = dn / len;
  s.target = [s.peg[0] + (un * newDist) / mlat, s.peg[1] + (ue * newDist) / mlng];
}

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
    const mid = () => [(s.peg[0] + s.target[0]) / 2, (s.peg[1] + s.target[1]) / 2];
    const line = L.polyline([s.peg, s.target], { color: '#0b2e7a', weight: 4, opacity: 0.95, lineCap: 'round' });
    const peg = L.marker(s.peg, { icon: pegIcon, draggable: true, title: 'Dra: flytt skytepunkt' });
    const tgt = L.marker(s.target, { icon: tgtIcon, draggable: true, title: 'Dra: flytt blink (endrer avstand)' });
    const handle = L.marker(mid(), { icon: moveIcon, draggable: true, title: 'Dra: flytt hele stasjonen' });

    peg.bindTooltip(labelHtml(s), { permanent: true, direction: 'right', offset: [10, 0], className: 'bue-label' });
    const liveLabel = () => peg.setTooltipContent(
      `${s.number} <span>${liveDist(peg.getLatLng(), tgt.getLatLng())} m</span>`);

    function commit() {
      s.peg = [peg.getLatLng().lat, peg.getLatLng().lng];
      s.target = [tgt.getLatLng().lat, tgt.getLatLng().lng];
      s.distance = liveDist(s.peg, s.target);
      save();
    }
    // drag endpoints — line + distance update live
    peg.on('drag', () => { line.setLatLngs([peg.getLatLng(), tgt.getLatLng()]); handle.setLatLng(L.latLng((peg.getLatLng().lat + tgt.getLatLng().lat)/2,(peg.getLatLng().lng + tgt.getLatLng().lng)/2)); liveLabel(); });
    tgt.on('drag', () => { line.setLatLngs([peg.getLatLng(), tgt.getLatLng()]); handle.setLatLng(L.latLng((peg.getLatLng().lat + tgt.getLatLng().lat)/2,(peg.getLatLng().lng + tgt.getLatLng().lng)/2)); liveLabel(); });
    peg.on('dragend', commit); tgt.on('dragend', commit);

    // move-handle — translate the whole station
    let ref = null;
    handle.on('dragstart', () => { ref = { peg: [...s.peg], tgt: [...s.target], mid: handle.getLatLng() }; });
    handle.on('drag', () => {
      const m = handle.getLatLng(), dlat = m.lat - ref.mid.lat, dlng = m.lng - ref.mid.lng;
      const np = [ref.peg[0] + dlat, ref.peg[1] + dlng], nt = [ref.tgt[0] + dlat, ref.tgt[1] + dlng];
      peg.setLatLng(np); tgt.setLatLng(nt); line.setLatLngs([np, nt]); liveLabel();
    });
    handle.on('dragend', () => { commit(); });

    // click anything to edit number/distance/delete
    const openEdit = () => peg.openPopup();
    peg.bindPopup(() => editForm(idx)); handle.bindPopup(() => editForm(idx));
    line.on('click', openEdit); tgt.on('click', openEdit);

    editLayer.addLayer(line); editLayer.addLayer(tgt); editLayer.addLayer(peg); editLayer.addLayer(handle);
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
    const nd = parseFloat(div.querySelector('#ef-dist').value);
    if (nd && Math.abs(nd - s.distance) > 0.01) { reposTarget(s, nd); s.distance = nd; } // move blink to match
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
  const nm = (document.getElementById('courseName').value || '').trim() || 'Felt bueskyting';
  return {
    type: 'FeatureCollection',
    metadata: { name: nm, created_with: 'feltbane-editor' },
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
  if (confirm('Tømme tegningen? (Lagrede baner beholdes)')) { stations = []; render(); }
};

// ---- Save to library + saved-courses list ----------------------------------
document.getElementById('saveBtn').onclick = () => {
  if (!stations.length) { alert('Tegn eller importer en bane først.'); return; }
  let name = (document.getElementById('courseName').value || '').trim();
  if (!name) { name = prompt('Navn på banen:', 'Min feltbane'); if (!name) return; }
  document.getElementById('courseName').value = name;
  feltLibSave(name, toGeoJSON());
  renderSavedList();
  alert('Lagret «' + name + '». Den vises nå som eget lag i kartvisningen.');
};

function renderSavedList() {
  const wrap = document.getElementById('savedList');
  const list = feltLibList();
  wrap.innerHTML = list.length ? '<div style="font-weight:700;margin-top:8px">Lagrede baner</div>' : '';
  list.forEach((entry) => {
    const row = document.createElement('div'); row.className = 'saved-row';
    const nm = document.createElement('span'); nm.className = 'nm';
    nm.textContent = entry.name + ' (' + (entry.geojson.features || []).filter((f) => f.properties.layer).length + ')';
    const load = document.createElement('button'); load.className = 'load'; load.textContent = 'Last';
    load.onclick = () => loadEntry(entry);
    const del = document.createElement('button'); del.className = 'del'; del.textContent = 'Slett';
    del.onclick = () => { if (confirm('Slette «' + entry.name + '»?')) { feltLibDelete(entry.id); renderSavedList(); } };
    row.append(nm, load, del); wrap.appendChild(row);
  });
}

function loadEntry(entry) {
  document.getElementById('courseName').value = entry.name;
  stations = (entry.geojson.features || []).filter((f) => f.properties.layer || f.properties.station)
    .filter((f) => f.geometry.type === 'LineString' && f.properties.kind !== 'route')
    .map((f) => { const c = f.geometry.coordinates;
      return { number: String(f.properties.station ?? ''),
               distance: f.properties.distance ?? distOf([c[0][1], c[0][0]], [c[c.length-1][1], c[c.length-1][0]]),
               peg: [c[0][1], c[0][0]], target: [c[c.length-1][1], c[c.length-1][0]] }; });
  render();
  if (stations.length) map.fitBounds(L.latLngBounds(stations.flatMap((s) => [s.peg, s.target])).pad(0.2));
};

// ---- Panel hide/show --------------------------------------------------------
document.getElementById('panelToggle').onclick = () => {
  const body = document.getElementById('panelBody');
  const hidden = body.style.display === 'none';
  body.style.display = hidden ? '' : 'none';
  document.getElementById('panelToggle').textContent = hidden ? '–' : '+';
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
renderSavedList();
if (stations.length) map.fitBounds(L.latLngBounds(stations.flatMap((s) => [s.peg, s.target])).pad(0.2));
