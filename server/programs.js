// ============ Programs: room-wise attendance & hackathon review ============
// A Program is a titled event (e.g. "Skill Palavar – Google Certification", "AI ML",
// "Python Coding", "Hackathon 2026") with its OWN Excel-uploaded roster
// (student → room → faculty), several scheduled sessions, and room-wise attendance /
// hackathon-review that the admin opens and closes per room. Faculty sign in with their
// Emp ID and can only post for a room they're assigned to, while that room is open.
// Completely separate from the exam roster, attempts and the legacy attendance sessions.
import crypto from 'node:crypto';

export const roomKey = (r) => String(r || '').trim().toUpperCase().replace(/\s+/g, '') || '(NO ROOM)';
const txt = (v, n = 190) => String(v ?? '').trim().slice(0, n);
const KINDS = ['attendance', 'review'];

export function registerProgramRoutes(app, { db, requireAdmin, getRubric }) {
  // ---- helpers ----
  /** Group a roster into rooms: label, faculty list, student + batch counts. */
  function roomsOf(students) {
    const m = new Map();
    for (const s of students) {
      const k = roomKey(s.room);
      let r = m.get(k);
      if (!r) { r = { room: k, label: txt(s.room) || 'No room', faculty: new Map(), students: 0, batches: new Set() }; m.set(k, r); }
      r.students++;
      if (s.empId) {
        const f = r.faculty.get(String(s.empId)) || { empId: String(s.empId), name: '' };
        if (!f.name && s.facultyName) f.name = s.facultyName;
        r.faculty.set(String(s.empId), f);
      }
      if (s.batchNo) r.batches.add(String(s.batchNo));
    }
    return [...m.values()]
      .map((r) => ({ room: r.room, label: r.label, faculty: [...r.faculty.values()], students: r.students, batches: r.batches.size }))
      .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
  }
  const critMaxOf = (rubric) => {
    const m = {};
    rubric.tables.forEach((t, ti) => t.criteria.forEach((c, ci) => { m[`t${ti}_c${ci}`] = c.max; }));
    return m;
  };
  const gradeOf = (p) => (p == null ? '' : p >= 85 ? 'Outstanding' : p >= 70 ? 'Good' : p >= 50 ? 'Average' : 'Needs Improvement');
  const byBatch = (a, b) => String(a.batchNo).localeCompare(String(b.batchNo), undefined, { numeric: true }) || String(a.reg).localeCompare(String(b.reg));
  async function loadSession(req, res) {
    const session = await db.programSessions.get(req.params.sid);
    if (!session) { res.status(404).json({ error: 'Session not found' }); return null; }
    const program = await db.programs.get(session.programId);
    if (!program) { res.status(404).json({ error: 'Program not found' }); return null; }
    return { session, program };
  }
  /** Per-room status for a session (attendance posting or review progress). */
  async function roomStatus(session, students) {
    const rooms = roomsOf(students);
    const open = new Set(session.openRooms || []);
    if (session.kind === 'attendance') {
      const posts = new Map((await db.programAttendance.bySession(session.id)).map((p) => [p.room, p]));
      return rooms.map((r) => {
        const p = posts.get(r.room);
        return { ...r, open: open.has(r.room), posted: !!p, present: p ? p.present : 0, absent: p ? p.absent : 0, postedAt: p?.postedAt || null, postedBy: p ? { empId: p.empId, name: p.facultyName } : null };
      });
    }
    const scores = await db.programScores.bySession(session.id);
    const agg = new Map();
    for (const s of scores) { const a = agg.get(s.room) || { scored: 0, present: 0, sum: 0, last: '' }; a.scored++; if (s.present) { a.present++; a.sum += s.total || 0; } if (s.postedAt > a.last) a.last = s.postedAt; agg.set(s.room, a); }
    return rooms.map((r) => {
      const a = agg.get(r.room) || { scored: 0, present: 0, sum: 0, last: '' };
      return { ...r, open: open.has(r.room), scored: a.scored, present: a.present, avg: a.present ? Math.round((a.sum / a.present) * 10) / 10 : 0, postedAt: a.last || null, posted: a.scored > 0 && a.scored >= r.students };
    });
  }

  // =============== ADMIN ===============
  app.get('/api/admin/programs', requireAdmin, async (_req, res) => {
    const programs = await db.programs.all();
    const out = [];
    for (const p of programs) {
      const [students, sessions] = await Promise.all([db.programStudents.byProgram(p.id), db.programSessions.byProgram(p.id)]);
      out.push({
        ...p, students: students.length, rooms: roomsOf(students).length,
        attendanceSessions: sessions.filter((s) => s.kind === 'attendance').length,
        reviewSessions: sessions.filter((s) => s.kind === 'review').length,
        openRooms: sessions.reduce((n, s) => n + (s.openRooms || []).length, 0),
        openAttendance: sessions.filter((s) => s.kind === 'attendance').reduce((n, s) => n + (s.openRooms || []).length, 0),
        openReview: sessions.filter((s) => s.kind === 'review').reduce((n, s) => n + (s.openRooms || []).length, 0),
      });
    }
    res.json({ programs: out });
  });

  app.post('/api/admin/programs', requireAdmin, async (req, res) => {
    const title = txt(req.body?.title, 255);
    if (!title) return res.status(400).json({ error: 'Enter a program title.' });
    const p = { id: crypto.randomUUID(), title, createdAt: new Date().toISOString() };
    await db.programs.add(p);
    res.json(p);
  });

  app.post('/api/admin/programs/:id', requireAdmin, async (req, res) => {
    const title = txt(req.body?.title, 255);
    if (!title) return res.status(400).json({ error: 'Enter a program title.' });
    const p = await db.programs.update(req.params.id, { title });
    if (!p) return res.status(404).json({ error: 'Program not found' });
    res.json(p);
  });

  // Data protection: a program that already holds attendance or review marks can't be deleted.
  app.post('/api/admin/programs/:id/delete', requireAdmin, async (req, res) => {
    const p = await db.programs.get(req.params.id);
    if (!p) return res.status(404).json({ error: 'Program not found' });
    const [att, sc] = await Promise.all([db.programAttendance.byProgram(p.id), db.programScores.byProgram(p.id)]);
    if (att.length || sc.length) return res.status(403).json({ error: 'This program already has attendance or review marks, so it is kept permanently.' });
    await db.programs.remove(p.id);
    res.json({ ok: true });
  });

  app.post('/api/admin/programs/:id/students/import', requireAdmin, async (req, res) => {
    const p = await db.programs.get(req.params.id);
    if (!p) return res.status(404).json({ error: 'Program not found' });
    const raw = Array.isArray(req.body?.students) ? req.body.students : null;
    if (!raw) return res.status(400).json({ error: 'Body must be { students: [...] }' });
    const seen = new Set(); const rows = []; let skipped = 0;
    for (const s of raw) {
      const reg = txt(s.reg ?? s.registrationNumber, 64);
      const name = txt(s.name);
      if (!reg || !name || seen.has(reg)) { skipped++; continue; }
      seen.add(reg);
      rows.push({
        id: crypto.randomUUID(), reg, name, branch: txt(s.branch, 64), section: txt(s.section, 64), room: txt(s.room, 64),
        empId: txt(s.empId, 32), facultyName: txt(s.facultyName), batchNo: txt(s.batchNo, 32), project: txt(s.project, 2000), ps: txt(s.ps, 64),
      });
    }
    if (!rows.length) return res.status(400).json({ error: 'No valid rows (each needs a registration number and a name).' });
    const r = await db.programStudents.importMany(p.id, rows, !!req.body?.replace);
    res.json({ ...r, skipped });
  });

  app.get('/api/admin/programs/:id/students', requireAdmin, async (req, res) => {
    res.json({ students: await db.programStudents.byProgram(req.params.id) });
  });

  app.get('/api/admin/programs/:id/sessions', requireAdmin, async (req, res) => {
    const kind = String(req.query.kind || '');
    const all = await db.programSessions.byProgram(req.params.id);
    res.json({ sessions: KINDS.includes(kind) ? all.filter((s) => s.kind === kind) : all });
  });

  app.post('/api/admin/programs/:id/sessions', requireAdmin, async (req, res) => {
    const p = await db.programs.get(req.params.id);
    if (!p) return res.status(404).json({ error: 'Program not found' });
    const kind = String(req.body?.kind || '');
    if (!KINDS.includes(kind)) return res.status(400).json({ error: 'kind must be attendance or review' });
    const count = (await db.programSessions.byProgram(p.id)).filter((s) => s.kind === kind).length;
    const s = {
      id: crypto.randomUUID(), programId: p.id, kind,
      name: txt(req.body?.name) || (kind === 'review' ? `Review ${count + 1}` : `Session ${count + 1}`),
      date: txt(req.body?.date, 16), startTime: txt(req.body?.startTime, 8), endTime: txt(req.body?.endTime, 8),
      openRooms: [], createdAt: new Date().toISOString(),
    };
    await db.programSessions.add(s);
    res.json(s);
  });

  app.post('/api/admin/program-sessions/:sid', requireAdmin, async (req, res) => {
    const patch = {};
    for (const [k, n] of [['name', 190], ['date', 16], ['startTime', 8], ['endTime', 8]]) if (typeof req.body?.[k] === 'string') patch[k] = txt(req.body[k], n);
    const s = await db.programSessions.update(req.params.sid, patch);
    if (!s) return res.status(404).json({ error: 'Session not found' });
    res.json(s);
  });

  app.post('/api/admin/program-sessions/:sid/delete', requireAdmin, async (req, res) => {
    const ctx = await loadSession(req, res); if (!ctx) return;
    const has = ctx.session.kind === 'attendance'
      ? (await db.programAttendance.bySession(ctx.session.id)).length
      : (await db.programScores.bySession(ctx.session.id)).length;
    if (has) return res.status(403).json({ error: 'This session already has submitted data and is kept permanently.' });
    await db.programSessions.remove(ctx.session.id);
    res.json({ ok: true });
  });

  /** Room board for one session — the room cards. */
  app.get('/api/admin/program-sessions/:sid/board', requireAdmin, async (req, res) => {
    const ctx = await loadSession(req, res); if (!ctx) return;
    const students = await db.programStudents.byProgram(ctx.program.id);
    const rooms = await roomStatus(ctx.session, students);
    const summary = {
      rooms: rooms.length, open: rooms.filter((r) => r.open).length, posted: rooms.filter((r) => r.posted).length,
      students: students.length,
      present: rooms.reduce((n, r) => n + (r.present || 0), 0),
      absent: rooms.reduce((n, r) => n + (r.absent || 0), 0),
      scored: rooms.reduce((n, r) => n + (r.scored || 0), 0),
    };
    let maxTotal = 0;
    if (ctx.session.kind === 'review') maxTotal = Object.values(critMaxOf(await getRubric())).reduce((n, v) => n + v, 0);
    res.json({ program: ctx.program, session: ctx.session, rooms, summary, maxTotal });
  });

  /** Open or close rooms: { open: true|false, rooms: ['C121', ...] | 'ALL' }. */
  app.post('/api/admin/program-sessions/:sid/rooms', requireAdmin, async (req, res) => {
    const ctx = await loadSession(req, res); if (!ctx) return;
    const students = await db.programStudents.byProgram(ctx.program.id);
    const all = roomsOf(students).map((r) => r.room);
    const target = req.body?.rooms === 'ALL' ? all : (Array.isArray(req.body?.rooms) ? req.body.rooms.map(roomKey).filter((r) => all.includes(r)) : []);
    if (!target.length) return res.status(400).json({ error: 'No matching rooms.' });
    const open = new Set(ctx.session.openRooms || []);
    for (const r of target) { if (req.body?.open) open.add(r); else open.delete(r); }
    const s = await db.programSessions.update(ctx.session.id, { openRooms: [...open] });
    res.json({ ok: true, openRooms: s.openRooms });
  });

  /** One room's detail: students + their attendance mark or review scores. */
  app.get('/api/admin/program-sessions/:sid/rooms/:room', requireAdmin, async (req, res) => {
    const ctx = await loadSession(req, res); if (!ctx) return;
    const room = roomKey(req.params.room);
    const students = (await db.programStudents.byProgram(ctx.program.id)).filter((s) => roomKey(s.room) === room).sort(byBatch);
    const open = (ctx.session.openRooms || []).includes(room);
    if (ctx.session.kind === 'attendance') {
      const p = await db.programAttendance.get(ctx.session.id, room);
      return res.json({ program: ctx.program, session: ctx.session, room, open, posting: p, students: students.map((s) => ({ ...s, present: p ? !!p.marks[s.reg] : null })) });
    }
    const rubric = await getRubric(); const critMax = critMaxOf(rubric);
    const scores = new Map((await db.programScores.bySession(ctx.session.id)).filter((s) => s.room === room).map((s) => [s.reg, s]));
    res.json({
      program: ctx.program, session: ctx.session, room, open, rubric, maxTotal: Object.values(critMax).reduce((n, v) => n + v, 0),
      students: students.map((s) => {
        const sc = scores.get(s.reg);
        const outOf = sc ? Object.keys(sc.scores || {}).reduce((n, k) => n + (critMax[k] || 0), 0) : 0;
        const pctv = sc && sc.present && outOf ? Math.round((sc.total / outOf) * 100) : null;
        return { ...s, scored: !!sc, present: sc ? sc.present : null, scores: sc ? sc.scores : {}, total: sc ? sc.total : null, percentage: pctv, grade: gradeOf(pctv), byEmp: sc?.byEmp || '' };
      }),
    });
  });

  /** Clear a room's submission so its faculty can post again. */
  app.post('/api/admin/program-sessions/:sid/rooms/:room/revoke', requireAdmin, async (req, res) => {
    const ctx = await loadSession(req, res); if (!ctx) return;
    const room = roomKey(req.params.room);
    const removed = ctx.session.kind === 'attendance'
      ? await db.programAttendance.remove(ctx.session.id, room)
      : await db.programScores.removeRoom(ctx.session.id, room);
    res.json({ ok: true, removed });
  });

  /** Flat rows for an Excel export of one session. */
  app.get('/api/admin/program-sessions/:sid/export', requireAdmin, async (req, res) => {
    const ctx = await loadSession(req, res); if (!ctx) return;
    const students = (await db.programStudents.byProgram(ctx.program.id)).sort((a, b) => roomKey(a.room).localeCompare(roomKey(b.room), undefined, { numeric: true }) || byBatch(a, b));
    if (ctx.session.kind === 'attendance') {
      const posts = new Map((await db.programAttendance.bySession(ctx.session.id)).map((p) => [p.room, p]));
      const rows = students.map((s) => {
        const p = posts.get(roomKey(s.room));
        return { 'Reg No': s.reg, Name: s.name, Branch: s.branch, Section: s.section, Room: s.room, 'Faculty Emp ID': s.empId, Faculty: s.facultyName, Status: p ? (p.marks[s.reg] ? 'Present' : 'Absent') : 'Not posted', 'Posted at': p ? new Date(p.postedAt).toLocaleString('en-IN') : '' };
      });
      return res.json({ program: ctx.program, session: ctx.session, rows });
    }
    const rubric = await getRubric(); const critMax = critMaxOf(rubric);
    const flat = []; rubric.tables.forEach((t, ti) => t.criteria.forEach((c, ci) => flat.push({ key: `t${ti}_c${ci}`, label: c.label, max: c.max })));
    const scores = new Map((await db.programScores.bySession(ctx.session.id)).map((s) => [s.reg, s]));
    const rows = students.map((s) => {
      const sc = scores.get(s.reg);
      const outOf = sc ? Object.keys(sc.scores || {}).reduce((n, k) => n + (critMax[k] || 0), 0) : 0;
      const pctv = sc && sc.present && outOf ? Math.round((sc.total / outOf) * 100) : null;
      const row = { 'Reg No': s.reg, Name: s.name, Room: s.room, Batch: s.batchNo, Project: s.project, PS: s.ps, Faculty: s.facultyName, 'Faculty Emp ID': s.empId, Present: sc ? (sc.present ? 'Present' : 'Absent') : 'Not scored' };
      for (const c of flat) row[`${c.label} (/${c.max})`] = sc ? (sc.scores?.[c.key] ?? '') : '';
      row.Total = sc ? sc.total : ''; row['%'] = pctv ?? ''; row.Grade = gradeOf(pctv);
      return row;
    });
    res.json({ program: ctx.program, session: ctx.session, rows });
  });

  // =============== FACULTY (Emp ID only) ===============
  /** All rooms this faculty is assigned to, across programs, for sessions of one kind. */
  app.post('/api/faculty/program/login', async (req, res) => {
    const empId = txt(req.body?.empId, 32);
    const kind = KINDS.includes(req.body?.kind) ? req.body.kind : 'attendance';
    if (!empId) return res.status(400).json({ error: 'Enter your Employee ID.' });
    const mine = await db.programStudents.byEmp(empId);
    if (!mine.length) return res.status(404).json({ error: 'No program rooms are assigned to this Employee ID. Please check the ID.' });
    const byProgram = new Map();
    for (const s of mine) { const l = byProgram.get(s.programId) || new Set(); l.add(roomKey(s.room)); byProgram.set(s.programId, l); }
    const cards = [];
    let facultyName = mine.find((s) => s.facultyName)?.facultyName || '';
    for (const [pid, myRooms] of byProgram) {
      const program = await db.programs.get(pid); if (!program) continue;
      const sessions = (await db.programSessions.byProgram(pid)).filter((s) => s.kind === kind);
      if (!sessions.length) continue;
      const roster = await db.programStudents.byProgram(pid);
      for (const session of sessions) {
        const status = await roomStatus(session, roster);
        for (const r of status) {
          if (!myRooms.has(r.room)) continue;
          cards.push({ programId: pid, programTitle: program.title, sessionId: session.id, sessionName: session.name, date: session.date, startTime: session.startTime, endTime: session.endTime, room: r.room, label: r.label, students: r.students, open: r.open, posted: r.posted, present: r.present || 0, absent: r.absent || 0, scored: r.scored || 0, postedAt: r.postedAt });
        }
      }
    }
    cards.sort((a, b) => (b.open - a.open) || String(b.date).localeCompare(String(a.date)) || a.label.localeCompare(b.label, undefined, { numeric: true }));
    res.json({ faculty: { empId, name: facultyName }, kind, cards });
  });

  /** Verify the faculty belongs to this room in this session's program; return context. */
  async function facultyRoom(req, res) {
    const empId = txt(req.body?.empId, 32);
    const room = roomKey(req.body?.room);
    const session = await db.programSessions.get(String(req.body?.sessionId || ''));
    if (!empId || !session) { res.status(400).json({ error: 'Missing session or Employee ID.' }); return null; }
    const roster = await db.programStudents.byProgram(session.programId);
    const inRoom = roster.filter((s) => roomKey(s.room) === room).sort(byBatch);
    if (!inRoom.some((s) => String(s.empId) === empId)) { res.status(403).json({ error: 'This room is not assigned to your Employee ID.' }); return null; }
    const program = await db.programs.get(session.programId);
    return { empId, room, session, program, students: inRoom, open: (session.openRooms || []).includes(room), facultyName: inRoom.find((s) => String(s.empId) === empId)?.facultyName || '' };
  }

  app.post('/api/faculty/program/room', async (req, res) => {
    const c = await facultyRoom(req, res); if (!c) return;
    const base = { program: c.program, session: { id: c.session.id, name: c.session.name, kind: c.session.kind, date: c.session.date, startTime: c.session.startTime, endTime: c.session.endTime }, room: c.room, label: c.students[0]?.room || c.room, open: c.open };
    const lite = (s) => ({ reg: s.reg, name: s.name, branch: s.branch, section: s.section, batchNo: s.batchNo, project: s.project, ps: s.ps });
    if (c.session.kind === 'attendance') {
      const p = await db.programAttendance.get(c.session.id, c.room);
      return res.json({ ...base, posting: p ? { postedAt: p.postedAt, present: p.present, absent: p.absent, total: p.total, by: p.facultyName || p.empId } : null, students: c.students.map((s) => ({ ...lite(s), present: p ? !!p.marks[s.reg] : null })) });
    }
    const rubric = await getRubric(); const critMax = critMaxOf(rubric);
    const scores = new Map((await db.programScores.bySession(c.session.id)).filter((s) => s.room === c.room).map((s) => [s.reg, s]));
    res.json({
      ...base, rubric, maxTotal: Object.values(critMax).reduce((n, v) => n + v, 0),
      students: c.students.map((s) => { const sc = scores.get(s.reg); return { ...lite(s), scored: !!sc, present: sc ? sc.present : true, scores: sc ? sc.scores : {}, total: sc ? sc.total : 0 }; }),
    });
  });

  /** Submit attendance for the whole room — once per session (admin can revoke to redo). */
  app.post('/api/faculty/program/attendance', async (req, res) => {
    const c = await facultyRoom(req, res); if (!c) return;
    if (c.session.kind !== 'attendance') return res.status(400).json({ error: 'This is not an attendance session.' });
    if (!c.open) return res.status(403).json({ error: 'Attendance for this room is not open. Please ask the coordinator to open it.' });
    const existing = await db.programAttendance.get(c.session.id, c.room);
    if (existing) return res.status(409).json({ error: `Attendance for this room was already submitted${existing.facultyName ? ` by ${existing.facultyName}` : ''} — it is locked. Ask the coordinator to revoke it if a change is needed.` });
    const marks = (req.body?.marks && typeof req.body.marks === 'object') ? req.body.marks : {};
    const clean = {}; let present = 0;
    for (const s of c.students) { const p = !!marks[s.reg]; clean[s.reg] = p; if (p) present++; }
    const rec = { sessionId: c.session.id, room: c.room, programId: c.session.programId, roomLabel: c.students[0]?.room || c.room, empId: c.empId, facultyName: c.facultyName, marks: clean, present, absent: c.students.length - present, total: c.students.length, postedAt: new Date().toISOString() };
    await db.programAttendance.set(rec);
    res.json({ ok: true, present, absent: rec.absent, total: rec.total, postedAt: rec.postedAt });
  });

  /** Save review marks for students in the room (can be re-saved while the room is open). */
  app.post('/api/faculty/program/review', async (req, res) => {
    const c = await facultyRoom(req, res); if (!c) return;
    if (c.session.kind !== 'review') return res.status(400).json({ error: 'This is not a review session.' });
    if (!c.open) return res.status(403).json({ error: 'Review for this room is not open. Please ask the coordinator to open it.' });
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    const critMax = critMaxOf(await getRubric());
    const inRoom = new Set(c.students.map((s) => s.reg));
    const now = new Date().toISOString(); let saved = 0;
    for (const r of rows) {
      const reg = txt(r.reg, 64); if (!inRoom.has(reg)) continue;
      const scores = {};
      for (const [k, v] of Object.entries(r.scores || {})) { if (critMax[k] == null) continue; const n = Math.round(Number(v)); if (!isNaN(n) && n >= 0) scores[k] = Math.min(n, critMax[k]); }
      const present = r.present !== false;
      const total = present ? Object.values(scores).reduce((n, v) => n + v, 0) : 0;
      await db.programScores.set({ sessionId: c.session.id, reg, programId: c.session.programId, room: c.room, present, scores: present ? scores : {}, total, byEmp: c.empId, postedAt: now });
      saved++;
    }
    res.json({ ok: true, saved, postedAt: now });
  });
}
