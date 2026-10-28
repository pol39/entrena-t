# Entrenador PWA

Aplicación web de entrenamiento personal para un entrenador y sus clientes.
Se instala en el móvil como una app (PWA) y funciona con:

- **Frontend:** HTML + CSS + JavaScript vanilla (módulos ES), sin frameworks ni Node.js.
- **Backend:** Supabase (Auth, Postgres y Storage), en región UE.
- **Publicación:** GitHub Pages.
- **Excel:** SheetJS, guardado dentro del proyecto (`lib/`).

---

## 1. Estado del proyecto

**Funciona (probado en un entorno simulado; falta probarlo con tu Supabase real):**

- Inicio de sesión y registro de clientes por invitación del entrenador.
- Consentimiento RGPD en el primer acceso, con fecha y versión guardadas.
- Panel del entrenador: lista de clientes, invitaciones, consentimiento del tutor de menores.
- Planificación: importar un Excel, ver cualquier plan como lo verá el cliente, activarlo con fecha de inicio, archivarlo o borrarlo.
- App del cliente: Inicio, Sesión, Microciclo y Guía.
- Registro de series en dos toques con autorrelleno, temporizador de descanso, RIR real, molestias y anotaciones.
- Recuento del peso levantado según el tipo de ejercicio.
- Hábitos marcables y con contador, mensajes entre cliente y entrenador.
- Modo sin conexión básico (service worker).

**Pendiente:** ver el apartado 12.

---

## 2. Estructura de carpetas

```
entrenador-pwa/
├── index.html
├── manifest.json
├── sw.js                      Service worker (modo sin conexión)
├── README.md
├── icons/                     icon-192.png, icon-512.png, icon-maskable-512.png
├── lib/
│   └── xlsx.full.min.js       SheetJS en local
├── css/
│   ├── base.css               variables, tipografía, botones
│   ├── components.css         tarjetas, formularios, barra inferior…
│   └── gym.css                tema visual (azul noche), animaciones, lateral del entrenador
├── js/                        TODO suelto, sin subcarpetas
│   ├── config.js              URL y clave pública de Supabase (tuyo, no se comparte)
│   ├── supabaseClient.js      cliente único de Supabase
│   ├── app.js                 arranque y reparto cliente / entrenador
│   ├── auth.js                login, registro, consentimiento
│   ├── welcome.js, consent.js pantallas de entrada y de consentimiento RGPD
│   ├── ui.js                  utilidades (render, avisos, errores)
│   ├── fx.js                  efectos: contadores, confeti, temporizador, vibración
│   ├── metrics.js             reglas de recuento por tipo de ejercicio
│   ├── plans.js               planes: guardar, activar, archivar, leer
│   ├── excelParser.js         lector de la plantilla Excel
│   ├── importPlan.js          pantalla de importación con vista previa
│   ├── clientApp.js           estructura de las 4 pestañas del cliente
│   ├── clientData.js          datos del cliente (series, sesiones, mensajes…)
│   ├── viewHome.js            Inicio
│   ├── viewSession.js         Sesión
│   ├── viewCycle.js           Microciclo
│   ├── viewGuide.js           Guía
│   ├── trainerApp.js          estructura del entrenador (Clientes / Planificación)
│   ├── trainerClients.js      pestaña Clientes
│   └── trainerPlans.js        pestaña Planificación
├── sql/
│   ├── schema.sql             tablas, RLS y bucket de vídeos
│   ├── migration_02.sql       app del cliente
│   ├── migration_03.sql       hábitos con contador
│   ├── migration_04.sql       tipos de ejercicio, peso corporal, fechas de plan
│   ├── migration_05.sql       contenido completo del plan y seguimiento
│   └── datos_de_prueba.sql    opcional: datos para un cliente de prueba
└── plantilla/
    └── plantilla-planificacion.xlsx
```

---

## 3. Qué necesitas

- Una cuenta gratuita en **Supabase** (supabase.com).
- Una cuenta gratuita en **GitHub** (github.com).
- Un navegador. No hace falta instalar nada en el ordenador.

---

## 4. Puesta en marcha (solo la primera vez)

