// Session generator: pure logic, no DOM. Runs in the browser (window.Engine) and in Node (tests).
// All numbers come from LIB (built from library.json): time_budget, settings, goals, splits, hiit.
(function (root) {
  const L = root.LIB || (typeof require !== 'undefined' ? require('./data/library.js') : null);
  const EX = L.exercises, BY = Object.fromEntries(EX.map(e => [e.id, e]));
  const B = L.budget, ST = L.settings, D = L.defaults;
  let uidN = 0; const uid = () => 'i' + Date.now().toString(36) + (uidN++).toString(36);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  function ownedSet(equip) {
    const s = new Set(equip || []); s.add('bodyweight'); s.add('floor');
    for (const k of equip || []) (L.satisfies[k] || []).forEach(t => s.add(t));
    return s;
  }
  const have = (e, owned) => e.equipment.every(t => owned.has(t));

  // Minutes split from time_budget + settings (water breaks, blocks).
  function split(minutes, opts = {}) {
    const m = clamp(Math.round(minutes), ST.minutes[0], ST.minutes[1]);
    const nBlocks = m > ST.blocks.overMin ? (opts.sports && opts.sports.length ? 3 : 2) : 1;
    const blockBreaks = nBlocks - 1;
    const water = m > ST.water.overMin ? Math.max(0, Math.ceil(m / ST.water.every) - 1 - blockBreaks) : 0;
    const content = m - water * ST.water.min - blockBreaks * ST.blocks.breakMin;
    const pw = B.pct.warm / 100, pc = B.pct.cool / 100;
    let warm = Math.max(B.minEach, Math.round(content * pw)), cool = Math.max(B.minEach, Math.round(content * pc));
    if (content - warm - cool < content * 0.5) { warm = Math.max(1, Math.round(content * pw)); cool = Math.max(1, Math.round(content * pc)); }
    warm = Math.min(warm, D.warmup_cap); cool = Math.min(cool, D.cooldown_cap);
    return { total: m, warm, main: content - warm - cool, cool, water, waterMin: ST.water.min, nBlocks, blockBreaks, blockMin: ST.blocks.breakMin };
  }

  const TR = L.timerRules || {};
  function restFor(goal, fallback) {
    const r = TR.rest_between_sets_s || {};
    if (goal && r[goal.name] != null) return r[goal.name];
    if (goal && goal.rest) return Math.round((goal.rest[0] + goal.rest[1]) / 2);
    return r.default != null ? r.default : fallback;
  }
  // ---- injuries (library injury_rules) ----
  const IR = L.injury || { regionPart: {}, regionJoint: {} };
  function injuryCtx(injuries) {
    if (!injuries || !injuries.length) return null;
    const parts = {}, joints = new Set(); let backNeck = false;
    for (const j of injuries) {
      const part = IR.regionPart[j.region]; if (!part) continue;
      (parts[part] = parts[part] || new Set()).add(j.side === 'center' ? 'both' : j.side || 'both');
      if (IR.regionJoint[j.region]) joints.add(IR.regionJoint[j.region]);
      if (part === 'back' || part === 'neck') backNeck = true;
    }
    for (const k in parts) if (parts[k].has('left') && parts[k].has('right')) parts[k].add('both');
    return { parts, joints, backNeck };
  }
  const OFFER = e => e.equipment.includes('pool') || e.equipment.includes('bike') || /walk_brisk|^walk/.test(e.id) || e.areas.includes('rehab');
  const HEAVY = e => e.sport === 'powerlifting' || e.equipment.includes('barbell') || (e.joint_stress || []).includes('impact') || isFormat(e) || e.areas.includes('hiit');
  function blockedBy(e, inj) {
    if (!inj) return false;
    // injury_rules.back_or_neck: swimming, walking, bike and rehab moves stay on offer for a back/neck injury
    const offered = OFFER(e);
    for (const u of e.uses || []) { const s = inj.parts[u]; if (s && (s.has('both') || !e.one_side) && !(offered && (u === 'back' || u === 'neck'))) return true; }
    if ((e.joint_stress || []).some(j => inj.joints.has(j))) return true;
    if (inj.backNeck && HEAVY(e)) return true;
    return false;
  }
  function healthySide(e, inj) {
    if (!inj || !e.one_side) return null;
    for (const u of e.uses || []) { const s = inj.parts[u]; if (s && s.size === 1) return s.has('left') ? 'right' : 'left'; }
    return null;
  }
  const goalById = id => L.goals.find(g => g.id === id) || null;
  const isFormat = e => !!(e.timer && e.timer.mode === 'interval');
  const isTimed = e => ['I', 'M', 'S', 'skill'].includes(e.type) || e.areas[0] === 'cardio' || isFormat(e) || /carry|walk|run|swim|ride|climb|hang|drag/i.test(e.name);
  const repsFor = (e, ctx) => {
    const g = ctx.goal; let r = g && g.reps ? g.reps.slice() : (D.reps[e.level] || '8-12').split('-').map(Number);
    if (ctx.factor && ctx.factor !== 1) r = r.map(x => Math.max(1, Math.round(x * ctx.factor)));
    return r;
  };
  function itemSec(it) { return it.sets * (it.work + it.rest) + (it.restAfter || 0); }
  const sum = items => items.reduce((a, it) => a + itemSec(it), 0);

  function makeItem(e, slot, sets, ctx, sec) {
    const it = { uid: uid(), id: e.id, sec, slot: { area: slot.area, type: slot.type }, type: e.type, sets, log: [] };
    const hs = healthySide(e, ctx.inj); if (hs) it.sideOnly = hs;
    const tm = e.timer || { mode: isTimed(e) ? 'countdown' : 'reps' };
    it.sides = tm.per_side ? 2 : (e.sides || 1);
    it.mode = tm.mode === 'reps' ? 'reps' : 'time';
    if (it.mode === 'reps') { it.work = B.D.work; it.rest = ctx.restD; it.reps = repsFor(e, ctx); return it; }
    let hold = tm.seconds || (e.type === 'S' ? B.S.min : e.type === 'M' ? B.M.sec : e.type === 'I' ? B.I.hold : B.D.work);
    if (e.type === 'I') { const h = ctx.goal && ctx.goal.holds; if (h) hold = clamp(hold, h[0], h[1]); it.rest = ctx.restI; }
    else if (e.type === 'S' || e.type === 'M') it.rest = 0;
    else it.rest = ctx.restD;
    if (ctx.factor && ctx.factor !== 1 && (e.type === 'D' || e.type === 'I')) hold = Math.round(hold * ctx.factor / 5) * 5;
    it.hold = hold; it.work = hold * it.sides;
    return it;
  }

  function score(e, area, ctx, prefer) {
    const lv = ctx.levelOf(area); let s = Math.random() * 2;
    if (e.areas[0] === area && e.type !== 'M' && e.type !== 'S') s += 3;
    s -= Math.max(0, lv - e.level) * 0.7;
    if (e.equipment.some(t => !['wall', 'mat', 'floor'].includes(t))) s += 0.5;
    if (prefer && e.equipment.join() === prefer.equipment.join()) s += 2;
    if (ctx.used && e.family) { for (const id of ctx.used) if (BY[id] && BY[id].family === e.family) { s -= 4; break; } }
    if (ctx.avoidJoint && (e.joint_stress || []).includes(ctx.avoidJoint)) s -= 6;
    if (ctx.avoidJoint && prefer && e.family && e.family === prefer.family && !(e.joint_stress || []).includes(ctx.avoidJoint)) s += 3;
    if (prefer && e.level === prefer.level) s += 1;
    if ((e.type === 'S' || e.type === 'M') && e.targets && e.targets.some(t => ctx.areas.includes(t))) s += 3;
    return s;
  }
  function pool(area, type, ctx, strictLevel = true) {
    return EX.filter(e => e.type === type && e.areas.includes(area) && have(e, ctx.owned)
      && !isFormat(e)
      && (type !== 'skill' || (e.sport && ctx.sports.includes(e.sport)))
      && (!ctx.rehab || e.areas.includes('rehab') || type === 'S' || type === 'M')
      && !(ctx.exclude && ctx.exclude.has(e.id)) && !blockedBy(e, ctx.inj) && !(ctx.only && !ctx.only.has(e.id))
      && (!strictLevel || e.level <= ctx.levelOf(area)));
  }
  function pick(area, type, ctx, used, prefer) {
    const tries = [[area, type, true]];
    if (type === 'D') tries.push([area, 'I', true]); if (type === 'I') tries.push([area, 'D', true]);
    tries.push([area, type, false]);
    for (const [a, t, strict] of tries) {
      const c = pool(a, t, ctx, strict).filter(e => !used.has(e.id));
      if (c.length) return c.map(e => [score(e, a, ctx, prefer), e]).sort((x, y) => y[0] - x[0])[0][1];
    }
    return null;
  }

  function fillMain(slots, budget, ctx, used, sec) {
    let items = [];
    for (const s of slots) {
      const e = pick(s[0], s[1], ctx, used); if (!e) { if (ctx.missing && s[0] !== 'mobility') ctx.missing.add(s[0]); continue; }
      used.add(e.id); const it0 = makeItem(e, { area: s[0], type: s[1] }, Math.max(s[2], ctx.minSets(s[1])), ctx, sec); if (it0.work >= 300) it0.sets = 1; items.push(it0);
    }
    const growable = it => ['D', 'I', 'skill'].includes(it.type);
    // too long: fewer sets, then fewer moves
    while (sum(items) > budget && items.length) {
      const big = [...items].reverse().find(it => it.sets > 2);
      if (big) { big.sets--; continue; }
      if (items.length > 1) { used.delete(items.pop().id); continue; }
      if (items[0].sets > 1) { items[0].sets--; continue; }
      break;
    }
    if (sum(items) > budget) { items.forEach(i => used.delete(i.id)); items = []; }
    // more sets first (up to maxSets)
    for (let grew = true; grew;) {
      grew = false;
      for (const it of items) if (growable(it) && it.work < 300 && it.sets < ctx.maxSets && sum(items) + it.work + it.rest <= budget) { it.sets++; grew = true; }
    }
    // then more moves
    const cyc = slots.filter(s => s[1] !== 'S' && s[1] !== 'M'); const src = cyc.length ? cyc : slots;
    let fails = 0;
    for (let k = 0; src.length && fails < src.length * 2 && k < 200; k++) {
      const s = src[k % src.length]; const e = pick(s[0], s[1], ctx, used);
      if (!e) { fails++; continue; }
      const it = makeItem(e, { area: s[0], type: s[1] }, ctx.baseSets(s), ctx, sec); if (it.work >= 300) it.sets = 1;
      while (it.sets > 1 && sum(items) + itemSec(it) > budget) it.sets--;
      if (sum(items) + itemSec(it) > budget) { fails++; continue; }
      used.add(e.id); items.push(it); fails = 0;
    }
    // then longer holds
    for (let grew = true; grew;) {
      grew = false;
      for (const it of items) if (it.type === 'I' && it.hold < (ctx.goal && ctx.goal.holds ? ctx.goal.holds[1] : B.S.max) && sum(items) + it.sets * 5 <= budget) { it.hold += 5; it.work = it.hold; grew = true; }
    }
    return items;
  }

  function warmup(sec, ctx, used) {
    const items = [];
    const cardio = EX.filter(e => !blockedBy(e, ctx.inj) && !used.has(e.id) && !ctx.exclude.has(e.id) && e.type === 'D' && e.areas[0] === 'cardio' && !isFormat(e) && have(e, ctx.owned)
      && e.level >= B.warmLevels[0] && e.level <= B.warmLevels[1] && !e.equipment.some(t => ['pool', 'open-space', 'bike', 'stairs'].includes(t)));
    const c = cardio.sort(() => Math.random() - 0.5)[0];
    let left = sec;
    if (c) { const it = makeItem(c, { area: 'cardio', type: 'D' }, 1, ctx, 'warm'); it.sides = 1; it.work = it.hold = Math.min(D.warmup_cardio_min * 60, sec); it.rest = 0; it.mode = 'time'; delete it.reps; items.push(it); used.add(c.id); left -= it.work; }
    const mob = EX.filter(e => !blockedBy(e, ctx.inj) && e.type === 'M' && have(e, ctx.owned) && !used.has(e.id) && !ctx.exclude.has(e.id))
      .map(e => [score(e, 'mobility', ctx), e]).sort((a, b) => b[0] - a[0]).map(x => x[1]);
    for (const e of mob) { if (left < 30) break; const it = makeItem(e, { area: 'mobility', type: 'M' }, 1, ctx, 'warm'); if (it.work > left) continue; items.push(it); used.add(e.id); left -= it.work; }
    if (left > 0 && items[0]) { items[0].work += left; items[0].hold = items[0].work; }
    return items;
  }

  function cooldown(sec, ctx, used) {
    const items = []; let left = sec;
    const st = EX.filter(e => !blockedBy(e, ctx.inj) && e.type === 'S' && have(e, ctx.owned) && !used.has(e.id) && !ctx.exclude.has(e.id))
      .map(e => [score(e, 'mobility', ctx), e]).sort((a, b) => b[0] - a[0]).map(x => x[1]);
    for (const e of st) { const it = makeItem(e, { area: 'mobility', type: 'S' }, 1, ctx, 'cool'); if (it.work > left) continue; items.push(it); used.add(e.id); left -= it.work; }
    for (let grew = true; grew && left > 0;) {
      grew = false;
      for (const it of items) { const step = 5 * it.sides; if (it.hold < B.S.max && step <= left) { it.hold += 5; it.work = it.hold * it.sides; left -= step; grew = true; } }
    }
    // still time left (huge budgets): second round of each stretch
    for (const it of items) { if (left >= it.work) { it.sets++; left -= it.work; } }
    return items;
  }

  function hiitBlocks(sec, ctx, used, formatId) {
    const f = L.hiit[formatId] || L.hiit.hiit_tabata; const blockSec = f.rounds * (f.work + f.rest); const between = 60;
    const n = Math.max(1, Math.floor((sec + between) / (blockSec + between)));
    const moves = EX.filter(e => !blockedBy(e, ctx.inj) && !ctx.exclude.has(e.id) && e.type === 'D' && (e.areas.includes('cardio') || e.areas.includes('power')) && !isFormat(e) && have(e, ctx.owned)
      && e.level <= Math.max(2, ctx.levelOf('cardio')) && !e.equipment.some(t => ['pool', 'bike', 'stairs'].includes(t)));
    const items = [];
    for (let b = 0; b < n; b++) {
      let pickM = moves.filter(e => !used.has(e.id)).sort(() => Math.random() - 0.5).slice(0, 2);
      if (pickM.length < 2) pickM = moves.slice().sort(() => Math.random() - 0.5).slice(0, 2);
      pickM.forEach(e => used.add(e.id));
      items.push({ uid: uid(), id: formatId, sec: 'main', kind: 'hiit', type: 'D', slot: { area: 'cardio', type: 'D' }, moves: pickM.map(e => e.id),
        sets: f.rounds, work: f.work, rest: f.rest, mode: 'time', hold: f.work, sides: 1, log: [], restAfter: b < n - 1 ? between : 0 });
    }
    return items;
  }

  function slotsFromAreas(areas) {
    const out = [];
    for (const a of areas) out.push([a, 'D', 3]);
    for (const a of areas) if (a !== 'cardio') out.push([a, 'I', 2]);
    return out;
  }

  // opts: {equip, minutes, slots | areas, goal, sports, levels, level, planWeek, hiitFormat}
  function generate(opts) {
    const owned = ownedSet(opts.equip); const sports = opts.sports || [];
    const goal = goalById(opts.goal);
    const sp = split(opts.minutes || 45, { sports });
    let slots = opts.slots ? opts.slots.map(s => s.slice()) : slotsFromAreas(opts.areas && opts.areas.length ? opts.areas : ['chest', 'back', 'quads', 'core']);
    const areas = [...new Set((opts.areas || []).concat(slots.map(s => s[0])).filter(a => a !== 'mobility' && a !== 'skill'))];
    const planF = opts.planWeek ? D.plan_week_factor[(opts.planWeek - 1) % D.plan_week_factor.length] : 1;
    const ease = opts.planWeek && opts.planWeek === ST.plan.easeWeek;
    const inj = injuryCtx(opts.injuries);
    let limited = null;
    if (inj && inj.backNeck && goal && ['strength', 'power', 'hiit'].includes(goal.id)) { limited = goal.id; }
    const ctx = {
      only: opts.only ? new Set(opts.only) : null, inj, missing: new Set(), owned, sports, areas, goal: limited ? null : goal, exclude: new Set(opts.exclude || []), used: null, factor: planF, rehab: goal && goal.id === 'rehabilitation',
      levelOf: a => Math.min(goal && goal.id === 'rehabilitation' ? 2 : 5, (opts.levels && opts.levels[a]) || opts.level || 2),
      restD: restFor(goal, B.D.rest), restI: goal ? restFor(goal, B.I.rest) : B.I.rest,
      maxSets: Math.max(1, (goal && goal.sets ? goal.sets[1] : B.maxSets) + (ease ? D.plan_deload_sets : 0)),
      minSets: t => (goal && goal.sets && (t === 'D') ? goal.sets[0] : 1),
      baseSets: s => Math.max(goal && goal.sets ? goal.sets[0] : 2, Math.min(s[2], 3)),
    };
    const g2 = ctx.goal;
    if (g2 && g2.id === 'flexibility') slots = areas.map(a => ['mobility', 'S', 2]).concat(slots.filter(s => s[1] === 'S'));
    if (g2 && g2.id === 'isometrics') slots = slots.map(s => s[1] === 'D' ? [s[0], 'I', s[2]] : s);
    if (g2 && g2.id === 'mobility') slots = areas.map(() => ['mobility', 'M', 2]);
    const used = new Set(); ctx.used = used;
    let mainBudget = sp.main * 60 * (ease ? 0.8 : 1);
    let main = [];
    const breakItem = (min, kind) => ({ uid: uid(), id: kind, sec: 'break', kind, type: 'B', sets: 1, work: min * 60, rest: 0, mode: 'time', hold: min * 60, log: [] });
    if (g2 && g2.id === 'hiit') {
      main = hiitBlocks(mainBudget, ctx, used, opts.hiitFormat || 'hiit_tabata');
      const left = mainBudget - sum(main); if (left > 150) main = main.concat(fillMain(slots.filter(s => s[0] === 'core'), left, ctx, used, 'main'));
    } else if (g2 && g2.id === 'cardio-endurance') {
      const c = pick('cardio', 'D', ctx, used, null);
      if (c) { used.add(c.id); const it = makeItem(c, { area: 'cardio', type: 'D' }, 1, ctx, 'main'); it.mode = 'time'; delete it.reps; it.sides = 1; it.work = it.hold = Math.round(Math.min(mainBudget * 0.8, 3600) / 60) * 60; it.rest = 0; main.push(it); }
      main = main.concat(fillMain([['core', 'D', 2], ['core', 'I', 2]], mainBudget - sum(main), ctx, used, 'main'));
    } else {
      const blocks = [];
      const hasSkills = sports.length > 0 && pool('skill', 'skill', ctx, false).length > 0;
      if (sp.nBlocks > 1) {
        const order = ST.blocks.order.filter(b => b !== 'skills' || hasSkills);
        const each = mainBudget / order.length;
        for (const b of order) {
          if (b === 'skills') blocks.push(fillMain([['skill', 'skill', 2]], each, ctx, used, 'main'));
          else if (b === 'conditioning') blocks.push(fillMain([['cardio', 'D', 4], ['core', 'D', 3], ['cardio', 'D', 4], ['core', 'I', 2]], each, ctx, used, 'main'));
          else blocks.push(fillMain(slots.filter(s => s[0] !== 'cardio') .length ? slots.filter(s => s[0] !== 'cardio') : slots, each, ctx, used, 'main'));
        }
        blocks.forEach((b, i) => { b.forEach(it => it.block = order[i]); main = main.concat(b); if (i < blocks.length - 1) main.push(breakItem(ST.blocks.breakMin, 'block_break')); });
      } else {
        if (hasSkills) { const sk = fillMain([['skill', 'skill', 2]], mainBudget * D.skills_share, ctx, used, 'main'); sk.forEach(i => i.block = 'skills'); main = sk; }
        main = main.concat(fillMain(slots, mainBudget - sum(main), ctx, used, 'main'));
      }
    }
    const gap = mainBudget - sum(main);
    ctx.only = null;
    if (gap > 120) main = main.concat(fillMain([['cardio', 'D', 3], ['rehab', 'D', 2], ['rehab', 'M', 2], ['core', 'I', 2], ['mobility', 'M', 2]], gap, ctx, used, 'main').map(i => Object.assign(i, { filler: true })));
    const mainSec = sum(main.filter(i => i.sec === 'main'));
    const warm = warmup(sp.warm * 60, ctx, used);
    const cool = cooldown(sp.cool * 60 + Math.max(0, sp.main * 60 - mainSec), ctx, used);
    let items = warm.concat(main, cool);
    // water breaks every N minutes of work
    if (sp.water) {
      const out = []; let since = 0, left = sp.water;
      for (const it of items) {
        if (it.kind === 'block_break') since = 0;
        if (left && since >= ST.water.every * 60 - 60) { out.push(breakItem(ST.water.min, 'water_break')); since = 0; left--; }
        out.push(it); since += itemSec(it);
      }
      while (left-- > 0) out.splice(out.length - 1, 0, breakItem(ST.water.min, 'water_break'));
      items = out;
    }
    return { items, budget: sp, limitedGoal: limited, missing: [...ctx.missing].filter(a => !main.some(i => i.slot.area === a)), goal: opts.goal || null, sports, areas, slots, minutes: sp.total, hiitFormat: opts.hiitFormat || null, planWeek: opts.planWeek || null };
  }

  function breakdown(items) {
    const b = { warm: 0, main: 0, cool: 0, break: 0 };
    for (const it of items) b[it.sec] = (b[it.sec] || 0) + itemSec(it);
    b.total = b.warm + b.main + b.cool + b.break; return b;
  }

  // Swap within the same pool: same area + type, gear you have, level cap; prefers the same equipment.
  // swap_rules.replace: same area + type + level cap, gear you have, nothing already in today's session.
  function ctxFor(opts) {
    const goal = goalById(opts.goal);
    return { inj: injuryCtx(opts.injuries), goal, factor: 1, restD: restFor(goal, B.D.rest), restI: goal ? restFor(goal, B.I.rest) : B.I.rest };
  }
  function alternatives(it, opts, excludeIds) {
    const owned = ownedSet(opts.equip); const goal = goalById(opts.goal);
    const ctx = { inj: injuryCtx(opts.injuries), owned, sports: opts.sports || [], areas: opts.areas || [], exclude: new Set(opts.exclude || []), rehab: goal && goal.id === 'rehabilitation',
      levelOf: a => (opts.levels && opts.levels[a]) || opts.level || 2, used: excludeIds, avoidJoint: opts.avoidJoint || null };
    const cur = BY[it.id];
    return pool(it.slot.area, cur.type, ctx, true).filter(e => !excludeIds.has(e.id) && e.id !== it.id)
      .map(e => [score(e, it.slot.area, ctx, cur) - Math.random() * 2 + (opts.random ? Math.random() * 3 : 0), e]).sort((a, b) => b[0] - a[0]).map(x => x[1]);
  }
  function swap(session, uidv, opts) {
    const it = session.items.find(i => i.uid === uidv); if (!it || it.kind === 'water_break' || it.kind === 'block_break') return null;
    const ids = new Set(session.items.map(i => i.id));
    if (it.kind === 'hiit') {
      const owned = ownedSet(opts.equip); const ex = new Set(opts.exclude || []); session.items.forEach(i => (i.moves || []).forEach(m => ids.add(m)));
      const injX = injuryCtx(opts.injuries); const mv = EX.filter(e => !blockedBy(e, injX) && e.type === 'D' && (e.areas.includes('cardio') || e.areas.includes('power')) && !isFormat(e) && have(e, owned) && !ids.has(e.id) && !ex.has(e.id) && !e.equipment.some(t => ['pool', 'bike', 'stairs'].includes(t)))
        .sort(() => Math.random() - 0.5).slice(0, it.moves.length || 2);
      if (!mv.length) return null; it.moves = mv.map(e => e.id); it.log = []; return it;
    }
    const alt = opts.toId ? BY[opts.toId] : alternatives(it, Object.assign({ random: true }, opts), ids)[0]; if (!alt) return null;
    const fresh = makeItem(alt, it.slot, it.sets, ctxFor(opts), it.sec);
    const keepHold = it.mode === 'time' && fresh.mode === 'time' && it.hold;
    Object.assign(it, { id: alt.id, type: alt.type, mode: fresh.mode, sides: fresh.sides, log: [] });
    if (fresh.mode === 'reps') { it.reps = fresh.reps; it.work = fresh.work; it.rest = fresh.rest; delete it.hold; }
    else if (keepHold) { delete it.reps; it.work = it.hold * it.sides; }
    else { it.hold = fresh.hold; it.work = fresh.work; it.rest = fresh.rest; delete it.reps; }
    return it;
  }
  function itemFor(id, sec, opts) {
    const e = BY[id]; const c = ctxFor(opts || {});
    const it = makeItem(e, { area: e.areas[0], type: e.type }, e.type === 'S' || e.type === 'M' ? 1 : 3, c, sec || 'main');
    if (it.work >= 300) it.sets = 1; return it;
  }
  const JOINTS = { wrist: 'wrist_extension', shoulder: 'shoulder_overhead', knee: 'deep_knee_bend', 'lower back': 'lower_back_load', neck: 'neck_load' };

  // Day plan for a split: day index -> slots (two-a-days: AM skills/cardio, PM strength).
  function splitDays(n) { return L.splits[String(n)] || L.splits['5']; }
  function slotsFor(daysPerWeek, dayIdx, sessionNo, sports) {
    const days = splitDays(daysPerWeek); const day = days[dayIdx % days.length];
    if (sessionNo === 2) return { name: day.name, slots: day.slots, role: 'pm' };
    return { name: day.name, slots: day.slots, role: 'one' };
  }

  const api = { injuryCtx, blockedBy, itemFor, JOINTS, L, EX, BY, ownedSet, have, split, generate, breakdown, itemSec, swap, alternatives, pool, slotsFromAreas, splitDays, slotsFor, goalById, isTimed };
  if (typeof module !== 'undefined') module.exports = api; else root.Engine = api;
})(typeof window !== 'undefined' ? window : globalThis);
