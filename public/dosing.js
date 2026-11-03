/* Water-chemistry analysis + chemical dosing guidance.
 * Shared by the server (require) and the browser (global `Dosing`).
 * Dose factors are standard rules of thumb per 10,000 gal — always add in stages and retest. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Dosing = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const RANGES = {
    fc:   { label: 'Free chlorine',   unit: 'ppm', min: 2,    max: 5,    target: 3 },
    ph:   { label: 'pH',              unit: '',    min: 7.2,  max: 7.8,  target: 7.5 },
    ta:   { label: 'Total alkalinity', unit: 'ppm', min: 70,   max: 120,  target: 90 },
    cya:  { label: 'Stabilizer (CYA)', unit: 'ppm', min: 30,   max: 60,   target: 40 },
    ch:   { label: 'Calcium hardness', unit: 'ppm', min: 200,  max: 400,  target: 300 },
    salt: { label: 'Salt',            unit: 'ppm', min: 2700, max: 3600, target: 3200 },
  };

  const r1 = (n) => (n < 10 ? Math.round(n * 10) / 10 : Math.round(n));
  const fluid = (oz) => (oz >= 128 ? `${(oz / 128).toFixed(1)} gal` : `${r1(oz)} fl oz`);
  const weight = (oz) => (oz >= 16 ? `${(oz / 16).toFixed(1)} lb` : `${r1(oz)} oz`);
  const drain = (pct) => `Partially drain & refill ≈ ${Math.min(90, Math.max(5, Math.round(pct)))}%`;

  function analyze(volume, readings) {
    const f = (Number(volume) || 0) / 10000;
    const out = [];
    for (const key of Object.keys(RANGES)) {
      const raw = readings[key];
      if (raw === null || raw === undefined || raw === '' || isNaN(Number(raw))) continue;
      const v = Math.round(Number(raw) * 100) / 100, R = RANGES[key];
      const status = v < R.min ? 'low' : v > R.max ? 'high' : 'ok';
      const item = { key, label: R.label, unit: R.unit, value: v, status, range: [R.min, R.max], dose: null, message: 'In range' };
      const set = (product, text, message) => { item.dose = { product, text }; item.message = message; };
      const gap = R.target - v;

      if (status === 'low') {
        if (key === 'fc') set('Liquid chlorine 10%', fluid(gap * 13 * f), `Raise ${r1(gap)} ppm`);
        if (key === 'ph') set('Soda ash', weight((gap / 0.2) * 6 * f), `Raise ${r1(gap)} pH`);
        if (key === 'ta') set('Baking soda', weight((gap / 10) * 24 * f), `Raise ${r1(gap)} ppm`);
        if (key === 'cya') set('Stabilizer', weight((gap / 10) * 13 * f), `Raise ${r1(gap)} ppm`);
        if (key === 'ch') set('Calcium chloride', weight((gap / 10) * 20 * f), `Raise ${r1(gap)} ppm`);
        if (key === 'salt') set('Pool salt', `${r1((gap / 1000) * 83.5 * f)} lb`, `Raise ${r1(gap)} ppm`);
      } else if (status === 'high') {
        if (key === 'fc') item.message = v > 10 ? 'Very high — keep swimmers out until it drops' : 'High — no chlorine needed, let it settle';
        if (key === 'ph') set('Muriatic acid 31%', fluid(((v - R.target) / 0.2) * 12 * f), `Lower ${r1(v - R.target)} pH`);
        if (key === 'ta') set('Muriatic acid 31%', fluid(((v - 100) / 10) * 25 * f), 'Lower with acid, then aerate to restore pH');
        if (key === 'cya') { item.dose = { product: 'Dilution', text: drain(((v - R.target) / v) * 100) }; item.message = 'Stabilizer only leaves by dilution'; }
        if (key === 'ch') { item.dose = { product: 'Dilution', text: drain(((v - R.target) / v) * 100) }; item.message = 'Hard water — dilute and watch the LSI'; }
        if (key === 'salt') { item.dose = { product: 'Dilution', text: drain(((v - R.target) / v) * 100) }; item.message = 'Too salty for most cells'; }
      }
      out.push(item);
    }
    return out;
  }

  const issues = (volume, readings) => analyze(volume, readings).filter((x) => x.status !== 'ok');

  return { RANGES, analyze, issues };
});
