/*
 * extract.js — pull UDisc course markings into GeoJSON
 * ----------------------------------------------------
 * UDisc renders its caddie-book map with Mapbox tiles, but the actual markings
 * (tees, baskets, fairways) are NOT baked into the image — they are structured
 * vector data hydrated into the page by React Router and reachable at:
 *
 *     window.__reactRouterDataRouter.state.loaderData[
 *       'routes/courses/$slug.layouts.$layoutId.caddie-book'
 *     ].course.holes
 *
 * Coordinates are plain WGS84 (EPSG:4326) lat/lng — the same datum Leaflet and
 * Kartverket use — so no reprojection is needed.
 *
 * HOW TO RE-RUN (e.g. for a different course/layout):
 *   1. Open the caddie-book page in a browser:
 *        https://udisc.com/courses/<slug>/layouts/<layoutId>/caddie-book
 *   2. Open DevTools console, paste the buildGeoJSON() body below, then:
 *        copy(JSON.stringify(buildGeoJSON(), null, 0))
 *   3. Save the clipboard into course.geojson next to index.html.
 *
 * NOTE: GeoJSON coordinate order is [longitude, latitude] (lng first); UDisc
 *       stores them as separate `latitude` / `longitude` fields.
 */

function buildGeoJSON() {
  const r = window.__reactRouterDataRouter;
  const route = r.state.loaderData['routes/courses/$slug.layouts.$layoutId.caddie-book'];
  const c = route.course;

  const pt = (p) => [p.longitude, p.latitude];
  const colorOf = (labels) => (labels && labels[0] && labels[0].color) || 'gray';
  const labelOf = (labels) => (labels && labels[0] && labels[0].name) || '';

  const features = [];
  for (const h of (c.holes || [])) {
    const hole = h.name;

    for (const t of (h.teePositions || [])) {
      features.push({
        type: 'Feature',
        properties: { kind: 'tee', hole, label: labelOf(t.teePositionLabels), color: colorOf(t.teePositionLabels) },
        geometry: { type: 'Point', coordinates: pt(t) },
      });
    }

    for (const tg of (h.targetPositions || [])) {
      features.push({
        type: 'Feature',
        properties: { kind: 'basket', hole, label: labelOf(tg.targetPositionLabels) },
        geometry: { type: 'Point', coordinates: pt(tg) },
      });
    }

    for (const pc of (h.pathConfigurations || [])) {
      const coords = [pt(pc.teePosition), ...((pc.doglegs || []).map(pt)), pt(pc.targetPosition)];
      features.push({
        type: 'Feature',
        properties: {
          kind: 'fairway', hole, par: pc.par, distance: pc.distance,
          color: colorOf(pc.teePosition.teePositionLabels),
          tee: labelOf(pc.teePosition.teePositionLabels),
        },
        geometry: { type: 'LineString', coordinates: coords },
      });
    }
  }

  return {
    type: 'FeatureCollection',
    metadata: {
      course: c.name,
      layout: (route.layout && route.layout.name) || '',
      source: location.href,
      center: c.location && c.location.coordinates,
      holeCount: (c.holes || []).length,
    },
    features,
  };
}

// Allow `node`/bundler import if ever needed; harmless in the browser console.
if (typeof module !== 'undefined') module.exports = { buildGeoJSON };
