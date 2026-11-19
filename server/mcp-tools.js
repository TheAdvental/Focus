// MCP for Claude: tools over Focus data, as a JSON-RPC handler.
// One implementation, two homes: the server (data in its database) and the PC app (data in its page).
// Each home passes an adapter:
//   load()            -> { tasks: [], habits: [], sessions: [], stuck: [], timer: {...} | null }   (records as the app stores them)
//   put(col, record)  -> stores a task or habit; the record carries a fresh `u`, so it wins over older copies everywhere
//   events(from, to)  -> { configured, events: [{ date, start, end, allDay, title, location }], error? }
// Zero dependencies (plain Node 18+).
const crypto = require('crypto');

const pad = n => String(n).padStart(2, '0');
const dstr = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => dstr(new Date());
const addDays = (day, n) => { const d = new Date(day + 'T12:00'); d.setDate(d.getDate() + n); return dstr(d); };
const weekday = day => new Date(day + 'T12:00').getDay();
const DATE = /^\d{4}-\d\d-\d\d$/, TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const uid = () => crypto.randomBytes(6).toString('hex');

class UserError extends Error {}
const fail = msg => { throw new UserError(msg); };
const checkDate = (v, name) => { if (v && (!DATE.test(v) || isNaN(new Date(v + 'T12:00')))) fail(`${name} must be YYYY-MM-DD`); return v; };
const checkTime = (v, name) => { if (v && !TIME.test(v)) fail(`${name} must be HH:MM (24h)`); return v; };
function checkDays(v) {
  if (!Array.isArray(v) || !v.length) fail('days must be a non-empty list like ["mon","wed","fri"]');
  const out = v.map(d => typeof d === 'number' ? d : DAYS.indexOf(String(d).slice(0, 3).toLowerCase()));
  if (out.some(d => !(d >= 0 && d <= 6))) fail('days accepts mon, tue, wed, thu, fri, sat, sun');
  return [...new Set(out)].sort((a, b) => a - b);
}

/* ---------- habits ---------- */
// A habit is a template; on each of its days it becomes an ordinary task "h:<habit>:<date>". Devices create that task
// lazily, so when it is missing here it is worked out from the template (same fields the app would give it).
const instId = (h, day) => `h:${h.id}:${day}`;
const habitOn = (h, day) => !h.del && h.days.includes(weekday(day)) && dstr(new Date(h.created)) <= day;
function instance(d, h, day) {
  return d.tasks.find(t => t.id === instId(h, day)) || { id: instId(h, day), habitId: h.id, title: h.title, firstStep: h.mini || '', why: '',
    planDate: day, planTime: h.time || '', deadline: '', done: false, doneAt: null, mini: false, created: Date.now() };
}
function habitState(d, h, day) {
  if (!habitOn(h, day)) return 'off';
  const t = instance(d, h, day);
  if (!t.del && t.done) return t.mini ? 'minimal' : 'done';
  return day === today() ? 'pending' : day > today() ? 'upcoming' : 'missed';
}

/* ---------- views: what Claude sees ---------- */
const viewTask = t => ({ id: t.id, title: t.title, first_step: t.firstStep || '', why: t.why || '', plan_date: t.planDate || '', plan_time: t.planTime || '',
  deadline: t.deadline || '', done: !!t.done, done_at: t.doneAt ? new Date(t.doneAt).toISOString() : '', note: t.note || '' });
function viewHabit(d, h) {
  const last14 = [];
  for (let i = 13; i >= 0; i--) { const day = addDays(today(), -i), s = habitState(d, h, day); if (s !== 'off') last14.push({ date: day, state: s }); }
  return { id: h.id, title: h.title, minimal_version: h.mini || '', cue: h.cue || '', time: h.time || '', days: h.days.map(n => DAYS[n]),
    note: h.note || '', last_14_days: last14 };
}
const focusMin = (d, day) => d.sessions.filter(s => s.kind === 'focus' && dstr(new Date(s.start)) === day).reduce((a, s) => a + s.min, 0);

/* ---------- tools ---------- */
const S = (type, description, extra) => Object.assign({ type, description }, extra);
const taskFields = {
  title: S('string', 'What needs doing'),
  first_step: S('string', 'A tiny, concrete first action of 2-5 minutes, e.g. "open the handout and read the task"'),
  why: S('string', 'Why it matters to the user (optional)'),
  plan_date: S('string', 'Day to do it, YYYY-MM-DD. Empty string = unplanned'),
  plan_time: S('string', 'Start time, HH:MM 24h. The app reminds the user at this time. Empty string = no time'),
  deadline: S('string', 'YYYY-MM-DD, or empty string for none'),
  note: S('string', 'Free-text note'),
};
const habitFields = {
  title: S('string', 'What to do regularly'),
  days: S('array', 'Weekdays it repeats on', { items: { type: 'string', enum: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] } }),
  time: S('string', 'Reminder time, HH:MM 24h, or empty string for none'),
  minimal_version: S('string', 'The smallest version that still counts on a bad day, e.g. "read one page"'),
  cue: S('string', 'What it follows or where it happens, e.g. "after breakfast"'),
  note: S('string', 'Note about the habit as a whole: why, own rules'),
};
const pick = (o, keys) => Object.fromEntries(keys.filter(k => k in o).map(k => [k, o[k]]));

