'use strict';
/* Steady — a calm daily tracker designed around AuDHD: a fixed frame with fresh content inside.
   No build step, no dependencies. */

// ───────────────────────── utils
const $ = (s, e = document) => e.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3);
const DAY = 864e5;
const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => ymd(new Date());
const parse = s => { const [a, b, c] = s.split('-').map(Number); return new Date(a, b - 1, c); };
const addD = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return ymd(d); };
const addM = (s, n) => {
  const d = parse(s), day = d.getDate(); d.setDate(1); d.setMonth(d.getMonth() + n);
  d.setDate(Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate())); return ymd(d);
};
const diff = (a, b) => Math.round((parse(a) - parse(b)) / DAY);
const nice = s => {
  const k = diff(s, today());
  if (k === 0) return 'Today'; if (k === 1) return 'Tomorrow'; if (k === -1) return 'Yesterday';
  if (k > 1 && k < 7) return parse(s).toLocaleDateString(undefined, { weekday: 'long' });
  return parse(s).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};
const weekEnd = () => { const t = today(); const dow = parse(t).getDay(); return addD(t, dow === 0 ? 7 : 7 - dow); };
const nextDow = dow => { let d = today(); while (parse(d).getDay() !== dow) d = addD(d, 1); return d; };
const pick = a => a[Math.floor(Math.random() * a.length)];
const tmin = s => { const [h, m] = String(s || '0:0').split(':').map(Number); return h * 60 + (m || 0); };
const nowMin = () => { const n = new Date(); return n.getHours() * 60 + n.getMinutes(); };
const fmtT = s => { const m = tmin(s); const d = new Date(); d.setHours(Math.floor(m / 60), m % 60, 0, 0); return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }); };
const hashStr = s => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

// ───────────────────────── state
const KEY = 'steady.v1', DEVKEY = 'steady.dev', TIMERKEY = 'steady.timer';
const COLS = ['areas', 'tasks', 'inbox', 'bills', 'wins', 'events', 'boosts'];
const blank = () => ({
  v: 2,
  settings: {
    u: 0, name: '', cur: '$', quiet: { on: true, from: '21:30', to: '07:00' }, sound: true, cash: 0, taxPct: 20, taxPot: 0, onboarded: false,
    day: { start: '07:00', work: '09:00', workEnd: '17:00', end: '21:30' }, cycle: { on: false, starts: [], len: 28 },
  },
  areas: {}, tasks: {}, inbox: {}, bills: {}, wins: {}, events: {}, boosts: {},
});
let S = blank();
let dev = { theme: 'auto', clientId: '', lastArea: '', driveOk: false, fileId: '', lastSync: 0, mode: 'one', scan: null, basics: '', rough: '', lastOpen: 0, cheers: [] };
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage full or blocked */ } },
};
function load() {
  const s = store.get(KEY), d = store.get(DEVKEY), b = blank();
  if (s) {
    S = { ...b, ...s, settings: { ...b.settings, ...s.settings } };
    S.settings.day = { ...b.settings.day, ...(s.settings && s.settings.day) };
    S.settings.cycle = { ...b.settings.cycle, ...(s.settings && s.settings.cycle) };
    for (const c of COLS) S[c] = S[c] || {};
  }
  if (d) dev = { ...dev, ...d };
  const cutoff = Date.now() - 60 * DAY;
  for (const c of COLS) for (const id in S[c]) if (S[c][id].del && S[c][id].u < cutoff) delete S[c][id];
}
const saveDev = () => store.set(DEVKEY, dev);
function persist(noSync) { store.set(KEY, S); if (!noSync) scheduleSync(); }
const live = c => Object.values(S[c] || {}).filter(x => !x.del);
function put(c, o) { o.u = Date.now(); S[c][o.id] = o; persist(); return o; }
function del(c, id) { S[c][id] = { id, del: true, u: Date.now() }; persist(); }
function setSettings(patch) { S.settings = { ...S.settings, ...patch, u: Date.now() }; persist(); }

// ───────────────────────── constants & language
const SIZES = [[5, '5 min'], [10, '10 min'], [15, '15 min'], [30, '30 min'], [60, '1 hr+']];
const ENERGY = { l: 'Easy', m: 'Medium', h: 'Demanding' };
const CAP = { h: 'Strong', m: 'Steady', l: 'Gentle' };
const ANCHORS = [['any', 'Anytime'], ['am', 'Morning'], ['mid', 'Work hours'], ['pm', 'Evening']];
const REPEATS = [['', 'Never'], ['daily', 'Daily'], ['weekdays', 'Weekdays'], ['weekly', 'Weekly'], ['biweekly', 'Every 2 weeks'], ['monthly', 'Monthly'], ['yearly', 'Yearly'], ['every', 'Every N days']];
const COLORS = ['#7b6a86', '#7f8f76', '#a67f6b', '#5f6f8a', '#a0708a', '#6f8f8a', '#958a5c', '#432a4d', '#8c7b6b', '#6a5a7a'];
const CHEERS = [
  'Done. That counts.', 'One less thing in your head.', 'Moved forward.', 'Nice. Take a breath.', 'That was real progress.', 'Handled.',
  'Your future self says thanks.', 'Small steps are still steps.', 'You did the thing.', 'Look at that, momentum.', 'That took effort. Noticed.',
  'Ticked. Lighter now.', 'Quietly brilliant.', 'Progress, not perfection.', 'You showed up for that one.',
];
const TINY = ['Open the file / app / page', 'Gather what I need', 'Write the first line', 'Set a 5-minute timer', 'Put on music that helps'];
const BOOSTS = [['Play one favourite song', 4], ['Step outside for 2 minutes', 2], ['Make a nice drink', 5], ['Stretch or shake it out', 2], ['Five slow breaths at the window', 1], ['A snack you love', 5]];
const SCANQ = [
  ['ate', 'Eaten in the last 4 hours?', [['y', 'Yes'], ['n', 'No']]],
  ['water', 'Had water recently?', [['y', 'Yes'], ['n', 'No']]],
  ['slept', 'Slept OK?', [['y', 'Yes'], ['n', 'Not really']]],
  ['pain', 'In pain or unwell?', [['n', 'No'], ['y', 'Yes']]],
  ['over', 'Overstimulated or frazzled?', [['n', 'No'], ['y', 'Yes']]],
  ['social', 'People battery?', [['ok', 'OK'], ['low', 'Low']]],
];
const PEOPLE_RX = /\b(call|phone|ring|email|e-mail|reply|respond|message|text|meeting|meet|client|customer|zoom|dm|chase|follow up|follow-up)\b/;

function nextDue(r, due) {
  const t = today();
  const step = s => {
    switch (r.t) {
      case 'daily': return addD(s, 1);
      case 'weekdays': { let x = addD(s, 1); while ([0, 6].includes(parse(x).getDay())) x = addD(x, 1); return x; }
      case 'weekly': return addD(s, 7);
      case 'biweekly': return addD(s, 14);
      case 'monthly': return addM(s, 1);
      case 'yearly': return addM(s, 12);
      default: return addD(s, Math.max(1, r.n || 1));
    }
  };
  let d = step(due || t), g = 0;
  while (d <= t && g++ < 400) d = step(d);
  return d;
}

// ───────────────────────── money helpers
const money = n => {
  const v = Math.abs(n), frac = Math.abs(v % 1) > 0.004;
  return (n < 0 ? '-' : '') + (S.settings.cur || '$') + v.toLocaleString(undefined, { minimumFractionDigits: frac ? 2 : 0, maximumFractionDigits: 2 });
};
const sum = a => a.reduce((x, b) => x + (+b.amount || 0), 0);
function moneyCalc() {
  const t = today(), end = addD(t, 14), B = live('bills').filter(b => !b.paid);
  const out = B.filter(b => b.dir === 'out' && b.due <= end), owed = B.filter(b => b.dir === 'in');
  const cash = +S.settings.cash || 0, pot = +S.settings.taxPot || 0;
  return { cash, pot, dueOut: sum(out), owed: sum(owed), safe: cash - pot - sum(out) };
}

// ───────────────────────── areas
const areaList = () => live('areas').sort((a, b) => (a.kind === b.kind ? (a.order || 0) - (b.order || 0) : a.kind === 'biz' ? -1 : 1));
const areaName = id => S.areas[id] && !S.areas[id].del ? S.areas[id].name : 'No area';
const areaColor = id => S.areas[id] && !S.areas[id].del ? S.areas[id].color : '#b7b0a8';
const areaDot = id => `<span class="dotc" style="--c:${areaColor(id)}"></span>`;
const areaOpts = none => [...(none ? [['', 'None']] : []), ...areaList().map(a => [a.id, a.name, a.color])];
const paused = id => S.areas[id] && !S.areas[id].del && S.areas[id].paused;
function addArea(name, kind, color) {
  const n = live('areas').length;
  return put('areas', { id: uid(), name, kind, color: color || COLORS[n % COLORS.length], paused: false, order: n });
}

// ───────────────────────── body, cycle, capacity
const scanToday = () => (dev.scan && dev.scan.d === today() && !dev.scan.skip ? dev.scan : null);
function cycleInfo(date = today()) {
  const c = S.settings.cycle;
  if (!c || !c.on || !c.starts || !c.starts.length) return null;
  const st = [...c.starts].sort(), last = st.filter(s => s <= date).pop();
  if (!last) return null;
  let len = +c.len || 28;
  const gaps = []; for (let i = 1; i < st.length; i++) gaps.push(diff(st[i], st[i - 1]));
  const rec = gaps.slice(-3).filter(g => g >= 18 && g <= 45);
  if (rec.length) len = Math.round(rec.reduce((a, b) => a + b, 0) / rec.length);
  const day = diff(date, last) + 1;
  if (day > len + 14) return { day, len, label: 'Cycle day unknown', note: 'Log your next period start when it comes.', hard: false };
  if (day <= 5) return { day, len, label: `Period, day ${day}`, note: day <= 2 ? 'Energy is often lower now. Gentle is the plan.' : 'Go easy on yourself.', hard: day <= 2 };
  if (day <= 13) return { day, len, label: `Rising-energy phase, day ${day}`, note: 'Many people find planning and starting new things easier now.', hard: false };
  if (day <= 16) return { day, len, label: `Mid-cycle, day ${day}`, note: '', hard: false };
  if (day <= len - 7) return { day, len, label: `Second half, day ${day}`, note: '', hard: false };
  if (day <= len) return { day, len, label: `Premenstrual week, day ${day}`, note: 'ADHD traits often feel stronger this week. Lower expectations are a strategy, not a failure.', hard: true };
  return { day, len, label: `Day ${day}, period may be due`, note: 'Lighter plans are a good idea.', hard: true };
}
function capacity() {
  const s = scanToday(), c = cycleInfo(), why = [];
  let n = 3;
  if (s) {
    if (s.slept === 'n') { n--; why.push('short on sleep'); }
    if (s.pain === 'y') { n--; why.push('pain'); }
    if (s.over === 'y') { n--; why.push('overstimulated'); }
    if (s.ate === 'n') n -= 0.5;
  }
  if (c && c.hard) { n--; why.push(c.label.split(',')[0].toLowerCase()); }
  if (dev.rough === today()) { n--; why.push('rough hormonal day'); }
  const known = !!(s || (c && c.hard) || dev.rough === today());
  return { n, lvl: n >= 2.5 ? 'h' : n >= 1.5 ? 'm' : 'l', why, known };
}
const energyNow = () => { const c = capacity(); return c.known ? c.lvl : null; };

// ───────────────────────── fixed events (appointments)
const eventsOn = date => live('events').filter(e => e.date === date || (e.weekly && e.date <= date && parse(e.date).getDay() === parse(date).getDay()))
  .sort((a, b) => tmin(a.start) - tmin(b.start));
function nextEvent() {
  const nm = nowMin(), e = eventsOn(today()).find(x => tmin(x.start) > nm);
  return e ? { e, mins: tmin(e.start) - nm, buffer: +e.buffer || 15 } : null;
}
const blockNow = () => { const d = S.settings.day, nm = nowMin(); return nm < tmin(d.work) ? 'am' : nm < tmin(d.workEnd) ? 'mid' : 'pm'; };

// ───────────────────────── ranking: the one-next-thing engine
let ui = { tab: 'today', pulled: null, area: 'all', chosen: null, scan: {}, gap: 0 };
const bodyItem = (id, title, score) => ({ kind: 'body', id, title, area: '', size: 5, steps: [], score, why: ['Your body comes first'] });

