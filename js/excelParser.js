// Lee un Excel con hojas Plan / Sesiones / Alimentación y lo convierte en datos listos para Supabase.
// No guarda nada: solo devuelve { ok, plan, sessions, habits, errors, warnings }.
// Cada error indica hoja, fila y columna exactas.

const MAX_BYTES = 5 * 1024 * 1024;

// ---------- Normalización ----------
export const normalizeName = (s) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const key = (s) => normalizeName(s).replace(/ /g, '');
const isBlank = (v) => v == null || (typeof v === 'string' && v.trim() === '');
const text = (v) => (isBlank(v) ? '' : v instanceof Date ? '' : String(v).trim());
const pad = (n) => String(n).padStart(2, '0');

// ---------- Estructura esperada (nombres tolerantes a tildes y mayúsculas) ----------
const SHEETS = {
  plan: ['plan'],
  sessions: ['sesiones', 'sesion', 'entrenamiento', 'entrenamientos', 'rutina'],
  habits: ['alimentacion', 'habitos', 'alimentacionhabitos', 'alimentacionyhabitos', 'nutricion', 'pautas']
};
const COLUMNS = {
  plan: { name: ['nombre', 'plan'], description: ['descripcion', 'objetivo'], start_date: ['fechainicio', 'inicio'], end_date: ['fechafin', 'fin'] },
  sessions: {
    week: ['semana'], day: ['dia'], title: ['sesion', 'titulo'], exercise: ['ejercicio'],
    sets: ['series'], reps: ['repeticiones', 'reps'], rest: ['descanso', 'descansos', 'descansoseg'],
    rpe: ['rpe'], tempo: ['tempo'], notes: ['notas', 'nota', 'observaciones']
  },
  habits: { category: ['categoria', 'tipo'], title: ['titulo', 'pauta', 'nombre'], content: ['contenido', 'descripcion', 'detalle'], frequency: ['frecuencia'] }
};
const REQUIRED = { plan: ['name'], sessions: ['day', 'exercise'], habits: ['title'] };
const REQUIRED_LABEL = { name: 'Nombre', day: 'Día', exercise: 'Ejercicio', title: 'Título' };
const DAYS = { lunes: 1, martes: 2, miercoles: 3, jueves: 4, viernes: 5, sabado: 6, domingo: 7 };
const CATS = { alimentacion: 'alimentacion', nutricion: 'alimentacion', comida: 'alimentacion', descanso: 'descanso', sueno: 'descanso', habito: 'habito', habitos: 'habito' };

// ---------- Carga local de SheetJS (lib/xlsx.full.min.js) ----------
let sheetJsPromise = null;
function loadSheetJS() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  if (!sheetJsPromise) {
    sheetJsPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = new URL('../lib/xlsx.full.min.js', import.meta.url).href;
      s.onload = () => (window.XLSX ? resolve(window.XLSX) : reject(new Error('SheetJS no se inicializó.')));
      s.onerror = () => { sheetJsPromise = null; reject(new Error('No se encuentra lib/xlsx.full.min.js en el proyecto.')); };
      document.head.append(s);
    });
  }
  return sheetJsPromise;
}

