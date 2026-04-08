# HANDOFF — Business OS

## Para qué es este archivo
Log de progreso para que cualquier instancia de IA (Claude, Codex, etc.) pueda retomar el trabajo exactamente donde se dejó. Se actualiza al final de cada sesión.

---

## Estado actual: 2026-04-08 — SESIÓN 1 (completada)

### Resumen
App desplegada y funcionando en Hostinger. Login con PIN, dashboard, sidebar con 8 módulos, dark/light mode. Chatbot de Telegram FUNCIONANDO — responde mensajes, crea leads automáticamente, muestra talleres. CRUD de talleres y leads operativo. Inbox de conversaciones con chat bubbles.

### URL producción
- **App**: https://darkred-kangaroo-559638.hostingersite.com/
- **Health**: https://darkred-kangaroo-559638.hostingersite.com/api/health
- **Webhook Telegram setup**: https://darkred-kangaroo-559638.hostingersite.com/api/webhook/telegram/setup
- **Repo**: https://github.com/Dran9/business-os.git
- **Bot Telegram**: https://t.me/dranTele_bot

### Credenciales y tokens
- **PIN admin**: 4747
- **MySQL**: DB=u926460478_OS, user=u926460478_OS_user, pass=OSultraApp909
- **JWT_SECRET**: bos_j8k2m9x4w7p1v6n3q5t0r
- **TELEGRAM_BOT_TOKEN**: 8284427516:AAEFPXUXnUcxkUxAdRn-n5zYqvlodRcDt7o
- Todas las env vars configuradas en hPanel de Hostinger

### Lo que funciona HOY (probado en producción)
1. **Login con PIN** — 4 casilleros, auto-avance, auto-submit, JWT 90 días
2. **Dashboard** — KPIs: leads, conversiones, talleres activos, ingresos/gastos/neto
3. **Sidebar** — 8 módulos, dark/light toggle, responsive mobile slide-out
4. **Talleres** — CRUD completo: crear, editar, eliminar. Tabla con status, fecha, precio, venue, inscritos
5. **Leads** — Tabla con filtros por status/búsqueda, score bar visual, timeAgo
6. **Conversaciones** — Layout split (lista + chat), tags, message bubbles inbound/outbound
7. **Bot Telegram** — FUNCIONANDO. Responde mensajes, crea leads automáticamente, muestra talleres disponibles con botones inline, maneja fases (welcome → qualifying → interested), escalación a Daniel
8. **Dark mode** — Toggle en sidebar, persiste en localStorage
9. **15 tablas MySQL** — Se crean solas al primer startup con seeds (tenant Daniel + admin PIN)

### Arquitectura del chatbot (IMPORTANTE)

#### Canal agnóstico
```
Telegram/WhatsApp → ChannelAdapter.parseIncoming() → mensaje normalizado
                                                          ↓
                                                    ChatbotEngine.handleMessage()
                                                          ↓
                                                    ChannelAdapter.sendText/sendButtons()
```
- `server/services/channels/base.js` — Interfaz abstracta
- `server/services/channels/telegram.js` — Implementación Telegram Bot API
- Para WhatsApp: crear `server/services/channels/whatsapp.js` que herede de base.js

#### Motor del chatbot
- `server/services/chatbot/engine.js` — State machine con fases:
  - `welcome` → detecta intent (saludo, taller, precio) → muestra botones
  - `qualifying` → muestra talleres, maneja selección, escala a Daniel si pide
  - `interested` → muestra detalles del taller seleccionado con precio, fecha, venue, cupos
- Auto-crea leads en DB con source='telegram'
- Auto-crea conversaciones vinculadas al lead
- Guarda TODOS los mensajes (inbound + outbound) en tabla `messages`
- Actualiza timestamps, contadores, status del lead automáticamente

#### Webhook
- `POST /api/webhook/telegram` — recibe updates de Telegram
- `GET /api/webhook/telegram/setup` — configura el webhook automáticamente
- Responde 200 inmediatamente para evitar retries de Telegram