function pool() {
  const t = today(), e = energyNow(), anchor = blockNow(), basics = dev.basics === t, s = scanToday();
  const socialLow = s && s.social === 'low', nx = nextEvent(), fit = nx && nx.mins <= 240 ? nx.mins - nx.buffer : null;
  const out = [];
  if (s && s.ate === 'n') out.push(bodyItem('ate', 'Eat something easy', 130));
  if (s && s.water === 'n') out.push(bodyItem('water', 'Drink a glass of water', 125));
  for (const k of live('tasks')) {
    if (k.done || paused(k.area) || (k.start && k.start > t) || (k.snooze && k.snooze >= t)) continue;
    if (basics && !(k.basic || (k.hard && k.due && diff(k.due, t) <= 1))) continue;
    let sc = 0; const why = [];
    if (k.pin) { sc += 50; why.push('Your pick for today'); }
    if (k.due) {
      const d = diff(k.due, t);
      if (k.hard) {
        if (d < 0) { sc += 110; why.push('Deadline passed. Needs attention'); }
        else if (d === 0) { sc += 100; why.push('Deadline today'); }
        else if (d <= 3) { sc += 70 - d * 5; why.push(`Deadline ${nice(k.due).toLowerCase()}`); }
        else if (d <= 7) sc += 25; else if (!k.pin) continue;
      } else if (d <= 0) { sc += 30 + Math.min(-d, 5); why.push(d === 0 ? 'Planned for today' : 'Rolled over quietly'); }
      else if (d === 1) sc += 12; else if (!k.pin) continue;
    } else if (!k.pin) continue;
    if (k.basic) sc += 15;
    if (e) {
      if (k.energy === e) { sc += 12; why.push('Fits your capacity'); }
      else if (e === 'l' && k.energy === 'h') sc -= 40;
      else if (e === 'l' && k.size <= 10) sc += 8;
    }
    if (k.people && socialLow && !k.hard) { sc -= 35; why.push('People battery low, so this can wait'); }
    if (k.anchor && k.anchor !== 'any') sc += k.anchor === anchor ? 18 : -15;
    if (fit != null) { if ((k.size || 10) > fit) { sc -= 25; why.push(`Might not fit before ${nx.e.title}`); } else { sc += 8; why.push(`Fits before ${nx.e.title}`); } }
    sc += Math.min(Math.max(0, diff(t, ymd(new Date(k.created || Date.now())))), 10) * 0.5;
    if (k.area && k.area === dev.lastArea) sc -= 4;
    out.push({ kind: 'task', id: k.id, title: k.title, area: k.area, size: k.size || 10, energy: k.energy, hard: k.hard, due: k.due, first: k.first, steps: k.steps || [], people: k.people, quest: k.quest, reward: k.reward, score: sc, why });
  }
  for (const b of live('bills')) {
    if (b.paid || paused(b.area) || (b.snooze && b.snooze >= t)) continue;
    const d = diff(b.due, t);
    if (b.dir === 'out' && d <= (basics ? 1 : 3)) {
      out.push({ kind: 'bill', id: b.id, title: `Pay ${b.name} (${money(b.amount)})`, area: b.area, size: 5, hard: true, due: b.due, steps: [], score: d < 0 ? 105 : d === 0 ? 95 : 80 - d * 5, why: [d < 0 ? 'Past its due date' : d === 0 ? 'Due today' : `Due ${nice(b.due).toLowerCase()}`] });
    } else if (!basics && b.dir === 'in' && d < 0 && !(b.chase && b.chase >= t)) {
      out.push({ kind: 'chase', id: b.id, title: `Check on payment: ${b.name} (${money(b.amount)})`, area: b.area, size: 5, steps: [], people: true, score: socialLow ? 5 : 40, why: [`Was expected ${nice(b.due).toLowerCase()}`] });
    }
  }
  out.sort((a, b) => b.score - a.score);
  if (ui.pulled && S.tasks[ui.pulled] && !S.tasks[ui.pulled].done) {
    const k = S.tasks[ui.pulled], i = out.findIndex(x => x.id === k.id);
    if (i >= 0) out.unshift(out.splice(i, 1)[0]);
    else out.unshift({ kind: 'task', id: k.id, title: k.title, area: k.area, size: k.size || 10, energy: k.energy, first: k.first, steps: k.steps || [], people: k.people, score: 999, why: ['From your backlog'] });
  }
  return out;
}

// ───────────────────────── actions on items
function win(title, area, quest) { put('wins', { id: uid(), title, area, quest: !!quest, at: Date.now(), day: today() }); }
function cheer(extra) {
  const recent = dev.cheers || [];
  const opts = CHEERS.map((_, i) => i).filter(i => !recent.includes(i));
  const i = pick(opts.length ? opts : CHEERS.map((_, j) => j));
  dev.cheers = [...recent, i].slice(-6); saveDev();
  toast(extra ? `${CHEERS[i]} ${extra}` : CHEERS[i]);
}
function complete(kind, id) {
  let extra = '';
  if (kind === 'task') {
    const k = S.tasks[id]; if (!k) return;
    win(k.title, k.area, k.quest); dev.lastArea = k.area; saveDev();
    if (k.quest && k.reward) extra = `Quest complete. Your reward: ${k.reward}.`;
    if (k.repeat) { k.due = nextDue(k.repeat, k.due); k.steps = (k.steps || []).map(s => ({ ...s, done: false })); k.snooze = null; k.slips = 0; }
    else { k.done = true; k.doneAt = Date.now(); }
    k.pin = false; put('tasks', k);
  } else if (kind === 'bill') markPaid(id);
  else if (kind === 'chase') { const b = S.bills[id]; win('Followed up on ' + b.name, b.area); b.chase = addD(today(), 3); put('bills', b); }
  else if (kind === 'body') { if (dev.scan) { dev.scan[id] = 'y'; saveDev(); } win(id === 'ate' ? 'Ate something' : 'Drank water', ''); }
  if (ui.pulled === id) ui.pulled = null;
  if (ui.chosen === id) ui.chosen = null;
  if (kind !== 'bill') cheer(extra);
  render();
}
function snooze(kind, id) {
  const t = today();
  if (kind === 'task') {
    const k = S.tasks[id]; k.snooze = t; k.slips = (k.slips || 0) + 1; put('tasks', k);
    if (k.slips >= 3) { toast('This one keeps slipping. Smaller steps might help.'); setTimeout(() => stepsSheet(id), 400); }
  } else if (kind === 'body') { if (dev.scan) { dev.scan[id] = 'later'; saveDev(); } }
  else { const b = S.bills[id]; b.snooze = t; put('bills', b); }
  if (ui.pulled === id) ui.pulled = null;
  if (ui.chosen === id) ui.chosen = null;
  render();
}
function markPaid(id) {
  const b = S.bills[id]; if (!b) return;
  const amt = +b.amount || 0;
  win(b.dir === 'out' ? 'Paid ' + b.name : 'Received ' + b.name, b.area);
  let msg;
  if (b.dir === 'out') { setSettings({ cash: (+S.settings.cash || 0) - amt }); msg = `Paid. Cash updated: ${money(-amt)}`; }
  else {
    const biz = S.areas[b.area] && S.areas[b.area].kind === 'biz';
    const set = biz ? Math.round(amt * (+S.settings.taxPct || 0)) / 100 : 0;
    setSettings({ cash: (+S.settings.cash || 0) + amt, taxPot: (+S.settings.taxPot || 0) + set });
    msg = set ? `Cash +${money(amt)}. ${money(set)} set aside for tax` : `Cash updated: +${money(amt)}`;
  }
  if (b.repeat) { b.due = nextDue({ t: b.repeat }, b.due); b.snooze = null; b.chase = null; } else b.paid = true;
  put('bills', b); toast(msg);
}

// ───────────────────────── toast
let toastT;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('on');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 3000);
}

// ───────────────────────── sheet + form plumbing
let sheetFn = null, F = {};
function sheet(fn) {
  sheetFn = fn;
  const s = $('#sheet');
  s.innerHTML = `<div class="scrim" data-act="closeSheet"></div><div class="panel" role="dialog" aria-modal="true"><div class="grab"></div>${fn()}</div>`;
  s.hidden = false; document.body.classList.add('noscroll');
}
function resheet() {
  const p = $('#sheet .panel'); if (!p || !sheetFn) return;
  const y = p.scrollTop; p.innerHTML = '<div class="grab"></div>' + sheetFn(); p.scrollTop = y;
}
function closeSheet() { sheetFn = null; const s = $('#sheet'); s.hidden = true; s.innerHTML = ''; document.body.classList.toggle('noscroll', !!tm); }
const rerender = () => (sheetFn ? resheet() : render());
const chips = (k, opts, cur) => `<div class="chips">${opts.map(([v, l, c]) =>
  `<button type="button" class="chip${String(cur) === String(v) ? ' on' : ''}" data-act="chip" data-k="${k}" data-v="${esc(v)}">${c ? `<span class="dotc" style="--c:${c}"></span>` : ''}${esc(l)}</button>`).join('')}</div>`;
const field = (label, inner) => `<label class="f">${label}</label>${inner}`;
const bindIn = (k, v, type = 'text', extra = '') => `<input type="${type}" data-f="${k}" value="${esc(v ?? '')}" ${extra}>`;
const check = (k, on, label) => `<label class="check"><input type="checkbox" data-f="${k}" ${on ? 'checked' : ''}> <span>${label}</span></label>`;
const dateQuick = k => `<div class="chips" style="margin-top:8px">${[['', 'No date'], [today(), 'Today'], [addD(today(), 1), 'Tomorrow'], [weekEnd(), 'This week'], [addD(today(), 7), 'Next week']].map(([v, l]) =>
  `<button type="button" class="chip" data-act="chip" data-k="${k}" data-v="${v}">${l}</button>`).join('')}</div>`;
const cycleHint = date => { const c = date && cycleInfo(date); return c && c.hard ? `<p class="hint">That date falls in your ${esc(c.label.split(',')[0].toLowerCase())}. Consider giving it some buffer.</p>` : ''; };

// ───────────────────────── task sheet
function taskSheet(id, seed) {
  const k = id ? S.tasks[id] : null;
  F = k
    ? { ...k, steps: (k.steps || []).map(s => s.t).join('\n'), repeatT: k.repeat ? k.repeat.t : '', repeatN: k.repeat ? k.repeat.n || 2 : 2, _id: id }
    : { title: '', area: '', size: 10, energy: 'm', anchor: 'any', due: '', hard: false, first: '', steps: '', notes: '', repeatT: '', repeatN: 2, pin: false, people: false, basic: false, quest: false, reward: '', ...seed };
  sheet(taskForm);
}
function taskForm() {
  return `<h2>${F._id ? 'Edit task' : 'New task'}</h2>
  ${field('What is it?', bindIn('title', F.title, 'text', 'placeholder="e.g. Send Acme the invoice" autocomplete="off"'))}
  ${field('Where does it belong?', chips('area', areaOpts(true), F.area))}
  ${field('When?', bindIn('due', F.due, 'date') + dateQuick('due'))}${cycleHint(F.due)}
  ${F.due ? check('hard', F.hard, 'Hard deadline (someone is counting on it)') : ''}
  ${field('How long for a first sitting?', chips('size', SIZES, F.size))}
  ${field('How demanding is it?', chips('energy', Object.entries(ENERGY), F.energy))}
  ${field('Best part of the day', chips('anchor', ANCHORS, F.anchor))}
  ${check('people', F.people, 'Involves people (calls, clients, messages). Waits when your people battery is low')}
  ${check('basic', F.basic, 'Essential: keep it even on basics-only days')}
  ${field('Repeats', `<select data-f="repeatT">${REPEATS.map(([v, l]) => `<option value="${v}" ${F.repeatT === v ? 'selected' : ''}>${l}</option>`).join('')}</select>${F.repeatT === 'every' ? bindIn('repeatN', F.repeatN, 'number', 'min="1" style="margin-top:8px"') : ''}`)}
  ${field('Tiny first step (the very first move)', bindIn('first', F.first, 'text', 'placeholder="e.g. Open the invoice template"'))}
  ${field('Smaller steps (one per line, optional)', `<textarea data-f="steps" placeholder="Open template&#10;Fill in the amount&#10;Send">${esc(F.steps)}</textarea>`)}
  ${check('quest', F.quest, 'Make it a side quest with a reward')}
  ${F.quest ? field('Your reward when it\'s done', bindIn('reward', F.reward, 'text', 'placeholder="e.g. Fancy coffee, an episode, new stickers"')) : ''}
  ${field('Notes', `<textarea data-f="notes">${esc(F.notes || '')}</textarea>`)}
  ${check('pin', F.pin, 'Make this one of my picks for today')}
  <div class="row"><button class="btn pri" data-act="saveTask">Save</button><button class="btn ghost" data-act="closeSheet">Cancel</button>
  ${F._id ? '<button class="btn ghost danger" data-act="delTask">Delete</button>' : ''}</div>`;
}
function saveTaskFromForm() {
  if (!String(F.title || '').trim()) { toast('Give it a name first'); return false; }
  const old = F._id ? S.tasks[F._id] : null;
  const steps = String(F.steps || '').split('\n').map(x => x.trim()).filter(Boolean).map(t => (old && (old.steps || []).find(s => s.t === t)) || { id: uid(), t, done: false });
  const o = {
    ...(old || { id: uid(), created: Date.now(), done: false }),
    title: F.title.trim(), area: F.area || '', size: +F.size || 10, energy: F.energy || 'm', anchor: F.anchor || 'any',
    due: F.due || '', hard: !!F.hard && !!F.due, first: (F.first || '').trim(), steps, notes: F.notes || '', pin: !!F.pin,
    people: !!F.people, basic: !!F.basic, quest: !!F.quest, reward: F.quest ? (F.reward || '').trim() : '',
    repeat: F.repeatT ? { t: F.repeatT, n: +F.repeatN || 2 } : null,
  };
  if (o.repeat && !o.due) o.due = today();
  put('tasks', o); return true;
}
function stepsSheet(id) {
  const k = S.tasks[id]; if (!k) return;
  F = { _id: id, steps: (k.steps || []).map(s => s.t).join('\n'), first: k.first || '' };
  sheet(() => `<h2>Make it smaller</h2><p class="mut small">${esc(k.title)}</p>
    ${field('Very first move (2 minutes or less)', bindIn('first', F.first, 'text', 'placeholder="e.g. Open the document"'))}
    ${field('Steps, one per line', `<textarea data-f="steps" placeholder="One small step per line">${esc(F.steps)}</textarea>`)}
    <p class="mut small" style="margin-top:8px">Want a starting point? Tap to add:</p>
    <div class="chips" style="margin-top:6px">${TINY.map(t => `<button class="chip" data-act="addTiny" data-v="${esc(t)}">+ ${esc(t)}</button>`).join('')}</div>
    <div class="row"><button class="btn pri" data-act="saveSteps">Save</button><button class="btn ghost" data-act="closeSheet">Cancel</button></div>`);
}