// ---------- Conversores de celdas (null = vacío, NaN = inválido) ----------
const toNumber = (v) => {
  if (isBlank(v)) return null;
  if (typeof v === 'number') return v;
  const n = Number(String(v).trim().replace(',', '.'));
  return Number.isFinite(n) ? n : NaN;
};
const toInt = (v, min, max) => {
  const n = toNumber(v);
  return n === null ? null : Number.isInteger(n) && n >= min && n <= max ? n : NaN;
};
const toDecimal = (v, min, max) => {
  const n = toNumber(v);
  return n === null ? null : n >= min && n <= max ? n : NaN;
};
function toSeconds(v) {
  if (isBlank(v)) return null;
  if (typeof v === 'number') return v >= 0 ? Math.round(v) : NaN;
  const s = String(v).trim().toLowerCase().replace(',', '.');
  let m = s.match(/^(\d+):(\d{1,2})$/);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  m = s.match(/^(\d+(?:\.\d+)?)\s*(s|seg|segundos?)?$/);
  if (m) return Math.round(Number(m[1]));
  m = s.match(/^(\d+(?:\.\d+)?)\s*(m|min|minutos?)$/);
  return m ? Math.round(Number(m[1]) * 60) : NaN;
}
function toDay(v) {
  if (isBlank(v)) return null;
  const n = toInt(v, 1, 7);
  if (n !== null && !Number.isNaN(n)) return n;
  return DAYS[key(v).replace(/^dia/, '')] ?? NaN;
}
function toIsoDate(v) {
  if (isBlank(v)) return null;
  const build = (y, mo, d) => {
    const dt = new Date(Date.UTC(y, mo - 1, d));
    return dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === Number(d) ? `${y}-${pad(mo)}-${pad(d)}` : NaN;
  };
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    const d = new Date(v.getTime() + 12 * 3600e3); // margen contra desfases horarios
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return build(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  return m ? build(+m[3], +m[2], +m[1]) : NaN;
}

// ---------- Lectura de una hoja como tabla con fila/columna reales ----------
function readTable(XLSX, wb, kind, sheetName, issues) {
  const t = { name: sheetName, rows: [], col: {}, ok: true };
  const ws = wb.Sheets[sheetName];
  if (!ws || !ws['!ref']) return t;

  const range = XLSX.utils.decode_range(ws['!ref']);
  const grid = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', blankrows: true, raw: true });
  const h = grid.findIndex((r) => r.some((c) => text(c) !== '' || c instanceof Date));
  if (h < 0) return t;

  const idx = {};
  grid[h].forEach((cell, c) => {
    for (const [field, aliases] of Object.entries(COLUMNS[kind])) {
      if (idx[field] === undefined && aliases.includes(key(cell))) {
        idx[field] = c;
        t.col[field] = `${XLSX.utils.encode_col(range.s.c + c)} (${text(cell)})`;
      }
    }
  });
  for (const field of REQUIRED[kind]) {
    if (idx[field] === undefined) {
      issues.push({ sheet: sheetName, row: range.s.r + h + 1, column: '—', message: `Falta la columna «${REQUIRED_LABEL[field]}».` });
      t.ok = false;
    }
  }
  if (!t.ok) return t;

  grid.slice(h + 1).forEach((r, i) => {
    if (r.every((c) => isBlank(c))) return;
    const v = {};
    for (const f in idx) v[f] = r[idx[f]];
    t.rows.push({ row: range.s.r + h + i + 2, v });
  });
  return t;
}

// ---------- API pública ----------
export async function parseExcelFile(file) {
  const result = { ok: false, plan: null, sessions: [], habits: [], errors: [], warnings: [] };
  const issues = result.errors;
  const fail = (message) => { issues.push({ sheet: '—', row: '—', column: '—', message }); return result; };
  const bad = (t, r, field, message) => issues.push({ sheet: t.name, row: r.row, column: t.col[field] ?? '—', message });

  if (!file) return fail('No se ha seleccionado ningún archivo.');
  if (!/\.xlsx?$/i.test(file.name)) return fail('El archivo debe ser un Excel (.xlsx o .xls).');
  if (file.size > MAX_BYTES) return fail('El archivo supera los 5 MB.');

  let XLSX, wb;
  try { XLSX = await loadSheetJS(); } catch (e) { return fail(e.message); }
  try { wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true }); }
  catch { return fail('No se pudo leer el archivo. ¿Está dañado o protegido con contraseña?'); }

  const findSheet = (kind) => wb.SheetNames.find((n) => SHEETS[kind].includes(key(n)));

  // --- Hoja Plan ---
  const planName = findSheet('plan');
  if (!planName) {
    fail('Falta la hoja «Plan».');
  } else {
    const t = readTable(XLSX, wb, 'plan', planName, issues);
    if (t.ok) {
      const r = t.rows[0];
      if (!r) {
        issues.push({ sheet: planName, row: '—', column: '—', message: 'La hoja «Plan» no tiene datos.' });
      } else {
        if (t.rows.length > 1) result.warnings.push(`Hoja «${planName}»: solo se usa la primera fila de datos.`);
        const name = text(r.v.name);
        if (!name) bad(t, r, 'name', 'El nombre del plan es obligatorio.');
        const start = toIsoDate(r.v.start_date);
        const end = toIsoDate(r.v.end_date);
        if (Number.isNaN(start)) bad(t, r, 'start_date', 'Fecha no válida. Usa dd/mm/aaaa o aaaa-mm-dd.');
        if (Number.isNaN(end)) bad(t, r, 'end_date', 'Fecha no válida. Usa dd/mm/aaaa o aaaa-mm-dd.');
        if (start && end && !Number.isNaN(start) && !Number.isNaN(end) && end < start) bad(t, r, 'end_date', 'La fecha de fin es anterior a la de inicio.');
        result.plan = {
          name, description: text(r.v.description) || null,
          start_date: Number.isNaN(start) ? null : start, end_date: Number.isNaN(end) ? null : end,
          status: 'draft' // siempre entra como borrador: el entrenador lo activa a mano
        };
      }
    }
  }

  // --- Hoja Sesiones ---
  const sessName = findSheet('sessions');
  if (!sessName) {
    fail('Falta la hoja «Sesiones».');
  } else {
    const t = readTable(XLSX, wb, 'sessions', sessName, issues);
    const groups = new Map();
    for (const r of t.rows) {
      const exercise = text(r.v.exercise);
      if (!exercise) { bad(t, r, 'exercise', 'Falta el nombre del ejercicio.'); continue; }

      const day = toDay(r.v.day);
      if (day === null || Number.isNaN(day)) { bad(t, r, 'day', 'Día no válido. Usa 1-7 o lunes…domingo.'); continue; }
      let week = toInt(r.v.week, 1, 99);
      if (Number.isNaN(week)) { bad(t, r, 'week', 'La semana debe ser un número entero de 1 a 99.'); week = 1; }
      week ??= 1;

      const sets = toInt(r.v.sets, 1, 50);
      const rest = toSeconds(r.v.rest);
      const rpe = toDecimal(r.v.rpe, 0, 10);
      if (Number.isNaN(sets)) bad(t, r, 'sets', 'Las series deben ser un número entero entre 1 y 50.');
      if (Number.isNaN(rest)) bad(t, r, 'rest', 'Descanso no válido. Usa segundos (90), 1:30 o 2 min.');
      if (Number.isNaN(rpe)) bad(t, r, 'rpe', 'El RPE debe ser un número entre 0 y 10.');
      for (const f of ['reps', 'tempo']) {
        if (r.v[f] instanceof Date) bad(t, r, f, 'Excel lo ha convertido en fecha. Escríbelo como texto, por ejemplo con apóstrofo: \'6-8');
      }

      const title = text(r.v.title) || `Día ${day}`;
      const gk = `${week}|${day}|${normalizeName(title)}`;
      if (!groups.has(gk)) groups.set(gk, { week_number: week, day_number: day, title, sort_order: groups.size, exercises: [] });
      const g = groups.get(gk);
      g.exercises.push({
        exercise_name: exercise, exercise_id: null,
        sets: Number.isNaN(sets) ? null : sets,
        reps: r.v.reps instanceof Date ? null : text(r.v.reps) || null,
        rest_seconds: Number.isNaN(rest) ? null : rest,
        rpe: Number.isNaN(rpe) ? null : rpe,
        tempo: r.v.tempo instanceof Date ? null : text(r.v.tempo) || null,
        notes: text(r.v.notes) || null,
        sort_order: g.exercises.length
      });
    }
    result.sessions = [...groups.values()];
    if (t.ok && !result.sessions.length && !issues.length) {
      result.warnings.push('La hoja de sesiones no tiene ejercicios: el plan quedará vacío (borrador).');
    }
  }

  // --- Hoja Alimentación / Hábitos (opcional) ---
  const habName = findSheet('habits');
  if (!habName) {
    result.warnings.push('No hay hoja «Alimentación»: el plan no tendrá pautas de alimentación ni hábitos.');
  } else {
    const t = readTable(XLSX, wb, 'habits', habName, issues);
    for (const r of t.rows) {
      const title = text(r.v.title);
      if (!title) { bad(t, r, 'title', 'Falta el título de la pauta.'); continue; }
      const raw = text(r.v.category);
      const category = raw ? CATS[key(raw)] : 'habito';
      if (!category) { bad(t, r, 'category', 'Categoría no válida. Usa: alimentación, descanso o hábito.'); continue; }
      result.habits.push({
        category, title, content: text(r.v.content) || null,
        frequency: text(r.v.frequency) || null, sort_order: result.habits.length
      });
    }
  }

  result.ok = issues.length === 0;
  return result;
}

