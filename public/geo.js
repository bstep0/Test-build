/* Routing maths shared by server and browser (global `Geo`): distances, route optimisation, trip stats. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Geo = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const EARTH_MI = 3958.8, ROAD_FACTOR = 1.3; // straight-line → typical street-network distance
  const rad = (d) => (d * Math.PI) / 180;
  const has = (p) => p && p.lat != null && p.lng != null && p.lat !== '' && p.lng !== '' && !isNaN(p.lat) && !isNaN(p.lng);

  function miles(a, b) {
    const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * EARTH_MI * Math.asin(Math.sqrt(h));
  }

  // total driving miles for visiting `pts` in order, starting (and optionally ending) at `depot`
  function pathMiles(depot, pts, roundTrip = true) {
    let d = 0, prev = depot;
    for (const p of pts) { d += miles(prev, p); prev = p; }
    if (roundTrip && pts.length) d += miles(prev, depot);
    return d * ROAD_FACTOR;
  }

  function centroid(pts) {
    return { lat: pts.reduce((s, p) => s + +p.lat, 0) / pts.length, lng: pts.reduce((s, p) => s + +p.lng, 0) / pts.length };
  }

  // Nearest-neighbour construction + 2-opt improvement. Returns indices into `pts`.
  function optimizeOrder(depot, pts, { roundTrip = true } = {}) {
    const n = pts.length;
    if (n < 3) return pts.map((_, i) => i);
    const nodes = [depot, ...pts];
    const d = nodes.map((a) => nodes.map((b) => miles(a, b)));
    const cost = (o) => { let c = 0, prev = 0; for (const i of o) { c += d[prev][i]; prev = i; } return roundTrip ? c + d[prev][0] : c; };
    const left = new Set(pts.map((_, i) => i + 1)), order = [];
    for (let cur = 0; left.size;) {
      let best = -1, bd = Infinity;
      for (const j of left) if (d[cur][j] < bd) { bd = d[cur][j]; best = j; }
      order.push(best); left.delete(best); cur = best;
    }
    let best = cost(order), improved = true, guard = 0;
    while (improved && guard++ < 50) {
      improved = false;
      for (let i = 0; i < n - 1; i++) for (let j = i + 1; j < n; j++) {
        const cand = order.slice(0, i).concat(order.slice(i, j + 1).reverse(), order.slice(j + 1));
        const c = cost(cand);
        if (c < best - 1e-9) { order.splice(0, n, ...cand); best = c; improved = true; }
      }
    }
    return order.map((i) => i - 1);
  }

  // items: [{lat,lng,...}] in current order. Items without coordinates keep their relative order at the end.
  function optimizeItems(depot, items, opts = {}) {
    const located = items.filter(has), missing = items.filter((x) => !has(x));
    const start = has(depot) ? depot : located.length ? centroid(located) : null;
    if (!start || located.length < 2) return { ordered: items.slice(), before: 0, after: 0, depotAssumed: !has(depot), missing: missing.length };
    const order = optimizeOrder(start, located, opts);
    const ordered = order.map((i) => located[i]);
    const rt = opts.roundTrip !== false;
    return { ordered: ordered.concat(missing), before: pathMiles(start, located, rt), after: pathMiles(start, ordered, rt), depotAssumed: !has(depot), missing: missing.length };
  }

  function stats(depot, items, { roundTrip = true, speed = 25, serviceMin = 25 } = {}) {
    const located = items.filter(has);
    const start = has(depot) ? depot : located.length ? centroid(located) : null;
    const mi = start ? pathMiles(start, located, roundTrip) : 0;
    const drive = (mi / (speed || 25)) * 60, work = items.length * serviceMin;
    return { miles: mi, driveMin: drive, workMin: work, totalMin: drive + work, count: items.length, located: located.length };
  }

  return { miles, pathMiles, optimizeOrder, optimizeItems, stats, has };
});