### Estructura de archivos ACTUAL
```
business-os/
├── server/
│   ├── index.js                     (Express, rutas activas: auth, analytics, webhook, leads, workshops, conversations)
│   ├── db.js                        (MySQL pool + 15 tablas + seeds)
│   ├── routes/
│   │   ├── auth.js                  (PIN login + setup)
│   │   ├── analytics.js             (dashboard KPIs)
│   │   ├── webhook.js               (Telegram webhook + setup)
│   │   ├── workshops.js             (CRUD talleres + venues)
│   │   ├── leads.js                 (CRUD leads + stats)
│   │   └── conversations.js         (lista + mensajes)
│   ├── services/
│   │   ├── channels/
│   │   │   ├── base.js              (interfaz abstracta de canal)
│   │   │   └── telegram.js          (adaptador Telegram Bot API)
│   │   └── chatbot/
│   │       └── engine.js            (motor de playbooks con fases)
│   └── middleware/
│       ├── auth.js                  (JWT)
│       └── tenant.js                (multi-tenant con cache)
├── client/
│   ├── src/
│   │   ├── App.jsx                  (router con lazy loading)
│   │   ├── main.jsx
│   │   ├── index.css                (design system completo)
│   │   ├── pages/
│   │   │   ├── Login.jsx            (PIN 4 dígitos)
│   │   │   ├── Dashboard.jsx        (KPI cards)
│   │   │   ├── Workshops.jsx        (CRUD tabla + form)
│   │   │   ├── Leads.jsx            (tabla + filtros + score)
│   │   │   ├── Conversations.jsx    (inbox split + chat)
│   │   │   ├── Finance.jsx          (placeholder)
│   │   │   ├── Marketing.jsx        (placeholder)
│   │   │   ├── Insights.jsx         (placeholder)
│   │   │   └── Settings.jsx         (placeholder)
│   │   ├── components/layout/
│   │   │   ├── AdminLayout.jsx
│   │   │   └── Sidebar.jsx          (nav + icons + theme toggle)
│   │   ├── hooks/
│   │   │   ├── useAuth.js           (JWT + cross-tab)
│   │   │   └── useTheme.js          (light/dark/system)
│   │   └── utils/
│   │       ├── api.js               (fetch wrapper + 401 redirect)
│   │       └── dates.js             (formatters Bolivia TZ)
│   ├── dist/                        (pre-built, commiteado)
│   └── vite.config.js
├── .claude/skills/                  (9 skills para AI)
├── CLAUDE.md
├── HANDOFF.md
└── package.json
```

---

## Lo que falta — por prioridad

### Fase 2.5: Mejorar chatbot (SIGUIENTE)
- [ ] Integrar LLM (Groq) para fase "educate" — respuestas conversacionales a objeciones
- [ ] Manejar botón "Quiero inscribirme" → enviar QR de pago
- [ ] OCR de comprobantes (copiar de Agenda 4.0)
- [ ] Lead scoring automático basado en interacciones
- [ ] Tags automáticos por LLM en cada mensaje
- [ ] Pushinator para escalaciones a Daniel
- [ ] Secuencia post-inscripción (follow-up automático)
- [ ] Playbooks configurables desde UI

### Fase 3: Finanzas
- [ ] `server/routes/finance.js` — Transacciones CRUD, metas, balance
- [ ] `client/src/pages/Finance.jsx` — Dashboard financiero
- [ ] Integración Agenda 4.0 vía API (endpoint read-only en Agenda)
- [ ] Google Vision OCR para comprobantes

### Fase 4: Marketing + Insights
- [ ] Campañas CRUD, generador de copy con LLM
- [ ] `client/src/pages/Marketing.jsx` — Catálogo de publicidades
- [ ] `client/src/pages/Insights.jsx` — Métricas, embudos, análisis de objeciones
- [ ] Meta Graph API para posts orgánicos (futuro)

