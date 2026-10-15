// Efectos visuales y táctiles. Respetan "reducir movimiento" del sistema.
const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const fmtKg = (n) => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const mmss = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

export const haptic = (pattern = 12) => { try { navigator.vibrate?.(pattern); } catch { /* no disponible */ } };

// Hace que un número "cuente" de un valor a otro. Si se llama de nuevo sobre el mismo elemento, la anterior se cancela.
export function countUp(el, to, { from = 0, duration = 900, format = (n) => String(Math.round(n)) } = {}) {
  if (!el) return;
  const token = {};
  el.__fx = token;
  if (reduced() || from === to || typeof requestAnimationFrame !== 'function') { el.textContent = format(to); return; }
  const t0 = performance.now();
  const step = (now) => {
    if (el.__fx !== token) return;
    const p = Math.min((now - t0) / duration, 1);
    el.textContent = format(from + (to - from) * (1 - (1 - p) ** 3));
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// Pequeño destello verde alrededor de un botón
export function sparkBurst(el) {
  if (reduced() || !el) return;
  const r = el.getBoundingClientRect();
  const wrap = document.createElement('div');
  wrap.className = 'spark-wrap';
  wrap.style.left = `${r.left + r.width / 2}px`;
  wrap.style.top = `${r.top + r.height / 2}px`;
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const s = document.createElement('span');
    s.className = 'spark';
    s.style.setProperty('--dx', `${Math.cos(a) * 34}px`);
    s.style.setProperty('--dy', `${Math.sin(a) * 34}px`);
    wrap.append(s);
  }
  document.body.append(wrap);
  setTimeout(() => wrap.remove(), 700);
}

export function confetti(count = 70) {
  if (reduced()) return;
  const colors = ['#5B8CFF', '#FF7A2F', '#34F5A4', '#FFC15A', '#F3F6FF'];
  const box = document.createElement('div');
  box.className = 'confetti';
  for (let i = 0; i < count; i++) {
    const p = document.createElement('i');
    p.style.cssText = `left:${Math.random() * 100}%;background:${colors[i % colors.length]};--x:${(Math.random() - .5) * 140}px;--r:${Math.random() * 720}deg;--t:${1.6 + Math.random() * 1.4}s;animation-delay:${Math.random() * .3}s`;
    box.append(p);
  }
  document.body.append(box);
  setTimeout(() => box.remove(), 3600);
}

// "2-2.5 min" → 150, "60-75 seg" → 75, "90 seg" → 90. Con rangos usa el valor más alto.
export function parseRest(text, seconds) {
  if (seconds) return Number(seconds);
  const nums = String(text || '').match(/\d+(?:[.,]\d+)?/g);
  if (!nums) return 0;
  const n = Math.max(...nums.map((x) => Number(x.replace(',', '.'))));
  return Math.round(/min/i.test(text) ? n * 60 : n);
}

// ---------- Temporizador de descanso (círculo que se vacía) ----------
let restEl = null;
let restId = null;
export function stopRest() {
  clearInterval(restId);
  restEl?.remove();
  restEl = null;
}

export function startRest(seconds, label = 'Descanso') {
  stopRest();
  if (!seconds || seconds < 5) return;
  const end = Date.now() + seconds * 1000;
  const el = document.createElement('div');
  el.className = 'rest-timer';
  el.setAttribute('role', 'timer');
  el.innerHTML = `
    <svg class="rest-ring" viewBox="0 0 36 36" aria-hidden="true">
      <circle class="track" cx="18" cy="18" r="15" pathLength="100"/>
      <circle class="fill" cx="18" cy="18" r="15" pathLength="100" style="animation-duration:${seconds}s"/>
    </svg>
    <div><div class="rest-time">${mmss(seconds)}</div><div class="muted small"></div></div>
    <button type="button" class="btn btn-secondary rest-skip">Saltar</button>`;
  el.querySelector('.small').textContent = label;
  el.querySelector('.rest-skip').onclick = stopRest;
  document.body.append(el);
  restEl = el;
  restId = setInterval(() => {
    const left = Math.max(0, Math.ceil((end - Date.now()) / 1000));
    el.querySelector('.rest-time').textContent = mmss(left);
    if (left > 0) return;
    clearInterval(restId);
    haptic([200, 100, 200]);
    el.classList.add('done');
    el.querySelector('.small').textContent = '¡A por la siguiente serie!';
    el.querySelector('.rest-skip').textContent = 'Vale';
    setTimeout(() => { if (restEl === el) stopRest(); }, 4000);
  }, 250);
}

// ---------- Pantalla de celebración al terminar el entrenamiento ----------
export function funFact(kg) {
  if (kg >= 6000) return 'Más que un elefante africano.';
  if (kg >= 1000) return `Como ${(kg / 1000).toFixed(1).replace('.', ',')} coches pequeños.`;
  return '';
}

export function celebrate({ title, kg, extra = '', onClose } = {}) {
  const el = document.createElement('div');
  el.className = 'celebrate';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.innerHTML = `
    <div class="panel stack">
      <h2></h2>
      <div class="num-xl" data-kg>0 kg</div>
      <p class="muted">levantados en este entrenamiento</p>
      <p data-fact></p>
      <p class="muted small" data-extra></p>
      <button type="button" class="btn btn-lg btn-block">Continuar</button>
    </div>`;
  el.querySelector('h2').textContent = title || '¡Entrenamiento completado!';
  el.querySelector('[data-fact]').textContent = funFact(kg);
  el.querySelector('[data-extra]').textContent = extra;
  document.body.append(el);
  confetti();
  haptic([30, 40, 30]);
  countUp(el.querySelector('[data-kg]'), kg, { duration: 1400, format: (n) => `${fmtKg(n)} kg` });
  el.querySelector('button').onclick = () => { el.remove(); onClose?.(); };
  el.querySelector('button').focus();
}
