export const $ = (sel, root = document) => root.querySelector(sel);

// Escapa texto para insertarlo en HTML sin riesgo de inyección
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function render(html, { wide = false } = {}) {
  const app = $('#app');
  app.innerHTML = html;
  app.classList.toggle('wide', wide);
  window.scrollTo(0, 0);
  return app;
}

export function toast(msg, type = '', ms = 3500) {
  const el = document.createElement('div');
  el.className = type ? `toast toast-${type}` : 'toast';
  el.textContent = msg;
  $('#toasts').append(el);
  setTimeout(() => el.remove(), ms);
}

export function setBusy(btn, busy) {
  btn.disabled = busy;
  btn.setAttribute('aria-busy', String(busy));
}

// Pantalla simple: título + texto + un botón
export function renderNotice(title, text, label, onClick) {
  render(`
    <section class="welcome">
      <h1>${esc(title)}</h1>
      <p>${esc(text)}</p>
      <button class="btn btn-lg btn-block" id="notice-btn" type="button">${esc(label)}</button>
    </section>`);
  $('#notice-btn').onclick = onClick;
}

export function friendlyError(err) {
  console.error(err);
  if (!navigator.onLine) return 'Sin conexión a internet. Inténtalo de nuevo cuando tengas cobertura.';
  const m = String(err?.message || err || '');
  if (/Invalid login credentials/i.test(m)) return 'Email o contraseña incorrectos.';
  if (/Email not confirmed/i.test(m)) return 'Aún no has confirmado tu email. Revisa tu bandeja de entrada.';
  if (/already registered/i.test(m)) return 'Ya existe una cuenta con ese email. Prueba a entrar.';
  if (/Password should be|weak/i.test(m)) return 'La contraseña es demasiado débil. Usa al menos 8 caracteres.';
  if (/rate limit|too many/i.test(m)) return 'Demasiados intentos. Espera unos minutos.';
  if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return 'No se pudo conectar con el servidor. Comprueba tu conexión.';
  return 'Algo ha fallado. Inténtalo de nuevo.';
}