// ───────────────────────── capture + inbox
function captureSheet() {
  F = { cap: '', capArea: '' };
  const hasVoice = !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  sheet(() => `<h2>Get it out of your head</h2><p class="mut small">No need to organise it. Drop it in and sort it later.</p>
    <div class="row" style="margin-top:12px;flex-wrap:nowrap"><input type="text" id="capIn" data-f="cap" placeholder="What's on your mind?" autocomplete="off" enterkeyhint="done" style="flex:1">
    ${hasVoice ? '<button class="btn" data-act="voice" aria-label="Speak">🎤</button>' : ''}</div>
    <p class="mut small" style="margin-top:12px">Optional: which part of life?</p>
    <div style="margin-top:6px">${chips('capArea', areaOpts(true), F.capArea)}</div>
    <div class="row"><button class="btn pri" data-act="saveCap">Add to inbox</button><button class="btn ghost" data-act="closeSheet">Done</button></div>`);
  setTimeout(() => { const i = $('#capIn'); if (i) i.focus(); }, 60);
}
function saveCap() {
  const text = String(F.cap || '').trim(); if (!text) return;
  put('inbox', { id: uid(), text, area: F.capArea || '', at: Date.now() });
  F.cap = ''; const i = $('#capIn'); if (i) { i.value = ''; i.focus(); }
  toast('Captured. Your head is lighter.'); if (!sheetFn) render(); else renderNav();
}
function startVoice() {
  const R = window.SpeechRecognition || window.webkitSpeechRecognition; if (!R) return;
  const r = new R(); r.lang = navigator.language || 'en-US'; r.interimResults = false;
  r.onresult = e => { const t = e.results[0][0].transcript; const i = $('#capIn'); if (i) { i.value = (i.value ? i.value + ' ' : '') + t; F.cap = i.value; } };
  r.onerror = () => toast('Could not hear that. Try the keyboard mic.');
  try { r.start(); toast('Listening…'); } catch { /* already listening */ }
}
function guess(text) {
  const l = text.toLowerCase(), t = today(), g = { area: '', due: '', hard: false, people: PEOPLE_RX.test(l) };
  for (const a of live('areas')) if (a.name.length > 1 && l.includes(a.name.toLowerCase())) { g.area = a.id; break; }
  if (!g.area) for (const a of live('areas')) { const w = a.name.toLowerCase().split(/\s+/)[0]; if (w.length > 3 && new RegExp('\\b' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b').test(l)) { g.area = a.id; break; } }
  if (/\b(today|asap|urgent)\b/.test(l)) g.due = t;
  else if (/\btomorrow\b/.test(l)) g.due = addD(t, 1);
  else if (/\bnext week\b/.test(l)) g.due = addD(t, 7);
  else ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'].forEach((n, i) => { if (new RegExp('\\b' + n + '\\b').test(l)) { let d = addD(t, 1); while (parse(d).getDay() !== i) d = addD(d, 1); g.due = d; } });
  if (g.due && /(deadline|due|must|submit|file|pay)/.test(l)) g.hard = true;
  return g;
}
const inboxItems = () => live('inbox').sort((a, b) => (a.skip || 0) - (b.skip || 0) || a.at - b.at);

// ───────────────────────── views
function renderNav() {
  const n = live('inbox').length;
  const tabs = [['today', '☀', 'Today'], ['inbox', '✉', 'Inbox'], ['plan', '☰', 'Plan'], ['money', (S.settings.cur || '$').slice(0, 1), 'Money'], ['more', '⋯', 'More']];
  $('#nav').innerHTML = tabs.map(([k, g, l]) => `<button class="${ui.tab === k ? 'on' : ''}" data-act="tab" data-v="${k}" ${ui.tab === k ? 'aria-current="page"' : ''}><b>${esc(g)}</b>${l}${k === 'inbox' && n ? `<span class="dot">${n}</span>` : ''}</button>`).join('');
}
function render() {
  const th = dev.theme === 'auto' ? '' : dev.theme;
  if (th) document.documentElement.dataset.theme = th; else delete document.documentElement.dataset.theme;
  if (!S.settings.onboarded) { $('#nav').innerHTML = ''; $('#fab').hidden = true; $('#view').innerHTML = vWizard(); return; }
  $('#fab').hidden = false;
  renderNav();
  $('#view').innerHTML = ({ today: vToday, inbox: vInbox, plan: vPlan, money: vMoney, more: vMore })[ui.tab]();
}
function metaTags(it) {
  return `${it.area ? `<span class="tag">${areaDot(it.area)}${esc(areaName(it.area))}</span>` : ''}<span class="tag">⏱ ${it.size} min</span>${it.people ? '<span class="tag">👥 people</span>' : ''}${it.hard ? `<span class="tag hardt">⚑ ${esc(it.due ? nice(it.due) : 'deadline')}</span>` : ''}${it.quest ? '<span class="tag">✦ quest</span>' : ''}`;
}

// Today: the fixed frame. Sections always appear in this order.
function vToday() {
  const t = today(), P = pool(), wins = live('wins').filter(w => w.day === t).length, hr = new Date().getHours();
  const greet = hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening';
  let h = `<header class="top"><h1>${greet}${S.settings.name ? ', ' + esc(S.settings.name) : ''}</h1>
    <p class="mut">${new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })} · ${wins ? `${wins} win${wins > 1 ? 's' : ''} today` : 'a fresh start'}</p></header>`;
  h += sectCheckin();
  h += sectWelcome();
  h += sectTimeline();
  h += sectHeadsUp();
  h += sectNext(P);
  const nIn = live('inbox').length;
  if (nIn && dev.basics !== t) h += `<button class="banner" data-act="tab" data-v="inbox"><b>${nIn} thing${nIn > 1 ? 's' : ''} in your inbox.</b> About ${Math.max(1, Math.round(nIn * 0.4))} min to sort, whenever suits.</button>`;
  if (dev.basics !== t) h += sectQuest();
  const up = upcoming(P.slice(0, 4).map(x => x.id));
  if (up.length) h += `<h3>Not forgotten: coming up</h3><div class="list">${up.map(u => `<div class="item"><span class="dotc" style="--c:${areaColor(u.area)}"></span><div class="grow"><div class="t">${esc(u.title)}</div><div class="m">${nice(u.due)}</div></div></div>`).join('')}</div>`;
  h += sectBoosts();
  return h;
}
function sectCheckin() {
  const t = today(), c = cycleInfo(), cap = capacity(), s = dev.scan && dev.scan.d === t ? dev.scan : null;
  const cyc = c ? `<p class="cyc">◐ ${esc(c.label)}${c.note ? `. ${esc(c.note)}` : ''}</p>` : '';
  if (!s) {
    const d = ui.scan;
    return `<section class="card soft"><p class="q">Quick body check <span class="mut small">(about 5 seconds)</span></p>
      ${SCANQ.map(([k, q, opts]) => `<div class="scanrow"><span>${q}</span><div class="chips">${opts.map(([v, l]) => `<button class="chip sm${d[k] === v ? ' on' : ''}" data-act="scan" data-k="${k}" data-v="${v}">${l}</button>`).join('')}</div></div>`).join('')}
      <div class="row"><button class="btn pri" data-act="scanDone">Done</button><button class="btn ghost" data-act="scanSkip">Skip today</button></div>${cyc}</section>`;
  }
  const stale = s.at && Date.now() - s.at > 4 * 3600e3;
  return `<div class="capline"><span class="cap cap-${cap.lvl}">${cap.known ? `Capacity: ${CAP[cap.lvl]}` : 'Capacity: not checked'}</span>
    ${cap.why.length ? `<span class="mut small">${esc(cap.why.join(', '))}</span>` : ''}
    <button class="btn sm ghost" data-act="rescan">${stale ? 'Been a while. Check in again?' : 'Check in again'}</button>
    ${dev.basics === t ? '<button class="btn sm" data-act="basicsOff">Back to a normal day</button>' : '<button class="btn sm ghost" data-act="basicsOn">Basics only today</button>'}</div>${cyc}`;
}
function sectWelcome() {
  const t = today(), cap = capacity();
  if (dev.basics === t) return `<section class="card soft"><p class="q">Basics-only day</p><p class="mut small">Only your body, essentials and anything that would cause real damage if missed. Everything else is safely waiting. This counts as a full day.</p></section>`;
  if (ui.welcomeDismissed) return '';
  if (ui.gap >= 2) return `<section class="card soft"><p class="q">Welcome back.</p><p class="mut small">No catch-up needed. Everything rolled forward quietly while you were away. Want to ease in with a basics-only day?</p>
    <div class="row"><button class="btn pri" data-act="basicsOn">Basics only</button><button class="btn" data-act="welcomeOk">Normal day</button></div></section>`;
  if (cap.known && cap.n <= 0.5) return `<section class="card soft"><p class="q">Sounds like a low-capacity day.</p><p class="mut small">Switching to basics only is a smart move, not giving up.</p>
    <div class="row"><button class="btn pri" data-act="basicsOn">Basics only</button><button class="btn ghost" data-act="welcomeOk">I'm OK</button></div></section>`;
  return '';
}
function sectTimeline() {
  const d = S.settings.day, a = tmin(d.start), z = Math.max(a + 60, tmin(d.end)), span = z - a;
  const pc = m => Math.min(100, Math.max(0, (m - a) / span * 100)), nm = nowMin(), ev = eventsOn(today());
  const segs = [['Morning', a, tmin(d.work), 'am'], ['Work', tmin(d.work), tmin(d.workEnd), 'mid'], ['Evening', tmin(d.workEnd), z, 'pm']];
  const cur = blockNow();
  return `<section class="tl" aria-label="Today's timeline">
    <div class="tlbar">${segs.map(([l, s, e, c]) => `<div class="seg seg-${c}${c === cur ? ' cur' : ''}" style="left:${pc(s)}%;width:${pc(e) - pc(s)}%"><span>${l}</span></div>`).join('')}
    ${ev.map(e => { const s = tmin(e.start), en = e.end ? tmin(e.end) : s + 60; return `<div class="ev" style="left:${pc(s)}%;width:${Math.max(2, pc(en) - pc(s))}%"></div>`; }).join('')}
    ${nm >= a && nm <= z ? `<div class="now" style="left:${pc(nm)}%" aria-label="Now"></div>` : ''}</div>
    <div class="tlx mut small"><span>${fmtT(d.start)}</span><span>${fmtT(d.end)}</span></div>
    <div class="evlist">${ev.map(e => `<button class="evi${tmin(e.start) < nm ? ' past' : ''}" data-act="editEvent" data-id="${e.id}"><b>${fmtT(e.start)}</b> ${esc(e.title)}</button>`).join('')}<button class="evi add" data-act="newEvent">+ Fixed event</button></div></section>`;
}
function sectHeadsUp() {
  const nx = nextEvent(); if (!nx) return '';
  const { e, mins, buffer } = nx, wrap = mins - buffer;
  if (mins <= 45) return `<section class="card warn"><p class="q">Heads-up: ${esc(e.title)} at ${fmtT(e.start)}, in ${mins} min.</p><p class="small">${wrap > 0 ? `Start wrapping up in about ${wrap} min.` : 'Time to start wrapping up and getting ready.'}</p></section>`;
  if (mins <= 240) return `<section class="card soft"><p class="q">${esc(e.title)} at ${fmtT(e.start)}</p><p class="small mut">You have about ${Math.max(0, wrap)} minutes before you need to get ready. The suggestions below are things that fit, so the waiting doesn't eat your day.</p></section>`;
  return '';
}
function sectNext(P) {
  const mode = dev.mode === 'three' ? 'three' : 'one';
  let h = `<div class="modebar"><span class="mut small">How do you want to choose?</span><div class="seg2" role="group">
    <button class="${mode === 'one' ? 'on' : ''}" data-act="mode" data-v="one">Pick for me</button><button class="${mode === 'three' ? 'on' : ''}" data-act="mode" data-v="three">Show me 3</button></div></div>`;
  if (mode === 'three' && !ui.chosen && P.length) {
    h += `<div class="opts">${P.slice(0, 3).map(it => `<button class="card opt" data-act="choose" data-id="${it.id}"><div class="t">${esc(it.title)}</div><div class="m">${metaTags(it)}</div>${it.why[0] ? `<p class="why">${esc(it.why[0])}</p>` : ''}<span class="go">Choose this →</span></button>`).join('')}</div>
      <p class="mut small">None of these? That's fine. <button class="link" data-act="backlog">Something small from the backlog</button></p>`;
    return h;
  }
  const it = mode === 'three' && ui.chosen ? P.find(x => x.id === ui.chosen) || P[0] : P[0];
  h += hero(it, mode === 'three' && !!ui.chosen);
  if (mode === 'one' && P.length > 1) {
    h += `<h3>Also in reach, if you'd like</h3><div class="list">${P.slice(1, 4).map(x => `<div class="item"><button class="tick" data-act="doneItem" data-kind="${x.kind}" data-id="${x.id}" aria-label="Mark done">✓</button>
      <button class="grow" data-act="openItem" data-kind="${x.kind}" data-id="${x.id}"><div class="t">${esc(x.title)}</div><div class="m">${x.area ? esc(areaName(x.area)) + ' · ' : ''}${x.size} min${x.why[0] ? ' · ' + esc(x.why[0]) : ''}</div></button></div>`).join('')}</div>`;
    if (P.length > 4) h += `<p class="mut small" style="margin-top:8px">${P.length - 4} more are safely waiting. Hidden on purpose so it's not overwhelming.</p>`;
  }
  return h;
}
function upcoming(skip) {
  const t = today(), end = addD(t, 7), out = [];
  for (const k of live('tasks')) if (!k.done && k.hard && k.due > t && k.due <= end && !skip.includes(k.id)) out.push({ title: k.title, due: k.due, area: k.area });
  for (const b of live('bills')) if (!b.paid && b.dir === 'out' && b.due > addD(t, 3) && b.due <= end) out.push({ title: `Pay ${b.name} (${money(b.amount)})`, due: b.due, area: b.area });
  return out.sort((a, b) => a.due.localeCompare(b.due)).slice(0, 4);
}
function sectQuest() {
  const Q = live('tasks').filter(k => k.quest && !k.done && !paused(k.area));
  if (!Q.length) return '';
  const q = Q.sort((a, b) => a.id.localeCompare(b.id))[hashStr(today()) % Q.length];
  return `<h3>Side quest of the day (optional)</h3><section class="card quest"><div class="t">✦ ${esc(q.title)}</div>${q.reward ? `<p class="small" style="margin-top:4px">Reward: <b>${esc(q.reward)}</b></p>` : ''}
    <div class="row"><button class="btn sm" data-act="sprint" data-m="10" data-kind="task" data-id="${q.id}">▶ 10 min</button><button class="btn sm" data-act="doneItem" data-kind="task" data-id="${q.id}">✓ Quest done</button></div></section>`;
}
function sectBoosts() {
  const B = live('boosts'); if (!B.length) return '';
  const seed = hashStr(today() + (ui.boostSeed || 0)), pickN = [...B].sort((a, b) => (hashStr(a.id + seed) % 97) - (hashStr(b.id + seed) % 97)).slice(0, 3);
  return `<h3>Dopamine menu</h3><div class="chips">${pickN.map(b => `<button class="chip" data-act="boost" data-id="${b.id}">✿ ${esc(b.title)}</button>`).join('')}<button class="chip" data-act="shuffleBoost">↻ Others</button></div>`;
}
function hero(it, fromThree) {
  if (!it) return `<section class="card hero empty"><h2>Nothing pressing right now.</h2><p class="mut" style="margin-top:6px">That's allowed. Rest, or pull one small thing from your backlog if you want to.</p>
    <div class="row"><button class="btn pri" data-act="backlog">Something small</button><button class="btn" data-act="capture">Capture a thought</button></div></section>`;
  const ns = (it.steps || []).find(s => !s.done);
  const firstLine = ns ? ns.t : (it.first || 'Open it and just look at it for 2 minutes. No pressure to finish.');
  const rec = it.size <= 5 ? 5 : it.size <= 10 ? 10 : 15;
  let btns;
  if (it.kind === 'task') btns = `<div class="chips"><span class="mut small">Sprint:</span>${[5, 10, 15].map(m => `<button class="btn sm${m === rec ? ' pri' : ''}" data-act="sprint" data-m="${m}" data-kind="task" data-id="${it.id}">▶ ${m}</button>`).join('')}<span class="mut small">min</span></div>
      <div class="row"><button class="btn" data-act="sprint" data-m="2" data-just="1" data-kind="task" data-id="${it.id}">Just 2 minutes</button><button class="btn" data-act="doneItem" data-kind="task" data-id="${it.id}">✓ Done</button>
      <button class="btn ghost" data-act="notNow" data-kind="task" data-id="${it.id}">Not now</button><button class="btn ghost" data-act="steps" data-id="${it.id}">Smaller steps</button></div>`;
  else if (it.kind === 'bill') btns = `<div class="row"><button class="btn pri" data-act="doneItem" data-kind="bill" data-id="${it.id}">✓ I've paid it</button><button class="btn ghost" data-act="notNow" data-kind="bill" data-id="${it.id}">Not now</button><button class="btn ghost" data-act="tab" data-v="money">Open money</button></div>`;
  else if (it.kind === 'body') btns = `<div class="row"><button class="btn pri" data-act="doneItem" data-kind="body" data-id="${it.id}">✓ Done</button><button class="btn ghost" data-act="notNow" data-kind="body" data-id="${it.id}">Later</button></div>`;
  else btns = `<div class="row"><button class="btn pri" data-act="doneItem" data-kind="chase" data-id="${it.id}">✓ I followed up</button><button class="btn" data-act="received" data-id="${it.id}">It arrived</button><button class="btn ghost" data-act="notNow" data-kind="chase" data-id="${it.id}">Not now</button></div>`;
  const stepsHtml = it.kind === 'task' && it.steps.length ? `<div>${it.steps.map(s => `<div class="step${s.done ? ' done' : ''}"><button class="tick${s.done ? ' done' : ''}" data-act="toggleStep" data-id="${it.id}" data-sid="${s.id}" aria-label="Toggle step">${s.done ? '✓' : ''}</button><span>${esc(s.t)}</span></div>`).join('')}</div>` : '';
  return `<section class="card hero"><div class="lbl">${fromThree ? 'You chose' : it.kind === 'body' ? 'First, your body' : 'An idea for now'}</div><div class="title">${esc(it.title)}</div><div>${metaTags(it)}</div>
    ${it.kind === 'task' ? `<div class="first"><b>${ns ? 'Next step' : 'Start by'}</b>${esc(firstLine)}</div>` : ''}${stepsHtml}
    ${it.why.length ? `<p class="why">${esc(it.why.join(' · '))}</p>` : ''}${btns}
    ${fromThree ? '<div class="row"><button class="link" data-act="unchoose">← Back to the 3 options</button></div>' : ''}</section>`;
}

function vInbox() {
  const items = inboxItems();
  if (!items.length) return `<header class="top"><h1>Inbox</h1></header><section class="card hero empty"><h2>Inbox is clear.</h2><p class="mut" style="margin-top:6px">Your head is lighter. Anything new? Tap + and drop it in.</p></section>`;
  const it = items[0];
  if (F._inb !== it.id) {
    const g = guess(it.text);
    F = { _inb: it.id, area: it.area || g.area, due: g.due, hard: g.hard, size: 10, people: g.people };
  }
  return `<header class="top"><h1>Inbox</h1><p class="mut">${items.length} to sort · one at a time</p></header>
  <section class="card hero"><div class="lbl">Sort this</div><div class="title">${esc(it.text)}</div>
    ${field('Where does it belong?', chips('area', areaOpts(true), F.area))}
    ${field('When?', chips('due', [[today(), 'Today'], [addD(today(), 1), 'Tomorrow'], [weekEnd(), 'This week'], ['', 'Someday']], F.due))}
    <div style="margin-top:8px">${bindIn('due', F.due, 'date')}</div>${cycleHint(F.due)}
    ${F.due ? check('hard', F.hard, 'Hard deadline (someone is counting on it)') : ''}
    ${field('How long for a first go?', chips('size', SIZES.slice(0, 4), F.size))}
    ${check('people', F.people, 'Involves people')}
    <div class="row"><button class="btn pri" data-act="triage" data-id="${it.id}">Save as task</button><button class="btn" data-act="skipInbox" data-id="${it.id}">Skip for now</button><button class="btn ghost" data-act="dropInbox" data-id="${it.id}">Not needed</button></div></section>`;
}

function taskRow(k) {
  const d = k.due ? diff(k.due, today()) : null;
  return `<div class="item"><button class="tick${k.done ? ' done' : ''}" data-act="${k.done ? 'undo' : 'doneItem'}" data-kind="task" data-id="${k.id}" aria-label="${k.done ? 'Undo' : 'Mark done'}">${k.done ? '✓' : ''}</button>
    <button class="grow" data-act="editTask" data-id="${k.id}"><div class="t">${k.quest ? '✦ ' : ''}${esc(k.title)}</div>
    <div class="m">${areaDot(k.area)} ${esc(areaName(k.area))}${k.due ? ' · ' + (k.hard ? '⚑ ' : '') + (d < 0 && !k.hard ? 'rolling forward' : nice(k.due)) : ''} · ${k.size} min${k.people ? ' · 👥' : ''}${k.repeat ? ' · repeats' : ''}${paused(k.area) ? ' · <span class="pill">paused</span>' : ''}</div></button></div>`;
}
function vPlan() {
  const t = today(), A = ui.area;
  const tasks = live('tasks').filter(k => A === 'all' || k.area === A), open = tasks.filter(k => !k.done);
  const grp = [['Now', k => k.due && k.due <= t], ['This week', k => k.due && k.due > t && k.due <= addD(t, 7)], ['Later', k => k.due && k.due > addD(t, 7)], ['Backlog (no date)', k => !k.due]];
  const byDue = (a, b) => (a.due || '').localeCompare(b.due || '') || (a.created || 0) - (b.created || 0);
  const done = tasks.filter(k => k.done).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0)).slice(0, 6);
  const ev = [];
  for (let i = 0; i < 14; i++) { const d = addD(t, i); eventsOn(d).forEach(e => ev.push({ e, d })); }
  return `<header class="top"><h1>Plan</h1><p class="mut">Everything, by area. Today only shows what's next.</p></header>
  <div class="chips tight"><button class="chip${A === 'all' ? ' on' : ''}" data-act="areaFilter" data-v="all">All</button>${areaList().map(a => `<button class="chip${A === a.id ? ' on' : ''}" data-act="areaFilter" data-v="${a.id}"><span class="dotc" style="--c:${a.color}"></span>${esc(a.name)}</button>`).join('')}</div>
  <div class="row" style="margin:0 0 4px"><button class="btn pri" data-act="newTask">+ New task</button><button class="btn" data-act="newEvent">+ Fixed event</button></div>
  ${grp.map(([l, f]) => { const L = open.filter(f).sort(byDue); return L.length ? `<h3>${l} (${L.length})</h3><div class="list">${L.map(taskRow).join('')}</div>` : ''; }).join('') || '<p class="mut" style="margin-top:16px">Nothing here yet. Tap + New task, or drop thoughts in with the + button.</p>'}
  ${A === 'all' && ev.length ? `<h3>Fixed events, next 2 weeks</h3><div class="list">${ev.slice(0, 12).map(({ e, d }) => `<div class="item"><span class="dotc" style="--c:${areaColor(e.area)}"></span><button class="grow" data-act="editEvent" data-id="${e.id}"><div class="t">${esc(e.title)}</div><div class="m">${nice(d)} · ${fmtT(e.start)}${e.weekly ? ' · weekly' : ''}</div></button></div>`).join('')}</div>` : ''}
  ${done.length ? `<h3>Recently done</h3><div class="list">${done.map(taskRow).join('')}</div>` : ''}`;
}

function billRow(b) {
  const d = diff(b.due, today());
  return `<div class="item"><button class="tick" data-act="payBill" data-id="${b.id}" aria-label="${b.dir === 'out' ? 'Mark paid' : 'Mark received'}">✓</button>
    <button class="grow" data-act="editBill" data-id="${b.id}"><div class="t">${esc(b.name)}</div><div class="m">${areaDot(b.area)} ${esc(areaName(b.area))} · ${d < 0 ? 'was due ' + nice(b.due) : 'due ' + nice(b.due).toLowerCase()}${b.repeat ? ' · repeats' : ''}</div></button>
    <span class="amt">${money(b.amount)}</span></div>`;
}
function vMoney() {
  const m = moneyCalc(), B = live('bills').filter(b => !b.paid).sort((a, b) => a.due.localeCompare(b.due));
  const out = B.filter(b => b.dir === 'out'), inc = B.filter(b => b.dir === 'in');
  const msg = m.safe < 0
    ? `You're about <b>${money(-m.safe)}</b> short for the next 14 days. That's information, not a verdict. Options: follow up on money owed to you${m.owed ? ` (${money(m.owed)} is waiting)` : ''}, ask to delay a non-urgent bill, or pause extra spending this week.`
    : 'After bills due in the next 14 days and your tax pot, this is yours to spend. Leaving some unspent builds a buffer, which makes surprises much less scary.';
  const byArea = areaList().map(a => ({ a, o: sum(out.filter(b => b.area === a.id)), i: sum(inc.filter(b => b.area === a.id)) })).filter(x => x.o || x.i);
  return `<header class="top"><h1>Money</h1><p class="mut">A simple picture. No daily logging.</p></header>
  <section class="card ${m.safe < 0 ? 'warn' : 'soft'}"><div class="mut small">Safe to spend (next 14 days)</div><div class="big">${money(m.safe)}</div><p style="margin-top:8px">${msg}</p>
    <div class="kv small" style="margin-top:10px"><span>Cash you have now</span><b>${money(m.cash)}</b></div>
    <div class="kv small"><span>− Set aside for tax</span><b>${money(m.pot)}</b></div>
    <div class="kv small"><span>− Bills due in 14 days</span><b>${money(m.dueOut)}</b></div>
    <div class="row"><button class="btn sm" data-act="cashSheet">Update my cash</button><button class="btn sm" data-act="taxSheet">Tax pot</button></div></section>
  <div class="row" style="margin-top:0"><button class="btn pri" data-act="newBill" data-dir="out">+ Bill to pay</button><button class="btn" data-act="newBill" data-dir="in">+ Money coming in</button></div>
  <h3>You owe (${out.length})</h3>${out.length ? `<div class="list">${out.map(billRow).join('')}</div>` : '<p class="mut small">Nothing added. Add your regular bills once and they repeat by themselves.</p>'}
  <h3>Owed to you (${inc.length})</h3>${inc.length ? `<div class="list">${inc.map(billRow).join('')}</div>` : '<p class="mut small">No invoices or income tracked.</p>'}
  ${byArea.length ? `<h3>By area</h3><div class="list">${byArea.map(x => `<div class="item"><span class="dotc" style="--c:${x.a.color}"></span><div class="grow t">${esc(x.a.name)}</div><div class="m" style="text-align:right">owe ${money(x.o)}<br>owed ${money(x.i)}</div></div>`).join('')}</div>` : ''}
  <h3>Money basics</h3>
  <details class="card"><summary>1. Know one number</summary><p class="mut">"Safe to spend" is cash minus what's already spoken for. If you only look at one thing, look at that.</p></details>
  <details class="card"><summary>2. Set tax money aside the moment you're paid</summary><p class="mut">Business income isn't all yours. Steady sets aside a percentage (${S.settings.taxPct}%) each time you mark a business payment as received. Ask an accountant what percentage is right where you live.</p></details>
  <details class="card"><summary>3. Bills first, wants second</summary><p class="mut">Put every regular bill in once. Marking it paid rolls it to the next due date automatically.</p></details>
  <details class="card"><summary>4. Build a small buffer</summary><p class="mut">Even one week of bills sitting untouched makes surprises far less scary. Unspent "safe to spend" is a good place to start.</p></details>
  <details class="card"><summary>5. Keep business and personal money separate</summary><p class="mut">Separate accounts make tax time, and this screen, much simpler.</p></details>
  <p class="mut small">General information to help you get organised, not financial or tax advice. For decisions about tax, debt or investing, talk to a qualified professional.</p>`;
}

function vMore() {
  const items = [['body', 'Body & cycle', 'Check-ins, cycle tracking, rough days'], ['boosts', 'Dopamine menu', 'Your quick pick-me-ups'], ['wins', 'Wins', 'Everything you got done'],
    ['reset', 'Weekly reset', 'Five-minute guided look at the week'], ['areas', 'Businesses & areas', 'Add, rename, pause'], ['settings', 'Settings', 'Your day, quiet hours, theme'],
    ['backup', 'Backup & Google Drive sync', 'Keep phone and desktop in step'], ['ics', 'Export deadline reminders (.ics)', 'Let your phone calendar do the nagging'], ['help', 'Install & tips', 'Put Steady on your home screen']];
  return `<header class="top"><h1>More</h1></header><div class="list menu">${items.map(([k, t, s]) => `<div class="item" data-act="more" data-v="${k}" tabindex="0" role="button"><div class="grow"><div class="t">${t}</div><div class="m">${s}</div></div><span class="mut">›</span></div>`).join('')}</div>`;
}

// ───────────────────────── More: sub-sheets
function bodySheet() {
  const c = S.settings.cycle;
  F = { cycOn: c.on, cycLen: c.len, cycStart: '' };
  sheet(() => {
    const ci = cycleInfo(), starts = [...(S.settings.cycle.starts || [])].sort().reverse().slice(0, 4);
    return `<h2>Body & cycle</h2>
    <div class="row"><button class="btn pri" data-act="rescan">Do a body check now</button><button class="btn" data-act="roughDay">${dev.rough === today() ? 'Rough day logged ✓' : 'Log a rough hormonal day'}</button></div>
    <h3>Cycle-aware planning</h3>
    <p class="mut small">Stored only on your devices (and your own Drive if you sync). Steady lowers expectations on harder days and warns when you plan deadlines into them.</p>
    ${check('cycOn', F.cycOn, 'Track my cycle')}
    ${F.cycOn ? `${ci ? `<div class="card soft"><b>${esc(ci.label)}</b>${ci.note ? `<p class="small" style="margin-top:4px">${esc(ci.note)}</p>` : ''}</div>` : ''}
      <div class="row"><button class="btn" data-act="periodToday">My period started today</button></div>
      ${field('Or log a past start date', bindIn('cycStart', F.cycStart, 'date'))}
      ${field('Typical cycle length (days); it adjusts as you log', bindIn('cycLen', F.cycLen, 'number', 'min="18" max="45" style="max-width:120px"'))}
      ${starts.length ? `<p class="mut small" style="margin-top:10px">Logged starts: ${starts.map(s => nice(s)).join(', ')} <button class="link" data-act="undoPeriod">Remove latest</button></p>` : ''}` : ''}
    <p class="mut small" style="margin-top:12px">Phases are estimates and everyone's pattern is different. This isn't medical advice.</p>
    <div class="row"><button class="btn pri" data-act="saveBody">Save</button><button class="btn ghost" data-act="closeSheet">Close</button></div>`;
  });
}
function boostsSheet() {
  F = { boost: '' };
  sheet(() => `<h2>Dopamine menu</h2><p class="mut small">Quick, healthy pick-me-ups for between tasks. Three show up on Today, rotating.</p>
    <div class="list" style="margin-top:12px">${live('boosts').map(b => `<div class="item"><div class="grow t">✿ ${esc(b.title)}</div><button class="btn sm ghost" data-act="delBoost" data-id="${b.id}" aria-label="Remove">✕</button></div>`).join('') || '<div class="item"><div class="grow mut">Empty. Add a few things that reliably lift you.</div></div>'}</div>
    <div class="row" style="flex-wrap:nowrap"><input type="text" data-f="boost" placeholder="e.g. Dance to one song" style="flex:1"><button class="btn pri" data-act="addBoost">Add</button></div>
    <div class="row"><button class="btn ghost" data-act="closeSheet">Close</button></div>`);
}
function winsSheet() {
  sheet(() => {
    const W = live('wins').sort((a, b) => b.at - a.at), days = {};
    W.filter(w => diff(today(), w.day) < 7).forEach(w => (days[w.day] = days[w.day] || []).push(w));
    const keys = Object.keys(days).sort().reverse();
    return `<h2>Your wins</h2><p class="mut small">Only what you did. Never what you didn't.</p>
    ${keys.length ? keys.map(d => `<h3>${nice(d)} · ${days[d].length}</h3><div class="list">${days[d].map(w => `<div class="item"><span class="dotc" style="--c:${areaColor(w.area)}"></span><div class="grow t">${w.quest ? '✦ ' : ''}${esc(w.title)}</div></div>`).join('')}</div>`).join('') : '<p class="mut" style="margin-top:12px">Wins appear here as you finish things. Even tiny ones count. Eating counts.</p>'}
    <div class="row"><button class="btn" data-act="closeSheet">Close</button></div>`;
  });
}
function resetSheet() {
  F = { rs: 0 };
  sheet(() => {
    const t = today(), m = moneyCalc(), n = F.rs;
    const week = live('wins').filter(w => diff(t, w.day) < 7);
    const hardSoon = upcoming([]).concat(live('tasks').filter(k => !k.done && k.hard && k.due <= t).map(k => ({ title: k.title, due: k.due, area: k.area })));
    const cands = live('tasks').filter(k => !k.done && !paused(k.area) && (!k.due || k.due <= addD(t, 7))).sort((a, b) => (b.hard ? 1 : 0) - (a.hard ? 1 : 0) || (a.due || 'z').localeCompare(b.due || 'z')).slice(0, 12);
    const evs = []; for (let i = 0; i < 7; i++) eventsOn(addD(t, i)).forEach(e => evs.push({ e, d: addD(t, i) }));
    const hardDays = []; for (let i = 0; i < 7; i++) { const c = cycleInfo(addD(t, i)); if (c && c.hard) hardDays.push(nice(addD(t, i))); }
    const body = [
      `<h2>1 of 5 · Empty your head</h2><p class="mut">Anything still floating around? Drop it in the inbox.</p><p style="margin-top:10px">${live('inbox').length} item${live('inbox').length === 1 ? '' : 's'} waiting.</p><div class="row"><button class="btn" data-act="capture">+ Capture something</button>${live('inbox').length ? '<button class="btn" data-act="gotoInbox">Sort inbox</button>' : ''}</div>`,
      `<h2>2 of 5 · The week ahead</h2>${hardDays.length ? `<div class="card soft" style="margin-top:10px"><p class="small">◐ Gentler days this week: <b>${esc(hardDays.join(', '))}</b>. Plan less on those.</p></div>` : ''}
        <p class="mut" style="margin-top:8px">Fixed events:</p>${evs.length ? `<div class="list" style="margin-top:8px">${evs.map(({ e, d }) => `<div class="item"><span class="dotc" style="--c:${areaColor(e.area)}"></span><div class="grow"><div class="t">${esc(e.title)}</div><div class="m">${nice(d)} · ${fmtT(e.start)}</div></div></div>`).join('')}</div>` : '<p class="small">None.</p>'}
        <p class="mut" style="margin-top:12px">Hard deadlines:</p>${hardSoon.length ? `<div class="list" style="margin-top:8px">${hardSoon.map(u => `<div class="item"><span class="dotc" style="--c:${areaColor(u.area)}"></span><div class="grow"><div class="t">${esc(u.title)}</div><div class="m">${nice(u.due)}</div></div></div>`).join('')}</div>` : '<p class="small">None. A calm week.</p>'}`,
      `<h2>3 of 5 · Money check</h2><div class="card soft" style="margin-top:10px"><div class="mut small">Safe to spend (14 days)</div><div class="big">${money(m.safe)}</div></div><p class="mut small">Is your cash number roughly right? Update it if not.</p><div class="row"><button class="btn" data-act="cashSheet">Update my cash</button></div>`,
      `<h2>4 of 5 · Pick up to 3 priorities</h2><p class="mut small">Picked tasks float to the top of Today.</p><div class="list" style="margin-top:8px">${cands.map(k => `<div class="item"><button class="tick${k.pin ? ' done' : ''}" data-act="pinTask" data-id="${k.id}" aria-label="Pick">${k.pin ? '✓' : ''}</button><div class="grow"><div class="t">${esc(k.title)}</div><div class="m">${esc(areaName(k.area))}${k.due ? ' · ' + nice(k.due) : ''}</div></div></div>`).join('') || '<div class="item"><div class="grow mut">No tasks yet.</div></div>'}</div>`,
      `<h2>5 of 5 · Look what you did</h2><p style="margin-top:8px">${week.length} win${week.length === 1 ? '' : 's'} in the last 7 days.</p>${week.slice(0, 8).map(w => `<p class="mut small">✓ ${esc(w.title)}</p>`).join('')}<p style="margin-top:12px"><b>That's the reset. Go easy on yourself this week.</b></p>`,
    ][n];
    return `${body}<div class="row">${n > 0 ? '<button class="btn" data-act="rsBack">Back</button>' : ''}${n < 4 ? '<button class="btn pri" data-act="rsNext">Next</button>' : '<button class="btn pri" data-act="closeSheet">Finish</button>'}</div>`;
  });
}
function areasSheet() {
  sheet(() => `<h2>Businesses & areas</h2><p class="mut small">Pausing hides an area from Today (for example a business on hold). Nothing is deleted.</p>
    <div class="list" style="margin-top:12px">${areaList().map(a => `<div class="item"><span class="dotc" style="--c:${a.color}"></span><button class="grow" data-act="editArea" data-id="${a.id}"><div class="t">${esc(a.name)}</div><div class="m">${a.kind === 'biz' ? 'Business' : 'Personal'}${a.paused ? ' · paused' : ''}</div></button>
      <button class="btn sm" data-act="pauseArea" data-id="${a.id}">${a.paused ? 'Resume' : 'Pause'}</button></div>`).join('')}</div>
    <div class="row"><button class="btn pri" data-act="newArea" data-k="biz">+ Business</button><button class="btn" data-act="newArea" data-k="me">+ Personal area</button><button class="btn ghost" data-act="closeSheet">Close</button></div>`);
}
function areaForm(id, kind) {
  const a = id ? S.areas[id] : null;
  F = a ? { _id: id, name: a.name, color: a.color, kind: a.kind } : { name: '', color: COLORS[live('areas').length % COLORS.length], kind };
  sheet(() => `<h2>${F._id ? 'Edit' : 'New'} ${F.kind === 'biz' ? 'business' : 'area'}</h2>${field('Name', bindIn('name', F.name, 'text', 'autocomplete="off"'))}
    ${field('Colour', `<div class="chips">${COLORS.map(c => `<button class="chip${F.color === c ? ' on' : ''}" data-act="chip" data-k="color" data-v="${c}" aria-label="Colour ${c}"><span class="dotc" style="--c:${c}"></span></button>`).join('')}</div>`)}
    <div class="row"><button class="btn pri" data-act="saveArea">Save</button><button class="btn ghost" data-act="areasBack">Cancel</button>${F._id ? '<button class="btn ghost danger" data-act="delArea">Delete</button>' : ''}</div>`);
}
function eventSheet(id) {
  const e = id ? S.events[id] : null;
  F = e ? { ...e, _id: id } : { title: '', date: today(), start: '', end: '', area: '', buffer: 15, weekly: false };
  sheet(() => `<h2>${F._id ? 'Edit' : 'New'} fixed event</h2><p class="mut small">Appointments, calls, school runs: anything at a set time. Steady warns you beforehand and suggests what fits in the gap.</p>
    ${field('What is it?', bindIn('title', F.title, 'text', 'placeholder="e.g. Dentist, Client call" autocomplete="off"'))}
    ${field('Date', bindIn('date', F.date, 'date'))}
    <div class="row" style="margin-top:0"><div style="flex:1">${field('Starts', bindIn('start', F.start, 'time'))}</div><div style="flex:1">${field('Ends (optional)', bindIn('end', F.end, 'time'))}</div></div>
    ${field('Minutes I need to get ready / travel', chips('buffer', [[5, '5'], [15, '15'], [30, '30'], [45, '45'], [60, '60']], F.buffer))}
    ${field('Area', chips('area', areaOpts(true), F.area))}
    ${check('weekly', F.weekly, 'Repeats every week')}
    <div class="row"><button class="btn pri" data-act="saveEvent">Save</button><button class="btn ghost" data-act="closeSheet">Cancel</button>${F._id ? '<button class="btn ghost danger" data-act="delEvent">Delete</button>' : ''}</div>`);
}
const dayF = d => ({ d_start: d.start, d_work: d.work, d_workEnd: d.workEnd, d_end: d.end });
const dayFields = (src = F) => `<div class="grid2">${[['d_start', 'Day starts'], ['d_work', 'Work starts'], ['d_workEnd', 'Work ends'], ['d_end', 'Day winds down']].map(([k, l]) => `<div>${field(l, bindIn(k, src[k], 'time'))}</div>`).join('')}</div>`;
const dayFrom = src => ({ start: src.d_start || '07:00', work: src.d_work || '09:00', workEnd: src.d_workEnd || '17:00', end: src.d_end || '21:30' });
function settingsSheet() {
  const s = S.settings;
  F = { name: s.name, cur: s.cur, qOn: s.quiet.on, qFrom: s.quiet.from, qTo: s.quiet.to, sound: s.sound, theme: dev.theme, ...dayF(s.day) };
  sheet(() => `<h2>Settings</h2>${field('What should I call you?', bindIn('name', F.name))}${field('Currency symbol', bindIn('cur', F.cur, 'text', 'maxlength="3" style="max-width:100px"'))}
    ${field('Theme', chips('theme', [['auto', 'Match device'], ['light', 'Light'], ['dark', 'Dark plum']], F.theme))}
    <h3>The shape of your day</h3>${dayFields()}
    ${check('qOn', F.qOn, 'Quiet hours (no sounds or alerts)')}
    <div class="row" style="margin-top:0"><div style="flex:1">${field('From', bindIn('qFrom', F.qFrom, 'time'))}</div><div style="flex:1">${field('Until', bindIn('qTo', F.qTo, 'time'))}</div></div>
    ${check('sound', F.sound, 'Gentle chime when a sprint ends')}
    <div class="row"><button class="btn" data-act="askNotify">Allow notifications</button></div>
    <div class="row"><button class="btn pri" data-act="saveSettings">Save</button><button class="btn ghost" data-act="closeSheet">Cancel</button></div>`);
}
function backupSheet() {
  F = { clientId: dev.clientId || '' };
  sheet(() => `<h2>Backup & sync</h2>
    <p class="mut small" style="margin-top:6px">Your data lives on this device. Back it up, or sync phone and desktop through your own Google Drive (a private app folder nobody else can see).</p>
    <div class="row"><button class="btn" data-act="exportJson">Download backup</button><button class="btn" data-act="importJson">Restore from file</button></div>
    <input type="file" id="importFile" accept="application/json" hidden>
    <h3>Google Drive sync</h3>
    <p class="mut small">One-time setup needed: a free Google "Client ID". Steps are in SETUP.md.</p>
    ${field('Google Client ID', bindIn('clientId', F.clientId, 'text', 'placeholder="123456-abc.apps.googleusercontent.com" autocomplete="off"'))}
    <p class="small" style="margin-top:8px">${dev.driveOk ? `Connected. Last sync: ${dev.lastSync ? new Date(dev.lastSync).toLocaleString() : 'never'}` : 'Not connected yet.'} ${esc(SYNC.status)}</p>
    <div class="row"><button class="btn pri" data-act="driveConnect">${dev.driveOk ? 'Sync now' : 'Connect Google Drive'}</button>${dev.driveOk ? '<button class="btn ghost" data-act="driveOff">Disconnect</button>' : ''}<button class="btn ghost" data-act="closeSheet">Close</button></div>`);
}
function helpSheet() {
  sheet(() => `<h2>Install & tips</h2>
    <h3>Put it on your phone / desktop</h3>
    <p class="small"><b>iPhone:</b> open in Safari, then Share, then Add to Home Screen.<br><b>Android:</b> Chrome menu, then Install app.<br><b>Desktop:</b> Chrome/Edge, install icon in the address bar.</p>
    ${deferredInstall ? '<div class="row"><button class="btn pri" data-act="installApp">Install now</button></div>' : ''}
    <h3>How it works</h3>
    <p class="small">• Today always has the same sections in the same order. Only what's inside changes.<br>• Anything on your mind goes in with the <b>+</b> button. Sort it later.<br>• "Pick for me" or "Show me 3": switch whenever you like.<br>• "Not now" is always okay. It comes back later without fuss.<br>• Hard deadlines (⚑) stay visible until done.<br>• Low day? "Basics only" is a full day's work.<br>• For real alarms, export deadlines to your phone calendar.</p>
    <div class="row"><button class="btn" data-act="closeSheet">Close</button></div>`);
}

// ───────────────────────── money sheets
function billSheet(id, dir) {
  const b = id ? S.bills[id] : null;
  F = b ? { ...b, _id: id } : { dir, name: '', amount: '', due: today(), repeat: '', area: '' };
  sheet(() => `<h2>${F._id ? 'Edit' : 'Add'} ${F.dir === 'out' ? 'bill' : 'money coming in'}</h2>
    ${field('Name', bindIn('name', F.name, 'text', `placeholder="${F.dir === 'out' ? 'e.g. Phone, Rent, Insurance' : 'e.g. Invoice #12 · Acme'}" autocomplete="off"`))}
    ${field('Amount', bindIn('amount', F.amount, 'number', 'inputmode="decimal" step="0.01" min="0"'))}
    ${field(F.dir === 'out' ? 'Due date' : 'Expected date', bindIn('due', F.due, 'date'))}
    ${field('Repeats', chips('repeat', [['', 'One-off'], ['weekly', 'Weekly'], ['monthly', 'Monthly'], ['yearly', 'Yearly']], F.repeat))}
    ${field('Which area?', chips('area', areaOpts(true), F.area))}
    <div class="row"><button class="btn pri" data-act="saveBill">Save</button><button class="btn ghost" data-act="closeSheet">Cancel</button>${F._id ? '<button class="btn ghost danger" data-act="delBill">Delete</button>' : ''}</div>`);
}
function cashSheet() {
  F = { cash: S.settings.cash };
  sheet(() => `<h2>How much cash do you have right now?</h2><p class="mut small">Add up your everyday account(s). A rough number is fine. Update it whenever you remember.</p>
    ${field('Cash available', bindIn('cash', F.cash, 'number', 'inputmode="decimal" step="0.01"'))}
    <div class="row"><button class="btn pri" data-act="saveCash">Save</button><button class="btn ghost" data-act="closeSheet">Cancel</button></div>`);
}
function taxSheet() {
  F = { taxPct: S.settings.taxPct, taxPot: S.settings.taxPot, taxPaid: '' };
  sheet(() => `<h2>Tax pot</h2><p class="mut small">Money from business income that's earmarked for tax. It's still in your cash, but Steady treats it as not yours to spend. Ask your accountant what percentage fits you.</p>
    ${field('Set aside from each business payment (%)', bindIn('taxPct', F.taxPct, 'number', 'min="0" max="80"'))}
    ${field('Currently in the pot', bindIn('taxPot', F.taxPot, 'number', 'step="0.01"'))}
    ${field('I just paid some tax (amount; removes it from pot and cash)', bindIn('taxPaid', F.taxPaid, 'number', 'step="0.01" min="0"'))}
    <div class="row"><button class="btn pri" data-act="saveTax">Save</button><button class="btn ghost" data-act="closeSheet">Cancel</button></div>`);
}

// ───────────────────────── first-run wizard
let W = { step: 0, name: '', cur: '$', biz: '', ...dayF(blank().settings.day), cycOn: false, cycStart: '', cycLen: 28, routines: { am: true, pm: true, biz: true, home: true, money: true } };
const WSTEPS = 5;
function vWizard() {
  const n = W.step;
  const body = [
    `<h1>Welcome to Steady</h1><p class="mut" style="margin:6px 0 10px">A calm place for work, home, money and body. The same shape every day, one small step at a time, and it never shames you. Setup takes about two minutes.</p>
     ${field('What should I call you?', bindIn('name', W.name))}${field('Currency symbol', bindIn('cur', W.cur, 'text', 'maxlength="3" style="max-width:100px"'))}`,
    `<h1>Your businesses</h1><p class="mut" style="margin:6px 0 10px">One per line. You can add, rename or pause them any time.</p>
     <textarea data-f="biz" style="min-height:160px" placeholder="Business one&#10;Business two&#10;Business three&#10;Business four">${esc(W.biz)}</textarea>`,
    `<h1>The shape of your day</h1><p class="mut" style="margin:6px 0 10px">These make the fixed frame you'll see every day: Morning, Work, Evening. Rough times are fine.</p>${dayFields(W)}`,
    `<h1>Starter routines</h1><p class="mut" style="margin:6px 0 10px">Pre-made repeating tasks so it isn't empty. Delete anything you don't want.</p>
     ${[['am', 'Morning anchor: meds/vitamins, water, 5-minute tidy, look at Today'], ['pm', 'Evening wind-down: quick reset, phone away'], ['biz', 'Weekly for each business: follow up leads, chase invoices, content, bookkeeping'], ['home', 'Weekly home: laundry, groceries, one bigger chore'], ['money', 'Weekly money check: look at bills, update cash']].map(([k, l]) => `<label class="check"><input type="checkbox" data-r="${k}" ${W.routines[k] ? 'checked' : ''}> <span>${l}</span></label>`).join('')}`,
    `<h1>Cycle-aware planning <span class="mut small">(optional)</span></h1><p class="mut" style="margin:6px 0 10px">ADHD traits often get stronger in the premenstrual week. Steady can lower expectations then and warn you before you book deadlines into it. Private to your devices.</p>
     ${check('cycOn', W.cycOn, 'Yes, track my cycle')}
     ${W.cycOn ? `${field('When did your last period start? (rough is fine)', bindIn('cycStart', W.cycStart, 'date'))}${field('Typical cycle length in days', bindIn('cycLen', W.cycLen, 'number', 'min="18" max="45" style="max-width:120px"'))}` : ''}`,
  ][n];
  return `<div class="wiz"><p class="mut small">Step ${n + 1} of ${WSTEPS}</p>${body}<div class="row">${n > 0 ? '<button class="btn" data-act="wizBack">Back</button>' : ''}<button class="btn pri" data-act="wizNext">${n < WSTEPS - 1 ? 'Next' : 'Finish setup'}</button></div></div>`;
}
function finishWizard() {
  setSettings({
    name: W.name.trim(), cur: (W.cur || '$').trim() || '$', onboarded: true, day: dayFrom(W),
    cycle: { on: !!W.cycOn, starts: W.cycOn && W.cycStart ? [W.cycStart] : [], len: Math.min(45, Math.max(18, +W.cycLen || 28)) },
  });
  ['Home', 'Health', 'Money', 'People'].forEach(n => addArea(n, 'me'));
  const biz = W.biz.split('\n').map(x => x.trim()).filter(Boolean).slice(0, 12).map(n => addArea(n, 'biz'));
  const me = n => live('areas').find(a => a.name === n && a.kind === 'me').id;
  const mk = (title, area, o) => put('tasks', { id: uid(), created: Date.now(), done: false, title, area, size: 10, energy: 'm', anchor: 'any', hard: false, steps: [], first: '', notes: '', people: false, basic: false, ...o });
  const R = W.routines, daily = { t: 'daily' };
  if (R.am) {
    mk('Take meds / vitamins', me('Health'), { size: 5, energy: 'l', anchor: 'am', due: today(), repeat: daily, basic: true });
    mk('Drink a glass of water', me('Health'), { size: 5, energy: 'l', anchor: 'am', due: today(), repeat: daily, basic: true });
    mk('5-minute tidy of one spot', me('Home'), { size: 5, energy: 'l', anchor: 'am', due: today(), repeat: daily });
    mk('Look at Today and choose a first sprint', me('Home'), { size: 5, energy: 'l', anchor: 'am', due: today(), repeat: daily });
  }
  if (R.pm) {
    mk('Wind-down: phone away, lights low', me('Health'), { size: 5, energy: 'l', anchor: 'pm', due: today(), repeat: daily });
    mk('Quick reset: clear one surface', me('Home'), { size: 5, energy: 'l', anchor: 'pm', due: today(), repeat: daily });
  }
  if (R.biz) biz.forEach((a, i) => {
    mk('Follow up on open leads', a.id, { size: 15, anchor: 'mid', people: true, due: nextDow(1 + (i % 5)), repeat: { t: 'weekly' } });
    mk('Chase unpaid invoices', a.id, { size: 10, anchor: 'mid', people: true, due: nextDow(1 + ((i + 1) % 5)), repeat: { t: 'weekly' } });
    mk('Plan or post content', a.id, { size: 15, energy: 'h', anchor: 'mid', due: nextDow(1 + ((i + 2) % 5)), repeat: { t: 'weekly' } });
    mk('10-minute bookkeeping (receipts, categorise)', a.id, { size: 10, energy: 'l', due: nextDow(5), repeat: { t: 'weekly' } });
  });
  if (R.home) {
    mk('Laundry', me('Home'), { size: 15, energy: 'l', due: nextDow(6), repeat: { t: 'weekly' } });
    mk('Groceries', me('Home'), { size: 30, due: nextDow(6), repeat: { t: 'weekly' }, basic: true });
    mk('One bigger chore', me('Home'), { size: 30, energy: 'h', due: nextDow(0), repeat: { t: 'weekly' } });
  }
  if (R.money) mk('Money check: look at bills, update cash', me('Money'), { size: 10, due: nextDow(0), repeat: { t: 'weekly' } });
  if (!live('boosts').length) BOOSTS.forEach(([title, mins]) => put('boosts', { id: uid(), title, mins }));
  ui.tab = 'today'; render(); toast('All set. Tap + any time something pops into your head.');
}

// ───────────────────────── focus timer (with hyperfocus guard + event heads-up)
let tm = store.get(TIMERKEY), tick = null, audioCtx = null;
const saveTimer = () => store.set(TIMERKEY, tm);
const inQuiet = () => {
  const q = S.settings.quiet; if (!q.on) return false;
  const m = nowMin(), f = tmin(q.from), t = tmin(q.to);
  return f <= t ? m >= f && m < t : m >= f || m < t;
};
function startTimer(o) {
  try { audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)(); if (audioCtx.state === 'suspended') audioCtx.resume(); } catch { /* no audio */ }
  tm = { kind: o.kind, id: o.id, title: o.title, mins: o.mins, end: Date.now() + o.mins * 60000, paused: false, left: 0, done: false, just: !!o.just, brk: !!o.brk, started: Date.now(), guard: false, guarded: false, ext: 0 };
  saveTimer(); showTimer();
}
const timerLeft = () => (tm.paused || tm.guard ? tm.left : Math.max(0, tm.end - Date.now()));
function showTimer() {
  const el = $('#timer'); if (!tm) { el.hidden = true; clearInterval(tick); return; }
  el.hidden = false; el.dataset.paused = 'x'; document.body.classList.add('noscroll'); drawTimer(); clearInterval(tick); tick = setInterval(drawTimer, 500);
}
function timerNote() {
  const nx = nextEvent(); if (!nx || nx.mins > 45) return '';
  return `Heads-up: ${nx.e.title} at ${fmtT(nx.e.start)}, in ${nx.mins} min.`;
}
function drawTimer() {
  if (!tm) return;
  const el = $('#timer'), left = timerLeft();
  if (!tm.done && !tm.paused && !tm.guard && left <= 0) { tm.done = true; saveTimer(); endAlert(); el.dataset.paused = 'x'; }
  const total = tm.mins * 60000, sec = Math.ceil(left / 1000), pct = 100 - Math.min(100, left / total * 100);
  if (tm.guard) {
    if (el.dataset.paused === 'guard') return;
    el.dataset.paused = 'guard';
    const mins = Math.max(1, Math.round((Date.now() - tm.started) / 60000));
    el.innerHTML = `<div class="tt">You've been in the zone for ${mins} minute${mins === 1 ? "" : "s"}.</div><p class="mut" style="max-width:420px">Hyperfocus is a gift, and your body still has needs. Quick check before you carry on:</p>
      <div class="chips" style="justify-content:center">${['Water', 'Bathroom', 'Stretch', 'Something to eat?'].map(x => `<span class="chip">${x}</span>`).join('')}</div>
      <div class="row"><button class="btn pri" data-act="guardOk">Body's OK, keep going</button><button class="btn" data-act="tmBreak">5-minute break</button><button class="btn ghost" data-act="tmStop">Stop here</button></div>`;
    return;
  }
  if (tm.done) {
    if (el.dataset.paused === 'done') return;
    el.dataset.paused = 'done';
    const boosts = live('boosts').sort(() => Math.random() - 0.5).slice(0, 3);
    el.innerHTML = tm.brk
      ? `<div class="tt">${tm.kind === 'boost' ? 'Nice. Topped up.' : "Break's over."}</div><p class="mut">Ready for another small sprint, or done for now? Both are fine.</p><div class="row"><button class="btn pri" data-act="tmBack">Back to Today</button></div>`
      : tm.just
        ? `<div class="tt">You started. That was the hardest part.</div><p class="mut">Keep going for 10 minutes?</p><div class="row"><button class="btn pri" data-act="tmMore" data-m="10">Yes, 10 more</button><button class="btn" data-act="tmDone">✓ It's done</button><button class="btn ghost" data-act="tmStop">Stop here</button></div>`
        : `<div class="tt">Sprint complete.</div><p class="mut">${esc(tm.title)}</p><div class="row"><button class="btn pri" data-act="tmDone">✓ It's done</button><button class="btn" data-act="tmMore" data-m="5">5 more minutes</button><button class="btn" data-act="tmBreak">Short break</button><button class="btn ghost" data-act="tmStop">Stop for now</button></div>
          ${boosts.length ? `<p class="mut small" style="margin-top:8px">Break idea: ${boosts.map(b => esc(b.title)).join(' · ')}</p>` : ''}`;
    return;
  }
  const clock = $('#timer .clock');
  if (clock && el.dataset.paused === String(tm.paused)) {
    clock.textContent = `${Math.floor(sec / 60)}:${pad(sec % 60)}`; $('#timer .bar i').style.width = pct + '%';
    const n = $('#timer .tnote'); if (n) n.textContent = timerNote(); return;
  }
  el.dataset.paused = String(tm.paused);
  el.innerHTML = `<div class="mut small">${tm.kind === 'boost' ? 'Dopamine break' : tm.brk ? 'Break. Stretch, water, look away from screens' : tm.just ? 'Just begin. Two minutes only' : 'Focus sprint'}</div><div class="tt">${esc(tm.title)}</div>
    <div class="clock">${Math.floor(sec / 60)}:${pad(sec % 60)}</div><div class="bar"><i style="width:${pct}%"></i></div><p class="tnote small">${esc(timerNote())}</p>
    <div class="row"><button class="btn" data-act="tmPause">${tm.paused ? 'Resume' : 'Pause'}</button>${tm.brk ? '' : '<button class="btn" data-act="tmMore" data-m="5">+5 min</button><button class="btn" data-act="tmDone">✓ Done</button>'}<button class="btn ghost" data-act="tmStop">Stop</button></div>`;
}
function endAlert() {
  if (inQuiet()) return;
  if (S.settings.sound && audioCtx) {
    try { [523.25, 659.25, 783.99].forEach((f, i) => { const o = audioCtx.createOscillator(), g = audioCtx.createGain(), t0 = audioCtx.currentTime + i * 0.22; o.type = 'sine'; o.frequency.value = f; g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.15, t0 + 0.04); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.9); o.connect(g); g.connect(audioCtx.destination); o.start(t0); o.stop(t0 + 1); }); } catch { /* ignore */ }
  }
  if (navigator.vibrate) navigator.vibrate([120, 80, 120]);
  notify(tm.brk ? 'Break over' : 'Sprint complete');
}
function notify(body) {
  if (inQuiet() || !document.hidden || !('Notification' in window) || Notification.permission !== 'granted') return;
  try { new Notification('Steady', { body, tag: 'steady' }); } catch { /* ignore */ }
}
function endTimer() { tm = null; localStorage.removeItem(TIMERKEY); clearInterval(tick); const el = $('#timer'); el.hidden = true; el.innerHTML = ''; document.body.classList.toggle('noscroll', !!sheetFn); }

