import { render, $, esc, toast, setBusy, friendlyError } from '../ui.js';
import { acceptGdpr } from '../auth.js';
import { APP_NAME, CONTACT_EMAIL, GDPR_VERSION } from '../config.js';

// TEXTO MODELO: debe revisarlo un profesional legal antes de usar la app con clientes reales.
export function showConsent(profile, onAccepted, onLogout) {
  render(`
    <section class="stack-lg">
      <div>
        <h1>Antes de empezar</h1>
        <p class="muted">Necesitamos tu permiso para tratar tus datos. Léelo con calma.</p>
      </div>

      <div class="consent-box stack" tabindex="0" aria-label="Política de privacidad">
        <h3>Quién es el responsable</h3>
        <p>Tu entrenador, a través de ${esc(APP_NAME)}. Contacto: ${esc(CONTACT_EMAIL)}.</p>
        <h3>Qué datos tratamos y para qué</h3>
        <p>Tu email, nombre, planes de entrenamiento, series registradas, molestias o dolores que anotes
           (datos de salud) y mensajes con tu entrenador. Solo se usan para preparar y seguir tu entrenamiento.</p>
        <h3>Base legal</h3>
        <p>Tu consentimiento explícito. Puedes retirarlo en cualquier momento pidiéndolo a tu entrenador.</p>
        <h3>Quién accede a tus datos</h3>
        <p>Solo tú y tu entrenador. Los datos se guardan en servidores de Supabase en la Unión Europea,
           que actúa como encargado del tratamiento.</p>
        <h3>Cuánto tiempo se conservan</h3>
        <p>Mientras dure tu relación con tu entrenador. Después se borran cuando lo solicites.</p>
        <h3>Tus derechos</h3>
        <p>Acceso, rectificación, supresión, limitación, oposición y portabilidad, escribiendo a ${esc(CONTACT_EMAIL)}.
           También puedes reclamar ante la Agencia Española de Protección de Datos (aepd.es).</p>
        <h3>Menores de edad</h3>
        <p>Si eres menor, tu entrenador necesita además el consentimiento de tu madre, padre o tutor legal.</p>
        <p class="muted">Versión ${esc(GDPR_VERSION)}</p>
      </div>

      <div class="stack">
        <label class="check">
          <input type="checkbox" id="c-privacy">
          <span>He leído y acepto la política de privacidad.</span>
        </label>
        <label class="check">
          <input type="checkbox" id="c-health">
          <span>Doy mi consentimiento explícito para que mi entrenador trate mis datos de salud
                (molestias, dolores y progresos) para gestionar mi entrenamiento.</span>
        </label>
        <button id="accept" class="btn btn-lg btn-block" type="button" disabled>Aceptar y continuar</button>
        <button id="logout" class="btn btn-ghost btn-block" type="button">Salir sin aceptar</button>
      </div>
    </section>`);

  const privacy = $('#c-privacy');
  const health = $('#c-health');
  const btn = $('#accept');
  const sync = () => { btn.disabled = !(privacy.checked && health.checked); };
  privacy.onchange = health.onchange = sync;

  btn.onclick = async () => {
    setBusy(btn, true);
    try {
      await acceptGdpr(profile.id);
      toast('Consentimiento registrado.', 'ok');
      onAccepted();
    } catch (err) {
      toast(friendlyError(err), 'error');
      setBusy(btn, false);
      sync();
    }
  };
  $('#logout').onclick = onLogout;
}