function makeTools(A) {
  async function task(id) {
    const d = await A.load(), t = d.tasks.find(x => x.id === id && !x.del);
    if (!t) fail(`no task with id ${id}`);
    if (t.habitId) fail('this is a habit\'s day — use mark_habit or update_habit');
    return t;
  }
  async function habit(id) {
    const d = await A.load(), h = d.habits.find(x => x.id === id && !x.del);
    if (!h) fail(`no habit with id ${id}`);
    return { d, h };
  }
  function applyTask(t, a) {
    if ('title' in a) { if (!String(a.title).trim()) fail('title cannot be empty'); t.title = String(a.title).trim(); }
    if ('first_step' in a) t.firstStep = String(a.first_step).trim();
    if ('why' in a) t.why = String(a.why).trim();
    if ('note' in a) t.note = String(a.note).trim();
    if ('plan_date' in a) t.planDate = checkDate(a.plan_date, 'plan_date');
    if ('plan_time' in a) t.planTime = checkTime(a.plan_time, 'plan_time');
    if ('deadline' in a) t.deadline = checkDate(a.deadline, 'deadline');
    if ('done' in a) { t.done = !!a.done; t.doneAt = t.done ? (t.doneAt || Date.now()) : null; }
    t.u = Date.now();
    return t;
  }
  function applyHabit(h, a) {
    if ('title' in a) { if (!String(a.title).trim()) fail('title cannot be empty'); h.title = String(a.title).trim(); }
    if ('days' in a) h.days = checkDays(a.days);
    if ('time' in a) h.time = checkTime(a.time, 'time');
    if ('minimal_version' in a) h.mini = String(a.minimal_version).trim();
    if ('cue' in a) h.cue = String(a.cue).trim();
    if ('note' in a) h.note = String(a.note).trim();
    h.u = Date.now();
    return h;
  }
  // like the app does: today's not-yet-done task of an edited or deleted habit follows the habit
  async function followHabit(d, h) {
    const day = today(), t = instance(d, h, day);
    if (t.done) return;
    const shouldExist = habitOn(h, day);
    if (!shouldExist && !d.tasks.some(x => x.id === t.id)) return; // nothing to hide
    await A.put('tasks', Object.assign({}, t, { title: h.title, firstStep: h.mini || '', planTime: h.time || '', del: !shouldExist, u: Date.now() }));
  }

  return [
    { name: 'get_schedule',
      description: 'The plan day by day: tasks planned for each day (today also lists overdue ones), habits due with their state, calendar events, focus minutes. Use it before planning so new tasks do not clash with events.',
      inputSchema: { type: 'object', properties: { from: S('string', 'YYYY-MM-DD, default today'), to: S('string', 'YYYY-MM-DD, default = from; at most 31 days') } },
      async run(a) {
        const from = checkDate(a.from, 'from') || today(), to = checkDate(a.to, 'to') || from;
        if (to < from) fail('to is before from');
        if (addDays(from, 31) <= to) fail('at most 31 days at once');
        const d = await A.load(), ev = await A.events(from, to), td = today(), days = [];
        for (let day = from; day <= to; day = addDays(day, 1)) {
          const tasks = d.tasks.filter(t => !t.del && !t.habitId && (t.planDate === day || (day === td && !t.done && t.planDate && t.planDate < td)))
            .sort((x, y) => (x.planTime || '99').localeCompare(y.planTime || '99'))
            .map(t => Object.assign(viewTask(t), t.planDate < day ? { overdue: true } : {}));
          const habits = d.habits.filter(h => habitOn(h, day)).map(h => {
            const t = instance(d, h, day);
            return { habit_id: h.id, title: h.title, time: h.time || '', minimal_version: h.mini || '', state: habitState(d, h, day), note: t.note || '' };
          });
          days.push({ date: day, weekday: DAYS[weekday(day)], tasks, habits, events: ev.events.filter(e => e.date === day),
            focus_minutes: day <= td ? focusMin(d, day) : undefined });
        }
        const timer = d.timer && d.timer.endAt > Date.now() ? { kind: d.timer.kind, task: d.timer.title, ends_at: new Date(d.timer.endAt).toISOString() } : null;
        return { today: td, days, calendar: ev.configured ? (ev.error ? 'error: ' + ev.error : 'connected') : 'not connected', running_timer: timer };
      } },

    { name: 'list_tasks',
      description: 'Tasks (not habits). By default the open ones; filter by planned day if needed.',
      inputSchema: { type: 'object', properties: {
        status: S('string', 'open (default), done or all', { enum: ['open', 'done', 'all'] }),
        from: S('string', 'Only tasks planned on or after this day, YYYY-MM-DD'), to: S('string', 'Only tasks planned on or before this day'),
        unplanned: S('boolean', 'Only tasks with no day') } },
      async run(a) {
        const st = a.status || 'open', d = await A.load();
        checkDate(a.from, 'from'); checkDate(a.to, 'to');
        return d.tasks.filter(t => !t.del && !t.habitId && (st === 'all' || (st === 'done') === !!t.done)
          && (!a.unplanned || !t.planDate) && (!a.from || (t.planDate && t.planDate >= a.from)) && (!a.to || (t.planDate && t.planDate <= a.to)))
          .sort((x, y) => ((x.planDate || '9') + (x.planTime || '')).localeCompare((y.planDate || '9') + (y.planTime || ''))).map(viewTask);
      } },

    { name: 'add_task',
      description: 'Create a task. A good task has a day, a start time and a tiny first step — propose them if the user did not give them.',
      inputSchema: { type: 'object', properties: taskFields, required: ['title'] },
      async run(a) {
        const t = applyTask({ id: 'c' + uid(), title: '', firstStep: '', why: '', planDate: '', planTime: '', deadline: '', done: false, doneAt: null, created: Date.now() }, a);
        await A.put('tasks', t);
        return viewTask(t);
      } },

    { name: 'update_task',
      description: 'Change a task: reschedule it (plan_date / plan_time), edit text, or mark it done or not done. Only the given fields change.',
      inputSchema: { type: 'object', properties: Object.assign({ id: S('string', 'Task id'), done: S('boolean', 'Mark done or not done') }, taskFields), required: ['id'] },
      async run(a) {
        const t = applyTask(Object.assign({}, await task(a.id)), pick(a, Object.keys(taskFields).concat('done')));
        await A.put('tasks', t);
        return viewTask(t);
      } },

    { name: 'delete_task',
      description: 'Delete a task. Ask the user first unless they clearly asked for it.',
      inputSchema: { type: 'object', properties: { id: S('string', 'Task id') }, required: ['id'] },
      async run(a) {
        const t = await task(a.id);
        await A.put('tasks', Object.assign({}, t, { del: true, u: Date.now() }));
        return { deleted: t.title };
      } },

    { name: 'list_habits',
      description: 'Habits (repeating tasks) with their days, time, minimal version, cue, note and the last 14 days (done / minimal / missed / pending).',
      inputSchema: { type: 'object', properties: {} },
      async run() { const d = await A.load(); return d.habits.filter(h => !h.del).map(h => viewHabit(d, h)); } },

    { name: 'add_habit',
      description: 'Create a habit: something that repeats on given weekdays. It shows up in the plan on those days and reminds at its time. A good habit has a cue and a minimal version.',
      inputSchema: { type: 'object', properties: habitFields, required: ['title'] },
      async run(a) {
        const h = applyHabit({ id: uid(), title: '', mini: '', cue: '', time: '', note: '', days: [0, 1, 2, 3, 4, 5, 6], created: Date.now() }, a);
        await A.put('habits', h);
        return viewHabit(await A.load(), h);
      } },

    { name: 'update_habit',
      description: 'Change a habit: title, weekdays, time, minimal version, cue or note. Only the given fields change. Past days keep their marks.',
      inputSchema: { type: 'object', properties: Object.assign({ id: S('string', 'Habit id') }, habitFields), required: ['id'] },
      async run(a) {
        const { d, h: cur } = await habit(a.id), h = applyHabit(Object.assign({}, cur), pick(a, Object.keys(habitFields)));
        await A.put('habits', h);
        await followHabit(d, h);
        return viewHabit(await A.load(), h);
      } },

    { name: 'delete_habit',
      description: 'Delete a habit. Its past marks stay in the statistics. Ask the user first unless they clearly asked for it.',
      inputSchema: { type: 'object', properties: { id: S('string', 'Habit id') }, required: ['id'] },
      async run(a) {
        const { d, h: cur } = await habit(a.id), h = Object.assign({}, cur, { del: true, u: Date.now() });
        await A.put('habits', h);
        await followHabit(d, h);
        return { deleted: h.title };
      } },

    { name: 'mark_habit',
      description: 'Record a habit for a day: done, minimal (only the minimal version) or not_done, and/or a note for that day. Works for past days too.',
      inputSchema: { type: 'object', properties: {
        habit_id: S('string', 'Habit id'), date: S('string', 'YYYY-MM-DD, default today'),
        state: S('string', 'Leave out to change only the note', { enum: ['done', 'minimal', 'not_done'] }), note: S('string', 'Note for that day') },
        required: ['habit_id'] },
      async run(a) {
        const day = checkDate(a.date, 'date') || today();
        if (day > today()) fail('cannot mark a day in the future');
        if (!a.state && !('note' in a)) fail('give a state, a note, or both');
        const { d, h } = await habit(a.habit_id);
        if (!habitOn(h, day)) fail(`${day} is not a day of this habit (its days: ${h.days.map(n => DAYS[n]).join(', ')})`);
        const t = Object.assign({}, instance(d, h, day), { del: false, u: Date.now() });
        if (a.state) {
          t.done = a.state !== 'not_done'; t.mini = a.state === 'minimal';
          t.doneAt = !t.done ? null : day === today() ? Date.now() : new Date(day + 'T12:00').getTime();
        }
        if ('note' in a) t.note = String(a.note).trim();
        await A.put('tasks', t);
        return { habit: h.title, date: day, state: habitState(Object.assign({}, d, { tasks: d.tasks.filter(x => x.id !== t.id).concat(t) }), h, day), note: t.note || '' };
      } },

    { name: 'get_stats',
      description: 'Progress over the last N days: focus minutes per day, tasks finished, how each habit went, and the reasons the user gave for procrastinating.',
      inputSchema: { type: 'object', properties: { days: S('number', '1-60, default 7') } },
      async run(a) {
        const n = Math.min(60, Math.max(1, Math.round(a.days || 7))), d = await A.load(), from = addDays(today(), -(n - 1)), focus = {};
        for (let i = 0; i < n; i++) { const day = addDays(from, i); focus[day] = focusMin(d, day); }
        const habits = d.habits.filter(h => !h.del).map(h => {
          const c = { done: 0, minimal: 0, missed: 0 };
          for (let i = 0; i < n; i++) { const s = habitState(d, h, addDays(from, i)); if (s in c) c[s]++; }
          return Object.assign({ title: h.title }, c);
        });
        const reasons = {};
        d.stuck.filter(s => s.at >= new Date(from + 'T00:00').getTime()).forEach(s => reasons[s.reason] = (reasons[s.reason] || 0) + 1);
        return { from, to: today(), focus_minutes_per_day: focus, focus_minutes_total: Object.values(focus).reduce((x, y) => x + y, 0),
          tasks_finished: d.tasks.filter(t => !t.del && !t.habitId && t.done && t.doneAt >= new Date(from + 'T00:00').getTime()).length,
          habits, procrastination_reasons: reasons };
      } },
  ];
}

