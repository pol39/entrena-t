// Lee la plantilla (hojas Plan, Sesiones, Ejercicios y Pautas) y devuelve datos listos para guardar.
// No guarda nada: { ok, plan, sessions, habits, errors, warnings }. Cada error indica hoja, fila y columna.

const MAX_BYTES = 5 * 1024 * 1024;

export const normalizeName = (s) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const key = (s) => normalizeName(s).replace(/ /g, '');
const isBlank = (v) => v == null || (typeof v === 'string' && v.trim() === '');
const text = (v) => (isBlank(v) || v instanceof Date ? '' : String(v).trim());
const opt = (v) => text(v) || null;
const pad = (n) => String(n).padStart(2, '0');

// ---------- Estructura esperada (nombres tolerantes a tildes, mayúsculas y espacios) ----------
const SHEETS = {
  plan: ['plan'], sessions: ['sesiones', 'sesion'], exercises: ['ejercicios', 'ejercicio'],
  habits: ['pautas', 'pauta', 'alimentacion', 'habitos']
};
const COLUMNS = {
  plan: {
    name: ['nombre', 'plan'], description: ['descripcion'], client_profile: ['usuario', 'usuaria', 'perfil'],
    frequency: ['frecuencia'], goal: ['objetivo'], progress: ['progreso', 'progresom1'], structure: ['estructura'],
    weeks: ['semanas'], start_date: ['fechainicio', 'inicio'], end_date: ['fechafin', 'fin'], footer: ['piedepagina', 'pie']
  },
  sessions: {
    code: ['codigo', 'id'], weeks: ['semanas'], day: ['dia'], kind: ['tipo'], title: ['titulo'], objective: ['objetivo'],
    focus: ['enfoqueprincipal', 'enfoque', 'focus'], rep_strategy: ['estrategiaderepeticiones', 'estrategia'],
    key_material: ['materialclave'], cardio_summary: ['cardioresumen'], objective_summary: ['objetivoresumen'],
    tip_title: ['titulodelaviso', 'tituloaviso'], notes: ['aviso', 'nota'], notes_hint: ['ayudaanotaciones', 'ayuda']
  },
  exercises: {
    session: ['sesion', 'codigo'], block: ['bloque'], block_title: ['titulodelbloque', 'titulobloque'], exercise: ['ejercicio'],
    detail: ['detalle', 'subtitulo'], equipment: ['material', 'equipamiento'], sets: ['series'], reps: ['repeticiones', 'reps'],
    scheme: ['esquema'], rir: ['rir'], rest: ['descanso'], notes: ['consejotecnico', 'consejo'], video: ['videourl', 'video'], tag: ['etiqueta']
  },
  habits: {
    category: ['categoria', 'tipo'], title: ['titulo', 'pauta'], subtitle: ['subtitulo'], content: ['contenido'],
    detail: ['aporte'], frequency: ['frecuencia'], checkable: ['marcable'], target: ['objetivodiario'], unit: ['unidad']
  }
};
const REQUIRED = { plan: ['name'], sessions: ['code', 'title'], exercises: ['session', 'exercise'], habits: ['category', 'title'] };
const LABEL = { name: 'Nombre', code: 'Código', title: 'Título', session: 'Sesión', exercise: 'Ejercicio', category: 'Categoría' };
const DAYS = { lunes: 1, martes: 2, miercoles: 3, jueves: 4, viernes: 5, sabado: 6, domingo: 7 };
const KINDS = { fuerza: 'fuerza', cardio: 'cardio', movilidad: 'movilidad', descanso: 'descanso' };
const BLOCKS = { calentamiento: 'calentamiento', principal: 'principal', cardio: 'cardio', final: 'final' };
const CATS = {
  alimentacion: 'alimentacion', macros: 'macros', suplementos: 'suplementos', suplementacion: 'suplementos',
  equivalencias: 'equivalencias', descanso: 'descanso', habito: 'habito', habitos: 'habito', consejo: 'consejo',
  consejos: 'consejo', seguridad: 'seguridad', glosario: 'glosario', seguimiento: 'seguimiento', feedback: 'feedback',
  metodologia: 'metodologia', horario: 'horario', horarios: 'horario'
};

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
const toDay = (v) => {
  if (isBlank(v)) return null;
  const n = toInt(v, 1, 7);
  if (n !== null && !Number.isNaN(n)) return n;
  return DAYS[key(v).replace(/^dia/, '')] ?? NaN;
};
const toYes = (v) => ['si', 's', 'yes', 'y', 'true', '1', 'x'].includes(key(v));