### Fase 5: Pulido
- [ ] Settings.jsx — Config por tenant desde UI (logo, colores, API keys)
- [ ] SSE para real-time en inbox (conversaciones nuevas aparecen solas)
- [ ] Migración Telegram → WhatsApp cuando Daniel tenga otro chip
- [ ] Onboarding wizard para venta del software

---

## Decisiones de arquitectura

1. **Multi-tenant en DB** — API keys en tabla `tenants`, no en .env
2. **CSS custom properties** — Theming desde :root, dark mode, multi-tenant branding
3. **PIN de 4 dígitos** — App personal, JWT 90 días
4. **Canal agnóstico** — Adaptadores intercambiables (Telegram ahora, WhatsApp después)
5. **Chatbot fases** — welcome/qualifying/interested con escalación
6. **Groq para tagging, DeepSeek para conversación** — gratis/barato
7. **Lazy loading** — cada página se carga solo cuando se navega
8. **client/dist/ commiteado** — Hostinger no ejecuta builds

## Archivos de referencia en Agenda 4.0
Path: `/Users/dran/Documents/Codex openai/agenda4.0/`
- `server/services/whatsapp.js` — envío WhatsApp Cloud API
- `server/services/ocr.js` — Google Vision OCR
- `server/routes/webhook.js` — webhooks Meta
- `server/services/adminEvents.js` — SSE real-time

## Notas para la próxima sesión
- TODO FUNCIONA EN PRODUCCIÓN. Bot Telegram respondiendo, admin operativo.
- Daniel necesita crear talleres en el admin para que el bot los muestre
- Los webhooks de Meta/WhatsApp están en agenda.danielmaclean.com — NO mover
- Para cambios frontend: editar src/, `cd client && npm run build`, commitear dist/, push
- Env vars en hPanel: DB_HOST, DB_USER, DB_PASSWORD, DB_NAME, JWT_SECRET, TELEGRAM_BOT_TOKEN, PORT, NODE_ENV

---

## Estado actual: 2026-04-08 — SESIÓN 2 (completada)

### Resumen
Se integró una primera capa real de IA y análisis sobre el chatbot, se habilitó Finanzas como módulo funcional y se activó Insights con embudo comercial. También se aclaró la dirección de producto: aunque el schema conserva `tenant_id`, la estrategia actual es **single-tenant por instalación** con pocos usuarios internos por negocio, no SaaS multi-tenant.

### Lo implementado en esta sesión
1. **Groq en el chatbot**
   - Nuevo archivo: `server/services/chatbot/llm.js`
   - Modelo: `llama-3.3-70b-versatile`
   - Endpoint Groq OpenAI-compatible
   - Si no existe `GROQ_API_KEY`, todo sigue funcionando en fallback determinístico
   - En fase `interested`, si el lead hace preguntas libres y ya hay taller seleccionado, el bot usa LLM para responder breve y sin inventar datos

2. **Tags automáticos con LLM**
   - Nuevo archivo: `server/services/analysis/tagger.js`
   - Después de cada mensaje inbound se intenta clasificar:
     - `intent`
     - `sentiment`
     - `quality`
   - Los tags se guardan en `tags` para `message`, `conversation` y `lead`
   - Si no hay `GROQ_API_KEY`, el tagging se omite sin romper el flujo

3. **Lead scoring automático**
   - Nuevo archivo: `server/services/analysis/scorer.js`
   - Recalcula `leads.quality_score` basado en:
     - primer mensaje
     - cantidad de mensajes inbound
     - pregunta de precio
     - intención de inscripción
     - ghosting >48h
     - señal de solo curiosidad

4. **Botón de inscripción**
   - El botón `inscribir_<id>` ya no queda muerto
   - Ahora crea o actualiza `enrollments` en estado `pending` y confirma el interés por chat
   - Todavía NO envía QR ni procesa comprobante; eso sigue pendiente para la siguiente fase