// Empareja los ejercicios del Excel con la biblioteca ([{id, name}]) ignorando tildes y mayúsculas.
// Rellena exercise_id y devuelve los nombres sin pareja (se guardan igual, sin vídeo).
export function matchExercises(sessions, library) {
  const byName = new Map((library || []).map((e) => [normalizeName(e.name), e.id]));
  const unmatched = new Set();
  for (const s of sessions) {
    for (const ex of s.exercises) {
      ex.exercise_id = byName.get(normalizeName(ex.exercise_name)) ?? null;
      if (!ex.exercise_id) unmatched.add(ex.exercise_name);
    }
  }
  return [...unmatched];
}

export const formatIssue = (i) =>
  i.sheet === '—' ? i.message : `Hoja «${i.sheet}», fila ${i.row}, columna ${i.column}: ${i.message}`;

// Descarga un Excel de ejemplo con el formato correcto
export async function downloadTemplate() {
  const XLSX = await loadSheetJS();
  const wb = XLSX.utils.book_new();
  const add = (name, rows) => XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name);
  add('Plan', [
    ['Nombre', 'Descripción', 'Fecha inicio', 'Fecha fin'],
    ['Fuerza 8 semanas', 'Bloque de fuerza general', '2026-10-19', '2026-12-13']
  ]);
  add('Sesiones', [
    ['Semana', 'Día', 'Sesión', 'Ejercicio', 'Series', 'Repeticiones', 'Descanso (s)', 'RPE', 'Tempo', 'Notas'],
    [1, 'Lunes', 'Tren inferior', 'Sentadilla trasera', 4, '6-8', 120, 7.5, '3-1-1', 'Espalda neutra'],
    [1, 'Lunes', 'Tren inferior', 'Peso muerto rumano', 3, '8-10', 90, '', '', ''],
    [1, 'Jueves', 'Tren superior', 'Press banca', 4, '6-8', 120, 8, '', '']
  ]);
  add('Alimentación', [
    ['Categoría', 'Título', 'Contenido', 'Frecuencia'],
    ['Alimentación', 'Proteína en cada comida', 'Entre 25 y 35 g por comida principal', 'Diaria'],
    ['Descanso', 'Dormir 7-8 horas', 'Acostarte a la misma hora', 'Diaria'],
    ['Hábito', 'Caminar 8.000 pasos', '', 'Diaria']
  ]);
  XLSX.writeFile(wb, 'plantilla-entrenamiento.xlsx');
}