// minute ticker: keeps the timeline, heads-up and waiting mode current; nudges before events
const nudged = new Set();
setInterval(() => {
  if (!S.settings.onboarded) return;
  const nx = nextEvent();
  if (nx) for (const at of [45, 15]) {
    const key = nx.e.id + today() + at;
    if (nx.mins <= at && nx.mins > at - 2 && !nudged.has(key)) { nudged.add(key); notify(`${nx.e.title} at ${fmtT(nx.e.start)}, in ${nx.mins} min`); if (!document.hidden && !tm) toast(`Heads-up: ${nx.e.title} in ${nx.mins} min`); }
  }
  const a = document.activeElement;
  if (ui.tab === 'today' && !sheetFn && !tm && !(a && /INPUT|TEXTAREA|SELECT/.test(a.tagName))) render();
}, 60000);

// ───────────────────────── reminders export (.ics)
function exportIcs() {
  const t = today(), L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Steady//EN'];
  const ev = (title, due, id) => {
    const d = due.replace(/-/g, ''), e = addD(due, 1).replace(/-/g, '');
    L.push('BEGIN:VEVENT', `UID:${id}@steady`, `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`, `DTSTART;VALUE=DATE:${d}`, `DTEND;VALUE=DATE:${e}`, `SUMMARY:${title.replace(/[,;\n]/g, ' ')}`,
      'BEGIN:VALARM', 'TRIGGER:-PT15H', 'ACTION:DISPLAY', 'DESCRIPTION:Tomorrow', 'END:VALARM', 'BEGIN:VALARM', 'TRIGGER:PT9H', 'ACTION:DISPLAY', 'DESCRIPTION:Today', 'END:VALARM', 'END:VEVENT');
  };
  let n = 0;
  live('tasks').filter(k => !k.done && k.hard && k.due >= t).forEach(k => { ev('⚑ ' + k.title, k.due, k.id); n++; });
  live('bills').filter(b => !b.paid && b.dir === 'out' && b.due >= t).forEach(b => { ev('Pay ' + b.name + ' ' + money(b.amount), b.due, b.id); n++; });
  L.push('END:VCALENDAR');
  if (!n) return toast('No upcoming hard deadlines or bills to export yet');
  download('steady-reminders.ics', 'text/calendar', L.join('\r\n')); toast(`Exported ${n} reminder${n > 1 ? 's' : ''}. Open the file to add them to your calendar.`);
}
function download(name, type, text) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// ───────────────────────── Google Drive sync (appDataFolder, per-item last-write-wins)
const SYNC = { tok: null, exp: 0, busy: false, status: '', t: null };
function mergeIn(r) {
  if (!r || typeof r !== 'object') return;
  for (const c of COLS) for (const id in (r[c] || {})) { const x = r[c][id]; if (!S[c][id] || x.u > S[c][id].u) S[c][id] = x; }
  if (r.settings && r.settings.u > S.settings.u) S.settings = { ...S.settings, ...r.settings };
  persist(true);
}
function gisLoad() {
  return new Promise((res, rej) => {
    if (window.google && google.accounts && google.accounts.oauth2) return res();
    const s = document.createElement('script'); s.src = 'https://accounts.google.com/gsi/client'; s.onload = res; s.onerror = () => rej(new Error('Could not reach Google (offline?)')); document.head.appendChild(s);
  });
}
async function getToken(interactive) {
  if (SYNC.tok && Date.now() < SYNC.exp - 60000) return SYNC.tok;
  if (!dev.clientId) throw new Error('Add your Google Client ID first');
  await gisLoad();
  return new Promise((res, rej) => {
    const c = google.accounts.oauth2.initTokenClient({
      client_id: dev.clientId, scope: 'https://www.googleapis.com/auth/drive.appdata',
      callback: r => { if (r.error) return rej(new Error(r.error)); SYNC.tok = r.access_token; SYNC.exp = Date.now() + (r.expires_in || 3600) * 1000; res(SYNC.tok); },
      error_callback: e => rej(new Error(e.type || 'sign-in blocked')),
    });
    c.requestAccessToken({ prompt: interactive || !dev.driveOk ? 'consent' : '' });
  });
}
async function gfetch(url, opt = {}) {
  const t = await getToken(false);
  const r = await fetch(url, { ...opt, headers: { Authorization: 'Bearer ' + t, ...(opt.headers || {}) } });
  if (!r.ok) throw new Error('Drive ' + r.status);
  return r;
}
async function syncNow(interactive) {
  if (SYNC.busy) return; SYNC.busy = true; SYNC.status = 'Syncing…';
  try {
    await getToken(interactive);
    let id = dev.fileId;
    if (!id) {
      const j = await (await gfetch(`https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=${encodeURIComponent("name='steady-data.json'")}&fields=files(id)`)).json();
      id = j.files && j.files[0] && j.files[0].id;
    }
    if (id) {
      try { mergeIn(await (await gfetch(`https://www.googleapis.com/drive/v3/files/${id}?alt=media`)).json()); }
      catch (e) { if (!/404/.test(e.message)) throw e; id = null; }
    }
    const body = JSON.stringify(S);
    if (id) await gfetch(`https://www.googleapis.com/upload/drive/v3/files/${id}?uploadType=media`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body });
    else {
      const b = 'steady' + uid(), meta = JSON.stringify({ name: 'steady-data.json', parents: ['appDataFolder'] });
      const mp = `--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${b}\r\nContent-Type: application/json\r\n\r\n${body}\r\n--${b}--`;
      id = (await (await gfetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', { method: 'POST', headers: { 'Content-Type': 'multipart/related; boundary=' + b }, body: mp })).json()).id;
    }
    dev.fileId = id; dev.driveOk = true; dev.lastSync = Date.now(); saveDev(); SYNC.status = 'Synced ✓';
    if (!sheetFn && !tm) render();
  } catch (e) { SYNC.status = 'Sync issue: ' + e.message; }
  finally { SYNC.busy = false; const h = $('#sheet h2'); if (sheetFn && h && /Backup/.test(h.textContent)) backupSheet(); }
}
function scheduleSync() {
  if (!dev.driveOk || !SYNC.tok || Date.now() > SYNC.exp - 60000) return;
  clearTimeout(SYNC.t); SYNC.t = setTimeout(() => syncNow(false), 4000);
}

// ───────────────────────── events
const A = {
  tab(d) { ui.tab = d.v; window.scrollTo(0, 0); render(); },
  capture: captureSheet, closeSheet,
  chip(d) {
    F[d.k] = ['size', 'buffer'].includes(d.k) ? +d.v : d.v;
    if (d.k === 'theme') { dev.theme = d.v; saveDev(); render(); }
    if (d.k === 'due' && !d.v) F.hard = false;
    rerender();
  },
  saveCap, voice: startVoice,
  // body check
  scan(d) { ui.scan[d.k] = ui.scan[d.k] === d.v ? undefined : d.v; render(); },
  scanDone() { dev.scan = { d: today(), at: Date.now(), ...ui.scan }; ui.scan = {}; saveDev(); ui.welcomeDismissed = false; render(); toast('Thanks for checking in.'); },
  scanSkip() { dev.scan = { d: today(), at: Date.now(), skip: true }; ui.scan = {}; saveDev(); render(); },
  rescan() {
    const prev = scanToday(); ui.scan = {};
    if (prev) for (const [k] of SCANQ) if (prev[k] === 'y' || prev[k] === 'n' || prev[k] === 'ok' || prev[k] === 'low') ui.scan[k] = prev[k];
    dev.scan = null; saveDev(); closeSheet(); ui.tab = 'today'; window.scrollTo(0, 0); render();
  },
  basicsOn() { dev.basics = today(); ui.chosen = null; saveDev(); render(); toast('Basics only. That is a full day.'); },
  basicsOff() { dev.basics = ''; ui.welcomeDismissed = true; saveDev(); render(); },
  welcomeOk() { ui.welcomeDismissed = true; render(); },
  mode(d) { dev.mode = d.v; ui.chosen = null; saveDev(); render(); },
  choose(d) { ui.chosen = d.id; render(); },
  unchoose() { ui.chosen = null; render(); },
  boost(d) { const b = S.boosts[d.id]; if (b) startTimer({ kind: 'boost', id: b.id, title: b.title, mins: Math.max(1, +b.mins || 2), brk: true }); },
  shuffleBoost() { ui.boostSeed = (ui.boostSeed || 0) + 1; render(); },
  addBoost() { const t = String(F.boost || '').trim(); if (!t) return; put('boosts', { id: uid(), title: t, mins: 3 }); F.boost = ''; resheet(); render(); },
  delBoost(d) { del('boosts', d.id); resheet(); render(); },
  // items
  doneItem(d) { complete(d.kind, d.id); if (sheetFn) resheet(); },
  undo(d) { const k = S.tasks[d.id]; k.done = false; k.doneAt = null; put('tasks', k); render(); },
  notNow(d) { snooze(d.kind, d.id); },
  received(d) { markPaid(d.id); render(); },
  steps(d) { stepsSheet(d.id); },
  toggleStep(d) { const k = S.tasks[d.id]; const s = k.steps.find(x => x.id === d.sid); s.done = !s.done; put('tasks', k); render(); if (k.steps.every(x => x.done)) toast('All steps done. Mark it complete?'); },
  sprint(d) {
    const it = S.tasks[d.id]; if (!it) return;
    const ns = (it.steps || []).find(s => !s.done), title = d.just ? (ns ? ns.t : (it.first || it.title)) : it.title;
    startTimer({ kind: 'task', id: it.id, title, mins: +d.m, just: !!d.just });
  },
  backlog() {
    const c = live('tasks').filter(k => !k.done && !k.due && !paused(k.area) && (k.size || 10) <= 15);
    if (!c.length) return toast('Backlog is empty. Add something small with +');
    ui.pulled = pick(c).id; ui.chosen = dev.mode === 'three' ? ui.pulled : null; render();
  },
  openItem(d) { if (d.kind === 'task') taskSheet(d.id); else if (d.kind === 'body') complete('body', d.id); else A.tab({ v: 'money' }); },
  newTask() { taskSheet(null, ui.area !== 'all' ? { area: ui.area } : {}); },
  editTask(d) { taskSheet(d.id); },
  saveTask() { if (saveTaskFromForm()) { closeSheet(); render(); toast('Saved'); } },
  delTask() { if (confirm('Delete this task?')) { del('tasks', F._id); closeSheet(); render(); } },
  saveSteps() {
    const k = S.tasks[F._id], old = k.steps || [];
    k.steps = String(F.steps || '').split('\n').map(x => x.trim()).filter(Boolean).map(t => old.find(s => s.t === t) || { id: uid(), t, done: false });
    k.first = (F.first || '').trim(); put('tasks', k); closeSheet(); render(); toast('Smaller now. Good.');
  },
  addTiny(d) { F.steps = (F.steps ? F.steps + '\n' : '') + d.v; resheet(); },
  areaFilter(d) { ui.area = d.v; render(); },
  triage(d) {
    const it = S.inbox[d.id]; if (!it) return;
    put('tasks', { id: uid(), created: Date.now(), done: false, title: it.text, area: F.area || '', size: +F.size || 10, energy: 'm', anchor: 'any', due: F.due || '', hard: !!F.hard && !!F.due, people: !!F.people, steps: [], first: '', notes: '', pin: false, repeat: null });
    const someday = !F.due; del('inbox', d.id); F = {}; toast(someday ? 'Saved to backlog' : 'Saved'); render();
  },
  skipInbox(d) { const it = S.inbox[d.id]; it.skip = (it.skip || 0) + 1; put('inbox', it); F = {}; render(); },
  dropInbox(d) { del('inbox', d.id); F = {}; render(); },
  gotoInbox() { closeSheet(); A.tab({ v: 'inbox' }); },
  // events
  newEvent() { eventSheet(null); }, editEvent(d) { eventSheet(d.id); },
  saveEvent() {
    if (!String(F.title || '').trim() || !F.start) return toast('Add a name and a start time');
    const old = F._id ? S.events[F._id] : null;
    put('events', { ...(old || { id: uid() }), title: F.title.trim(), date: F.date || today(), start: F.start, end: F.end || '', area: F.area || '', buffer: +F.buffer || 15, weekly: !!F.weekly });
    closeSheet(); render(); toast('Saved. You\'ll get a heads-up beforehand.');
  },
  delEvent() { if (confirm('Delete this event?')) { del('events', F._id); closeSheet(); render(); } },
  // money
  newBill(d) { billSheet(null, d.dir); }, editBill(d) { billSheet(d.id); },
  saveBill() {
    if (!String(F.name || '').trim()) return toast('Add a name');
    const old = F._id ? S.bills[F._id] : null;
    put('bills', { ...(old || { id: uid(), paid: false }), dir: F.dir, name: F.name.trim(), amount: +F.amount || 0, due: F.due || today(), repeat: F.repeat || '', area: F.area || '' });
    closeSheet(); render(); toast('Saved');
  },
  delBill() { if (confirm('Delete this?')) { del('bills', F._id); closeSheet(); render(); } },
  payBill(d) { markPaid(d.id); render(); },
  cashSheet, taxSheet,
  saveCash() { setSettings({ cash: +F.cash || 0 }); closeSheet(); render(); toast('Cash updated'); },
  saveTax() {
    let pot = +F.taxPot || 0, cash = +S.settings.cash || 0; const paid = +F.taxPaid || 0;
    if (paid) { pot = Math.max(0, pot - paid); cash -= paid; }
    setSettings({ taxPct: Math.min(80, Math.max(0, +F.taxPct || 0)), taxPot: pot, cash }); closeSheet(); render(); toast('Saved');
  },
  // body & cycle
  roughDay() { dev.rough = dev.rough === today() ? '' : today(); saveDev(); resheet(); render(); if (dev.rough) toast('Logged. Expectations lowered for today.'); },
  periodToday() { const c = { ...S.settings.cycle, on: true }; c.starts = [...new Set([...(c.starts || []), today()])]; setSettings({ cycle: c }); resheet(); render(); toast('Logged. Go gently.'); },
  undoPeriod() { const c = { ...S.settings.cycle }; c.starts = [...(c.starts || [])].sort().slice(0, -1); setSettings({ cycle: c }); resheet(); render(); },
  saveBody() {
    const c = { ...S.settings.cycle, on: !!F.cycOn, len: Math.min(45, Math.max(18, +F.cycLen || 28)) };
    if (F.cycStart) c.starts = [...new Set([...(c.starts || []), F.cycStart])];
    setSettings({ cycle: c }); closeSheet(); render(); toast('Saved');
  },
  more(d) { ({ body: bodySheet, boosts: boostsSheet, wins: winsSheet, reset: resetSheet, areas: areasSheet, settings: settingsSheet, backup: backupSheet, ics: exportIcs, help: helpSheet })[d.v](); },
  rsNext() { F.rs++; resheet(); }, rsBack() { F.rs--; resheet(); },
  pinTask(d) {
    const k = S.tasks[d.id];
    if (!k.pin && live('tasks').filter(x => x.pin && !x.done).length >= 3) return toast('Three is plenty. Unpick one first.');
    k.pin = !k.pin; put('tasks', k); resheet();
  },
  newArea(d) { areaForm(null, d.k); },
  editArea(d) { areaForm(d.id); },
  areasBack: areasSheet,
  pauseArea(d) { const a = S.areas[d.id]; a.paused = !a.paused; put('areas', a); areasSheet(); render(); },
  saveArea() {
    if (!String(F.name || '').trim()) return toast('Add a name');
    if (F._id) put('areas', { ...S.areas[F._id], name: F.name.trim(), color: F.color }); else addArea(F.name.trim(), F.kind, F.color);
    areasSheet(); render();
  },
  delArea() { if (confirm('Delete this area? Its tasks stay, but lose their label.')) { del('areas', F._id); areasSheet(); render(); } },
  saveSettings() {
    setSettings({ name: (F.name || '').trim(), cur: (F.cur || '$').trim() || '$', quiet: { on: !!F.qOn, from: F.qFrom || '21:30', to: F.qTo || '07:00' }, sound: !!F.sound, day: dayFrom(F) });
    dev.theme = F.theme; saveDev(); closeSheet(); render(); toast('Saved');
  },
  askNotify() { if (!('Notification' in window)) return toast('Not supported on this device'); Notification.requestPermission().then(p => toast(p === 'granted' ? 'Notifications on' : 'Notifications stay off')); },
  exportJson() { download(`steady-backup-${today()}.json`, 'application/json', JSON.stringify(S)); toast('Backup downloaded'); },
  importJson() { const f = $('#importFile'); f.onchange = () => { const r = new FileReader(); r.onload = () => { try { mergeIn(JSON.parse(r.result)); toast('Restored and merged'); closeSheet(); render(); } catch { toast('That file did not look right'); } }; if (f.files[0]) r.readAsText(f.files[0]); }; f.click(); },
  driveConnect() { dev.clientId = (F.clientId || '').trim(); saveDev(); syncNow(true); },
  driveOff() { dev.driveOk = false; dev.fileId = ''; saveDev(); SYNC.tok = null; SYNC.status = ''; backupSheet(); },
  installApp() { if (deferredInstall) { deferredInstall.prompt(); deferredInstall = null; closeSheet(); } },
  wizNext() { if (W.step < WSTEPS - 1) { W.step++; render(); window.scrollTo(0, 0); } else finishWizard(); },
  wizBack() { W.step--; render(); },
  // timer
  tmPause() { if (tm.paused) { tm.end = Date.now() + tm.left; tm.paused = false; } else { tm.left = timerLeft(); tm.paused = true; } saveTimer(); drawTimer(); },
  tmMore(d) {
    const m = +d.m;
    tm.ext = (tm.ext || 0) + 1;
    if (!tm.guarded && !tm.brk && (Date.now() - tm.started >= 45 * 60000 || tm.ext >= 3)) { tm.left = timerLeft(); tm.guard = true; tm.pend = m; saveTimer(); drawTimer(); return; }
    if (tm.done) { tm.done = false; tm.just = false; tm.mins = m; tm.end = Date.now() + m * 60000; } else { tm.mins += m; tm.end += m * 60000; if (tm.paused) tm.left += m * 60000; }
    saveTimer(); $('#timer').dataset.paused = 'x'; drawTimer();
  },
  guardOk() {
    const m = tm.pend || 5; tm.guard = false; tm.guarded = true;
    if (tm.done || tm.left <= 0) { tm.done = false; tm.just = false; tm.mins = m; tm.end = Date.now() + m * 60000; } else { tm.mins += m; tm.end = Date.now() + tm.left + m * 60000; }
    tm.paused = false; saveTimer(); $('#timer').dataset.paused = 'x'; drawTimer();
  },
  tmDone() { const t = tm; endTimer(); if (t && t.kind === 'task') complete('task', t.id); else render(); },
  tmStop() { endTimer(); render(); },
  tmBreak() { const g = tm.guard; startTimer({ kind: 'break', id: tm.id, title: 'Take a breather', mins: g ? 5 : 3, brk: true }); },
  tmBack() { endTimer(); render(); },
};
document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]'); if (!el) return;
  const fn = A[el.dataset.act]; if (fn) { e.preventDefault(); fn(el.dataset, el); }
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && sheetFn) closeSheet();
  const el = e.target;
  if (e.key === 'Enter' && el.id === 'capIn') { e.preventDefault(); saveCap(); }
  if ((e.key === 'Enter' || e.key === ' ') && el.matches && el.matches('.menu .item')) { e.preventDefault(); el.click(); }
});
const RERENDER_ON = ['repeatT', 'quest', 'cycOn', 'due'];
const bindEvt = e => {
  const t = e.target, k = t.dataset && t.dataset.f;
  if (t.dataset && t.dataset.r) { W.routines[t.dataset.r] = t.checked; return; }
  if (!k) return;
  const v = t.type === 'checkbox' ? t.checked : t.value;
  if (!S.settings.onboarded) { W[k] = v; if (k === 'cycOn' && e.type === 'change') render(); return; }
  F[k] = v;
  if (k === 'clientId') dev.clientId = v;
  if (e.type === 'change' && RERENDER_ON.includes(k)) rerender();
};
document.addEventListener('input', bindEvt);
document.addEventListener('change', bindEvt);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { dev.lastOpen = Date.now(); saveDev(); return; }
  if (tm) drawTimer(); else if (!sheetFn && S.settings.onboarded) render();
});

let deferredInstall = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredInstall = e; });

// ───────────────────────── boot
load();
ui.gap = dev.lastOpen ? diff(today(), ymd(new Date(dev.lastOpen))) : 0;
if (tm && tm.end) showTimer();
render();
dev.lastOpen = Date.now(); saveDev();
if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => { /* offline mode unavailable */ });
if (new URLSearchParams(location.search).get('capture') && S.settings.onboarded) captureSheet();
if (dev.driveOk) syncNow(false);