5. **Finanzas funcional**
   - Nueva ruta: `server/routes/finance.js`
   - Activada en `server/index.js`
   - Endpoints:
     - `GET /api/finance/summary`
     - `GET /api/finance/transactions`
     - `POST /api/finance/transactions`
     - `PUT /api/finance/transactions/:id`
     - `DELETE /api/finance/transactions/:id`
     - `PUT /api/finance/goals/current`
   - `client/src/pages/Finance.jsx` ya permite:
     - ver KPIs del mes
     - guardar meta mensual
     - filtrar por mes / tipo / categoría
     - crear, editar y borrar transacciones
   - Categorías soportadas:
     - taller
     - publicidad
     - venue
     - materiales
     - herramientas
     - transporte
     - otros

6. **Insights funcional**
   - `server/routes/analytics.js` ahora tiene `GET /api/analytics/funnel`
   - `client/src/pages/Insights.jsx` ahora muestra:
     - conversión total
     - tasa de pérdida
     - leads calificados
     - leads negociando
     - embudo visual
     - top fuentes de leads

7. **Frontend build**
   - Se reconstruyó `client/dist/`
   - Build OK con `cd client && npm run build`

### Archivos creados/modificados en sesión 2
- `server/services/chatbot/llm.js`
- `server/services/analysis/tagger.js`
- `server/services/analysis/scorer.js`
- `server/routes/finance.js`
- `server/services/chatbot/engine.js`
- `server/routes/analytics.js`
- `server/index.js`
- `client/src/pages/Finance.jsx`
- `client/src/pages/Insights.jsx`
- `client/src/index.css`
- `client/dist/*`
- `CLAUDE.md`
- `HANDOFF.md`

### Pendientes importantes
- Integrar QR de cobro y OCR de comprobantes para la inscripción
- Pushinator para escalaciones a Daniel
- Mejorar scoring con señales más finas del historial
- Evitar acumulación excesiva de tags redundantes si el volumen crece
- Conectar Finanzas con Agenda 4.0 para consolidado
- Hacer `Marketing.jsx` funcional
- Hacer `Settings.jsx` funcional
- Revisar seguridad de PIN por defecto antes de poner esto realmente expuesto

### Notas operativas
- El webhook de Telegram ya quedó confirmado en producción:
  - `GET /api/webhook/telegram/setup` respondió `Webhook is already set`
  - y el bot respondió mensajes reales
- Multi-tenant real NO es prioridad hoy
- La prioridad práctica es: una instalación por cliente + pocos miembros de equipo

### Verificación hecha
- `node --check` del backend modificado: OK
- `cd client && npm run build`: OK

---

## Estado actual: 2026-04-08 — SESIÓN 4 (completada)

### Resumen
Se integró la base de cobros por QR y OCR para Business OS, tomando como referencia operativa el flujo de `agenda4.0`. Ahora la app ya soporta 4 opciones configurables de pago con QR, envío del QR correcto por Telegram y validación automática de comprobantes usando Google Vision con las 3 reglas clave: destinatario, monto y fecha contra el último contexto de pago enviado.

### Qué se tomó de agenda4.0 como inspiración real
- **Configuración admin de QR**: upload simple desde panel, una tarjeta por opción
- **OCR por Google Vision**: parsing de comprobantes bolivianos
- **Validación correcta del comprobante**:
  1. cuenta destino válida
  2. monto correcto
  3. fecha del comprobante no anterior al último QR/recordatorio enviado
- **Decisión importante**: validar contra el último contexto de pago enviado, no contra la fecha del taller

### Lo implementado en esta sesión
1. **Configuración de cobros**
   - Nueva ruta: `server/routes/settings.js`
   - Endpoints:
     - `GET /api/settings/payment-options`
     - `PUT /api/settings/payment-options`
     - `POST /api/settings/payment-options/:slot/qr`
     - `GET /api/settings/payment-options/:slot/qr`
   - 4 slots configurables por instalación:
     - etiqueta
     - monto
     - activo/inactivo
     - imagen QR
   - Esto permite casos como:
     - `Precio constelar`
     - `Precio participar`
     - más 2 opciones extra si se necesitan