// "1-4", "1,3", "1-2,4" → [1,2,3,4]. Vacío → null. Inválido → NaN.
function toWeeks(v) {
  if (v instanceof Date) return NaN;
  const s = text(v);
  if (!s) return null;
  const out = new Set();
  for (const part of s.split(/[,;]/)) {
    const m = part.trim().match(/^(\d+)(?:\s*[-–]\s*(\d+))?$/);
    if (!m) return NaN;
    const a = Number(m[1]);
    const b = m[2] ? Number(m[2]) : a;
    if (a < 1 || b < a || b > 52) return NaN;
    for (let i = a; i <= b; i++) out.add(i);
  }
  return [...out].sort((x, y) => x - y);
}

function toIsoDate(v) {
  if (isBlank(v)) return null;
  const build = (y, mo, d) => {
    const dt = new Date(Date.UTC(y, mo - 1, d));
    return dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d ? `${y}-${pad(mo)}-${pad(d)}` : NaN;
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
function firstHeader(XLSX, ws) {
  if (!ws || !ws['!ref']) return [];
  const grid = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', blankrows: true, raw: true });
  return grid.find((r) => r.some((c) => text(c) !== '')) || [];
}

function readTable(XLSX, wb, kind, sheetName, issues) {
  const t = { name: sheetName, rows: [], col: {}, ok: true };
  const ws = wb.Sheets[sheetName];
  if (!ws || !ws['!ref']) return t;
  const range = XLSX.utils.decode_range(ws['!ref']);
  const grid = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', blankrows: true, raw: true });
  const h = grid.findIndex((r) => r.some((c) => text(c) !== ''));
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
      issues.push({ sheet: sheetName, row: range.s.r + h + 1, column: '—', message: `Falta la columna «${LABEL[field]}».` });
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

  const find = (kind) => wb.SheetNames.find((n) => SHEETS[kind].includes(key(n)));
  // txt: texto de una celda; si Excel la convirtió en fecha ("1-2" → 1 de febrero) se avisa
  const txt = (t, r, field) => {
    if (r.v[field] instanceof Date) {
      bad(t, r, field, 'Excel lo ha convertido en fecha. Escríbelo como texto, por ejemplo con apóstrofo: \'1-2');
      return null;
    }
    return opt(r.v[field]);
  };

  // La plantilla antigua tenía la columna Ejercicio dentro de la hoja Sesiones
  const sName = find('sessions');
  if (sName) {
    const head = firstHeader(XLSX, wb.Sheets[sName]).map(key);
    if (head.includes('ejercicio') && !head.includes('codigo')) {
      return fail('Este Excel usa la plantilla antigua. Descarga la plantilla nueva (Plan, Sesiones, Ejercicios y Pautas) y vuelve a subirlo.');
    }
  }

  // --- Hoja Plan ---
  const pName = find('plan');
  if (!pName) {
    fail('Falta la hoja «Plan».');
  } else {
    const t = readTable(XLSX, wb, 'plan', pName, issues);
    if (t.ok) {
      const r = t.rows[0];
      if (!r) {
        issues.push({ sheet: pName, row: '—', column: '—', message: 'La hoja «Plan» no tiene datos.' });
      } else {
        if (t.rows.length > 1) result.warnings.push(`Hoja «${pName}»: solo se usa la primera fila de datos.`);
        const name = text(r.v.name);
        if (!name) bad(t, r, 'name', 'El nombre del plan es obligatorio.');
        const weeks = toInt(r.v.weeks, 1, 52);
        const start = toIsoDate(r.v.start_date);
        const end = toIsoDate(r.v.end_date);
        if (Number.isNaN(weeks)) bad(t, r, 'weeks', 'Las semanas deben ser un número entero de 1 a 52.');
        if (Number.isNaN(start)) bad(t, r, 'start_date', 'Fecha no válida. Usa dd/mm/aaaa o aaaa-mm-dd.');
        if (Number.isNaN(end)) bad(t, r, 'end_date', 'Fecha no válida. Usa dd/mm/aaaa o aaaa-mm-dd.');
        if (start && end && !Number.isNaN(start) && !Number.isNaN(end) && end < start) bad(t, r, 'end_date', 'La fecha de fin es anterior a la de inicio.');
        result.plan = {
          name, description: opt(r.v.description), client_profile: opt(r.v.client_profile), frequency: opt(r.v.frequency),
          goal: opt(r.v.goal), progress: opt(r.v.progress), structure: opt(r.v.structure), footer: opt(r.v.footer),
          weeks: Number.isNaN(weeks) ? null : weeks,
          start_date: Number.isNaN(start) ? null : start, end_date: Number.isNaN(end) ? null : end,
          status: 'draft' // siempre entra como borrador: el entrenador lo activa a mano
        };
      }
    }
  }

  // --- Hoja Sesiones: una fila por sesión; se repite en las semanas indicadas ---
  const defs = new Map();
  if (!sName) {
    fail('Falta la hoja «Sesiones».');
  } else {
    const t = readTable(XLSX, wb, 'sessions', sName, issues);
    for (const r of t.rows) {
      const code = text(r.v.code);
      if (!code) { bad(t, r, 'code', 'Falta el código de la sesión.'); continue; }
      if (defs.has(key(code))) { bad(t, r, 'code', `El código «${code}» está repetido.`); continue; }
      const title = text(r.v.title);
      if (!title) bad(t, r, 'title', 'Falta el título de la sesión.');
      let weeks = toWeeks(r.v.weeks);
      if (Array.isArray(weeks) === false && weeks !== null) { bad(t, r, 'weeks', 'Semanas no válidas. Usa 1-4 o 1,3 (como texto), o déjalo vacío para todas.'); weeks = null; }
      const day = toDay(r.v.day);
      if (Number.isNaN(day)) bad(t, r, 'day', 'Día no válido. Usa lunes…domingo o 1-7, o déjalo vacío.');
      const kindRaw = text(r.v.kind);
      const kind = kindRaw ? KINDS[key(kindRaw)] : 'fuerza';
      if (!kind) bad(t, r, 'kind', 'Tipo no válido. Usa Fuerza, Cardio, Movilidad o Descanso.');
      defs.set(key(code), {
        code, order: defs.size, weeks, day: Number.isNaN(day) ? null : day, kind: kind || 'fuerza', title,
        objective: txt(t, r, 'objective'), focus: txt(t, r, 'focus'), rep_strategy: txt(t, r, 'rep_strategy'),
        key_material: txt(t, r, 'key_material'), cardio_summary: txt(t, r, 'cardio_summary'),
        objective_summary: txt(t, r, 'objective_summary'), tip_title: txt(t, r, 'tip_title'),
        notes: txt(t, r, 'notes'), notes_hint: txt(t, r, 'notes_hint'), exercises: []
      });
    }
  }

  // --- Hoja Ejercicios: cada fila se engancha a su sesión por el código ---
  const eName = find('exercises');
  if (!eName) {
    result.warnings.push('No hay hoja «Ejercicios»: las sesiones quedarán sin ejercicios.');
  } else {
    const t = readTable(XLSX, wb, 'exercises', eName, issues);
    for (const r of t.rows) {
      const name = text(r.v.exercise);
      if (!name) { bad(t, r, 'exercise', 'Falta el nombre del ejercicio.'); continue; }
      const code = text(r.v.session);
      const def = defs.get(key(code));
      if (!def) {
        bad(t, r, 'session', code ? `La sesión «${code}» no existe en la hoja Sesiones.` : 'Falta el código de la sesión.');
        continue;
      }
      const blockRaw = text(r.v.block);
      const block = blockRaw ? BLOCKS[key(blockRaw)] : 'principal';
      if (!block) bad(t, r, 'block', 'Bloque no válido. Usa Calentamiento, Principal, Cardio o Final.');
      const sets = toInt(r.v.sets, 1, 50);
      if (Number.isNaN(sets)) bad(t, r, 'sets', 'Las series deben ser un número entero entre 1 y 50.');
      const video = txt(t, r, 'video');
      if (video && !/^https?:\/\//i.test(video)) bad(t, r, 'video', 'La URL del vídeo debe empezar por http:// o https://');
      def.exercises.push({
        block: block || 'principal', block_title: txt(t, r, 'block_title'), exercise_name: name, exercise_id: null,
        detail: txt(t, r, 'detail'), equipment: txt(t, r, 'equipment'), sets: Number.isNaN(sets) ? null : sets,
        reps: txt(t, r, 'reps'), scheme: txt(t, r, 'scheme'), rir: txt(t, r, 'rir'), rest_text: txt(t, r, 'rest'),
        rest_seconds: null, notes: txt(t, r, 'notes'), video_url: video && /^https?:\/\//i.test(video) ? video : null,
        tag: txt(t, r, 'tag'), sort_order: def.exercises.length
      });
    }
  }

  // --- Expandir las sesiones a una por semana ---
  const planWeeks = result.plan?.weeks || null;
  const allWeeks = Array.from({ length: planWeeks || 1 }, (_, i) => i + 1);
  const sessions = [];
  for (const d of defs.values()) {
    for (const w of d.weeks || allWeeks) {
      const { order, weeks, day, exercises, ...rest } = d;
      sessions.push({ ...rest, def: order, week_number: w, day_number: day, exercises: exercises.map((e) => ({ ...e })) });
    }
  }
  sessions.sort((a, b) => a.week_number - b.week_number || a.def - b.def);
  sessions.forEach((s, i) => { s.sort_order = i; delete s.def; });
  result.sessions = sessions;
  if (result.plan) result.plan.weeks = Math.max(planWeeks || 0, ...sessions.map((s) => s.week_number), 1);
  if (!sessions.length) result.warnings.push('No hay ninguna sesión: el plan quedará vacío (borrador).');

  // --- Hoja Pautas (opcional) ---
  const hName = find('habits');
  if (!hName) {
    result.warnings.push('No hay hoja «Pautas»: el plan no tendrá alimentación, consejos ni formulario de feedback.');
  } else {
    const t = readTable(XLSX, wb, 'habits', hName, issues);
    for (const r of t.rows) {
      const title = text(r.v.title);
      if (!title) { bad(t, r, 'title', 'Falta el título de la pauta.'); continue; }
      const category = CATS[key(r.v.category)];
      if (!category) { bad(t, r, 'category', 'Categoría no válida. Usa: Metodología, Horario, Alimentación, Macros, Equivalencias, Suplementos, Descanso, Hábito, Consejo, Seguridad, Glosario, Seguimiento o Feedback.'); continue; }
      const target = toInt(r.v.target, 2, 100000);
      if (Number.isNaN(target)) bad(t, r, 'target', 'El objetivo diario debe ser un número entero de 2 en adelante.');
      result.habits.push({
        category, title, subtitle: txt(t, r, 'subtitle'), content: txt(t, r, 'content'), detail: txt(t, r, 'detail'),
        frequency: txt(t, r, 'frequency'), checkable: toYes(r.v.checkable),
        target: Number.isNaN(target) ? null : target, unit: txt(t, r, 'unit'), sort_order: result.habits.length
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

// Descarga un Excel en blanco con el formato correcto y una fila de ejemplo por hoja
export async function downloadTemplate() {
  const XLSX = await loadSheetJS();
  const wb = XLSX.utils.book_new();
  const add = (name, rows) => XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name);
  add('Plan', [
    ['Nombre', 'Descripción', 'Usuario', 'Frecuencia', 'Objetivo', 'Progreso', 'Estructura', 'Semanas', 'Fecha inicio', 'Fecha fin', 'Pie de página'],
    ['Mi plan', 'Programa de 4 semanas', 'Cliente (edad | altura | peso)', '4 días / semana', 'Objetivo del plan', '', '', 4, '', '', '']
  ]);
  add('Sesiones', [
    ['Código', 'Semanas', 'Día', 'Tipo', 'Título', 'Objetivo', 'Enfoque principal', 'Estrategia de repeticiones', 'Material clave', 'Cardio (resumen)', 'Objetivo (resumen)', 'Título del aviso', 'Aviso', 'Ayuda anotaciones'],
    ['Sessió 1', '1-4', '', 'Fuerza', 'TREN INFERIOR', 'Objetivo de la sesión', 'Tren inferior', '12-15 reps', 'Premsa, Extensió', '', '', 'Recordatorio', 'Texto del aviso', '(Ex: me he sentido fuerte...)']
  ]);
  add('Ejercicios', [
    ['Sesión', 'Bloque', 'Título del bloque', 'Ejercicio', 'Detalle', 'Material', 'Series', 'Repeticiones', 'Esquema', 'RIR', 'Descanso', 'Consejo técnico', 'Vídeo (URL)', 'Etiqueta'],
    ['Sessió 1', 'Principal', '', 'Premsa de cames', 'Peus separats', 'Màquina premsa', 3, '12-15', '', '2', '75 seg', 'Baixada controlada', '', '']
  ]);
  add('Pautas', [
    ['Categoría', 'Título', 'Subtítulo', 'Contenido', 'Aporte', 'Frecuencia', 'Marcable', 'Objetivo diario', 'Unidad'],
    ['Alimentación', 'Esmorzar (8:00 h)', '', 'Pa integral + ou', '25 g Prot | 40 g Carb', '', 'Sí', '', ''],
    ['Hábito', 'Beber agua', '', '', '', 'Diaria', 'Sí', 8, 'vasos']
  ]);
  XLSX.writeFile(wb, 'plantilla-planificacion.xlsx');
}
