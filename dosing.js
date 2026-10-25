// Dosing: turns test marks (max reps, max time, heavy lifts, 30-s sprint, Cooper 12-min) into sets, reps, load
// and intervals for the chosen goal. Every number is read from library.json's `dosing` section (via LIB.dosing);
// the parsing below only pulls numbers out of Spade's text. Pure logic, no DOM.
(function (root) {
  const L = root.LIB || require('./data/library.js');
  const E = root.Engine || require('./engine.js');
  const DS = L.dosing || {};
  const num = s => parseFloat(s);
  const rng = s => { // "85-100" | "up to 67" | "12+" | "6-12" | "67"
    s = String(s || ''); let m;
    if ((m = s.match(/up to\s*(\d+(?:\.\d+)?)/i))) return [null, num(m[1])];
    if ((m = s.match(/(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)/))) return [num(m[1]), num(m[2])];
    if ((m = s.match(/(\d+(?:\.\d+)?)\s*\+/))) return [num(m[1]), null];
    if ((m = s.match(/(\d+(?:\.\d+)?)/))) return [num(m[1]), num(m[1])];
    return null;
  };
  // %1RM <-> reps table
  const PCT = Object.entries(DS.pct_1rm_to_reps || {}).map(([p, r]) => [num(p), r]).sort((a, b) => b[0] - a[0]);
  const pctForReps = r => { let best = null; for (const [p, rr] of PCT) if (rr <= r) best = p; else break; return best != null ? best : PCT.length ? PCT[PCT.length - 1][0] : null; };
  // 1RM formulas (constants read from the formula text)
  const F = DS.estimate_1rm || {};
  const EP = (F.epley || '').match(/reps\s*\/\s*(\d+(?:\.\d+)?)/); const EPD = EP ? num(EP[1]) : null;
  const BZ = (F.brzycki || '').match(/\/\s*\(\s*([\d.]+)\s*-\s*([\d.]+)\s*x\s*reps/); const BZA = BZ ? num(BZ[1]) : null, BZB = BZ ? num(BZ[2]) : null;
  const maxRepsForEstimate = (rng(F.note) || [10])[0] || 10;
  function estimate1RM(w, reps) {
    if (!(w > 0) || !(reps >= 1)) return null; if (reps === 1) return w;
    const ep = EPD ? w * (1 + reps / EPD) : null; const bz = BZA ? w / (BZA - BZB * reps) : null;
    return { epley: ep, brzycki: bz, value: ep != null ? ep : bz, formula: ep != null ? 'epley' : 'brzycki', reliable: reps <= maxRepsForEstimate };
  }
  // goal -> dosing rows
  const GW = DS.by_goal_weights || {};
  const words = s => s.toLowerCase().split(/[^a-z]+/).filter(w => w.length > 2 && !['loaded', 'moves'].includes(w));
  const follow = k => (k && GW[k] && GW[k].use_row && GW[GW[k].use_row]) ? GW[k].use_row : k;
  const beginnerKey = () => Object.keys(GW).find(k => /beginner/i.test(k)) || null;
  const keyFor = goalId => {
    const g = goalId && E.goalById(goalId); const keys = Object.keys(GW);
    if (!g) return beginnerKey();
    const gw = words(g.name + ' ' + g.id);
    const k = keys.find(k => k === g.name) || keys.find(k => words(k)[0] === gw[0]) || keys.find(k => /\(loaded moves\)/.test(k) && words(k).some(w => gw.includes(w)));
    return follow(k) || beginnerKey();   // flexibility, isometrics etc: beginner row
  };
  // the worked example narrows the goal ranges (e.g. strength 85-90% for 3-5 x 3-5); use it when it exists
  const WEX = Object.entries(DS).find(([k]) => /^worked_example/.test(k)) || [null, {}];
  const WEX_1RM = num((WEX[0] || '').match(/(\d+)_(lb|kg)/) ? WEX[0].match(/(\d+)_(lb|kg)/)[1] : NaN);
  const WEX_ALIAS = { size: 'muscle', endurance: 'muscular' };
  let HEAVY_ON = false; const opts_heavy = (goalId, out) => HEAVY_ON && out.heavy && /strength/.test(goalId || '');
  function prescription(goalId, heavyOptIn) {
    HEAVY_ON = !!heavyOptIn;
    const key = keyFor(goalId); const row = key ? GW[key] : null; if (!row) return null;
    const out = { key, pct: rng(row.load_pct_1rm), reps: rng(row.reps), sets: rng(row.sets), rest: row.rest || null, note: row.note || null, light: /no %/i.test(row.load_pct_1rm || '') };
    const ex = Object.entries(WEX[1]).find(([k]) => key.split(/[ /]/)[0] === k || key.startsWith(WEX_ALIAS[k] || '\u0000'));
    if (row.heavy_option) { const m = row.heavy_option.match(/(\d+)-(\d+)%\s*for\s*(\d+)-(\d+)\s*reps/); if (m) out.heavy = { pct: [num(m[1]), num(m[2])], reps: [num(m[3]), num(m[4])], text: row.heavy_option }; }
    if (ex && out.pct && out.reps && out.sets && out.reps[1] != null) out.example = ex[1];   // the row is complete: it wins
    else if (ex) {
      const t = ex[1]; let m;
      if ((m = t.match(/\((\d+)(?:-(\d+))?%\)/))) out.pct = /up to/i.test(t) ? [out.pct ? out.pct[0] : null, num(m[1])] : [num(m[1]), num(m[2] || m[1])];
      else if ((m = t.match(/(\d+)-(\d+)\s*(lb|kg)/)) && WEX_1RM) out.pct = [Math.round(num(m[1]) / WEX_1RM * 100), Math.round(num(m[2]) / WEX_1RM * 100)];
      if ((m = t.match(/(\d+)-(\d+)\s*sets of\s*(\d+)(?:-(\d+)|\+)/))) { out.sets = [num(m[1]), num(m[2])]; out.reps = [num(m[3]), m[4] ? num(m[4]) : null]; }
      out.example = t;
    }
    if (opts_heavy(goalId, out)) { out.pct = out.heavy.pct; out.reps = out.heavy.reps; out.spotter = true; }
    if (out.pct && out.pct[0] == null) out.pct[0] = PCT.length ? Math.min(...PCT.map(p => p[0])) : out.pct[1];   // "up to 67": floor at the table's lightest row
    if (out.reps && out.reps[1] == null) out.reps[1] = (PCT.find(p => p[0] === out.pct[0]) || [0, out.reps[0] + 3])[1];  // "12+": top = reps at that floor
    return out;
  }
  // bodyweight rules
  const BW = DS.by_goal_bodyweight || {};
  const RIR = (() => { const m = (BW.rule || '').match(/max reps minus\s*(\d+)-(\d+)/i); return m ? [num(m[1]), num(m[2])] : [2, 3]; })();
  const ENDPCT = (() => { const m = (BW.rule || '').match(/about\s*(\d+)-(\d+)%\s*of max/i); return m ? [num(m[1]), num(m[2])] : null; })();
  const BWEX = (() => { const m = (BW.example || '').match(/Max\s*(\d+).*?size:\s*(\d+)\s*sets of\s*(\d+)-(\d+)/i); return m ? { max: num(m[1]), sets: num(m[2]), lo: num(m[3]), hi: num(m[4]) } : null; })();
  const HOLD = (() => { const m = (BW.holds || '').match(/(\d+)-(\d+)%\s*of max hold time,\s*(\d+)\s*sets.*?add\s*(\d+)\s*s per set/); return m ? { pct: [num(m[1]), num(m[2])], sets: num(m[3]), add: num(m[4]) } : null; })();
  const BWPROG = (() => { const m = (BW.progress || '').match(/(\d+)\s*or more reps to spare,\s*add\s*(\d+)-(\d+)\s*reps/); return m ? { spare: num(m[1]), add: [num(m[2]), num(m[3])] } : null; })();
  const HARDER_AT = (rng((BW.harder_switch || '').match(/about\s*[\d-]+/) ? BW.harder_switch.match(/about\s*([\d-]+)/)[1] : '') || [null])[0];
  function bodyweightReps(max, goalId) {
    const p = prescription(goalId); const end = p && /muscular|endurance/.test(p.key);
    let lo, hi;
    if (end && ENDPCT) { lo = Math.round(max * ENDPCT[0] / 100); hi = Math.round(max * ENDPCT[1] / 100); }
    else { hi = max - RIR[1]; lo = BWEX ? Math.round(max * BWEX.lo / BWEX.max) : max - RIR[1] - 2; }   // 20 -> 15-17, per the library example
    hi = Math.max(1, hi); lo = Math.max(1, Math.min(lo, hi));
    return { reps: [lo, hi], sets: p && p.sets ? p.sets : null, harder: HARDER_AT != null && max >= HARDER_AT };
  }
  // cardio
  const CD = DS.cardio || {};
  const SPR = (() => { const t = CD.sprints || ''; const a = t.match(/(\d+)-(\d+)\s*s/), b = t.match(/(\d+)-(\d+)x as long/); return { work: a ? [num(a[1]), num(a[2])] : null, ratio: b ? [num(b[1]), num(b[2])] : null }; })();
  const LONG = (() => { const m = (CD.hiit_long || '').match(/(\d+)-(\d+)\s*x\s*(\d+)\s*s.*?(\d+)\s*s easy/); return m ? { rounds: [num(m[1]), num(m[2])], work: num(m[3]), rest: num(m[4]) } : null; })();
  const CPROG = (() => { const m = (CD.progress || '').match(/shorten rest by\s*(\d+)-(\d+)/); return { addRound: /add one interval/i.test(CD.progress || ''), restCut: m ? [num(m[1]), num(m[2])] : null }; })();
  const C12 = CD.from_12_min_test || {};
  const EASY = (rng((C12.easy_pace || '').match(/x\s*([\d.]+-[\d.]+)/) ? C12.easy_pace.match(/x\s*([\d.]+-[\d.]+)/)[1] : '') || null);
  const VO2 = (() => { const m = (C12.vo2max_estimate || '').match(/\(meters\s*-\s*([\d.]+)\)\s*\/\s*([\d.]+)/); return m ? [num(m[1]), num(m[2])] : null; })();
  // 12-minute run: test pace (sec per km or mi), easy pace range, interval pace, VO2max estimate
  function cooper(dist, du, unit) {
    const meters = du === 'mi' ? dist * 1609.344 : du === 'km' ? dist * 1000 : du === 'yd' ? dist * 0.9144 : dist;
    const per = (unit || 'mi') === 'km' ? 1000 : 1609.344; const pace = 720 / (meters / per);
    return { meters, pace, easy: EASY ? [pace * EASY[0], pace * EASY[1]] : null, interval: pace, vo2: VO2 ? (meters - VO2[0]) / VO2[1] : null, per: (unit || 'mi'), note: C12.note || '' };
  }
  // progression + retest
  const PR = DS.progression || '';
  const PROG = (() => { const up = PR.match(/about\s*([\d.]+)-([\d.]+)%\s*\(upper body\)/), low = PR.match(/([\d.]+)-([\d.]+)%\s*\(lower body\)/), drop = PR.match(/drop\s*([\d.]+)-([\d.]+)%/), times = PR.match(/every set (\w+)/);
    return { upper: up ? [num(up[1]), num(up[2])] : null, lower: low ? [num(low[1]), num(low[2])] : null, drop: drop ? [num(drop[1]), num(drop[2])] : null, times: times && times[1] === 'twice' ? 2 : 2 }; })();
  const RETEST_WEEKS = (rng((PR.match(/Retest every\s*([\d-]+)\s*weeks/) || [])[1]) || [4])[0];

  // weights: sensible steps
  const STEP = { lb: { barbell: 5, dumbbell: 5, kettlebell: 5, default: 5 }, kg: { barbell: 2.5, dumbbell: 2, kettlebell: 4, default: 2.5 } };
  const toUnit = (v, from, to) => from === to ? v : from === 'lb' ? v * 0.45359237 : v / 0.45359237;
  function roundLoad(v, unit, e, dir) {
    const kind = (e.equipment || []).find(t => STEP[unit][t]) || 'default'; const s = STEP[unit][kind];
    const f = dir < 0 ? Math.floor : dir > 0 ? Math.ceil : Math.round; return Math.max(s, f(v / s) * s);
  }
  const LOADED = ['barbell', 'dumbbell', 'kettlebell', 'sandbag', 'plate', 'slam-ball', 'water-jug', 'backpack', 'weighted-rope'];
  const isLoaded = e => e.equipment.some(t => LOADED.includes(t));
  const lowerBody = e => (e.uses || []).includes('legs') && !(e.uses || []).includes('arms') || ['quads', 'glutes', 'hamstrings', 'calves'].includes(e.areas[0]);

  // marks: { key: [{date, kind, v, w, reps, est, unit, dist, du}] }; key = move id | 'sprint30' | 'cooper12'
  const latest = (marks, key) => { const l = marks && marks[key]; return l && l.length ? l[l.length - 1] : null; };
  function markFor(e, marks, kind) {
    const own = latest(marks, e.id); if (own && (!kind || own.kind === kind)) return { m: own, from: e };
    if (!e.family) return null;   // family: same family + same level + same loaded/bodyweight kind
    for (const x of E.EX) if (x.id !== e.id && x.family === e.family && x.level === e.level && isLoaded(x) === isLoaded(e)) { const m = latest(marks, x.id); if (m && (!kind || m.kind === kind)) return { m, from: x }; }
    return null;
  }
  // tests a user may run right now (never on an injured area)
  function testable(kind, opts) {
    const owned = E.ownedSet(opts.equip || []); const inj = E.injuryCtx(opts.injuries);
    const ok = e => E.have(e, owned) && !E.blockedBy(e, inj) && !(opts.exclude || []).includes(e.id);
    if (kind === 'maxReps') return E.EX.filter(e => ok(e) && e.type === 'D' && !isLoaded(e) && (!e.timer || e.timer.mode === 'reps') && !e.areas.includes('cardio') && !e.areas.includes('skill'));
    if (kind === 'maxTime') return E.EX.filter(e => ok(e) && e.type === 'I' && !isLoaded(e));
    if (kind === 'heavy') return E.EX.filter(e => ok(e) && e.type === 'D' && isLoaded(e) && (!e.timer || e.timer.mode === 'reps'));
    const run = E.BY[kind === 'sprint30' ? 'sprint_intervals' : 'run_outdoor'] || E.BY.run_place;   // the moves these tests stand in for
    if (kind === 'sprint30' || kind === 'cooper12') return run && E.blockedBy(run, inj) ? [] : [{ id: kind }];
    return [];
  }

  // apply to one item (skips items already dosed or logged)
  function applyItem(it, opts, dose) {
    if (it.dosed === it.id || it.log.some(Boolean) || it.kind === 'water_break' || it.kind === 'block_break') return it;
    const e = E.BY[it.id]; if (!e) return it;
    const marks = opts.marks || {}; const unit = opts.units === 'metric' ? 'kg' : 'lb'; const goalId = opts.goal || null;
    const p = prescription(goalId, opts.heavySingles); it.dosed = it.id; delete it.basis; delete it.weightRange; delete it.offerHarder; delete it.doseNote;
    if (it.kind === 'hiit') {
      const sp = latest(marks, 'sprint30'); if (!sp || !SPR.work || !SPR.ratio) return it;
      const block = it.sets * (it.work + it.rest); const w = Math.min(SPR.work[1], sp.secs || 30), r = w * SPR.ratio[0];
      const st = (dose && dose.hiit) || {};
      it.work = w; it.rest = Math.max(w * SPR.ratio[0] - (st.restCut || 0), w * SPR.ratio[0] - 15); it.sets = Math.max(1, Math.floor(block / (w + r))) + (st.add || 0);
      it.basis = { k: 'sprint', d: sp.dist, du: sp.du, s: w }; it.doseNote = CD.sprints; return it;
    }
    if (e.areas.includes('cardio') && it.mode === 'time' && it.work >= 300) {
      const c = latest(marks, 'cooper12'); if (c) { const cp = cooper(c.dist, c.du, opts.units === 'metric' ? 'km' : 'mi'); it.basis = { k: 'cooper', d: c.dist, du: c.du, pace: cp.pace, easy: cp.easy, vo2: cp.vo2, per: cp.per }; it.doseNote = CD.steady; }
      return it;
    }
    const rehab = goalId === 'rehabilitation' || (p && p.light);
    if (isLoaded(e) && it.mode === 'reps') {
      const mk = markFor(e, marks, 'heavy'); if (!mk) return it;
      if (rehab) { it.basis = { k: 'rehab' }; it.doseNote = p && p.note; it.light = true; return it; }   // no % rule: light, pain-free
      const pr = p || prescription(null); if (!pr || !pr.pct) return it; if (pr.spotter) { it.spotter = pr.heavy.text; it.heavySingle = true; }
      const oneRm = toUnit(mk.m.est || mk.m.w, mk.m.unit || 'lb', unit) * ((dose && dose[e.id] && dose[e.id].f) || 1);
      const lo = roundLoad(oneRm * pr.pct[0] / 100, unit, e, 1), hi = Math.max(lo, roundLoad(oneRm * pr.pct[1] / 100, unit, e, -1));
      it.weightRange = [lo, hi]; it.weight = roundLoad((lo + hi) / 2, unit, e, 0); it.wUnit = unit;
      if (pr.reps) it.reps = [pr.reps[0], pr.reps[1]];
      if (pr.sets) it.sets = Math.max(pr.sets[0], Math.min(pr.sets[1], it.sets));
      it.basis = { k: 'heavy', w: Math.round(toUnit(mk.m.est || mk.m.w, mk.m.unit || 'lb', unit)), u: unit, est: !!mk.m.est, move: mk.from.id };
      return it;
    }
    if (!isLoaded(e) && it.mode === 'reps') {
      const mk = markFor(e, marks, 'maxReps'); if (!mk) return it;
      if (rehab) { it.basis = { k: 'rehab' }; it.doseNote = p && p.note; return it; }
      const r = bodyweightReps(mk.m.v, goalId); const add = (dose && dose[e.id] && dose[e.id].repAdd) || 0; it.reps = [r.reps[0] + add, r.reps[1] + add];
      if (r.sets) it.sets = Math.max(r.sets[0], Math.min(r.sets[1], it.sets));
      if (r.harder) { const h = E.progressions(e, 1, opts).list[0]; if (h) it.offerHarder = h.id; }
      it.basis = { k: 'reps', n: mk.m.v, move: mk.from.id };
      return it;
    }
    if (e.type === 'I' && it.mode === 'time') {
      const mk = markFor(e, marks, 'maxTime'); if (!mk) return it;
      if (rehab) { it.basis = { k: 'rehab' }; it.doseNote = p && p.note; return it; }
      const hp = HOLD ? HOLD.pct : [60, 75]; const add = (dose && dose[e.id] && dose[e.id].holdAdd) || 0;
      it.hold = Math.max(5, Math.round(mk.m.v * (hp[0] + hp[1]) / 200 / 5) * 5) + add; it.work = it.hold * (it.sides || 1); it.holdRange = [Math.round(mk.m.v * hp[0] / 100), Math.round(mk.m.v * hp[1] / 100)];
      if (HOLD && HOLD.sets) it.sets = HOLD.sets;
      it.basis = { k: 'time', n: mk.m.v, move: mk.from.id };
    }
    return it;
  }
  function applySession(sess, opts, dose) { for (const it of sess.items) applyItem(it, opts, dose); return sess; }

  // logging -> load changes (progression rule)
  function onItemLogged(it, dose) {
    const e = E.BY[it.id]; const base = it.baseSets || it.sets; if (!e || it.log.slice(0, it.kind === 'hiit' ? 1 : base).filter(Boolean).length < (it.kind === 'hiit' ? 1 : base) || it.progCounted) return null;
    it.progCounted = true;
    if (it.kind === 'hiit' && it.basis) {
      const h = dose.hiit = dose.hiit || { add: 0, restCut: 0 };
      if (it.log[0] && it.log[0].st === 'c') { if (CPROG.addRound && (!LONG || it.sets < LONG.rounds[1])) h.add++; else if (CPROG.restCut) h.restCut += CPROG.restCut[0]; return { k: 'hiitUp' }; }
      return null;
    }
    if (it.basis && it.basis.k === 'time') {   // holds: +5 s per set once every set was controlled (Complete)
      if (HOLD && it.log.slice(0, base).every(r => r && r.st === 'c')) { const d = dose[e.id] = dose[e.id] || {}; d.holdAdd = (d.holdAdd || 0) + HOLD.add; return { k: 'holdUp', s: HOLD.add }; }
      return null;
    }
    if (it.basis && it.basis.k === 'reps') {   // bodyweight: every set hit its target with 2+ reps to spare -> add 1 rep per set
      if (BWPROG && it.log.slice(0, base).every(r => r && r.v != null && r.v >= it.reps[1] + BWPROG.spare)) { const d = dose[e.id] = dose[e.id] || {}; d.repAdd = (d.repAdd || 0) + BWPROG.add[0]; return { k: 'repsUp', n: BWPROG.add[0] }; }
      return null;
    }
    if (!it.weightRange) return null;
    const d = dose[e.id] = dose[e.id] || { f: 1, top: 0, miss: 0 };
    const top = it.log.slice(0, base).every(r => r && (r.st === 'c' || (r.v != null && r.v >= it.reps[1])));
    const miss = it.log.slice(0, base).some(r => r && (r.st === 'x' || (r.st === 'p' && (r.v == null || r.v < it.reps[0]))));
    if (top) { d.top++; d.miss = 0; } else if (miss) { d.miss++; d.top = 0; }
    if (d.top >= PROG.times) { const pc = (lowerBody(e) ? PROG.lower : PROG.upper) || [2.5]; d.f *= 1 + pc[0] / 100; d.top = 0; return { k: 'up', pct: pc[0] }; }
    if (d.miss >= PROG.times) { const pc = PROG.drop || [5]; d.f *= 1 - pc[0] / 100; d.miss = 0; return { k: 'down', pct: pc[0] }; }
    return null;
  }
  function retestDue(marks, now) {
    const out = []; now = now || Date.now();
    for (const [k, l] of Object.entries(marks || {})) { const m = l[l.length - 1]; const ref = m.snooze || m.date; const w = Math.floor((now - new Date(m.date + 'T12:00')) / (7 * 864e5));
      if ((now - new Date(ref + 'T12:00')) / (7 * 864e5) >= RETEST_WEEKS) out.push({ key: k, weeks: w }); }
    return out;
  }
  const api = { cooper, HOLD, BWPROG, keyFor, rng, pctForReps, estimate1RM, prescription, bodyweightReps, roundLoad, toUnit, isLoaded, markFor, testable, applyItem, applySession, onItemLogged, retestDue,
    RETEST_WEEKS, PROG, SPR, LONG, RIR, HARDER_AT, DS };
  if (typeof module !== 'undefined') module.exports = api; else root.Dosing = api;
})(typeof window !== 'undefined' ? window : globalThis);