2. **Schema y storage**
   - `tenants` ahora guarda:
     - `payment_options` (JSON)
     - `payment_destination_accounts` (TEXT)
     - `payment_qr_1..4`
     - `payment_qr_1_mime..payment_qr_4_mime`
   - `enrollments` ahora guarda:
     - `payment_requested_at`
     - `verified_at`
     - `payment_proof`
     - `payment_proof_type`
     - `ocr_data`

3. **OCR**
   - Nuevo archivo: `server/services/ocr.js`
   - Usa `GOOGLE_VISION_API_KEY`
   - Extrae:
     - nombre
     - monto
     - fecha
     - hora si aparece
     - referencia
     - banco
     - cuenta destino
     - texto raw

4. **Workflow de cobro en chatbot**
   - Nuevo archivo: `server/services/chatbot/paymentWorkflow.js`
   - Al tocar `inscribir_<id>`:
     - se crea o actualiza `enrollment`
     - si hay una sola opción activa, el bot manda el QR directamente
     - si hay varias opciones activas, el bot pide elegir una
   - Al tocar `payopt_<slot>`:
     - se manda el QR correcto por Telegram
     - se guarda contexto de pago en `conversations.metadata.payment_request`

5. **Comprobante por Telegram**
   - `server/services/channels/telegram.js` ahora:
     - detecta `mediaFileId`, nombre y mime
     - puede descargar el archivo real desde Telegram
     - puede enviar imágenes por buffer, no solo por URL
   - `server/services/chatbot/engine.js` ahora procesa imágenes/documentos como posible comprobante

6. **Validación automática**
   - Si llega imagen/documento y existe contexto de pago:
     - se descarga el archivo
     - se corre OCR
     - se validan 3 reglas:
       1. **destinatario**: la cuenta destino detectada debe estar en `payment_destination_accounts`
       2. **monto**: debe coincidir con la opción de pago enviada
       3. **fecha**: no puede ser anterior al momento en que se mandó el QR
   - Si pasa:
     - `enrollment.payment_status = 'paid'`
     - `enrollment.status = 'confirmed'`
     - se crea o actualiza `transactions` como ingreso verificado por OCR
     - lead y conversación pasan a `converted`
   - Si falla:
     - se guarda el comprobante igual
     - se guardan problemas en `ocr_data`
     - se responde con mensaje de mismatch entendible

7. **Settings UI**
   - `client/src/pages/Settings.jsx` ahora tiene sección de:
     - equipo interno
     - cobros, QR y OCR
   - Se pueden:
     - cargar 4 QRs
     - definir etiqueta y monto por slot
     - activar/desactivar slots
     - definir cuentas destino válidas para OCR

8. **Infra / dependencia**
   - Se instaló `multer` en raíz para uploads multipart
   - `.env.example` ahora incluye `TELEGRAM_BOT_TOKEN`

### Archivos creados/modificados en sesión 4
- `server/routes/settings.js`
- `server/services/paymentOptions.js`
- `server/services/ocr.js`
- `server/services/chatbot/paymentWorkflow.js`
- `server/db.js`
- `server/middleware/tenant.js`
- `server/index.js`
- `server/services/channels/base.js`
- `server/services/channels/telegram.js`
- `server/services/chatbot/engine.js`
- `client/src/utils/api.js`
- `client/src/pages/Settings.jsx`
- `.env.example`
- `package.json`
- `package-lock.json`
- `client/dist/*`
- `CLAUDE.md`
- `HANDOFF.md`

### Límites actuales / siguientes pasos
- Las 4 opciones de pago son globales por instalación, no por taller
- Para el caso de Daniel eso alcanza bien para `constelar` y `participar`, pero si luego hay pricing muy distinto por cada taller convendría volverlo por workshop
- La validación de fecha hoy compara correctamente contra el contexto del QR enviado; si más adelante se necesita precisión horaria estricta, se puede endurecer usando hora OCR cuando el banco la exponga bien
- Falta exponer en UI una vista clara de enrollments y pagos verificados/mismatch