const INSTRUCTIONS = `Focus (Фокус) is the user's anti-procrastination planner. The user writes in Ukrainian; answer in their language.
How the app wants plans to look, because this is what makes them work:
- A task gets a concrete day, a start time and a tiny first step of 2-5 minutes. At that time the app reminds the user and offers to start.
- Prefer 1-3 tasks per day over a long list.
- A habit gets a cue ("after breakfast") and a minimal version that still counts on a bad day. Missing once is fine; the app warns against missing twice in a row.
- Check get_schedule before planning a day so tasks do not clash with calendar events.
- Ask before deleting anything unless the user clearly asked for it.
Dates are YYYY-MM-DD and times HH:MM in the user's local time.`;

function createMcp(adapter, { version = '2.0.0' } = {}) {
  const tools = makeTools(adapter);
  async function one(msg) {
    if (!msg || typeof msg !== 'object') return { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'invalid request' } };
    if (msg.id === undefined) return null; // notification
    const ok = result => ({ jsonrpc: '2.0', id: msg.id, result });
    switch (msg.method) {
      case 'initialize': return ok({ protocolVersion: (msg.params && msg.params.protocolVersion) || '2025-06-18',
        capabilities: { tools: {} }, serverInfo: { name: 'focus', version }, instructions: INSTRUCTIONS });
      case 'ping': return ok({});
      case 'tools/list': return ok({ tools: tools.map(({ run, ...t }) => t) });
      case 'tools/call': {
        const tool = tools.find(t => t.name === (msg.params && msg.params.name));
        if (!tool) return { jsonrpc: '2.0', id: msg.id, error: { code: -32602, message: 'unknown tool' } };
        try { return ok({ content: [{ type: 'text', text: JSON.stringify(await tool.run((msg.params && msg.params.arguments) || {}), null, 1) }] }); }
        catch (e) { return ok({ content: [{ type: 'text', text: (e instanceof UserError ? 'Error: ' : 'Internal error: ') + e.message }], isError: true }); }
      }
      default: return { jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'method not found' } };
    }
  }
  return async body => {
    if (!Array.isArray(body)) return one(body);
    const out = (await Promise.all(body.map(one))).filter(Boolean);
    return out.length ? out : null;
  };
}

module.exports = { createMcp };
