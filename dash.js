// Minimal stand-in for the dashboard runtime, for the public GitHub Pages copy of the season page (2026-11-23).
// Implements only what season.html uses: dash.calc / draw / data / onData / params / setParams / colors, plus
// claude.use('db') for the roster, kept in this browser's localStorage (the public site has no shared database).
(() => {
  const state = {}, calcs = {}, draws = {}, dataCbs = [], memo = {};
  const colors = ['#2f6fdf', '#d9622b', '#2e9e6b', '#b0429c', '#c99a1c', '#5b5fd6', '#cc3d4f', '#3a9ab5'];

  // ---- view settings live in the URL (?kind=rm_4v4&players=a&players=b), so a link opens the same view
  function readParams() {
    const p = {}; const u = new URLSearchParams(location.search);
    for (const k of new Set(u.keys())) { const v = u.getAll(k); p[k] = v.length > 1 || k === 'players' ? v : v[0]; }
    return p;
  }
  let params = readParams();
  function writeParams() {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) [].concat(v).forEach((x) => u.append(k, x));
    const q = u.toString(); history.replaceState(null, '', location.pathname + (q ? '?' + q : '') + location.hash);
  }

  // ---- roster in localStorage, shaped like the store the page expects: [{id, name, civs}]
  const RKEY = 'aoe4-roster';
  const rosterLoad = () => { try { return JSON.parse(localStorage.getItem(RKEY) || '[]'); } catch (e) { return []; } };
  const rosterSave = (r) => { localStorage.setItem(RKEY, JSON.stringify(r)); state.roster = { status: 'ok', data: r }; schedule(); };
  const db = {
    collection: (path) => ({ add: async (obj) => { const r = rosterLoad(); r.push({ ...obj, id: Math.random().toString(36).slice(2, 10) }); rosterSave(r); } }),
    doc: (path) => { const id = path.split('/').pop(); return {
      set: async (obj) => { rosterSave(rosterLoad().map((p) => (p.id === id ? { ...obj, id } : p))); },
      delete: async () => { rosterSave(rosterLoad().filter((p) => p.id !== id)); } }; },
  };
  window.claude = { use: async (what) => (what === 'db' ? db : null) };
  state.roster = { status: 'ok', data: rosterLoad() };

  // ---- derived tables: recomputed on every change (they read the view settings themselves)
  function compute() {
    const done = new Set();
    for (let pass = 0; pass < 10; pass++) {
      for (const [name, spec] of Object.entries(calcs)) {
        if (done.has(name)) continue;
        const ins = spec.inputs.map((i) => state[i] || { status: 'loading' });
        if (spec.inputs.some((i) => calcs[i] && !done.has(i))) continue;          // wait for a derived input
        done.add(name);
        if (ins.some((d) => d.status === 'error')) { state[name] = { status: 'error' }; continue; }
        if (ins.some((d) => d.status !== 'ok')) { state[name] = { status: 'loading' }; continue; }
        // reuse the last result while its inputs and the view settings are unchanged (tables arriving one by one
        // would otherwise rerun every heavy calc ~40 times during loading; code review 2026-11-24)
        const refs = ins.map((d) => d.data), pk = JSON.stringify(params), m = memo[name];
        if (m && m.pk === pk && m.refs.every((x, i) => x === refs[i])) { state[name] = m.out; continue; }
        try { state[name] = { status: 'ok', data: spec.fn(...refs) }; }
        catch (e) { console.error(name, e); state[name] = { status: 'error' }; }
        memo[name] = { pk, refs, out: state[name] };
      }
    }
  }
  function render() {
    compute();
    for (const f of dataCbs) { try { f(); } catch (e) { console.error(e); } }
    document.querySelectorAll('[data-draw]').forEach((el) => {
      const f = draws[el.dataset.draw]; if (!f) return;
      try { f(el); } catch (e) { console.error(el.dataset.draw, e); }
    });
  }
  let queued = false;
  function schedule() { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; render(); }); }

  window.dash = {
    colors,
    calc: (name, spec) => { calcs[name] = spec; },
    draw: (name, fn) => { draws[name] = fn; },
    onData: (fn) => { dataCbs.push(fn); },
    data: (name) => state[name] || { status: 'loading' },
    params: () => params,
    setParams: (o) => { for (const [k, v] of Object.entries(o)) { if (v == null || v === '') delete params[k]; else params[k] = v; } writeParams(); schedule(); },
  };

  // ---- tables come compact (github_pages.py compact(): columns once, repeated text once per column); expand to rows.
  // A missing cell stays undefined, which the page treats like null (it never tests === null).
  const expand = (j) => j.rows || j.r.map((a) => { const o = {};
    for (let i = 0; i < a.length; i++) { const v = a[i]; if (v === null) continue; const k = j.c[i], d = j.d[k]; o[k] = d ? d[v] : v; }
    return o; });

  // ---- load every published table, the ones the top of the page needs first (index.json order), 6 at a time;
  // draw as each one arrives
  addEventListener('DOMContentLoaded', async () => {
    schedule();
    const txt = document.getElementById('loadtext'), fill = document.getElementById('loadfill');
    let names;
    try { names = await (await fetch('data/index.json')).json(); }
    catch (e) { if (txt) txt.textContent = 'Could not load the results. Check your connection and reload.'; return; }
    let got = 0, failed = 0;
    const progress = () => { if (txt) txt.textContent = `Loading the season's results… ${got} of ${names.length}`; if (fill) fill.style.width = (100 * got / names.length) + '%'; };
    progress();
    for (const n of names) state[n] = { status: 'loading' };
    const queue = names.slice();
    await Promise.all(Array.from({ length: 6 }, async () => {
      while (queue.length) {
        const n = queue.shift();
        try { const r = await fetch(`data/${n}.json`); if (!r.ok) throw new Error(r.status); state[n] = { status: 'ok', data: expand(await r.json()) }; }
        catch (e) { console.error(n, e); state[n] = { status: 'error' }; failed++; }
        got++; progress(); schedule();
      }
    }));
    const l = document.getElementById('loading');
    if (failed && txt) txt.textContent = `${failed} of ${names.length} tables failed to load; reload to try again.`;
    else if (l) l.hidden = true;
  });
})();
