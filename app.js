'use strict';
// Teté — offline home workout tracker. UI only; plan logic lives in engine.js, text in strings.js, data in data/library.js.
const S = window.STR, L = window.LIB, E = window.Engine, DZ = window.Dosing;
const KEY = 'tete.v1';
const $ = (q, el = document) => el.querySelector(q);
const $$ = (q, el = document) => [...el.querySelectorAll(q)];
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (t, o = {}) => String(t).replace(/\{(\w+)\}/g, (m, k) => (o[k] != null ? o[k] : m));
const mmss = s => { s = Math.max(0, Math.round(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
const dstr = d => d.toLocaleDateString('en-CA');
const today = () => dstr(new Date());
const ex = id => E.BY[id] || E.BY[(L.idAliases || {})[id]] || { id, name: id, areas: ['core'], type: 'D', level: 1, equipment: [], cue: '' };
const has = (list, k) => (L.icons[list] || []).includes(k);
const img = (list, k, cls = 'ic') => (list === 'sports' && !has(list, k) && L.sportIconFallback && L.sportIconFallback[k]) ? img('goals', L.sportIconFallback[k], cls) : has(list, k) ? `<img class="${cls}" src="icons/${list}/${k}.png" alt="" loading="lazy">` : `<span class="${cls} ph">${esc((k || '?')[0].toUpperCase())}</span>`;
const ctl = (k, cls = 'ctl') => has('controls', k) ? `<img class="${cls}" src="icons/controls/${k}.png" alt="">` : '';
const eqName = t => S.equipNames[t] || t.replace(/-/g, ' ');
const areaName = a => S.areaNames[a] || a;
const goalName = id => S.goalNames[id] || id;
const cap = t => String(t || '').replace(/^./, c => c.toUpperCase());

// ---------- state ----------
function defaults() {
  return { v: 1, setupDone: false, equip: [], sports: [], goal: null, level: 2, levels: {}, counters: { fail: {}, top: {} }, offer: null,
    settings: { sounds: true, days: 5, minutes: 45, perDay: 1, gapHours: 4, units: 'imperial', currency: 'USD', checkinWeeks: 4, partnerTurns: false, hiit: 'hiit_tabata', plan: null },
    dayIdx: 0, sessions: [], checkins: [], pain: {}, dislike: {}, injuries: [], marks: {}, dose: {}, mapMode: 'work', regions: [], extras: [], view: 'front', tab: 'today' };
}
function load() {
  try { const s = JSON.parse(localStorage.getItem(KEY)); if (s && s.v === 1) { const d = defaults(); return Object.assign(d, s, { settings: Object.assign(d.settings, s.settings || {}) }); } } catch (e) { /* fresh start */ }
  return defaults();
}
let st = load();
const save = () => { try { const a0 = st.sessions ? st.sessions.filter(x => x.date === today() && !x.done).pop() : null; if (a0 && DZ) DZ.applySession(a0, opts({ goal: a0.goal }), st.dose); } catch (e) { /* dosing is best-effort */ } try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) { toast('Storage full'); } };

function planWeek() {
  const p = st.settings.plan; if (!p || !p.start) return null;
  const w = Math.floor((new Date(today()) - new Date(p.start)) / 864e5 / 7) + 1;
  return w >= 1 && w <= L.settings.plan.weeks ? w : null;
}
function opts(extra = {}) {
  return Object.assign({ equip: st.equip, sports: st.sports, goal: st.goal, level: st.level, levels: st.levels,
    exclude: Object.keys(st.pain).concat(Object.keys(st.dislike)), hiitFormat: st.settings.hiit, planWeek: planWeek(), injuries: st.injuries, marks: st.marks, units: st.settings.units }, extra);
}
const todays = () => st.sessions.filter(s => s.date === today());
const active = () => todays().filter(s => !s.done).pop() || null;
const anyLogs = s => s.items.some(i => i.log.some(Boolean));

// ---------- sessions ----------
function newSession(focus) {
  const n = todays().length + 1; const days = E.splitDays(st.settings.days);
  let name, slots = null, areas = null, goal = st.goal, minutes = st.settings.minutes, role = 'one';
  if (!focus || focus.type === 'plan') {
    const d = days[st.dayIdx % days.length]; name = d.name; slots = d.slots;
    if (st.settings.perDay >= 2 && n === 1) { role = 'am'; slots = st.sports.length ? [['skill', 'skill', 3]] : L.splitSlots.cardio; }
    else if (n >= 3) { const rec = Object.entries(L.week.days).find(([k]) => k.startsWith('6')); slots = rec ? rec[1] : slots; role = 'extra'; }
    else if (st.settings.perDay >= 2) role = 'pm';
  } else {
    areas = focus.areas; goal = focus.goal !== undefined ? focus.goal : st.goal; name = focus.name; slots = focus.slots || null;
  }
  if (focus && focus.minutes) minutes = focus.minutes;
  const g = E.generate(opts(Object.assign({ minutes, slots, areas, goal }, focus && focus.only ? { only: focus.only, equip: st.equip.concat(focus.place || []) } : {})));
  const sess = Object.assign({ id: 's' + Date.now().toString(36), date: today(), n, name, role, dayIdx: st.dayIdx, focus: focus || { type: 'plan' }, notes: '', done: false, startedAt: Date.now(), endedAt: null }, g, { goal });
  st.sessions.push(sess); save(); return sess;
}
function replaceActive(focus) {
  const a = active();
  if (a && anyLogs(a) && !confirm(S.rebuildConfirm)) return;
  if (a) st.sessions.splice(st.sessions.indexOf(a), 1);
  newSession(focus); render();
}

// ---------- level rules (week_template.how_it_works) ----------
function onLogged(sess, it, i) {
  const area = it.slot.area, c = st.counters, rec = it.log[i];
  if (!rec || !['D', 'I'].includes(it.type)) return;
  if (rec.st === 'x') {
    c.fail[area] = (c.fail[area] || 0) + 1;
    if (c.fail[area] >= 2) { c.fail[area] = 0; const cur = st.levels[area] || st.level; if (cur > 1) { st.levels[area] = cur - 1; toast(fmt(S.levelDown, { area: areaName(area), n: cur - 1 })); } }
  }
  if (it.log.length >= it.sets && it.log.slice(0, it.sets).every(r => r && r.st === 'c') && !it.topCounted) {
    it.topCounted = true; c.top[area] = (c.top[area] || 0) + 1;
    if (c.top[area] >= 3) { c.top[area] = 0; const cur = st.levels[area] || st.level; if (cur < 5) st.offer = { area, n: cur + 1 }; }
  }
}

// ---------- toast & sheet ----------
let toastT;
function toast(msg, action) {
  const t = $('#toast'); t.innerHTML = esc(msg) + (action ? ` <button class="link" id="toastAct">${esc(action.label)}</button>` : '');
  t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), action ? 6000 : 3200);
  if (action) $('#toastAct').onclick = () => { t.classList.remove('show'); action.fn(); };
}
function sheet(html) { const s = $('#sheet'); s.innerHTML = `<div class="sheet-card" role="dialog">${html}<button class="btn wide ghost" data-act="closeSheet">${esc(S.close)}</button></div>`; s.hidden = false; }
const closeSheet = () => { $('#sheet').hidden = true; };

// ---------- tests & dosing ----------
const distU = k => k === 'cooper12' ? (st.settings.units === 'metric' ? 'km' : 'mi') : (st.settings.units === 'metric' ? 'm' : 'yd');
const wU = () => st.settings.units === 'metric' ? 'kg' : 'lb';
const plural = n => /s$/.test(n) ? n : n + 's';
function basisText(it) {
  const b = it.basis; const mv = id => ex(id).name.toLowerCase();
  if (b.k === 'reps') return fmt(S.basisReps, { n: b.n, move: plural(mv(b.move)) });
  if (b.k === 'time') return fmt(S.basisTime, { t: mmss(b.n), move: mv(b.move) });
  if (b.k === 'heavy') return fmt(b.est ? S.basisHeavyEst : S.basisHeavy, { w: b.w, u: b.u, move: mv(b.move) });
  if (b.k === 'sprint') return fmt(S.basisSprint, { d: b.d + ' ' + b.du, s: b.s });
  if (b.k === 'cooper') return fmt(S.basisCooper, { d: b.d + ' ' + b.du });
  return S.basisRehab;
}
function markName(key) { return key === 'sprint30' ? S.sprintName : key === 'cooper12' ? S.cooperName : ex(key).name.toLowerCase(); }
function markText(key, m) {
  if (m.kind === 'maxReps') return fmt(S.testResult, { n: m.v, move: plural(markName(key)) });
  if (m.kind === 'maxTime') return fmt(S.testResult, { n: mmss(m.v), move: markName(key) });
  if (m.kind === 'heavy') return fmt(S.testResult, { n: Math.round(m.est || m.w) + ' ' + m.unit + (m.est ? ' (est.)' : ''), move: markName(key) });
  return fmt(S.testResult, { n: m.dist + ' ' + m.du, move: markName(key) });
}
let T = { kind: 'maxReps', id: null };
const TEST_DEFAULT = { maxReps: ['pushup', 'squat', 'pullup'], maxTime: ['plank', 'wall_sit'], heavy: ['bb_bench_press', 'bb_back_squat', 'db_press', 'kb_goblet_squat'] };
function viewTests() {
  const o = opts(); const kinds = ['maxReps', 'maxTime', 'heavy', 'sprint30', 'cooper12'];
  let h = `<header class="hero"><h1>${esc(S.testsTitle)}</h1><p class="sub" id="testsIntro">${esc(S.testsIntro)}</p></header>`;
  h += `<section class="card"><div class="chips" id="testKinds">${kinds.map(k => `<button class="chip ${T.kind === k ? 'on' : ''}" data-act="tKind" data-k="${k}" ${DZ.testable(k, o).length ? '' : 'disabled'}>${esc(S.testKinds[k])}</button>`).join('')}</div>
    ${st.injuries.length ? `<p class="small muted">${esc(S.testInjuredNote)}</p>` : ''}`;
  const list = DZ.testable(T.kind, o);
  if (['maxReps', 'maxTime', 'heavy'].includes(T.kind)) {
    if (!T.id || !list.some(e => e.id === T.id)) T.id = (TEST_DEFAULT[T.kind].find(id => list.some(e => e.id === id)) || (list[0] || {}).id) || null;
    h += `<select class="search" data-act="tMove" id="tMove">${list.map(e => `<option value="${e.id}" ${e.id === T.id ? 'selected' : ''}>${esc(e.name)}</option>`).join('')}</select>`;
  }
  const name = T.id ? ex(T.id).name : '';
  if (T.kind === 'maxReps' && T.id) h += `<p class="tprompt">${esc(fmt(S.testMaxReps, { move: name }))}</p><p class="tcount" id="tCount">${T.count || 0}</p>
      <div class="row"><button class="btn huge" data-act="tMinus">${esc(S.testMinus)}</button><button class="btn primary huge" data-act="tPlus" id="tPlus">${esc(S.testPlus)}</button></div><button class="btn wide" data-act="tSave" id="tDone">${esc(S.testDone)}</button>`;
  if (T.kind === 'maxTime' && T.id) h += `<p class="tprompt">${esc(fmt(S.testMaxTime, { move: name }))}</p><p class="tcount" id="tClock">${mmss(T.t0 ? (Date.now() - T.t0) / 1000 : 0)}</p>
      ${T.t0 ? `<button class="btn primary wide huge" data-act="tSave" id="tStop">${esc(S.testStop)}</button>` : `<button class="btn primary wide huge" data-act="tGo" id="tGo">${esc(S.testStart)}</button>`}`;
  if (T.kind === 'heavy' && T.id) h += `<p class="tprompt">${esc(fmt(S.testHeavy, { move: name }))}</p>
      <label class="lbl">${esc(fmt(S.testBest, { u: wU() }))} <input class="num" type="number" inputmode="decimal" id="tBest" data-act="tIn"></label><p class="muted">${esc(S.testOr)}</p>
      <div class="row"><label class="lbl">${esc(fmt(S.testWeight, { u: wU() }))} <input class="num" type="number" inputmode="decimal" id="tW" data-act="tIn"></label><label class="lbl">${esc(S.testReps)} <input class="num" type="number" inputmode="numeric" id="tR" data-act="tIn"></label></div>
      <p class="basis" id="tEst"></p><button class="btn primary wide" data-act="tSave" id="tSaveHeavy">${esc(S.testSave)}</button>`;
  if (T.kind === 'sprint30' || T.kind === 'cooper12') {
    const dur = T.kind === 'sprint30' ? 30 : 720; const left = T.t0 ? Math.max(0, dur - (Date.now() - T.t0) / 1000) : dur;
    h += `<p class="tprompt">${esc(T.kind === 'sprint30' ? S.testSprint : S.testCooper)}</p><p class="tcount" id="tClock">${mmss(left)}</p>
      ${T.t0 && left > 0 ? '' : `<button class="btn wide" data-act="tGo" id="tGo">${esc(S.testStart)}</button>`}
      <label class="lbl">${esc(fmt(S.testDistance, { u: distU(T.kind) }))} <input class="num" type="number" inputmode="decimal" step="any" id="tDist"></label>
      <button class="btn primary wide" data-act="tSave" id="tSaveDist">${esc(S.testSave)}</button>`;
  }
  if (T.last) h += `<p class="result" id="tResult">${esc(T.last)}</p>`;
  h += '</section>';
  const keys = Object.keys(st.marks);
  h += `<section class="card"><h3>${esc(S.testMarks)}</h3>${keys.length ? keys.map(k => st.marks[k].slice(-3).map(m => `<p class="small"><b>${esc(m.date)}</b> · ${esc(markText(k, m))}</p>`).join('')).join('') : `<p class="small muted">${esc(S.testNone)}</p>`}</section>`;
  return h;
}
let tTick = null;
function testTick() { clearInterval(tTick); tTick = setInterval(() => { if (st.tab !== 'tests' || !T.t0) { clearInterval(tTick); return; } const c = $('#tClock'); if (!c) return;
  if (T.kind === 'maxTime') c.textContent = mmss((Date.now() - T.t0) / 1000);
  else { const dur = T.kind === 'sprint30' ? 30 : 720; const left = Math.max(0, dur - (Date.now() - T.t0) / 1000); c.textContent = mmss(left); if (left <= 0) { beep(); T.t0 = null; render(); } } }, 250); }
