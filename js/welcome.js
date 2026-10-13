import { render, renderNotice, $, setBusy, friendlyError } from './ui.js';
import { signIn, signUp } from './auth.js';
import { APP_NAME } from './config.js';

export function showWelcome(onDone) {
  draw('login');

  function draw(mode) {
    const isLogin = mode === 'login';
    render(`
      <section class="welcome">
        <div>
          <h1>${APP_NAME}</h1>
          <p class="muted">${isLogin
            ? 'Entra para ver tu entrenamiento.'
            : 'Crea tu cuenta con el mismo email con el que te ha invitado tu entrenador.'}</p>
        </div>
        <form id="auth-form" class="stack" novalidate>
          <div class="field">
            <label for="email">Email</label>
            <input class="input" id="email" type="email" inputmode="email" autocomplete="email" required>
          </div>
          <div class="field">
            <label for="password">Contraseña</label>
            <input class="input" id="password" type="password" required
                   autocomplete="${isLogin ? 'current-password' : 'new-password'}">
            ${isLogin ? '' : '<span class="field-hint">Mínimo 8 caracteres.</span>'}
          </div>
          <p id="form-error" class="field-error" role="alert" hidden></p>
          <button id="submit" class="btn btn-lg btn-block" type="submit">
            ${isLogin ? 'Entrar' : 'Crear cuenta'}
          </button>
        </form>
        <button id="toggle" class="btn btn-ghost btn-block" type="button">
          ${isLogin ? 'Soy cliente nuevo: crear cuenta' : 'Ya tengo cuenta: entrar'}
        </button>
      </section>`);

    const showErr = (msg) => {
      const el = $('#form-error');
      el.textContent = msg;
      el.hidden = false;
    };

    $('#toggle').onclick = () => draw(isLogin ? 'register' : 'login');

    $('#auth-form').onsubmit = async (e) => {
      e.preventDefault();
      $('#form-error').hidden = true;
      const email = $('#email').value.trim().toLowerCase();
      const password = $('#password').value;

      if (!/^\S+@\S+\.\S+$/.test(email)) return showErr('Escribe un email válido.');
      if (!password) return showErr('Escribe tu contraseña.');
      if (!isLogin && password.length < 8) return showErr('La contraseña debe tener al menos 8 caracteres.');

      const btn = $('#submit');
      setBusy(btn, true);
      try {
        if (isLogin) {
          await signIn(email, password);
          return onDone();
        }
        const { session } = await signUp(email, password);
        if (session) return onDone();
        renderNotice('Revisa tu correo',
          'Te hemos enviado un enlace para confirmar tu cuenta. Después vuelve aquí y entra.',
          'Volver a entrar', () => draw('login'));
      } catch (err) {
        showErr(friendlyError(err));
        setBusy(btn, false);
      }
    };
  }
}