### Verificación hecha
- `node --check` del backend modificado: OK
- `cd client && npm run build`: OK

---

## Estado actual: 2026-04-08 — SESIÓN 3 (completada)

### Resumen
Se agregó soporte real para equipo interno dentro de una sola instalación. Ahora Daniel puede crear otros usuarios para operar la app, iniciar sesión con `username + PIN`, y asignar conversaciones manualmente. Esto deja el producto mejor alineado con el uso real: un negocio por instalación, con pocas personas del equipo operando juntas.

### Lo implementado en esta sesión
1. **Equipo interno**
   - Nueva ruta: `server/routes/team.js`
   - Endpoints:
     - `GET /api/team`
     - `POST /api/team`
     - `PUT /api/team/:id`
     - `DELETE /api/team/:id`
   - Roles soportados:
     - `owner`
     - `admin`
     - `viewer`

2. **Schema de usuarios mejorado**
   - `admin_users` ahora soporta:
     - `display_name`
     - `active`
   - Se agregaron migraciones idempotentes en `server/db.js`
   - El owner seed queda con `display_name = 'Daniel'`

3. **Login actualizado**
   - `client/src/pages/Login.jsx` ahora pide usuario y PIN
   - `server/routes/auth.js` ahora autentica por `username + pin`
   - Nuevo endpoint `GET /api/auth/me`
   - Se mantiene compatibilidad práctica si no se envía username

4. **Sesión del usuario en frontend**
   - `client/src/hooks/useAuth.js` ahora guarda y rehidrata `bos_user`
   - `client/src/utils/api.js` ahora persiste usuario junto al token
   - Sidebar muestra el usuario logueado y su rol

5. **Asignación manual de conversaciones**
   - Nuevo endpoint:
     - `PUT /api/conversations/:id/assign`
   - `client/src/pages/Conversations.jsx` ahora:
     - carga el equipo
     - permite asignar la conversación seleccionada
     - muestra en la lista a quién está asignado cada chat

6. **Settings funcional**
   - `client/src/pages/Settings.jsx` dejó de ser placeholder
   - Ya permite:
     - ver usuarios internos
     - crear usuario nuevo
     - activar/desactivar usuario
     - eliminar usuario

7. **Fix adicional**
   - `GET /api/leads/stats/summary` fue movido antes de `/:id` en `server/routes/leads.js`, así ya no queda tapado por la ruta dinámica

### Archivos creados/modificados en sesión 3
- `server/routes/team.js`
- `server/db.js`
- `server/routes/auth.js`
- `server/middleware/auth.js`
- `server/routes/conversations.js`
- `server/routes/leads.js`
- `server/index.js`
- `client/src/utils/api.js`
- `client/src/hooks/useAuth.js`
- `client/src/App.jsx`
- `client/src/components/layout/AdminLayout.jsx`
- `client/src/components/layout/Sidebar.jsx`
- `client/src/pages/Login.jsx`
- `client/src/pages/Conversations.jsx`
- `client/src/pages/Settings.jsx`
- `client/src/index.css`
- `client/dist/*`
- `CLAUDE.md`
- `HANDOFF.md`

### Cómo usarlo ahora
- Usuario inicial:
  - `owner`
  - PIN actual: `4747`
- Desde **Configuración**, crear usuario nuevo para otra persona del equipo
- Luego esa persona entra con su propio `username + PIN`
- Desde **Conversaciones**, puedes asignar cada chat al usuario que lo va a trabajar

### Pendientes siguientes con más sentido
- Permitir editar nombre visible, rol y PIN desde Settings sin borrar/recrear usuario
- Agregar filtro por asignado en Conversaciones
- Añadir notas internas por conversación
- Integrar QR/OCR para cerrar la inscripción con cobro real

### Verificación hecha
- `node --check` del backend modificado: OK
- `cd client && npm run build`: OK