function saveMark(key, m) { (st.marks[key] = st.marks[key] || []).push(Object.assign({ date: today() }, m)); T.last = markText(key, st.marks[key][st.marks[key].length - 1]); T.count = 0; T.t0 = null;
  const a = active(); if (a && !anyLogs(a)) a.items.forEach(i => { i.dosed = null; }); save(); render(); }
function heavyEstimate() {
  const best = +($('#tBest') || {}).value, w = +($('#tW') || {}).value, r = +($('#tR') || {}).value;
  if (best > 0) return { w: best, unit: wU() };
  const e = DZ.estimate1RM(w, r); if (!e) return null;
  return { w, reps: r, est: Math.round(e.value * 10) / 10, formula: e.formula, reliable: e.reliable, unit: wU() };
}
// ---------- easier / harder ----------
const moveTip = e => (e.tips && e.tips[0]) || e.cue || e.note || '';
const howLine = (e, dir) => dir < 0 ? (e.make_easier || e.makeEasier || '') : (e.make_harder || e.makeHarder || '');
const makeLines = e => { const a = howLine(e, -1), b = howLine(e, 1); return a || b ? `<p class="small makeit">${a ? `<span class="mk-e">${esc(fmt(S.makeEasier, { how: a }))}</span>` : ''}${a && b ? '<br>' : ''}${b ? `<span class="mk-h">${esc(fmt(S.makeHarder, { how: b }))}</span>` : ''}</p>` : ''; };
function howSheet(id) {
  const e = ex(id); const lines = e.frames && e.frames.length ? e.frames : (e.steps || []);
  sheet(`<h3>${esc(e.name)}</h3>${e.description ? `<p class="desc" id="howDesc">${esc(e.description)}</p>` : ''}
    ${lines.length ? `<ol class="flines">${lines.map(l => `<li>${esc(l)}</li>`).join('')}</ol>` : ''}
    ${e.tips && e.tips.length ? `<ul class="tips">${e.tips.map(t => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}${makeLines(e)}`);
}
function progSheet(it, dir) {
  const e = ex(it.id); const r = E.progressions(e, dir, opts(), curSess()); const how = howLine(e, dir);
  sheet(`<h3>${esc(dir < 0 ? S.easier : S.harder)}</h3>${how ? `<p class="how" id="progHow">${esc(how)}</p>` : ''}
    ${r.list.map(x => `<button class="btn wide left" data-act="progPick" data-id="${x.id}" data-uid2="${it.uid}">${esc(x.name)} <span class="small muted">${esc(fmt(S.levelTag, { n: x.level }))}</span></button>`).join('') || `<p class="muted">${esc(moveTip(e))}</p>`}`);
}
// ---------- injuries ----------
const oneArmNote = e => { const m = (e.note || '').match(/[^.]*one (arm|leg) at a time\.?/i); return m ? m[0].trim() : ''; };
const sideLabel = sd => sd === 'left' ? S.yourLeft : sd === 'right' ? S.yourRight : sd === 'both' ? S.bothSides : '';
const injName = j => (j.side === 'left' || j.side === 'right' ? sideLabel(j.side) + ' ' : j.side === 'both' ? S.bothSides + ' · ' : '') + j.region;
const injWeeks = j => Math.floor((Date.now() - new Date(j.date + 'T12:00')) / (7 * 864e5));
const injDue = j => (Date.now() - new Date((j.checked || j.date) + 'T12:00')) / (7 * 864e5) >= L.injury.remindWeeks;
function refreshPlan() {
  const a = active(); if (!a) return;
  if (!anyLogs(a)) { st.sessions.splice(st.sessions.indexOf(a), 1); return; }
  // already started: swap the not-yet-logged moves the injury rules out; drop any with no safe swap
  const c = E.injuryCtx(st.injuries);
  for (const it of a.items.slice()) {
    if (it.log.some(Boolean)) continue;
    if (it.kind === 'hiit' && c && c.backNeck) { a.items.splice(a.items.indexOf(it), 1); continue; }
    if (it.kind || !E.blockedBy(E.BY[it.id], c)) continue;
    if (!E.swap(a, it.uid, opts({ areas: a.areas }))) a.items.splice(a.items.indexOf(it), 1);
  }
}
function markInjury(region, side) {
  st.injuries = st.injuries.filter(j => j.region !== region);
  st.injuries.push({ region, side, date: today(), checked: today() });
  refreshPlan(); save(); render();
  sheet(`<h3>${ctl('pain-flag', 'ctl s')} ${esc(fmt(S.injMarked, { what: injName({ region, side }) }))}</h3><p class="warn" id="injDisc">${esc(S.injDisclaimer)}</p><button class="btn primary wide" data-act="closeSheet">${esc(S.injOk)}</button>`);
}
function healInjury(region) {
  const j = st.injuries.find(x => x.region === region); if (!j) return;
  st.injuries = st.injuries.filter(x => x !== j); refreshPlan(); save(); closeSheet(); render(); toast(fmt(S.injHealedToast, { what: injName(j) }));
}
function injSheet(region, tapped) {
  const cur = st.injuries.find(j => j.region === region);
  const sided = tapped !== 'center';
  sheet(`<h3>${esc(cap(region))}</h3><p class="muted">${esc(S.injHint)}</p>
    ${sided ? `<p class="lbl">${esc(S.injSideQ)}</p><div class="row wrap" id="sidePick">${['left', 'right', 'both'].map(sd => `<button class="btn ${(cur ? cur.side : tapped) === sd ? 'primary' : ''}" data-act="injSide" data-r="${esc(region)}" data-sd="${sd}">${esc(sideLabel(sd))}</button>`).join('')}</div>`
      : `<button class="btn primary wide" data-act="injSide" data-r="${esc(region)}" data-sd="center">${esc(S.injMark)}</button>`}
    ${cur ? `<button class="btn wide" data-act="injHeal" data-r="${esc(region)}">${ctl('bring-back', 'ctl s')}${esc(S.injHealed)}</button>` : ''}
    <p class="small muted">${esc(S.injDisclaimer)}</p>`);
}
function injListHTML(withHeal) {
  if (!st.injuries.length) return `<p class="small muted">${esc(S.injNone)}</p>`;
  return st.injuries.map(j => `<div class="flagrow inj"><span><b class="bang">!</b> ${esc(injName(j))} <span class="small muted">${esc(fmt(S.injSince, { date: j.date }))}</span></span>${withHeal ? `<button class="btn" data-act="injHeal" data-r="${esc(j.region)}">${esc(S.injHealed)}</button>` : ''}</div>`).join('');
}
function injMapHTML() {
  const svg = (window.BODYMAP || {})[st.view === 'back' ? 'injBack' : 'injFront'] || '';
  return `<div class="injmap-wrap"><p class="small">${esc(S.injHint)}</p><div class="seg"><button class="${st.view === 'front' ? 'on' : ''}" data-act="view" data-v="front">${esc(S.front)}</button><button class="${st.view === 'back' ? 'on' : ''}" data-act="view" data-v="back">${esc(S.back)}</button></div>
    ${st.view === 'front' ? `<div class="mirror small muted"><span>${esc(S.yourRight)}</span><span>${esc(S.yourLeft)}</span></div>` : `<div class="mirror small muted"><span>${esc(S.yourLeft)}</span><span>${esc(S.yourRight)}</span></div>`}
    <div class="bodymap injmap">${svg}</div>${injListHTML(true)}<p class="small muted">${esc(S.injDisclaimer)}</p></div>`;
}
const ALT = {
  swim: () => ({ only: E.EX.filter(e => e.equipment.includes('pool')).map(e => e.id), place: ['pool', 'kickboard'], slots: [['cardio', 'D', 4]] }),
  walk: () => ({ only: E.EX.filter(e => /walk/.test(e.id) && e.areas.includes('cardio')).map(e => e.id), place: ['open-space'], slots: [['cardio', 'D', 2]] }),
  bike: () => ({ only: E.EX.filter(e => e.equipment.includes('bike')).map(e => e.id), place: ['bike'], slots: [['cardio', 'D', 2]] }),
  rehab: () => ({ slots: [['rehab', 'M', 2], ['rehab', 'D', 2], ['rehab', 'I', 2]], goal: 'rehabilitation' }),
  mobility: () => ({ slots: [['mobility', 'M', 3], ['mobility', 'S', 2]], goal: null }),
  upper: () => ({ slots: L.splitSlots.upper }),
  lower: () => ({ slots: L.splitSlots.lower }),
};
function altOptions() {
  const injX = E.injuryCtx(st.injuries);
  return Object.keys(ALT).filter(k => {
    const a = ALT[k]; const f = a(); const own = E.ownedSet(st.equip.concat(f.place || []));
    if (f.only) return f.only.some(id => !E.blockedBy(E.BY[id], injX));
    return f.slots.some(sl => E.EX.some(e => (e.areas.includes(sl[0])) && e.type === sl[1] && E.have(e, own) && !E.blockedBy(e, injX)));
  });
}
function injuryCardsHTML(sess) {
  if (!st.injuries.length) return '';
  let h = '';
  for (const j of st.injuries.filter(injDue)) h += `<section class="card offer inj-remind" data-r="${esc(j.region)}"><p>${esc(fmt(S.injReminder, { side: S.sideWord[j.side] || '', area: j.region, n: Math.max(1, injWeeks(j)) }).replace(/ {2,}/g, ' '))}</p>
    <div class="row"><button class="btn" data-act="injStill" data-r="${esc(j.region)}">${esc(S.injStill)}</button><button class="btn primary" data-act="injHeal" data-r="${esc(j.region)}">${esc(S.injHealed)}</button></div></section>`;
  h += `<section class="card injcard"><p>${ctl('pain-flag', 'ctl s')} ${esc(fmt(S.injActive, { list: st.injuries.map(injName).join(', ') }))}</p>
    ${st.injuries.some(j => j.side === 'left' || j.side === 'right') ? `<p class="small muted">${esc(S.injOneSideNote)}</p>` : ''}
    <p class="warn small" id="injDiscPlan">${esc(S.injDisclaimer)}</p>`;
  const ic = E.injuryCtx(st.injuries);
  const lim = sess && (sess.limitedGoal || (ic && ic.backNeck && ['strength', 'power', 'hiit'].includes(sess.goal) ? sess.goal : null)), miss = sess && sess.missing && sess.missing.length;
  if (lim) h += `<p class="note" id="injLimited">${esc(fmt(S.injLimited, { goal: goalName(lim).toLowerCase() }))}</p>`;
  if (miss) h += `<p class="note" id="injMissing">${esc(fmt(S.injNothing, { areas: sess.missing.map(a => areaName(a).toLowerCase()).join(', ') }))}</p>`;
  if (lim || miss) h += `<p class="lbl">${esc(S.injSafer)}</p><div class="chips" id="altChips">${altOptions().map(k => `<button class="chip" data-act="altFocus" data-k="${k}">${esc(S.injAlt[k])}</button>`).join('')}</div>`;
  return h + '</section>';
}

// ---------- render ----------
function render() {
  $$('nav button').forEach(b => b.classList.toggle('on', b.dataset.tab === st.tab));
  const m = $('#main'); const fn = { tests: viewTests, today: viewToday, gear: viewSetup, library: viewLibrary, checkin: viewCheckin, history: viewHistory }[st.tab] || viewToday;
  m.innerHTML = fn(); bindAfter();
}

function breakdownLine(sess) {
  const b = E.breakdown(sess.items); const m = s => fmt(S.minutes, { m: Math.round(s / 60) });
  return fmt(S.breakdown, { w: m(b.warm), m: m(b.main), c: m(b.cool) }) + (b.break ? fmt(S.breakdownBreaks, { b: m(b.break) }) : '') + fmt(S.breakdownTotal, { t: m(b.total) });
}

function viewToday() {
  const head = `<header class="hero"><h1><img class="mark" src="icons/mark.png" alt="">${esc(S.appName)}</h1><p class="sub">${esc(new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' }))}</p></header>`;
  if (!st.setupDone) return head + `<section class="card center"><p>${esc(S.appSub)}</p><p class="muted">${esc(S.emptyHome)}</p><button class="btn primary wide" data-act="goSetup">${esc(S.firstRunBtn)}</button></section>`;
  let html = head;
  const pw = planWeek(); if (pw) html += `<p class="pill">${esc(fmt(S.planWeek, { n: pw, total: L.settings.plan.weeks }))}</p>`;
  if (st.offer) html += `<section class="card offer"><p>${esc(fmt(S.levelUpOffer, { n: st.offer.n, area: areaName(st.offer.area) }))}</p><div class="row"><button class="btn primary" data-act="lvlYes">${esc(S.levelUpYes)}</button><button class="btn" data-act="lvlNo">${esc(S.levelUpNo)}</button></div></section>`;
  let sess = active();
  if (!sess && !todays().length) sess = newSession();
  html += injuryCardsHTML(sess);
  for (const r of DZ.retestDue(st.marks).slice(0, 2)) html += `<section class="card offer retest" data-k="${r.key}"><p>${esc(fmt(S.testRetest, { n: r.weeks, move: markName(r.key) }))}</p><div class="row"><button class="btn" data-act="retestLater" data-k="${r.key}">${esc(S.testLater)}</button><button class="btn primary" data-act="retestGo" data-k="${r.key}">${esc(S.testRetestBtn)}</button></div></section>`;
  if (!sess) {
    const last = todays().slice(-1)[0]; const ago = last.endedAt ? (Date.now() - last.endedAt) / 6e4 : 0;
    html += `<section class="card center"><p class="big">${esc(S.doneToday)}</p>`;
    if (todays().length < L.settings.sessions[1]) {
      html += `<p>${esc(fmt(S.secondSession, { h: st.settings.gapHours }))}</p>`;
      if (last.endedAt) html += `<p class="muted">${esc(fmt(S.lastAgo, { t: `${Math.floor(ago / 60)} h ${Math.round(ago % 60)} min` }))}</p>`;
      if (st.settings.perDay >= 2) html += `<p class="muted">${esc(L.splitNotes.two_a_day || S.twoADay)}</p>`;
      html += `<button class="btn primary wide" data-act="nextSession">${esc(fmt(S.startNext, { n: todays().length + 1 }))}</button>`;
    }
    return html + '</section>';
  }
  const label = sess.focus.type === 'plan' ? fmt(S.dayLabel, { n: (sess.dayIdx % E.splitDays(st.settings.days).length) + 1, name: cap(sess.name) }) : fmt(S.focusLabel, { areas: sess.name });
  html += `<section class="sess-head"><p class="muted">${esc(fmt(S.sessionLabel, { n: sess.n }))}${sess.goal ? ' · ' + esc(goalName(sess.goal)) : ''}</p><h2>${esc(label)}</h2>
    <p class="breakdown" id="breakdown">${esc(breakdownLine(sess))}</p>
    <p class="muted small">${esc(fmt(S.noRepeats, { area: areaName((sess.items.find(i => i.sec === 'main') || { slot: { area: 'core' } }).slot.area).toLowerCase() }))}</p>
    ${sess.goal === 'rehabilitation' ? `<p class="warn small">${esc(S.rehabNote)}</p>` : ''}
    <div class="row"><button class="btn" data-act="shuffleDay">${ctl('restart', 'ctl s')}${esc(S.shuffleDay)}</button></div></section>`;
  html += builderHTML(sess);
  let lastSec = null, lastBlock = null;
  sess.items.forEach((it, idx) => {
    const sec = it.sec === 'break' ? (lastSec || 'main') : it.sec;
    if (sec !== lastSec) { html += `<h3 class="sec">${esc(S.sections[sec])}</h3>`; lastSec = sec; }
    if (it.block && it.block !== lastBlock) { html += `<p class="block">${esc(S.blocks[it.block] || it.block)}</p>`; lastBlock = it.block; }
    html += itemHTML(sess, it, idx);
  });
  const done = sess.items.reduce((a, i) => a + i.log.filter(Boolean).length, 0), total = sess.items.reduce((a, i) => a + (i.kind === 'hiit' ? 1 : i.sets), 0);
  html += `<button class="btn wide" data-act="addOpen">${esc(S.addExercise)}</button>
    <section class="card"><p class="muted">${esc(fmt(S.progressLine, { done, total }))}</p>
    <label class="lbl" for="notes">${esc(S.notes)}</label><textarea id="notes" data-act="notes" rows="3">${esc(sess.notes)}</textarea>
    <button class="btn primary wide" data-act="finish">${ctl('complete', 'ctl s')}${esc(S.finish)}</button><p class="muted small">${esc(S.disclaimer)}</p></section>`;
  return html;
}

function builderHTML(sess) {
  const days = E.splitDays(st.settings.days);
  const regions = new Set(st.regions), extras = new Set(st.extras);
  const svg = (window.BODYMAP || {})[st.view] || '';
  const ext = ['cardio', 'hiit', 'rehab', 'mobility', 'skills'];
  return `<details class="card builder" ${st.builderOpen ? 'open' : ''} data-act="builderToggle"><summary>${esc(S.changeFocus)}</summary>
    <p class="lbl">${esc(S.focusPlan)}</p><div class="chips">${days.map((d, i) => `<button class="chip ${sess.focus.type === 'plan' && sess.dayIdx % days.length === i ? 'on' : ''}" data-act="planDay" data-i="${i}">${i + 1}. ${esc(cap(d.name))}</button>`).join('')}</div>
    <p class="lbl">${esc(S.focusBody)}</p>
    <div class="seg mode" id="mapMode"><button class="${st.mapMode !== 'injury' ? 'on' : ''}" data-act="mapMode" data-m="work">${esc(S.mapWork)}</button><button class="${st.mapMode === 'injury' ? 'on inj' : ''}" data-act="mapMode" data-m="injury">${ctl('pain-flag', 'ctl s')}${esc(S.mapInjury)}</button></div>
    ${st.mapMode === 'injury' ? injMapHTML() : `<div class="bodywrap"><div class="body-col"><div class="seg"><button class="${st.view === 'front' ? 'on' : ''}" data-act="view" data-v="front">${esc(S.front)}</button><button class="${st.view === 'back' ? 'on' : ''}" data-act="view" data-v="back">${esc(S.back)}</button></div>
      <div class="bodymap" id="bodymap">${svg}</div></div>
      <div class="extras">${ext.map(x => `<button class="chip tall ${extras.has(x) ? 'on' : ''}" data-act="extra" data-x="${x}">${x === 'hiit' ? img('goals', 'hiit-conditioning', 'ic s') : x === 'rehab' ? img('goals', 'rehabilitation', 'ic s') : x === 'mobility' ? img('goals', 'mobility', 'ic s') : x === 'skills' ? img('goals', 'skills', 'ic s') : img('areas', 'cardio', 'ic s')}${esc(S.focusExtras[x])}</button>`).join('')}</div></div>
    <p class="small muted" id="regionList">${esc([...regions].join(', '))}</p>`}
    ${extras.has('hiit') ? `<p class="lbl">${esc(S.hiitFormat)}</p><div class="chips">${Object.keys(L.hiit).map(h => `<button class="chip ${st.settings.hiit === h ? 'on' : ''}" data-act="hiitFmt" data-h="${h}">${esc(S.hiitNames[h] || h)}</button>`).join('')}</div>` : ''}
    <p class="lbl">${esc(S.minutesTitle)}</p>${minutesChips('focusMin', st.focusMinutes || st.settings.minutes)}
    <button class="btn primary wide" data-act="buildFocus">${esc(S.buildSession)}</button></details>`;
}
function minutesChips(act, cur) {
  const opts2 = [10, 20, 30, 45, 60, 90, 120, 180, 240, 360].filter(m => m >= L.settings.minutes[0] && m <= L.settings.minutes[1]);
  return `<div class="chips">${opts2.map(m => `<button class="chip ${cur === m ? 'on' : ''}" data-act="${act}" data-m="${m}">${m}</button>`).join('')}
    <input class="num" type="number" inputmode="numeric" min="${L.settings.minutes[0]}" max="${L.settings.minutes[1]}" value="${cur}" data-act="${act}In" aria-label="${esc(S.minutesTitle)}"></div>`;
}

const LOADED = ['dumbbell', 'barbell', 'kettlebell', 'sandbag', 'water-jug', 'weighted-rope', 'backpack', 'plate', 'slam-ball'];
function targetText(it) {
  const e = ex(it.id);
  if (it.kind === 'hiit') return `${fmt(S.roundsN, { n: it.sets })} · ${it.work}s / ${it.rest}s`;
  if (it.mode === 'reps') return fmt(S.targetReps, { sets: it.sets, lo: it.reps[0], hi: it.reps[1] }) + (it.weightRange ? ' · ' + fmt(S.loadRange, { w: it.weight, u: it.wUnit, lo: it.weightRange[0], hi: it.weightRange[1] }) : '');
  return fmt(S.targetTime, { sets: it.sets, t: (it.hold >= 60 ? mmss(it.hold) : it.hold + 's') }) + (it.sides === 2 ? S.perSide : '');
}
function itemHTML(sess, it, idx) {
  if (it.kind === 'water_break' || it.kind === 'block_break') {
    const r = it.log[0];
    return `<article class="ex brk ${r ? 'done' : ''}" data-uid="${it.uid}"><div class="ex-h">${ctl('rest', 'ctl s')}<h4>${esc(S[it.kind])} · ${mmss(it.work)}</h4></div>
      <div class="row"><button class="btn" data-act="tStart" data-set="0">${ctl('start', 'ctl s')}${esc(S.start)}</button><button class="btn" data-act="stat" data-set="0" data-st="c">${esc(S.done)}</button></div></article>`;
  }
  const e = ex(it.id); const flagged = st.pain[it.id];
  const isHiit = it.kind === 'hiit';
  const loaded = !isHiit && e.equipment.some(t => LOADED.includes(t));
  const safety = !isHiit && (e.type === 'I' || e.areas.includes('neck'));
  const sets = isHiit ? 1 : it.sets;
  let rows = '';
  for (let i = 0; i < sets; i++) {
    const r = it.log[i]; const stv = r && r.st;
    const tm = it.mode === 'time' || isHiit;
    const lab = isHiit ? (S.hiitNames[it.id] || e.name) : e.type === 'skill' ? fmt(S.timedLabel, { name: fmt(S.setN, { n: i + 1 }), t: mmss(it.hold) }) : fmt(S.setN, { n: i + 1 });
    rows += `<div class="set ${stv ? 'st-' + stv : ''}" data-set="${i}"><div class="set-top"><span class="set-n">${esc(lab)}</span>
      <button class="tbtn" data-act="tStart" data-set="${i}" aria-label="${esc(S.start)}">${ctl(tm ? 'start' : 'stopwatch')}<span>${esc(S.start)}</span></button></div>
      <div class="stat">
        <button class="sbtn c ${stv === 'c' ? 'on' : ''}" data-act="stat" data-st="c" data-set="${i}">${ctl('complete')}<span>${esc(S.complete)}</span></button>
        <button class="sbtn p ${stv === 'p' ? 'on' : ''}" data-act="stat" data-st="p" data-set="${i}">${ctl('partial')}<span>${esc(S.partial)}</span></button>
        <button class="sbtn x ${stv === 'x' ? 'on' : ''}" data-act="stat" data-st="x" data-set="${i}">${ctl('could-not-do')}<span>${esc(S.couldNot)}</span></button>
      </div>
      ${stv === 'p' || (r && r.edit) ? `<div class="got"><input type="number" inputmode="numeric" min="0" value="${r && r.v != null ? r.v : ''}" data-act="val" data-set="${i}" aria-label="${esc(tm ? S.gotSecs : S.gotReps)}"><span>${esc(tm ? S.gotSecs : S.gotReps)}</span></div>` : ''}
      ${r && r.msg ? `<p class="small muted">${esc(r.msg)}${r.st === 'p' ? ` <button class="link" data-act="editSet" data-set="${i}">${esc(S.edit)}</button>` : ''}</p>` : ''}
    </div>`;
  }
  const pe = isHiit ? null : E.progressions(e, -1, opts(), sess), ph = isHiit ? null : E.progressions(e, 1, opts(), sess);
  return `<article class="ex ${it.log.length && it.log.filter(Boolean).length >= sets ? 'done' : ''}" data-uid="${it.uid}">
    <div class="ex-h">${isHiit ? img('goals', 'hiit-conditioning', 'ic') : img('equipment', e.equipment[0] || 'bodyweight', 'ic')}
      <div class="ex-t"><h4>${esc(isHiit ? (S.hiitNames[it.id] || e.name) : e.name)}${flagged ? ' ' + ctl('pain-flag', 'ctl s flag') : ''}</h4>
      ${e.subtitle ? `<p class="small">${esc(e.subtitle)}</p>` : ''}
      <p class="tags">${esc(isHiit ? e.name : [it.slot.area, ...e.areas.filter(a => a !== it.slot.area && a !== 'hiit')].slice(0, 3).map(areaName).join(' · '))} · ${esc(S.types[e.type] || e.type)} · ${esc(fmt(S.levelTag, { n: e.level }))}</p></div></div>
    <p class="target">${esc(targetText(it))}</p>${it.basis ? `<p class="basis small">${esc(basisText(it))}</p>` : ''}${it.offerHarder ? `<button class="btn small-btn" data-act="progPick" data-id="${it.offerHarder}" data-uid2="${it.uid}">${esc(fmt(S.offerHarderBtn, { move: ex(it.offerHarder).name }))}</button>` : ''}
    ${isHiit ? `<p class="cue">${esc(fmt(S.hiitMoves, { moves: (it.moves || []).map(m => ex(m).name).join(', ') }))}</p>` : ''}
    <p class="cue">${esc(e.cue || e.note)}${e.alias ? ` <em>(${esc(e.alias)})</em>` : ''}</p>
    ${e.note && e.cue && e.note !== e.cue ? `<p class="small muted">${esc(e.note)}</p>` : ''}
    ${it.sideOnly ? `<p class="note small sideonly">${esc(S.injSideOnly[it.sideOnly])}${oneArmNote(e) ? ' · ' + esc(oneArmNote(e)) : ''}</p>` : ''}
    ${safety ? `<p class="warn small">${esc(S.safety)}</p>` : ''}
    ${e.equipment.length ? `<p class="small muted">${esc(fmt(S.uses, { eq: e.equipment.map(eqName).join(', ') }))}</p>` : ''}
    ${pe ? `<div class="row prog"><button class="btn" data-act="progOpen" data-dir="-1" ${pe.list.length ? '' : 'disabled'}>${esc(S.tooHard)}</button><button class="btn" data-act="progOpen" data-dir="1" ${ph.list.length ? '' : 'disabled'}>${esc(S.tooEasy)}</button></div>
      ${makeLines(e)}${(!pe.list.length || !ph.list.length) && !howLine(e, -1) && !howLine(e, 1) ? `<p class="small muted progtip">${esc(moveTip(e))}</p>` : ''}` : ''}
    ${loaded ? `<label class="wt">${esc(fmt(S.weightLabel, { u: st.settings.units === 'metric' ? 'kg' : 'lb' }))} <input type="number" inputmode="decimal" min="0" value="${it.weight || ''}" data-act="weight"></label>` : ''}
    ${rows}
    <div class="tools">
      <button class="tool" data-act="swapOpen">${ctl('replace', 'ctl s')}${esc(S.swap)}</button>
      <button class="tool" data-act="focus">${esc(S.focusBtn)}</button>
      ${isHiit ? '' : `<button class="tool" data-act="howOpen">${esc(S.howTo)}</button>`}
      <button class="tool" data-act="up" aria-label="${esc(S.moveUpLabel)}">${S.moveUp}</button>
      <button class="tool" data-act="down" aria-label="${esc(S.moveDownLabel)}">${S.moveDown}</button>
      ${isHiit ? '' : `<button class="tool" data-act="addSet">${esc(S.addSet)}</button><button class="tool" data-act="remSet">${esc(S.removeSet)}</button>`}
      ${isHiit ? '' : `<button class="tool pain" data-act="painOpen" aria-label="${esc(S.painBtn)}" title="${esc(S.painBtn)}">${ctl('pain-flag', 'ctl s')}!</button>`}
      <button class="tool" data-act="remove" aria-label="${esc(S.removeLabel)}">${S.remove}</button>
    </div></article>`;
}

// ---------- setup ----------
function viewSetup() {
  const owned = new Set(st.equip);
  let html = `<header class="hero"><h1><img class="mark" src="icons/mark.png" alt="">${esc(S.appName)}</h1><p class="sub">${esc(S.appSub)}</p></header>
    <section class="card"><h2>${esc(S.pickTitle)}</h2><p class="muted">${esc(S.pickSub)}</p>
    <div class="tiles"><button class="tile on" disabled>${img('equipment', 'bodyweight')}<span>${esc(eqName('bodyweight'))}</span></button></div>`;
  for (const g of L.equipGroups) {
    if (!g.tags.length) continue;
    html += `<p class="lbl">${esc(S.groups[g.id] || g.id)}</p><div class="tiles">${g.tags.map(t => `<button class="tile ${owned.has(t) ? 'on' : ''}" data-act="equip" data-t="${t}" aria-pressed="${owned.has(t)}">${img('equipment', t)}<span>${esc(eqName(t))}</span></button>`).join('')}</div>`;
  }
  html += '</section>';
  // cheap gear (library cheap_gear; price shown only if the library sets one)
  const cheap = L.cheapGear.filter(c => !owned.has(c.id)).map(c => {
    const house = (L.equipGroups.find(g => g.id === 'basics') || { tags: [] }).tags.concat('anchor');
    const now = E.ownedSet(st.equip.concat(house)), plus = E.ownedSet(st.equip.concat(house, c.id));
    return Object.assign({ n: E.EX.filter(e => e.equipment.includes(c.id) && !E.have(e, now) && E.have(e, plus)).length }, c);
  }).filter(c => c.n > 0);
  if (cheap.length) html += `<section class="card"><h3>${esc(S.cheapTitle)}</h3>${cheap.map(c => `<div class="cheap">${img('equipment', c.id, 'ic s')}<p>${esc(fmt(S.cheapCard, { item: c.name, n: c.n }))}${c.price ? ' ' + esc(fmt(S.cheapPrice, { price: new Intl.NumberFormat(undefined, { style: 'currency', currency: st.settings.currency, maximumFractionDigits: 0 }).format(c.price) })) : ''}<br><span class="small muted">${esc(c.for)}</span></p></div>`).join('')}</section>`;
  html += `<section class="card"><h3>${esc(S.goalTitle)}</h3><div class="tiles">
    <button class="tile ${!st.goal ? 'on' : ''}" data-act="goal" data-g="">${img('areas', 'full-body')}<span>${esc(S.goalNone)}</span></button>
    ${L.goals.map(g => `<button class="tile ${st.goal === g.id ? 'on' : ''}" data-act="goal" data-g="${g.id}">${img('goals', g.icon || g.id)}<span>${esc(goalName(g.id))}</span></button>`).join('')}</div>`;
  const g = E.goalById(st.goal);
  if (g) html += `<p class="small muted">${g.reps ? esc(fmt(S.goalRule, { reps: g.reps.join('–'), sets: g.sets ? g.sets.join('–') : '–', rest: g.rest ? (g.rest[1] >= 120 ? g.rest.map(x => x / 60).join('–') + ' min' : g.rest.join('–') + ' s') : '–' })) : esc(g.format)}${g.tempo ? ' · ' + esc(g.tempo) : ''}${g.note ? '<br>' + esc(g.note) : ''}<br><em>${esc(L.goalSource)}</em></p>`;
  html += `</section><section class="card"><h3>${esc(S.sportsTitle)}</h3><div class="tiles">${Object.entries(L.sports).map(([id, nm]) => `<button class="tile ${st.sports.includes(id) ? 'on' : ''}" data-act="sport" data-s="${id}">${img('sports', id)}<span>${esc(nm)}</span></button>`).join('')}</div>
    <label class="toggle"><input type="checkbox" data-act="partnerTurns" ${st.settings.partnerTurns ? 'checked' : ''}> ${ctl('partner-turn', 'ctl s')} ${esc(S.partnerToggle)}</label></section>`;
  html += `<section class="card" id="testSetup"><h3>${esc(S.testsTitle)}</h3><p>${esc(S.testsIntro)}</p><p class="small muted">${esc(S.testsSetupHint)}</p><button class="btn wide" data-act="openTests">${esc(S.testsBtn)}</button></section>`;
  html += `<section class="card" id="injSetup"><h3>${ctl('pain-flag', 'ctl s')} ${esc(S.injTitle)}</h3>${injMapHTML()}</section>`;
  const days = st.settings.days;
  html += `<section class="card"><h3>${esc(S.daysTitle)}</h3><div class="chips">${Object.keys(L.splits).map(k => `<button class="chip ${String(days) === k ? 'on' : ''}" data-act="days" data-d="${k}">${k}</button>`).join('')}</div>
    <p class="small muted">${E.splitDays(days).map(d => esc(cap(d.name))).join(' · ')}</p>${days >= 6 ? `<p class="warn small">${esc(L.splitNotes.recovery_note || '')}</p>` : ''}
    <h3>${esc(S.minutesTitle)}</h3>${minutesChips('setMin', st.settings.minutes)}
    <h3>${esc(S.sessionsTitle)}</h3><div class="chips">${[1, 2, 3, 4].filter(n => n >= L.settings.sessions[0] && n <= L.settings.sessions[1]).map(n => `<button class="chip ${st.settings.perDay === n ? 'on' : ''}" data-act="perDay" data-n="${n}">${n}</button>`).join('')}</div>
    ${st.settings.perDay >= 2 ? `<p class="small muted">${esc(L.splitNotes.two_a_day || '')}</p>` : ''}
    <h3>${esc(S.levelTitle)}</h3><div class="chips">${[1, 2, 3, 4, 5].map(n => `<button class="chip ${st.level === n ? 'on' : ''}" data-act="level" data-n="${n}">${n}</button>`).join('')}</div><p class="small muted">${esc(S.levelHint)}</p>
    <label class="toggle"><input type="checkbox" data-act="plan" ${st.settings.plan ? 'checked' : ''}> ${esc(S.planTitle)}</label><p class="small muted">${esc(S.planHint)}</p>
    <button class="btn primary wide" data-act="buildWeek">${esc(st.setupDone ? S.buildBtn : S.firstRunBtn)}</button></section>`;
  if (st.setupDone) html += `<section class="card"><h3>${esc(S.weekTitle)}</h3><ol class="week">${E.splitDays(days).map((d, i) => `<li class="${i === st.dayIdx % E.splitDays(days).length ? 'on' : ''}"><b>${esc(cap(d.name))}</b> <span class="small muted">${esc([...new Set(d.slots.map(s => areaName(s[0])))].join(', '))}</span></li>`).join('')}</ol></section>`;
  html += settingsHTML();
  return html;
}
function settingsHTML() {
  const pain = Object.entries(st.pain), dis = Object.entries(st.dislike);
  return `<section class="card"><h3>${esc(S.settingsTitle)}</h3>
    <p class="lbl">${esc(S.units)}</p><div class="chips"><button class="chip ${st.settings.units === 'imperial' ? 'on' : ''}" data-act="units" data-u="imperial">${esc(S.imperial)}</button><button class="chip ${st.settings.units === 'metric' ? 'on' : ''}" data-act="units" data-u="metric">${esc(S.metric)}</button></div>
    <p class="lbl">${esc(S.currency)}</p><div class="chips">${['USD', 'EUR', 'MXN', 'PYG', 'GBP', 'CAD'].map(c => `<button class="chip ${st.settings.currency === c ? 'on' : ''}" data-act="currency" data-c="${c}">${c}</button>`).join('')}</div>
    <p class="lbl">${esc(S.timerSounds)}</p>${soundBtn('soundsToggle')}<p class="small muted" id="soundsSub">${esc(S.timerSoundsSub)}</p>
    <p class="lbl">${esc(S.gapHours)}</p><div class="chips">${[2, 3, 4, 6, 8].map(h => `<button class="chip ${st.settings.gapHours === h ? 'on' : ''}" data-act="gap" data-h="${h}">${h}</button>`).join('')}</div>
    <h3>${esc(S.testsTitle)}</h3><button class="btn" data-act="openTests" id="settingsTests">${esc(S.testsBtn)}</button>
    <h3>${esc(S.injTitle)}</h3><div id="injSettings">${injListHTML(true)}</div><p class="small muted" id="injDiscSettings">${esc(S.injDisclaimer)}</p>
    <h3>${ctl('pain-flag', 'ctl s')} ${esc(S.painTitle)}</h3><p class="small muted">${esc(S.painIntro)}</p>
    ${pain.length ? pain.map(([id, p]) => `<div class="flagrow"><span>${esc(ex(id).name)}${p.joint ? ' · ' + esc(S.joints[p.joint] || p.joint) : ''}${p.note ? ' · ' + esc(p.note) : ''}</span><button class="btn" data-act="bringBack" data-id="${id}" data-l="pain">${ctl('bring-back', 'ctl s')}${esc(S.painBring)}</button></div>`).join('') : `<p class="small muted">${esc(S.painNone)}</p>`}
    ${dis.length ? `<h3>${esc(S.dislikeTitle)}</h3>` + dis.map(([id]) => `<div class="flagrow"><span>${esc(ex(id).name)}</span><button class="btn" data-act="bringBack" data-id="${id}" data-l="dislike">${ctl('bring-back', 'ctl s')}${esc(S.painBring)}</button></div>`).join('') : ''}
    <div class="row wrap"><button class="btn" data-act="export">${esc(S.exportBtn)}</button><label class="btn">${esc(S.importBtn)}<input type="file" accept="application/json" data-act="import" hidden></label><button class="btn danger" data-act="reset">${esc(S.resetBtn)}</button></div>
    <p class="small muted">${esc(S.privacy)}</p><p class="small muted">${esc(S.disclaimer)}</p></section>`;
}

// ---------- library ----------
let libQ = { q: '', type: '', area: '', mine: false, sport: '' };
function viewLibrary() {
  const owned = E.ownedSet(st.equip);
  const areas = [...new Set(E.EX.flatMap(e => e.areas))];
  const list = E.EX.filter(e => (!libQ.type || e.type === libQ.type) && (!libQ.area || e.areas.includes(libQ.area)) && (!libQ.mine || E.have(e, owned))
    && (!libQ.sport || e.sport === libQ.sport) && (!libQ.q || (e.name + ' ' + (e.alias || '') + ' ' + e.cue + ' ' + e.id).toLowerCase().includes(libQ.q.toLowerCase())));
  const chip = (k, v, label) => `<button class="chip ${libQ[k] === v ? 'on' : ''}" data-act="lib" data-k="${k}" data-v="${v}">${esc(label)}</button>`;
  return `<header class="hero"><h1>${esc(S.libTitle)}</h1><p class="sub">${esc(fmt(S.libCount, { n: list.length }))} / ${E.EX.length}</p></header>
    <input class="search" type="search" placeholder="${esc(S.libSearch)}" value="${esc(libQ.q)}" data-act="libQ">
    <div class="chips scroll">${chip('type', '', S.all)}${Object.entries(S.types).map(([k, v]) => chip('type', k, v)).join('')}</div>
    <div class="chips scroll">${chip('area', '', S.all)}${areas.map(a => chip('area', a, areaName(a))).join('')}</div>
    <div class="chips scroll"><button class="chip ${libQ.mine ? 'on' : ''}" data-act="libMine">${esc(S.onlyMine)}</button>${chip('sport', '', S.all)}${Object.entries(L.sports).map(([k, v]) => chip('sport', k, v)).join('')}</div>
    <div class="liblist">${list.slice(0, 400).map(e => { const ez = E.progressions(e, -1, opts()).list[0], hz = E.progressions(e, 1, opts()).list[0]; return `<article class="lib">${img('equipment', e.equipment[0] || 'bodyweight', 'ic s')}<div><h4>${esc(e.name)}${st.pain[e.id] ? ' ' + ctl('pain-flag', 'ctl s flag') : ''}</h4>
      <p class="tags">${esc(e.areas.map(areaName).join(' · '))} · ${esc(S.types[e.type] || e.type)} · ${esc(fmt(S.levelTag, { n: e.level }))}${e.sport ? ' · ' + esc(L.sports[e.sport] || e.sport) : ''}</p>
      <p class="cue">${esc(e.cue)}${e.alias ? ` <em>(${esc(e.alias)})</em>` : ''}</p>
      ${e.equipment.length ? `<p class="small muted">${esc(fmt(S.uses, { eq: e.equipment.map(eqName).join(', ') }))}</p>` : ''}
      ${ez || hz ? `<p class="small muted">${ez ? esc(S.easier) + ': ' + esc(ez.name) : ''}${ez && hz ? ' · ' : ''}${hz ? esc(S.harder) + ': ' + esc(hz.name) : ''}</p>` : ''}
      ${e.note ? `<p class="small muted">${esc(e.note)}</p>` : ''}<button class="tool" data-act="howOpen" data-id="${e.id}">${esc(S.howTo)}</button></div></article>`; }).join('')}</div>`;
}

// ---------- check-in ----------
let ck = {};
function testsAvail() {
  const owned = E.ownedSet(st.equip);
  return L.tests.filter(t => !t.needs || t.needs.every(n => owned.has(n)));
}
function unitOf(t) { return t.units[st.settings.units] || t.units.imperial; }
function viewCheckin() {
  const last = st.checkins[st.checkins.length - 1]; const weeks = st.settings.checkinWeeks;
  let html = `<header class="hero"><h1>${esc(S.checkinTitle)}</h1></header><section class="card">`;
  const pw = planWeek();
  if (!last) html += `<p class="big">${esc(S.checkinFirst)}</p>`;
  else {
    const due = new Date(last.date); due.setDate(due.getDate() + weeks * 7);
    const days = Math.ceil((due - new Date(today())) / 864e5);
    html += days <= 0 || (pw && (pw === 1 || pw === L.settings.plan.weeks) && last.date < st.settings.plan.start) ? `<p class="big">${esc(S.checkinDue)}</p>` : `<p>${esc(fmt(S.checkinNext, { d: days, date: dstr(due) }))}</p>`;
  }
  html += `<p class="muted small">${esc(S.checkinWarm)}</p><p class="lbl">${esc(S.checkinEvery)}</p><div class="chips">${[2, 4].map(w => `<button class="chip ${weeks === w ? 'on' : ''}" data-act="ckWeeks" data-w="${w}">${esc(fmt(S.weeksN, { n: w }))}</button>`).join('')}</div></section>`;
  for (const t of testsAvail()) {
    const r = ck[t.id] || {};
    html += `<section class="card test" data-test="${t.id}"><h3>${esc(t.name)}${t.optional ? ` <span class="small muted">(${esc(S.optional)})</span>` : ''}</h3><p class="small">${esc(t.how)}</p>
      ${t.needsSpotter ? `<p class="warn small">${esc(S.spotterNeeded)}</p>` : ''}
      ${t.variants ? `<div class="chips">${t.variants.map(v => `<button class="chip ${r.variant === v ? 'on' : ''}" data-act="ckVar" data-v="${esc(v)}">${esc(v)}</button>`).join('')}</div>` : ''}
      <div class="got"><input type="number" inputmode="decimal" step="${t.step}" value="${r.v != null ? r.v : ''}" data-act="ckVal" aria-label="${esc(t.name)}"><span>${esc(unitOf(t))}</span></div>
      <div class="stat">${['c', 'p', 'x'].map(k => `<button class="sbtn ${k} ${r.st === k ? 'on' : ''}" data-act="ckSt" data-st="${k}">${ctl({ c: 'complete', p: 'partial', x: 'could-not-do' }[k])}<span>${esc({ c: S.complete, p: S.partial, x: S.couldNot }[k])}</span></button>`).join('')}</div>
      <details><summary class="small">${esc(S.source)}</summary><p class="small muted">${esc(t.source)}</p></details></section>`;
  }
  html += `<button class="btn primary wide" data-act="ckSave">${esc(S.saveCheckin)}</button>`;
  if (st.checkins.length) {
    const a = st.checkins[st.checkins.length - 2], b = st.checkins[st.checkins.length - 1];
    html += `<section class="card"><h3>${esc(S.chartTitle)}</h3>${L.tests.filter(t => b.r[t.id] && b.r[t.id].v != null).map(t => `<p>${esc(a && a.r[t.id] && a.r[t.id].v != null ? fmt(S.resultLine, { test: t.short, then: a.r[t.id].v + ' ' + unitOf(t), now: b.r[t.id].v + ' ' + unitOf(t) }) : fmt(S.firstResult, { test: t.short, now: b.r[t.id].v + ' ' + unitOf(t) }))}</p>`).join('')}
      ${st.checkins.length >= 2 ? chartsHTML() : `<p class="muted small">${esc(S.chartEmpty)}</p>`}</section>`;
  }
  return html;
}
function chartsHTML() {
  return L.tests.map(t => {
    const pts = st.checkins.map(c => [c.date, c.r[t.id] && c.r[t.id].v]).filter(p => p[1] != null && p[1] !== '');
    if (pts.length < 2) return '';
    const vs = pts.map(p => +p[1]); const lo = Math.min(...vs), hi = Math.max(...vs), W = 340, H = 110, pad = 18;
    const x = i => pad + i * (W - 2 * pad) / (pts.length - 1), y = v => H - pad - (hi === lo ? 0.5 : (v - lo) / (hi - lo)) * (H - 2 * pad);
    return `<figure class="chart"><figcaption>${esc(t.short)} (${esc(unitOf(t))})${t.lower ? ' · ' + esc(S.lowerBetter) : ''}</figcaption>
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(t.short)}"><polyline fill="none" stroke="currentColor" stroke-width="3" points="${vs.map((v, i) => x(i) + ',' + y(v)).join(' ')}"/>
      ${vs.map((v, i) => `<circle cx="${x(i)}" cy="${y(v)}" r="4"/><text x="${x(i)}" y="${y(v) - 8}" text-anchor="middle">${v}</text>`).join('')}</svg></figure>`;
  }).join('');
}

// ---------- history ----------
function viewHistory() {
  const done = st.sessions.filter(s => s.done || anyLogs(s));
  const days = new Set(done.map(s => s.date));
  const wk = new Date(); wk.setDate(wk.getDate() - 6); const weekN = [...days].filter(d => d >= dstr(wk)).length;
  let html = `<header class="hero"><h1>${esc(S.historyTitle)}</h1><p class="sub">${esc(fmt(S.statsLine, { days: days.size, sessions: done.length, week: weekN }))}</p></header>`;
  html += `<section class="card"><p class="lbl">${esc(S.last28)}</p><div class="grid28">`;
  for (let i = 27; i >= 0; i--) { const d = new Date(); d.setDate(d.getDate() - i); const k = dstr(d); html += `<span class="${days.has(k) ? 'on' : ''}" title="${k}"></span>`; }
  html += '</div></section>';
  if (!done.length) return html + `<p class="muted center">${esc(S.historyEmpty)}</p>`;
  for (const s of done.slice().reverse()) {
    const all = s.items.flatMap(i => i.log.filter(Boolean)); const c = all.filter(r => r.st === 'c').length, p = all.filter(r => r.st === 'p').length, x = all.filter(r => r.st === 'x').length;
    html += `<article class="card hist"><h3>${esc(s.date)} · ${esc(s.name)}</h3><p class="small muted">${esc(fmt(S.sessionLabel, { n: s.n }))} · ${esc(breakdownLine(s))}</p><p>${esc(fmt(S.setsSummary, { c, p, x }))}</p>
      <p class="small">${s.items.filter(i => i.log.some(Boolean)).map(i => esc(ex(i.id).name) + (st.pain[i.id] ? ' ' + ctl('pain-flag', 'ctl xs flag') : '')).join(', ')}</p>
      ${s.notes ? `<p class="note">${esc(s.notes)}</p>` : ''}<button class="link" data-act="delSession" data-id="${s.id}">${esc(S.deleteSession)}</button></article>`;
  }
  return html;
}

// ---------- timers (driven by each move's timer field + library timer_rules) ----------
const TR = L.timerRules || {}; const LEAD = TR.lead_in_s || 5, SWITCH = TR.switch_side_s || 5; const ADJ = TR.rest_adjust_buttons_s || [30, 60];
let R = null, tickH = null;
let audioCtx = null;
const soundBtn = id => { const on = st.settings.sounds !== false; return `<button class="btn sound" id="${id}" data-act="soundToggle" aria-pressed="${on}">${ctl(on ? 'sound-on' : 'sound-off', 'ctl s')}${esc(on ? S.soundOn : S.soundOff)}</button>`; };
const beepLog = [];
function beep(soft) {
  beepLog.push({ k: soft ? 'count' : 'go', t: Date.now(), muted: st.settings.sounds === false }); if (beepLog.length > 50) beepLog.shift();
  if (st.settings.sounds === false) return;
  try { if (!soft && navigator.vibrate) navigator.vibrate(150); audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)(); const a = audioCtx; const o = a.createOscillator(), g = a.createGain(); o.frequency.value = soft ? 660 : 880; g.gain.value = soft ? 0.15 : 0.3; o.connect(g); g.connect(a.destination); o.start(); o.stop(a.currentTime + (soft ? 0.08 : 0.15)); } catch (e) { /* no audio */ }
}
function curSess() { return active(); }
function findItem(uid) { const s = curSess(); return s && s.items.find(i => i.uid === uid); }
function nextLabel(sess, it, i) {
  const sets = it.kind === 'hiit' ? 1 : it.sets;
  if (i + 1 < sets) return fmt(S.goSet, { n: i + 2, total: sets });
  const k = sess.items.indexOf(it); const nx = sess.items.slice(k + 1).find(x => !(x.log.length >= (x.kind === 'hiit' ? 1 : x.sets)));
  return nx ? fmt(S.next, { exercise: nx.kind ? (S[nx.kind] || S.hiitNames[nx.id] || ex(nx.id).name) : ex(nx.id).name }) : S.allDone;
}
function phasesFor(it, i) {
  const e = ex(it.id); const ph = [{ t: 'lead', s: LEAD }];
  if (it.kind === 'water_break' || it.kind === 'block_break') return [{ t: 'break', s: it.work }];
  if (it.kind === 'hiit') {
    for (let r = 0; r < it.sets; r++) { ph.push({ t: 'work', s: it.work, r: r + 1, mv: (it.moves || [])[r % Math.max(1, (it.moves || []).length)] }); if (it.rest && r < it.sets - 1) ph.push({ t: 'hrest', s: it.rest }); }
    return ph;
  }
  if (it.mode === 'reps') return ph.concat([{ t: 'watch', s: Infinity }]);
  if (it.type === 'S') {
    for (let k = i; k < it.sets; k++) {
      if (k > i) ph.push({ t: 'relax', s: 5 });
      ph.push({ t: 'work', s: it.hold, set: k });
      if (it.sides === 2) { ph.push({ t: 'switch', s: SWITCH }); ph.push({ t: 'work', s: it.hold, set: k }); }
    }
    return ph;
  }
  ph.push({ t: 'work', s: it.hold });
  if (it.sides === 2) { ph.push({ t: 'switch', s: SWITCH }); ph.push({ t: 'work', s: it.hold }); }
  return ph;
}
function startTimer(uid, i) {
  const it = findItem(uid); if (!it) return;
  stopTick(); R = { kind: 'set', uid, i, ph: phasesFor(it, i), pi: 0, t0: Date.now(), acc: 0, paused: false, pauses: [], moved: 0 };
  tickH = setInterval(tick, 200); tick();
}
function startRest(it, i) {
  const sess = curSess(); if (!sess) return;
  const label = nextLabel(sess, it, i);
  if (label === S.allDone && !(i + 1 < it.sets)) { const nxt = sess.items.slice(sess.items.indexOf(it) + 1).some(x => !(x.log.length >= x.sets)); if (!nxt) { toast(S.allDone); return; } }
  if (it.type === 'S' || it.type === 'M' || it.kind === 'water_break' || it.kind === 'block_break') { R = { kind: 'msg', text: label, until: Date.now() + 4000 }; stopTick(); tickH = setInterval(tick, 250); tick(); return; }
  stopTick();
  R = { kind: 'rest', uid: it.uid, i, left: it.rest || 60, end: Date.now() + (it.rest || 60) * 1000, partner: st.settings.partnerTurns, t0: Date.now(), next: label };
  tickH = setInterval(tick, 200); tick();
}
function stopTick() { clearInterval(tickH); tickH = null; }
function elapsedPhase() { return (R.paused ? 0 : (Date.now() - R.t0) / 1000) + R.acc; }
function paint(bar, html) {
  const key = html.replace(/<span data-live>[^<]*<\/span>/g, '');
  if (bar.dataset.key === key) { const live = [...html.matchAll(/<span data-live>([^<]*)<\/span>/g)].map(m => m[1]); $$('[data-live]', bar).forEach((n, k) => { if (n.textContent !== live[k]) n.textContent = live[k]; }); return; }
  bar.dataset.key = key; bar.innerHTML = html;
}
function countdown(left, key) { if (left > LEAD || left <= 0) return; const c = Math.ceil(left); const k = key + ':' + c; if (R.cd !== k) { R.cd = k; beep(true); } }
const live = t => `<span data-live>${esc(t)}</span>`;
function tick() {
  const bar = $('#runner');
  if (!R) { bar.hidden = true; return; }
  bar.hidden = false;
  if (R.kind === 'msg') { paint(bar, `<p class="rmsg">${esc(R.text)}</p>`); if (Date.now() > R.until) { R = null; stopTick(); bar.hidden = true; } return; }
  if (R.kind === 'rest') {
    if (R.partner) { const up = (Date.now() - R.t0) / 1000; paint(bar, `<div class="rlab">${ctl('partner-turn', 'ctl s')}${live(fmt(S.partnerSet, { t: mmss(up) }))}</div><div class="rbtns"><button class="rb big" data-act="rSkip">${ctl('next')}<span>${esc(S.partnerDone)}</span></button></div>`); return; }
    const left = (R.end - Date.now()) / 1000;
    countdown(left, 'rest');
    if (left <= 0) { beep(); R = { kind: 'msg', text: R.next, until: Date.now() + 4000 }; return tick(); }
    paint(bar, `<div class="rlab">${ctl('rest', 'ctl s')}${live(fmt(S.rest, { t: mmss(left) }))}</div><div class="rbtns">
      <button class="rb" data-act="rAdd" data-s="${ADJ[0]}">${ctl('add-time')}<span>${esc(S.plus30)}</span></button>
      <button class="rb" data-act="rAdd" data-s="${ADJ[1]}">${ctl('add-time')}<span>${esc(S.plus60)}</span></button>
      <button class="rb" data-act="rSkip">${ctl('next')}<span>${esc(S.skip)}</span></button>
      <button class="rb mute" data-act="soundToggle" aria-label="${esc(st.settings.sounds !== false ? S.soundOn : S.soundOff)}">${ctl(st.settings.sounds !== false ? 'sound-on' : 'sound-off')}</button></div>`);
    return;
  }
  const it = findItem(R.uid); if (!it) { R = null; return tick(); }
  const p = R.ph[R.pi]; const el = elapsedPhase();
  if (p.s !== Infinity && el >= p.s) {
    if (p.t === 'work') R.moved += p.s;
    R.pi++; R.t0 = Date.now(); R.acc = 0; beep();
    if (R.pi >= R.ph.length) return finishTimer(true);
    return tick();
  }
  const left = p.s - el; const e = ex(it.id);
  if (p.s !== Infinity && (p.t === 'lead' || p.t === 'work')) countdown(left, R.pi);   // timer_rules.lead_in_s: 5-4-3-2-1, then the go tone
  let label;
  if (p.t === 'lead') label = fmt(S.startingIn, { s: Math.ceil(left) });
  else if (p.t === 'switch') label = S.switchSides;
  else if (p.t === 'relax') label = fmt(S.relaxNext, { s: Math.ceil(left) });
  else if (p.t === 'hrest') label = S.hiitRest + ' ' + mmss(left);
  else if (p.t === 'watch') label = ex(it.id).name + ' ' + mmss(el);
  else if (p.t === 'break') label = fmt(S.breakTimer, { name: S[it.kind], t: mmss(left) });
  else if (it.kind === 'hiit') label = fmt(S.hiitWork, { r: p.r, n: it.sets, move: p.mv ? ex(p.mv).name : '' }) + ' ' + mmss(left);
  else label = fmt(S.timedLabel, { name: e.name, t: mmss(left) });
  const icon = p.t === 'watch' ? 'stopwatch' : p.t === 'switch' ? 'switch-sides' : p.t === 'lead' ? 'countdown' : 'countdown';
  const big = p.t === 'watch' ? mmss(el) : mmss(left);
  paint(bar, `<div class="rlab">${ctl(icon, 'ctl s')}${live(label)}</div><div class="rbig">${live(big)}</div><div class="rbtns">` +
    (p.t === 'watch' ? `<button class="rb big" data-act="rDone">${ctl('complete')}<span>${esc(S.done)}</span></button>`
      : p.t === 'break' ? `<button class="rb" data-act="rStop">${ctl('next')}<span>${esc(S.skip)}</span></button>`
      : `${R.paused ? `<button class="rb" data-act="rResume">${ctl('start')}<span>${esc(S.start)}</span></button>` : `<button class="rb" data-act="rPause">${ctl('pause')}<span>${esc(S.pause)}</span></button>`}<button class="rb" data-act="rStop">${ctl('stop')}<span>${esc(S.stop)}</span></button>`) + '</div>');
}
function logSet(it, i, rec) {
  const sess = curSess(); it.log[i] = Object.assign({ at: Date.now() }, rec); onLogged(sess, it, i);
  const pg = DZ && DZ.onItemLogged(it, st.dose); if (pg) toast(pg.k === 'hiitUp' ? S.hiitUp : fmt(pg.k === 'up' ? S.loadUp : S.loadDown, { pct: pg.pct, move: ex(it.id).name }));
  save();
}
function finishTimer(completed) {
  const it = findItem(R.uid); const i = R.i; const r = R; R = null; stopTick();
  if (!it) return tick();
  if (it.kind === 'water_break' || it.kind === 'block_break') { logSet(it, 0, { st: 'c', v: it.work }); render(); startRest(it, 0); return; }
  if (it.type === 'S' && completed) {
    for (let k = i; k < it.sets; k++) logSet(it, k, { st: 'c', v: it.hold });
    const sess = curSess(); const k = sess.items.indexOf(it); const nx = sess.items.slice(k + 1).find(x => x.type === 'S' && !x.log.length);
    render(); R = { kind: 'msg', text: nx ? fmt(S.stretchDone, { stretch: ex(nx.id).name }) : S.allDone, until: Date.now() + 4000 }; tickH = setInterval(tick, 250); tick(); return;
  }
  const target = it.kind === 'hiit' ? it.sets * it.work : it.hold * (it.sides || 1);
  let msg = '';
  if (completed) {
    const v = it.mode === 'reps' ? it.reps[1] : Math.round(r.moved);
    if (r.pauses.length) msg = fmt(S.breaksDone, { t: mmss(target), n: r.pauses.length });
    logSet(it, i, { st: 'c', v, secs: Math.round(r.moved), pauses: r.pauses, msg });
    if (msg) toast(msg);
  }
  render(); startRest(it, i);
}
function stopEarly() {
  const it = findItem(R.uid); const i = R.i; const p = R.ph[R.pi];
  const moved = Math.round(R.moved + (p && (p.t === 'work') ? elapsedPhase() : 0)); const r = R; R = null; stopTick();
  if (!it) return tick();
  if (it.kind === 'water_break' || it.kind === 'block_break') { logSet(it, 0, { st: 'c', v: moved }); render(); return tick(); }
  const msg = fmt(S.stoppedEarly, { t: mmss(moved) });
  logSet(it, i, { st: 'p', v: moved, secs: moved, pauses: r.pauses, msg }); render(); toast(msg, { label: S.edit, fn: () => { it.log[i].edit = true; save(); render(); } });
  tick();
}

// ---------- focus view ----------
let F = null;
function openFocus(uid) {
  const sess = curSess(); const it = sess && sess.items.find(i => i.uid === uid); if (!it) return;
  const set = Math.min(it.log.filter(Boolean).length, (it.kind === 'hiit' ? 1 : it.sets) - 1);
  F = { uid, set, step: 0 }; renderFocus();
}
// focus model: pictures from icons/exercises/index.json (L.stepImages), captions from `frames`, tips as text; `steps` as fallback.
function focusModel(it) {
  const base = ex(it.id); let e = base;
  const picked = it.kind === 'hiit' || base.frames_from === 'picked_move';
  if (picked && it.moves && it.moves.length) e = ex(it.moves[Math.min(F.mv || 0, it.moves.length - 1)]);
  const imgs = (L.stepImages || {})[e.id] || [];
  const frames = e.frames && e.frames.length ? e.frames : null, steps = e.steps && e.steps.length ? e.steps : null;
  const lines = frames || steps || [e.cue || e.name];
  // images from index.json; captions paired in order; caption lines beyond the images are listed as text (never hidden)
  let caps, n, extra = [];
  if (imgs.length) { n = imgs.length; caps = imgs.map((_, i) => lines[i] || ''); extra = lines.slice(n); }
  else { n = lines.length; caps = lines.slice(); }
  const tips = (e.tips || []).filter(t => !caps.concat(extra).some(c => c.includes(t)));
  return { base, e, picked, imgs, caps, n, extra, tips, fmtTips: picked && base !== e ? (base.tips || []) : [] };
}
function renderFocus() {
  const f = $('#focus'); if (!F) { f.hidden = true; return; }
  const sess = curSess(); const it = sess && sess.items.find(i => i.uid === F.uid); if (!it) { F = null; f.hidden = true; return; }
  const M = focusModel(it); const e = M.e; const total = it.kind === 'hiit' ? 1 : it.sets;
  if (F.step >= M.n) F.step = 0;
  const k = sess.items.indexOf(it); const nx = sess.items.slice(k + 1).find(x => !x.kind || x.kind === 'hiit');
  const title = M.picked ? (S.hiitNames[it.id] || M.base.name) : e.name;
  f.innerHTML = `<div class="fv"><button class="fx" data-act="fClose" aria-label="${esc(S.close)}">✕</button>
    <h2>${esc(title)}</h2>${e.description ? `<p class="fdesc">${esc(e.description)}</p>` : ''}${M.picked ? `<div class="chips fmoves">${(it.moves || []).map((m, j) => `<button class="chip ${j === (F.mv || 0) ? 'on' : ''}" data-act="fMove" data-j="${j}">${esc(ex(m).name)}</button>`).join('')}</div>` : ''}
    <p class="muted">${esc(fmt(S.focusSet, { n: F.set + 1, total }))}</p>
    <div class="fstep ${M.imgs.length ? 'pics' : 'nopics'}" data-act="fTap">${M.imgs.length
      ? `<img src="${M.imgs[F.step]}" alt="${esc(M.caps[F.step] || e.name)}" width="768" height="576" loading="lazy" decoding="async">`
      : `<span class="stepnum">${F.step + 1}</span><p class="nopics-line" id="noPictures">${esc(S.noPictures)}</p>`}</div>
    <p class="fcap"><b>${esc(fmt(S.stepN, { n: F.step + 1, total: M.n }))}</b>${M.caps[F.step] ? `<br><span id="fcapText">${esc(M.caps[F.step])}</span>` : ''}</p>
    <div class="fnums">${Array.from({ length: M.n }, (_, j) => `<button class="${j === F.step ? 'on' : ''}" data-act="fStep" data-j="${j}" aria-label="${esc(fmt(S.stepN, { n: j + 1, total: M.n }))}">${j + 1}</button>`).join('')}</div>
    ${M.extra.length ? `<ol class="flines extra" start="${M.n + 1}">${M.extra.map(c => `<li>${esc(c)}</li>`).join('')}</ol>` : ''}
    ${M.imgs.length ? '' : `<ol class="flines">${M.caps.map((c, j) => `<li class="${j === F.step ? 'on' : ''}">${esc(c)}</li>`).join('')}</ol>`}
    ${M.tips.length ? `<ul class="tips">${M.tips.map(t => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
    ${M.fmtTips.length ? `<p class="small muted">${esc(M.fmtTips.join(' · '))}</p>` : ''}
    ${nx ? `<p class="small muted">${esc(fmt(S.focusNext, { move: ex(nx.id).name }))}</p>` : ''}
    <button class="btn primary wide huge" data-act="fDone">${ctl('complete', 'ctl s')}${esc(S.done)}</button></div>`;
  f.hidden = false;
  if (M.imgs[F.step + 1]) { const pre = new Image(); pre.src = M.imgs[F.step + 1]; }   // warm the next frame only
}

// ---------- events ----------
function itemOf(el) { const a = el.closest('[data-uid]'); const s = curSess(); return a && s ? s.items.find(i => i.uid === a.dataset.uid) : null; }
function swapSheet(it, avoidJoint, title) {
  const sess = curSess(); const ids = new Set(sess.items.map(i => i.id));
  const alts = E.alternatives(it, opts({ avoidJoint, areas: sess.areas }), ids).slice(0, 8);
  sheet(`<h3>${esc(title || fmt(S.swapTitle, { move: ex(it.id).name }))}</h3>${alts.length ? alts.map(a => `<button class="btn wide left" data-act="swapTo" data-uid2="${it.uid}" data-id="${a.id}">${img('equipment', a.equipment[0] || 'bodyweight', 'ic s')}<span>${esc(a.name)}<br><span class="small muted">${esc(a.cue)}</span></span></button>`).join('') : `<p>${esc(S.noSwap)}</p>`}
    ${title ? '' : `<button class="btn wide ghost" data-act="dislike" data-uid2="${it.uid}">${esc(S.dislikeBtn)}</button>`}`);
}
document.addEventListener('click', ev => {
  const b = ev.target.closest('[data-act]'); if (!b) return;
  const a = b.dataset.act; const sess = curSess();
  if (b.tagName === 'INPUT' || b.tagName === 'TEXTAREA' || b.tagName === 'DETAILS') return;
  const it = itemOf(b); const i = b.dataset.set != null ? +b.dataset.set : 0;
  const h = {
    goSetup: () => { st.tab = 'gear'; save(); render(); },
    lvlYes: () => { st.levels[st.offer.area] = st.offer.n; toast(fmt(S.levelUpDone, { area: areaName(st.offer.area), n: st.offer.n })); st.offer = null; save(); render(); },
    lvlNo: () => { st.offer = null; save(); render(); },
    nextSession: () => { newSession(); render(); window.scrollTo(0, 0); },
    shuffleDay: () => { sess.items.forEach(x => { if (!x.log.some(Boolean)) E.swap(sess, x.uid, opts({ areas: sess.areas })); }); save(); render(); toast(S.shuffled); },
    planDay: () => { st.dayIdx = +b.dataset.i; save(); replaceActive({ type: 'plan' }); },
    view: () => { st.view = b.dataset.v; save(); render(); },
    extra: () => { const x = b.dataset.x; st.extras = st.extras.includes(x) ? st.extras.filter(y => y !== x) : st.extras.concat(x); save(); render(); },
    hiitFmt: () => { st.settings.hiit = b.dataset.h; save(); render(); },
    focusMin: () => { st.focusMinutes = +b.dataset.m; save(); render(); },
    buildFocus: () => {
      const areas = [...new Set(st.regions.flatMap(r => L.regionToAreas[r] || []))];
      const x = new Set(st.extras); if (x.has('cardio')) areas.push('cardio');
      let goal = st.goal; if (x.has('hiit')) goal = 'hiit'; else if (x.has('rehab')) goal = 'rehabilitation'; else if (x.has('mobility')) goal = 'mobility';
      const slots = x.has('skills') && st.sports.length ? [['skill', 'skill', 3]].concat(E.slotsFromAreas(areas)) : null;
      if (!areas.length && !x.size) return toast(S.pickSomething);
      const name = st.regions.concat([...x].map(k => S.focusExtras[k])).join(', ');
      replaceActive({ type: 'areas', areas: areas.length ? areas : ['core'], goal, slots, name, minutes: st.focusMinutes || st.settings.minutes });
    },
    stat: () => {
      const st0 = b.dataset.st; const prev = it.log[i];
      const v = st0 === 'c' ? (it.mode === 'reps' ? it.reps[1] : it.kind === 'hiit' ? it.sets * it.work : it.hold * (it.sides || 1)) : st0 === 'x' ? 0 : (prev && prev.v != null && prev.st === 'p' ? prev.v : null);
      logSet(it, i, { st: st0, v, w: it.weight });
      render(); if (st0 !== 'x') startRest(it, i);
      if (st0 === 'p') { const inp = $(`[data-uid="${it.uid}"] [data-set="${i}"] input`); if (inp) inp.focus(); }
    },
    editSet: () => { it.log[i].edit = true; save(); render(); },
    tStart: () => startTimer(it.uid, i),
    rPause: () => { R.acc = elapsedPhase(); R.paused = true; R.pauses.push({ at: Date.now() }); tick(); },
    rResume: () => { const p = R.pauses[R.pauses.length - 1]; if (p) p.dur = Math.round((Date.now() - p.at) / 1000); R.paused = false; R.t0 = Date.now(); tick(); },
    rStop: () => stopEarly(),
    rDone: () => { const p = R.ph[R.pi]; R.moved += elapsedPhase(); R.pi = R.ph.length; finishTimer(true); },
    rAdd: () => { R.end += (+b.dataset.s) * 1000; tick(); },
    rSkip: () => { const nx = R.next; R = { kind: 'msg', text: nx, until: Date.now() + 3000 }; tick(); },
    swapOpen: () => swapSheet(it),
    swapTo: () => { const s2 = curSess(); const r = E.swap(s2, b.dataset.uid2, opts({ toId: b.dataset.id, areas: s2.areas })); closeSheet(); save(); render(); if (r) toast(fmt(S.swapped, { name: ex(r.id).name })); },
    dislike: () => { const s2 = curSess(); const t = s2.items.find(x => x.uid === b.dataset.uid2); const name = ex(t.id).name; st.dislike[t.id] = { date: today() }; E.swap(s2, t.uid, opts({ areas: s2.areas })); closeSheet(); save(); render(); toast(fmt(S.disliked, { move: name })); },
    painOpen: () => sheet(`<h3>${ctl('pain-flag', 'ctl s')} ${esc(S.painBtn)}</h3><p><b>${esc(ex(it.id).name)}</b></p><p class="lbl">${esc(S.painJoint)}</p>
      <div class="chips" id="jointChips">${Object.entries(S.joints).map(([k, v]) => `<button class="chip" data-act="joint" data-j="${k}">${esc(v)}</button>`).join('')}</div>
      <label class="lbl" for="painNote">${esc(S.painNote)}</label><textarea id="painNote" rows="2"></textarea><p class="small muted">${esc(S.painNoteHint)}</p>
      <p class="warn small">${esc(S.painDoctor)}</p><button class="btn primary wide" data-act="painFlag" data-uid2="${it.uid}">${ctl('pain-flag', 'ctl s')}${esc(S.painFlagBtn)}</button>`),
    joint: () => { $$('#jointChips .chip').forEach(c => c.classList.toggle('on', c === b && !b.classList.contains('on'))); },
    painFlag: () => {
      const s2 = curSess(); const t = s2.items.find(x => x.uid === b.dataset.uid2); const jb = $('#jointChips .chip.on'); const joint = jb ? jb.dataset.j : null;
      const name = ex(t.id).name; st.pain[t.id] = { date: today(), joint, note: ($('#painNote') || {}).value || '' };
      const avoid = joint ? E.JOINTS[joint] : null;
      E.swap(s2, t.uid, opts({ avoidJoint: avoid, areas: s2.areas })); save(); render(); toast(fmt(S.painFlagged, { move: name }));
      swapSheet(t, avoid, S.painTryAnother);
      $('#sheet .sheet-card').insertAdjacentHTML('beforeend', `<button class="btn wide" data-act="closeSheet">${esc(S.keepIt)}</button>`);
    },
    bringBack: () => { const l = b.dataset.l; const name = ex(b.dataset.id).name; delete st[l][b.dataset.id]; save(); render(); toast(fmt(S.painBack, { move: name })); },
    closeSheet,
    openTests: () => { st.tab = 'tests'; T = { kind: T.kind || 'maxReps', id: null }; render(); window.scrollTo(0, 0); },
    retestGo: () => { const k = b.dataset.k; const m = st.marks[k][st.marks[k].length - 1]; T = { kind: k === 'sprint30' || k === 'cooper12' ? k : m.kind, id: k === 'sprint30' || k === 'cooper12' ? null : k }; st.tab = 'tests'; render(); window.scrollTo(0, 0); },
    retestLater: () => { const l = st.marks[b.dataset.k]; l[l.length - 1].snooze = today(); save(); render(); },
    tKind: () => { T = { kind: b.dataset.k, id: null }; render(); },
    tPlus: () => { T.count = (T.count || 0) + 1; $('#tCount').textContent = T.count; },
    tMinus: () => { T.count = Math.max(0, (T.count || 0) - 1); $('#tCount').textContent = T.count; },
    tGo: () => { T.t0 = Date.now(); T.last = null; render(); testTick(); },
    tSave: () => {
      if (T.kind === 'maxReps') { if (T.count > 0) saveMark(T.id, { kind: 'maxReps', v: T.count }); }
      else if (T.kind === 'maxTime') { if (T.t0) saveMark(T.id, { kind: 'maxTime', v: Math.round((Date.now() - T.t0) / 1000) }); }
      else if (T.kind === 'heavy') { const m = heavyEstimate(); if (m) saveMark(T.id, Object.assign({ kind: 'heavy' }, m)); }
      else { const d = +$('#tDist').value; if (d > 0) saveMark(T.kind, { kind: T.kind, dist: d, du: distU(T.kind), secs: T.kind === 'sprint30' ? 30 : 720 }); }
    },
    howOpen: () => howSheet(b.dataset.id || it.id),
    soundToggle: () => { st.settings.sounds = st.settings.sounds === false; save(); render(); if (R) { const bar = $('#runner'); bar.dataset.key = ''; tick(); } },
    progOpen: () => progSheet(it, +b.dataset.dir),
    progPick: () => { const s2 = curSess(); const t = s2.items.find(x => x.uid === b.dataset.uid2); const n = E.itemFor(b.dataset.id, t.sec, opts()); n.slot = t.slot; if (t.sec === 'main' && n.work < 300) n.sets = t.sets; s2.items.splice(s2.items.indexOf(t), 1, n); closeSheet(); save(); render(); toast(fmt(S.progSwapped, { name: ex(n.id).name })); },
    mapMode: () => { st.mapMode = b.dataset.m; st.builderOpen = true; save(); render(); },
    injSide: () => { closeSheet(); markInjury(b.dataset.r, b.dataset.sd); },
    injHeal: () => healInjury(b.dataset.r),
    injStill: () => { const j = st.injuries.find(x => x.region === b.dataset.r); if (j) j.checked = today(); save(); render(); },
    altFocus: () => { const k = b.dataset.k; const f = ALT[k](); replaceActive(Object.assign({ type: 'alt', name: S.injAlt[k], minutes: st.settings.minutes, goal: f.goal !== undefined ? f.goal : null }, f)); window.scrollTo(0, 0); },
    up: () => { const k = sess.items.indexOf(it); if (k > 0 && sess.items[k - 1].sec === it.sec) { [sess.items[k - 1], sess.items[k]] = [sess.items[k], sess.items[k - 1]]; save(); render(); } },
    down: () => { const k = sess.items.indexOf(it); if (k < sess.items.length - 1 && sess.items[k + 1].sec === it.sec) { [sess.items[k + 1], sess.items[k]] = [sess.items[k], sess.items[k + 1]]; save(); render(); } },
    remove: () => { const k = sess.items.indexOf(it); sess.items.splice(k, 1); save(); render(); toast(fmt(S.removed, { name: ex(it.id).name }), { label: S.undo || '↺', fn: () => { sess.items.splice(k, 0, it); save(); render(); } }); },
    addSet: () => { it.sets++; save(); render(); },
    remSet: () => { if (it.sets > 1) { it.sets--; it.log.length = Math.min(it.log.length, it.sets); save(); render(); } },
    addOpen: () => { sheet(`<h3>${esc(S.addTitle)}</h3><input class="search" type="search" id="addQ" placeholder="${esc(S.addSearch)}"><div id="addList">${addList('')}</div>`); $('#addQ').addEventListener('input', e2 => { $('#addList').innerHTML = addList(e2.target.value); }); },
    addPick: () => { const s2 = curSess(); const n = E.itemFor(b.dataset.id, 'main', opts()); const lastMain = s2.items.map(x => x.sec).lastIndexOf('main'); s2.items.splice(lastMain + 1, 0, n); closeSheet(); save(); render(); toast(fmt(S.added, { name: ex(n.id).name })); },
    finish: () => {
      sess.done = true; sess.endedAt = Date.now();
      if (sess.focus.type === 'plan' && (st.settings.perDay < 2 || sess.n >= 2)) st.dayIdx = (st.dayIdx + 1) % E.splitDays(st.settings.days).length;
      R = null; stopTick(); tick(); save(); render(); toast(S.finished); window.scrollTo(0, 0);
    },
    focus: () => openFocus(it.uid),
    fClose: () => { F = null; renderFocus(); },
    fStep: () => { F.step = +b.dataset.j; renderFocus(); },
    fMove: () => { F.mv = +b.dataset.j; F.step = 0; renderFocus(); },
    fTap: () => { const n = focusModel(findItem(F.uid)).n; const r = b.getBoundingClientRect(); F.step = (F.step + (ev.clientX - r.left < r.width / 3 ? n - 1 : 1)) % n; renderFocus(); },
    fDone: () => {
      const t = findItem(F.uid); if (!t) return; const total = t.kind === 'hiit' ? 1 : t.sets;
      logSet(t, F.set, { st: 'c', v: t.mode === 'reps' ? t.reps[1] : t.hold * (t.sides || 1) }); render(); startRest(t, F.set);
      if (F.set + 1 < total) { F.set++; F.step = 0; renderFocus(); }
      else { const s2 = curSess(); const k = s2.items.indexOf(t); const nx = s2.items.slice(k + 1).find(x => !x.kind || x.kind === 'hiit'); if (nx) { F = { uid: nx.uid, set: 0, step: 0 }; renderFocus(); } else { F = null; renderFocus(); } }
    },
    equip: () => { const t = b.dataset.t; st.equip = st.equip.includes(t) ? st.equip.filter(x => x !== t) : st.equip.concat(t); save(); render(); },
    goal: () => { st.goal = b.dataset.g || null; save(); render(); },
    sport: () => { const s3 = b.dataset.s; st.sports = st.sports.includes(s3) ? st.sports.filter(x => x !== s3) : st.sports.concat(s3); save(); render(); },
    days: () => { st.settings.days = +b.dataset.d; st.dayIdx = 0; save(); render(); },
    setMin: () => { st.settings.minutes = +b.dataset.m; save(); render(); },
    perDay: () => { st.settings.perDay = +b.dataset.n; save(); render(); },
    level: () => { st.level = +b.dataset.n; st.levels = {}; save(); render(); },
    buildWeek: () => { st.setupDone = true; const a2 = active(); if (a2 && !anyLogs(a2)) st.sessions.splice(st.sessions.indexOf(a2), 1); save(); st.tab = 'today'; render(); window.scrollTo(0, 0); toast(S.built); },
    units: () => { st.settings.units = b.dataset.u; save(); render(); },
    currency: () => { st.settings.currency = b.dataset.c; save(); render(); },
    gap: () => { st.settings.gapHours = +b.dataset.h; save(); render(); },
    export: () => { const blob = new Blob([JSON.stringify(st, null, 1)], { type: 'application/json' }); const u = URL.createObjectURL(blob); const l = document.createElement('a'); l.href = u; l.download = `tete-backup-${today()}.json`; l.click(); setTimeout(() => URL.revokeObjectURL(u), 1000); },
    reset: () => { if (confirm(S.resetConfirm)) { localStorage.removeItem(KEY); st = defaults(); render(); } },
    lib: () => { libQ[b.dataset.k] = b.dataset.v; render(); },
    libMine: () => { libQ.mine = !libQ.mine; render(); },
    ckWeeks: () => { st.settings.checkinWeeks = +b.dataset.w; save(); render(); },
    ckVar: () => { const t = b.closest('[data-test]').dataset.test; ck[t] = Object.assign(ck[t] || {}, { variant: b.dataset.v }); render(); },
    ckSt: () => { const t = b.closest('[data-test]').dataset.test; ck[t] = Object.assign(ck[t] || {}, { st: b.dataset.st }); render(); },
    ckSave: () => { const r = {}; for (const [k, v] of Object.entries(ck)) if (v.v != null && v.v !== '' || v.st) r[k] = v; if (!Object.keys(r).length) return; st.checkins.push({ date: today(), r }); ck = {}; save(); render(); toast(S.checkinSaved); },
    delSession: () => { if (confirm(S.deleteConfirm)) { st.sessions = st.sessions.filter(s => s.id !== b.dataset.id); save(); render(); } },
  }[a];
  if (h) { ev.preventDefault(); h(); }
});
function addList(q) {
  const owned = E.ownedSet(st.equip); q = q.toLowerCase();
  return E.EX.filter(e => E.have(e, owned) && (!q || e.name.toLowerCase().includes(q))).slice(0, 60)
    .map(e => `<button class="btn wide left" data-act="addPick" data-id="${e.id}">${esc(e.name)} <span class="small muted">${esc(S.types[e.type] || e.type)}</span></button>`).join('');
}
document.addEventListener('input', ev => {
  const b = ev.target; const a = b.dataset && b.dataset.act; if (!a) return;
  const sess = curSess(); const it = itemOf(b);
  if (a === 'val') { const i = +b.dataset.set; it.log[i] = Object.assign(it.log[i] || { st: 'p' }, { v: b.value === '' ? null : +b.value }); save(); }
  else if (a === 'weight') { it.weight = b.value === '' ? null : +b.value; it.log.forEach(r => { if (r) r.w = it.weight; }); save(); }
  else if (a === 'notes') { sess.notes = b.value; save(); }
  else if (a === 'tIn') { const m = heavyEstimate(); const el = $('#tEst'); if (el) el.textContent = m && m.est ? fmt(S.testEstimate, { w: Math.round(m.est), u: m.unit }) + (m.reliable ? '' : ' ' + fmt(S.testEstimateWarn, { n: 10 })) : ''; }
  else if (a === 'libQ') { libQ.q = b.value; const pos = b.selectionStart; render(); const n = $('[data-act="libQ"]'); n.focus(); n.setSelectionRange(pos, pos); }
  else if (a === 'ckVal') { const t = b.closest('[data-test]').dataset.test; ck[t] = Object.assign(ck[t] || {}, { v: b.value === '' ? null : +b.value }); }
});
document.addEventListener('change', ev => {
  const b = ev.target; const a = b.dataset && b.dataset.act; if (!a) return;
  const clampM = v => Math.max(L.settings.minutes[0], Math.min(L.settings.minutes[1], Math.round(+v || 45)));
  if (a === 'tMove') { T = { kind: T.kind, id: b.value }; render(); }
  if (a === 'setMinIn') { st.settings.minutes = clampM(b.value); save(); render(); }
  if (a === 'focusMinIn') { st.focusMinutes = clampM(b.value); save(); render(); }
  if (a === 'partnerTurns') { st.settings.partnerTurns = b.checked; save(); }
  if (a === 'plan') { st.settings.plan = b.checked ? { start: today() } : null; save(); render(); }
  if (a === 'import') {
    const f = b.files[0]; if (!f) return; f.text().then(t => { const d = JSON.parse(t); if (d && d.v === 1 && Array.isArray(d.sessions)) { st = Object.assign(defaults(), d); save(); render(); toast(S.imported); } else toast(S.importBad); }).catch(() => toast(S.importBad));
  }
});
function bindAfter() {
  const bm = $('#bodymap');
  if (bm) {
    $$('.region', bm).forEach(r => { const on = st.regions.includes(r.dataset.libraryId); r.classList.toggle('selected', on); r.setAttribute('aria-pressed', on); });
    const toggle = r => { const id = r.dataset.libraryId; st.regions = st.regions.includes(id) ? st.regions.filter(x => x !== id) : st.regions.concat(id); save();
      $$(`.region`, bm).filter(x => x.dataset.libraryId === id).forEach(x => { x.classList.toggle('selected', st.regions.includes(id)); x.setAttribute('aria-pressed', st.regions.includes(id)); });
      $('#regionList').textContent = st.regions.join(', '); };
    bm.onclick = e => { const r = e.target.closest('.region'); if (r) toggle(r); };
    bm.onkeydown = e => { const r = e.target.closest('.region'); if (r && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); toggle(r); } };
  }
  $$('.injmap').forEach(m => {
    $$('.injury', m).forEach(r => {
      const j = st.injuries.find(x => x.region === r.dataset.libraryId);
      const on = !!j && (r.dataset.side === 'center' || j.side === 'both' || j.side === 'center' || j.side === r.dataset.side);
      r.classList.toggle('selected', on); r.classList.toggle('injured', on); r.setAttribute('aria-pressed', on);
      if (on && r.getBBox) { try { const bb = r.getBBox(); const t = document.createElementNS('http://www.w3.org/2000/svg', 'text'); t.setAttribute('x', bb.x + bb.width / 2); t.setAttribute("y", bb.y + bb.height / 2 + 14); t.setAttribute('class', 'bang'); t.setAttribute('pointer-events', 'none'); t.textContent = '!'; r.parentNode.appendChild(t); } catch (e) { /* not rendered */ } }
    });
    const pick = r => injSheet(r.dataset.libraryId, r.dataset.side);
    m.onclick = e => { const r = e.target.closest('.injury'); if (r) pick(r); };
    m.onkeydown = e => { const r = e.target.closest('.injury'); if (r && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); pick(r); } };
  });
  const d = $('details.builder'); if (d) d.ontoggle = () => { st.builderOpen = d.open; };
}
// swipe in focus view
let sx = null;
document.addEventListener('touchstart', e => { if (e.target.closest('.fstep')) sx = e.touches[0].clientX; }, { passive: true });
document.addEventListener('touchend', e => { if (sx == null || !F) return; const dx = e.changedTouches[0].clientX - sx; sx = null; if (Math.abs(dx) < 40) return; const n = focusModel(findItem(F.uid)).n; F.step = (F.step + (dx < 0 ? 1 : n - 1)) % n; renderFocus(); });
$$('nav button').forEach(b => b.addEventListener('click', () => { st.tab = b.dataset.tab; save(); render(); window.scrollTo(0, 0); }));
$('#sheet').addEventListener('click', e => { if (e.target.id === 'sheet') closeSheet(); });
if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
document.title = S.appName;
$$('nav button').forEach(b => { b.textContent = S.tabs[b.dataset.tab]; });
render();
setTimeout(() => { const sp = $('#splash'); if (sp) { sp.classList.add('out'); setTimeout(() => sp.remove(), 400); } }, 350);
window.__tete = { beepLog, get timer() { return R; }, get st() { return st; }, E, L, render, newSession, active, opts, save };