### 4.1 Crear el proyecto en Supabase

1. Crea un proyecto nuevo y elige una región de la **Unión Europea** (Frankfurt o Irlanda).
2. Guarda la contraseña de la base de datos en un gestor de contraseñas.
3. Espera a que el proyecto termine de prepararse (suele tardar un par de minutos).

### 4.2 Crear las tablas

En **SQL Editor > New query**, pega y ejecuta cada archivo **entero y en este orden**:

1. `sql/schema.sql`
2. `sql/migration_02.sql`
3. `sql/migration_03.sql`
4. `sql/migration_04.sql`
5. `sql/migration_05.sql`

Cada uno debe terminar con "Success". Se pueden repetir sin riesgo.

Comprobación final: ejecuta esto y mira que todas las filas digan `true` en `rowsecurity`:

```sql
select tablename, rowsecurity from pg_tables where schemaname = 'public' order by 1;
```

### 4.3 Configurar el acceso

En **Authentication**:

- **URL Configuration:** en *Site URL* pon la dirección de tu GitHub Pages, por ejemplo `https://TUUSUARIO.github.io/entrenador-pwa/`.
- **Sign In / Providers > Email:** decide si se exige confirmar el email. Para pruebas puedes desactivarlo; para uso real se recomienda activarlo.

### 4.4 Crear tu cuenta de entrenador

Por seguridad, cualquier cuenta nueva nace como *cliente*; nadie puede darse a sí mismo el rol de entrenador desde la web.

1. En **Authentication > Users > Add user**, crea tu usuario con email y contraseña (marca *Auto Confirm*).
2. En el **SQL Editor** ejecuta, con tu email:

```sql
update public.profiles set role = 'trainer' where email = 'tu@email.com';
```

Debe decir "1 row affected".

### 4.5 Conectar la web con Supabase

En Supabase, entra en **Project Settings > API Keys** y copia:

- La **Project URL** (`https://xxxx.supabase.co`).
- La clave **anon public** (o *publishable*). Nunca la `service_role` ni la `secret`.

Edita `js/config.js`:

```js
export const SUPABASE_URL = 'https://xxxx.supabase.co';
export const SUPABASE_ANON_KEY = 'tu-clave-anon-en-una-sola-linea';
export const APP_NAME = 'Entrenador PWA';
export const CONTACT_EMAIL = 'tu-email-de-contacto@ejemplo.com'; // responsable del tratamiento
export const GDPR_VERSION = '1.0';
```

La clave anon es pública por diseño: la protegen las políticas de seguridad (RLS). Pégala entera, en una sola línea y entre comillas.

### 4.6 Descargar SheetJS

Descarga `xlsx.full.min.js` desde la web oficial de SheetJS (versión 0.20.x) o desde cdnjs, y guárdalo como `lib/xlsx.full.min.js`.

### 4.7 Iconos

Crea tres PNG en `icons/`: `icon-192.png` (192×192), `icon-512.png` (512×512) e `icon-maskable-512.png` (512×512, con el logo centrado y margen alrededor). Sin ellos la app funciona, pero no se instala con icono propio.

### 4.8 Publicar en GitHub Pages

1. Crea un repositorio **público** llamado `entrenador-pwa`.
2. Sube todos los archivos con **Add file > Upload files** (arrastra las carpetas; GitHub no admite carpetas vacías).
3. En **Settings > Pages**, elige *Deploy from a branch*, rama `main`, carpeta `/ (root)`, y guarda.
4. Espera 1 o 2 minutos y abre la dirección que aparece.

**Importante:** el repositorio es público, así que **nunca subas datos reales de clientes**. La clave `anon` sí puede estar; la `service_role`, jamás.

---

## 5. Actualizar la web

1. En github.com, entra en la carpeta del archivo y usa **Add file > Upload files** con el mismo nombre y en la misma ruta (lo sustituye), o el lápiz para editar.
2. Pulsa **Commit changes**.
3. Espera 1 o 2 minutos y recarga con **Ctrl+Shift+R** (en el móvil, cierra y abre la app).
4. Si cambias de forma importante la lista de archivos, sube también `VERSION` en `sw.js` (por ejemplo, de `v1` a `v2`) para limpiar la caché antigua.

Todos los archivos de `js/` van **sueltos en la misma carpeta**; si dejas alguno en una subcarpeta, la app se queda en "Cargando…".

---

## 6. Cómo se usa

### Entrenador

- **Clientes:** una tarjeta por cliente con su estado y su plan activo.
  - **Invitar cliente:** escribe su email (en minúsculas) y marca si es menor. El cliente debe registrarse en la app con **ese mismo email**; así queda vinculado a ti automáticamente.
  - **Abrir cliente:** ves exactamente lo que ve él (Inicio, Sesión, Microciclo, Guía), en solo lectura. En pantallas anchas, las 4 pestañas van en un lateral; en el móvil, abajo, con un botón "← Clientes". Hay un selector de semana para recorrer todo el plan.
  - **Menores:** hasta que registres el consentimiento de su tutor, no pueden entrar.
- **Planificación:**
  1. **Importar plan desde Excel:** elige el cliente y el archivo. Verás una vista previa completa o los errores con hoja, fila y columna.
  2. **Guardar como borrador:** el cliente aún no lo ve.
  3. **Ver como el cliente:** abre cualquier plan, aunque sea borrador.
  4. **Activar:** eliges desde qué día rige. El plan activo pasa a archivado y **todo lo registrado se conserva**.
  5. **Archivar / Borrar:** un plan con registros del cliente no se puede borrar desde la app; se archiva.

### Cliente

1. Se registra con el email con el que lo invitó el entrenador.
2. Acepta la política de privacidad y el consentimiento de datos de salud.
3. Pestañas: **Inicio** (progreso semanal, sesión de hoy, hábitos, peso levantado), **Sesión** (ejercicios, vídeo, registro de series), **Microciclo** (progreso por semanas) y **Guía** (recomendaciones y mensajes).
4. En Sesión: la serie se valida con un toque (peso y repeticiones vienen rellenos con los de la última vez), y arranca el temporizador de descanso.

---

## 7. La plantilla Excel

Archivo: `plantilla/plantilla-planificacion.xlsx`. La app lee estas hojas (las demás se ignoran). No cambies los títulos de la fila 1 ni los nombres de las hojas.

| Hoja | Qué contiene |
|---|---|
| **Plan** | Nombre (obligatorio), descripción, usuario, frecuencia, objetivo, semanas, fechas, pie de página |
| **Sesiones** | Una fila por sesión: código (obligatorio), semanas (`1-4`), día, tipo, título (obligatorio), objetivo, enfoque, estrategia de repeticiones, material clave, aviso y ayuda de anotaciones |
| **Ejercicios** | Una fila por ejercicio: sesión (código), ejercicio (obligatorios), bloque, detalle, material, series, repeticiones, esquema, RIR, descanso, consejo técnico, vídeo (URL), etiqueta |
| **Pautas** | Categoría y título (obligatorios), subtítulo, contenido, aporte, marcable, objetivo diario y unidad |

- **Semanas:** una sesión escrita una vez se repite en las semanas indicadas (`1-4`, `1,3`, o vacío para todas).
- **Categorías de pautas:** Metodología, Horario, Alimentación, Macros, Equivalencias, Suplementos, Descanso, Hábito, Consejo, Seguridad, Glosario, Seguimiento y Feedback.
- Una pauta con título pero sin contenido es una **cabecera de sección**.
- **Marcable = Sí:** el cliente la marca cada día (por ejemplo, cada comida).
- **Objetivo diario y Unidad** convierten un hábito en contador (8 vasos, 8.000 pasos).
- Los calentamientos y la movilidad se añaden solo si tu plan los incluye (columna *Bloque*).
- La hoja **Registro** reproduce las tablas del PDF y se ignora al importar: el cliente las rellena en la app.
- Los valores como `1-2` o `4-6` deben ser **texto**; la plantilla ya está preparada para que Excel no los convierta en fechas.

---

## 8. Cómo se cuenta el peso levantado

| Tipo | Ejemplos | Qué suma |
|---|---|---|
| Carga | premsa, press, remos | peso ×
