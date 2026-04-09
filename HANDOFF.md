# HANDOFF — Business OS

## Para qué es este archivo
Log de progreso para que cualquier instancia de IA (Claude, Codex, etc.) pueda retomar el trabajo exactamente donde se dejó. Se actualiza al final de cada sesión.

---

## Estado actual: 2026-04-09 — SESIÓN 20 (completada)

### Resumen
Se corrigió el sistema de tags para que deje de duplicar estados en cada mensaje inbound. El tagger ahora corre solo cuando el embudo entra a una nueva etapa o cuando arranca una sesión nueva. También se añadió un endpoint de limpieza histórica y se estandarizó la configuración de Pushinator.

### Lo implementado en esta sesión
1. **Tagger**
   - `server/services/analysis/tagger.js`
   - `quality` y `sentiment` ahora son tags de estado:
     - borran el anterior por categoría antes de insertar el nuevo
   - `intent` ahora es tag de comportamiento:
     - solo se inserta si ese valor exacto no existía
   - ya no se insertan tags sobre `target_type = 'message'`

2. **FlowEngine**
   - `server/services/chatbot/flowEngine.js`
   - el tagger dejó de correr en cada inbound
   - ahora se usa `context.tag_on_next`
   - se activa:
     - al crear una sesión nueva
     - en cada transición de nodo
   - el análisis se ejecuta después de `runFlowEngine()` y luego limpia el flag

3. **Limpieza histórica**
   - `server/index.js`
   - nuevo endpoint:
     - `GET /api/admin/cleanup-tags`
   - elimina:
     - tags viejos duplicados de `quality`
     - tags viejos duplicados de `sentiment`
     - duplicados exactos de `intent`
     - todos los tags viejos de `target_type = 'message'`

4. **Pushinator**
   - `server/services/pushinator.js`
   - `.env.example`
   - configuración simplificada:
     - env: `PUSHINATOR_TOKEN`
     - env: `PUSHINATOR_CHANNEL_ID`
     - tenant config: `api_token`, `channel_id`

5. **Archivo legado**
   - `server/services/chatbot/engine.js` ya no existe
   - se verificó que no quedaban llamadas activas al tagger fuera de `flowEngine`

### Verificación
1. **Sintaxis server**
   - `node --check` pendiente de esta sesión sobre:
     - `server/services/analysis/tagger.js`
     - `server/services/chatbot/flowEngine.js`
     - `server/services/pushinator.js`
     - `server/index.js`

2. **Runtime**
   - pendiente probar con DB real:
     - `GET /api/admin/cleanup-tags`
     - no duplicación de tags tras múltiples mensajes

---

## Estado actual: 2026-04-09 — SESIÓN 19 (completada)

### Resumen
Se añadió `Contacts` como capa intermedia entre teléfono y lead, y el `flowEngine` ahora reconoce al contacto antes de iniciar el embudo. También se normalizaron deletes operativos y las acciones destructivas del admin pasaron a un patrón de confirmación de doble click.

### Lo implementado en esta sesión
1. **Schema**
   - `server/db.js`
   - nueva tabla `contacts`
   - `leads` ahora recibe:
     - `contact_id`
     - `deleted_at`

2. **Reconocimiento**
   - nuevo `server/services/nameClassifier.js`
   - `server/services/agendaBridge.js` suma `findByPhone(phone)`
   - `server/services/chatbot/flowEngine.js` ahora:
     - crea o recupera `contacts`
     - vincula `lead.contact_id`
     - bloquea `lista_negra`
     - arranca desde `nodo_06_presentacion` para `cliente` / `cliente_agenda`
     - agrega `greeting_override` y `groq_context` al contexto de sesión

3. **Contacts admin**
   - nueva ruta `server/routes/contacts.js`
   - nuevo mount `/api/contacts` en `server/index.js`
   - nueva página `client/src/pages/Contacts.jsx`
   - nuevo ítem `Contacts` en sidebar

4. **Deletes**
   - `server/routes/leads.js` ahora hace soft-delete y marca sesiones como `abandoned`
   - `server/routes/conversations.js` ahora soporta delete explícito de conversación

5. **Confirmación de acciones destructivas**
   - nuevo `client/src/components/ui/ConfirmButton.jsx`
   - aplicado en:
     - `client/src/pages/Workshops.jsx`
     - `client/src/pages/Leads.jsx`
     - `client/src/pages/Finance.jsx`
     - `client/src/pages/Marketing.jsx`
     - `client/src/pages/Funnel.jsx`
     - `client/src/pages/Settings.jsx`
     - `client/src/pages/Contacts.jsx`

### Verificación
1. **Sintaxis server**
   - `node --check` OK en:
     - `server/db.js`
     - `server/index.js`
     - `server/routes/contacts.js`
     - `server/routes/leads.js`
     - `server/routes/conversations.js`
     - `server/services/agendaBridge.js`
     - `server/services/chatbot/flowEngine.js`
     - `server/services/nameClassifier.js`

2. **Startup local**
   - `node server/index.js` falla en este workspace por entorno local sin MySQL escuchando en `127.0.0.1:3306`
   - por eso no se pudo completar validación real de:
     - creación física de `contacts`
     - `GET /api/contacts`
     - `POST /api/contacts`
     - respuesta end-to-end del bot

---

## Estado actual: 2026-04-09 — SESIÓN 18 (completada)

### Resumen
Se revirtió el endurecimiento del webhook de Telegram porque estaba bloqueando el canal de pruebas. El bot quedó de nuevo sin requerir `secret_token`, que en este proyecto no es prioritario porque Telegram se usa solo como sandbox antes de pasar a WhatsApp.

### Lo implementado en esta sesión
1. **Webhook Telegram simplificado**
   - `server/routes/webhook.js`
   - se quitó la validación de `x-telegram-bot-api-secret-token`

2. **Registro de webhook simplificado**
   - `server/services/channels/telegram.js`
   - `setWebhook()` vuelve a registrar solo `url` y `allowed_updates`

3. **Motivo**
   - el cambio anterior podía dejar el bot sin responder si el webhook remoto no se había reconfigurado después del deploy
   - como Telegram es solo de pruebas, se priorizó restaurar operación por encima del hardening de ese canal

4. **Verificación**
   - `node --check server/routes/webhook.js`: OK
   - `node --check server/services/channels/telegram.js`: OK

---

## Estado actual: 2026-04-09 — SESIÓN 17 (completada)

### Resumen
Se corrigió el módulo `Configuración` para que deje de resetear campos de cobro mientras el usuario está editando y para que muestre una confirmación visible cuando los cambios quedan guardados.

### Lo implementado en esta sesión
1. **Fix de reseteo en Configuración**
   - `client/src/pages/Settings.jsx`
   - la pantalla ahora distingue entre:
     - configuración ya cargada
     - cambios locales sin guardar
   - si llega una carga tardía del backend, ya no pisa el formulario local si el usuario empezó a editar

2. **Fix al subir QR**
   - al subir un QR ya no se reemplaza todo `paymentSettings`
   - solo se sincroniza `has_qr` del slot correspondiente
   - esto evita perder cambios no guardados en:
     - etiqueta
     - monto
     - activo/inactivo
     - cuentas destino OCR

3. **Señal visible de guardado**
   - se agregó feedback inline en Configuración:
     - `Guardando cambios...`
     - `Hay cambios sin guardar`
     - `Cambios guardados`
   - además se muestra un aviso superior de éxito cuando:
     - se guarda configuración de cobro
     - se sube un QR
     - se crea/edita/elimina un usuario
     - se cambia el PIN

4. **Verificación**
   - `npm run build` en `client/`: OK
   - el intento de `node --check` sobre `Settings.jsx` no aplica porque Node no parsea `.jsx` de esa forma; la validación real aquí fue el build de Vite

---

## Estado actual: 2026-04-09 — SESIÓN 16 (completada)

### Resumen
Se corrigieron bugs de backend confirmados, sin refactorizar arquitectura ni agregar funcionalidades nuevas. El foco fue proteger operación real del embudo, login y webhook.

### Lo implementado en esta sesión
1. **Embudo / enrollments**
   - `server/services/chatbot/flowEngine.js`
   - `ensureEnrollment()` ya no pisa enrollments confirmados/pagados cuando el lead vuelve a pasar por el flujo

2. **Workshops**
   - `server/routes/workshops.js`
   - `GET /api/workshops/venues/list` quedó movido antes de `GET /:id`
   - crear un taller ahora conserva `price: 0` y `early_bird_price: 0` en vez de convertirlos a `null`

3. **Webhook de Telegram**
   - `server/routes/webhook.js`
   - `server/services/channels/telegram.js`
   - se agregó `secret_token` al `setWebhook()`
   - el endpoint POST del webhook ahora valida `x-telegram-bot-api-secret-token`
   - después del deploy hay que re-ejecutar:
     - `GET /api/webhook/telegram/setup`

4. **Auth**
   - `server/routes/auth.js`
   - se agregó `express-rate-limit` al login
   - si hay más de un usuario activo, el login sin `username` devuelve `Selecciona tu usuario`
   - si solo hay uno, se conserva backward compatibility

5. **Tenant cache**
   - `server/middleware/tenant.js`
   - el middleware ya no hace `SELECT *` sobre `tenants`
   - se excluyen los campos `payment_qr_1..4` del cache en memoria

6. **Verificación**
   - `node --check` OK en todos los archivos tocados
   - `require('express-rate-limit')`: OK
   - `node server/index.js` intentó arrancar pero en este workspace falló por entorno local sin MySQL escuchando en `127.0.0.1:3306`

---

## Estado actual: 2026-04-09 — SESIÓN 15 (completada)

### Resumen
Se hizo un ajuste visual global de tipografía: toda la escala base de fuentes del admin subió `+2px` de forma consistente en tema claro y oscuro, sin agregar funcionalidades nuevas.

### Lo implementado en esta sesión
1. **Escala tipográfica global**
   - Archivo modificado: `client/src/index.css`
   - Se ajustaron los tokens:
     - `--font-size-xs`
     - `--font-size-sm`
     - `--font-size-base`
     - `--font-size-lg`
     - `--font-size-xl`
     - `--font-size-2xl`
     - `--font-size-3xl`
   - El incremento real fue de `+2px` por nivel respecto a la escala anterior

2. **Impacto**
   - El cambio afecta toda la app porque los componentes usan estos tokens
   - Aplica igual en light y dark mode
   - No se cambió lógica, datos ni comportamiento del backend

---

## Estado actual: 2026-04-09 — SESIÓN 13/14 (completadas)

### Resumen
Se implementó el módulo completo **Embudo** con backend, frontend, schema nuevo y reemplazo del motor hardcodeado del bot de Telegram por un `flowEngine` dinámico basado en nodos. Además, los talleres nuevos ahora nacen en `planned` para que el bot/embudo pueda ofrecerlos sin un paso manual extra.

### Lo implementado en estas sesiones
1. **Nuevo embudo dinámico en DB**
   - `server/db.js` ahora crea:
     - `flow_nodes`
     - `flow_sessions`
   - `flow_sessions` tiene índices para:
     - `conversation_id`
     - `status`
   - Se agrega seed automático del flujo inicial completo para `tenant_id = 1` si `flow_nodes` está vacía

2. **Nuevo motor del bot**
   - Nuevo archivo: `server/services/chatbot/flowEngine.js`
   - El webhook de Telegram ya no entra al viejo `chatbot/engine.js`
   - Ahora el bot:
     - busca o crea lead
     - busca o crea conversación
     - busca o crea `flow_session`
     - avanza dinámicamente por `flow_nodes`
   - Soporta tipos:
     - `message`
     - `open_question_ai`
     - `open_question_detect`
     - `options`
     - `action`
   - Guarda contexto acumulado en `flow_sessions.context`
   - Si falta un `node_key` referenciado, escala automáticamente a Daniel

3. **Acciones del embudo ya conectadas**
   - `send_qr`
     - reutiliza `payment_options` del tenant
     - reutiliza `buildPaymentQrResponse()`
   - `process_payment_proof`
     - reutiliza OCR y validación de comprobantes ya existente
   - `check_workshop_capacity`
     - verifica cupos para constelar y redirige a `nodo_09_sin_cupos` si corresponde
   - `escalate`
     - marca la sesión como `escalated`
     - marca la conversación como `escalated`
     - intenta notificar por Pushinator

4. **Nuevo backend admin del embudo**
   - Nuevo archivo: `server/routes/funnel.js`
   - Endpoints:
     - `GET /api/funnel/nodes`
     - `POST /api/funnel/nodes`
     - `PUT /api/funnel/nodes/:id`
     - `DELETE /api/funnel/nodes/:id`
     - `GET /api/funnel/sessions`
     - `GET /api/funnel/sessions/:id`
   - `DELETE` valida que el nodo no esté referenciado ni usado por sesiones activas

5. **Nuevo frontend admin del embudo**
   - Nuevo archivo: `client/src/pages/Funnel.jsx`
   - Nuevo route: `/funnel`
   - Nuevo ítem en sidebar entre Conversaciones y Leads
   - Tabs:
     - `Flujo`
     - `Sesiones activas`
   - La vista de sesiones escucha SSE por `funnel_session_update`
   - Desde Embudo se puede saltar a Conversaciones vía `?conversationId=...`

6. **Integración con Talleres**
   - Los placeholders de presentación:
     - `[FECHA]`
     - `[VENUE]`
     - `[HORA_INICIO]`
     - `[HORA_FIN]`
     se reemplazan con el taller más próximo `planned/open`
   - Talleres nuevos ahora nacen en `planned`:
     - `server/routes/workshops.js`
     - `client/src/pages/Workshops.jsx`

7. **Pushinator**
   - Nuevo archivo: `server/services/pushinator.js`
   - Toma credenciales desde:
     - env vars `PUSHINATOR_API_TOKEN`, `PUSHINATOR_CHANNEL_ID`
     - o `tenant.push_config`
   - Si falta config, no rompe el flujo

8. **Build y deploy**
   - `client/dist/` fue reconstruido y commiteado
   - El cambio funcional quedó finalmente integrado en `main`
   - Regla operativa acordada: para este proyecto no abrir branches intermedias salvo pedido explícito; Hostinger toma `main`

### Commits relevantes
- `05fc1d5` — `add embudo module`
- `c73c133` — `default new workshops to planned`

### Archivos nuevos relevantes
- `server/routes/funnel.js`
- `server/services/chatbot/flowEngine.js`
- `server/services/pushinator.js`
- `client/src/pages/Funnel.jsx`

### Archivos modificados relevantes
- `server/db.js`
- `server/index.js`
- `server/routes/webhook.js`
- `server/routes/workshops.js`
- `client/src/App.jsx`
- `client/src/components/layout/Sidebar.jsx`
- `client/src/index.css`
- `client/src/pages/Conversations.jsx`
- `client/src/pages/Workshops.jsx`

### Lo pendiente después de estas sesiones
- Verificar en producción Hostinger que el startup ejecute el seed/migración de `flow_nodes` y `flow_sessions`
- Validar con credenciales reales si Pushinator está configurado
- Probar end-to-end con Telegram real:
  - bienvenida
  - pregunta AI
  - bifurcación de terapia
  - presentación del taller
  - elección de modalidad
  - envío QR
  - OCR de comprobante
  - escalación
- Revisar si conviene retirar o archivar el viejo `server/services/chatbot/engine.js` para evitar deuda/confusión futura

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

---

## Estado actual: 2026-04-08 — SESIÓN 5 (completada)

### Resumen
Se cerró la primera capa operativa de inscripciones dentro del admin. Ahora Daniel puede revisar enrollments desde la app, detectar comprobantes recibidos o mismatch, confirmar pagos manualmente y reenviar QR o instrucciones sin depender del bot. Esto convierte el flujo QR/OCR en un proceso realmente operable desde backoffice.

### Lo implementado en esta sesión
1. **Módulo admin de inscripciones**
   - Nueva ruta: `server/routes/enrollments.js`
   - Activada en `server/index.js` con `/api/enrollments`
   - La lista devuelve enrollments con:
     - lead
     - taller
     - monto
     - asignado
     - `ocr_data`
     - estado derivado de revisión

2. **Estados operativos de revisión**
   - Se expone `review_state` para distinguir:
     - `pending`
     - `proof_received`
     - `mismatch`
     - `confirmed`
   - El cálculo considera:
     - `payment_status`
     - `status`
     - presencia de comprobante
     - problemas OCR en `ocr_data.validation_problems`

3. **Filtros de enrollments**
   - `GET /api/enrollments` soporta:
     - `workshop_id`
     - `state`
     - `assigned_to`
     - `search`
     - paginación
   - Se puede filtrar por `bot` para ver conversaciones no asignadas

4. **Acciones manuales sobre inscripciones**
   - Endpoints nuevos:
     - `POST /api/enrollments/:id/confirm`
     - `POST /api/enrollments/:id/reject`
     - `POST /api/enrollments/:id/resend-qr`
     - `POST /api/enrollments/:id/resend-instructions`
   - Solo `owner` y `admin` pueden gestionar estas acciones

5. **Servicio centralizado de enrollments**
   - Nuevo archivo: `server/services/enrollments.js`
   - Funciones:
     - `getEnrollmentWithRelations`
     - `syncWorkshopParticipantCount`
     - `resendPaymentInstructions`
     - `resendPaymentQr`
     - `confirmEnrollmentPayment`
     - `rejectEnrollmentPayment`
   - La confirmación manual:
     - marca el enrollment como pagado
     - crea o actualiza `transactions`
     - convierte lead y conversación
     - sincroniza `workshops.current_participants`
   - El rechazo manual:
     - mantiene historial
     - agrega `mismatch_manual` en `ocr_data.validation_problems`
     - deja el enrollment en estado pendiente para seguimiento

6. **UI dentro de Talleres**
   - `client/src/pages/Workshops.jsx` ahora incluye un bloque `Inscripciones`
   - Muestra:
     - lead
     - taller
     - monto
     - estado
     - asignado
     - notas y problemas de validación
   - Acciones disponibles en la tabla:
     - confirmar pago
     - rechazar
     - reenviar QR
     - reenviar instrucciones

7. **Sincronización con workflow OCR**
   - `server/services/chatbot/paymentWorkflow.js` ahora también llama `syncWorkshopParticipantCount` cuando el OCR confirma un pago automáticamente

### Archivos creados/modificados en sesión 5
- `server/routes/enrollments.js`
- `server/services/enrollments.js`
- `server/services/chatbot/paymentWorkflow.js`
- `server/index.js`
- `client/src/pages/Workshops.jsx`
- `client/dist/*`
- `CLAUDE.md`
- `HANDOFF.md`

### Pendientes siguientes con más sentido
- Crear una vista específica de enrollments si el volumen crece y `Workshops.jsx` empieza a quedar demasiado cargado
- Permitir ver y descargar el comprobante subido desde admin
- Añadir aprobación manual con monto corregido desde UI
- Agregar notas internas por enrollment o conversación
- Mover pricing/QR a nivel de taller si luego dejan de bastar las 4 opciones globales

### Verificación hecha
- `node --check server/index.js`: OK
- `node --check server/routes/enrollments.js`: OK
- `node --check server/services/enrollments.js`: OK
- `node --check server/services/chatbot/paymentWorkflow.js`: OK
- `cd client && npm run build`: OK

---

## Estado actual: 2026-04-08 — SESIÓN 6 (completada)

### Resumen
Se volvió operativo el inbox y se introdujo una capa real de actualización en vivo para que la app deje de depender de refresh manual en los módulos clave. Ahora Conversaciones permite operar chats desde admin con notas, estado interno y envío manual, mientras Leads y Finanzas reaccionan automáticamente a cambios del sistema y del bot.

### Lo implementado en esta sesión
1. **SSE admin**
   - Nuevo archivo: `server/services/adminEvents.js`
   - Nuevo endpoint: `GET /api/admin/events`
   - Usa token JWT por query string (`?token=`) para EventSource
   - Mantiene heartbeats para evitar timeouts en Hostinger/LiteSpeed

2. **Conversations con estado operativo**
   - `conversations` ahora soporta:
     - `inbox_state`
     - `internal_notes`
   - Migraciones idempotentes añadidas en `server/db.js`
   - Se normalizan conversaciones viejas con `inbox_state = 'open'`

3. **Inbox admin operativo**
   - `server/routes/conversations.js` fue ampliado con:
     - filtros por `status`
     - filtros por `assigned_to`
     - filtros por `inbox_state`
     - búsqueda por lead o taller
     - `PUT /api/conversations/:id/inbox-state`
     - `PUT /api/conversations/:id/notes`
     - `POST /api/conversations/:id/messages`
   - El envío manual usa Telegram cuando el canal es `telegram`
   - Los mensajes manuales quedan guardados en `messages`

4. **UI de Conversaciones rehecha**
   - `client/src/pages/Conversations.jsx` ahora incluye:
     - filtros operativos
     - indicador `En vivo`
     - selección y refresco automático del hilo
     - estado operativo (`Abierta`, `Pendiente`, `Resuelta`)
     - notas internas
     - composer para responder manualmente

5. **Actualización en vivo en Leads y Finanzas**
   - Nuevo hook: `client/src/hooks/useAdminEvents.js`
   - `client/src/pages/Leads.jsx` ahora escucha eventos `lead:change` y `conversation:change`
   - `client/src/pages/Finance.jsx` ahora escucha `finance:change`
   - Ambas pantallas muestran indicador de conexión `En vivo`
   - Se añadió `useDeferredValue` en búsquedas de leads para no disparar recargas agresivas mientras se escribe

6. **Broadcasts del backend**
   - `server/services/chatbot/engine.js` ahora emite eventos al:
     - crear leads
     - crear conversaciones
     - guardar mensajes inbound/outbound
     - procesar interacción
   - Además:
     - inbound reabre `inbox_state` a `open`
     - outbound actualiza `last_message_at`
   - `server/routes/leads.js` emite `lead:change` en update/delete
   - `server/routes/finance.js` emite `finance:change` en create/update/delete/meta
   - `server/services/enrollments.js` y `server/services/chatbot/paymentWorkflow.js` emiten eventos al confirmar pagos, para que Finanzas y el inbox se refresquen solos

7. **Estilos y UX**
   - `client/src/index.css` ahora tiene estilos para:
     - indicador live
     - panel lateral de operación
     - composer del inbox
     - textarea reusable

### Archivos creados/modificados en sesión 6
- `server/services/adminEvents.js`
- `server/index.js`
- `server/db.js`
- `server/routes/conversations.js`
- `server/routes/leads.js`
- `server/routes/finance.js`
- `server/services/chatbot/engine.js`
- `server/services/chatbot/paymentWorkflow.js`
- `server/services/enrollments.js`
- `client/src/hooks/useAdminEvents.js`
- `client/src/utils/api.js`
- `client/src/pages/Conversations.jsx`
- `client/src/pages/Leads.jsx`
- `client/src/pages/Finance.jsx`
- `client/src/index.css`
- `client/dist/*`
- `CLAUDE.md`
- `HANDOFF.md`

### Notas importantes
- La capa live usa SSE, no polling. Eso deja la app más instantánea sin meter carga innecesaria en Hostinger.
- El envío manual desde admin hoy soporta Telegram. Si luego se suma WhatsApp Cloud API, el siguiente paso correcto es crear un factory por canal y no meter `if channel === ...` en las rutas.
- El inbox operativo (`inbox_state`) es separado del estado comercial (`status`) de la conversación. Esto es intencional y correcto.

### Pendientes siguientes con más sentido
- Agregar filtro por `inbox_state` también en sidebar/dashboard si luego hace falta
- Mostrar y descargar comprobantes desde enrollments/inbox
- Añadir acciones rápidas desde leads para abrir conversación o crear follow-up
- Integrar una vista más fuerte de “pendientes del equipo” usando `assigned_to + inbox_state`
- Si el volumen sube mucho, considerar cache corto o deduplicación adicional para lista de conversaciones

### Verificación hecha
- `node --check server/index.js`: OK
- `node --check server/db.js`: OK
- `node --check server/routes/conversations.js`: OK
- `node --check server/routes/leads.js`: OK
- `node --check server/routes/finance.js`: OK
- `node --check server/services/chatbot/engine.js`: OK
- `node --check server/services/chatbot/paymentWorkflow.js`: OK
- `node --check server/services/enrollments.js`: OK
- `cd client && npm run build`: OK

---

## Estado actual: 2026-04-08 — SESIÓN 7 (completada)

### Resumen
Se completaron los puntos 3 y 5 del roadmap inmediato: ahora existe una revisión real de OCR/pagos dentro de Talleres, y Leads pasó de ser una tabla simple a una vista CRM con ficha y timeline. Con esto ya hay mejor capacidad de revisar mismatches, confirmar manualmente con monto corregido y entender el historial completo de un lead sin salir del módulo.

### Lo implementado en esta sesión
1. **Detalle de inscripción / OCR**
   - `server/routes/enrollments.js` ahora soporta:
     - `GET /api/enrollments/:id`
     - `GET /api/enrollments/:id/proof`
   - `server/services/enrollments.js` ahora añade:
     - `getReviewState`
     - `getEnrollmentProofAsset`
   - El detalle de inscripción devuelve:
     - datos del lead
     - datos del taller
     - contexto de pago
     - `ocr_data`
     - `payment_proof_present`
     - `review_state`

2. **Panel de revisión OCR en Talleres**
   - `client/src/pages/Workshops.jsx` ahora tiene layout doble:
     - tabla/lista de enrollments a la izquierda
     - panel de revisión a la derecha
   - El panel muestra:
     - estado de revisión
     - monto esperado
     - monto detectado por OCR
     - fecha del comprobante
     - cuenta detectada
     - banco
     - referencia
     - nombre detectado
     - texto OCR crudo
     - problemas detectados
   - Si existe comprobante:
     - se puede abrir
     - se puede descargar
     - si es imagen, se previsualiza

3. **Confirmación manual con monto corregido**
   - Desde el panel de revisión se puede confirmar un pago con monto manual
   - Esto resuelve el caso donde el OCR falla o donde el monto esperado debe ajustarse operativamente sin tocar la base a mano

4. **Ficha CRM del lead**
   - `client/src/pages/Leads.jsx` dejó de ser solo tabla
   - Ahora tiene layout doble:
     - tabla rápida de leads
     - ficha lateral del lead seleccionado
   - La ficha muestra:
     - datos base
     - score
     - fuente
     - ciudad
     - tags
     - notas
     - conversaciones recientes
     - inscripciones
     - ingresos asociados

5. **Timeline del lead**
   - `server/routes/leads.js` ahora compone un `timeline` unificado con:
     - mensajes
     - enrollments
     - transacciones
   - `client/src/pages/Leads.jsx` lo renderiza como timeline cronológico
   - Esto permite ver el recorrido comercial real del lead en un solo lugar

6. **Estilos CRM**
   - `client/src/index.css` ahora soporta:
     - `crm-layout`
     - `crm-detail`
     - `lead-summary-grid`
     - `lead-meta-card`
     - `timeline-list`
     - `proof-preview`
     - `table-row-selected`

### Archivos creados/modificados en sesión 7
- `server/routes/enrollments.js`
- `server/services/enrollments.js`
- `server/routes/leads.js`
- `client/src/pages/Workshops.jsx`
- `client/src/pages/Leads.jsx`
- `client/src/index.css`
- `client/dist/*`
- `CLAUDE.md`
- `HANDOFF.md`

### Notas importantes
- La validación/operación de OCR ahora ya es mucho más revisable desde admin, pero todavía no existe una cola dedicada solo de mismatches. Por ahora vive dentro de Talleres.
- El timeline de leads está pensado para contexto comercial y operativo; si luego quieres un CRM más profundo, el siguiente paso natural es permitir edición inline de notas/status del lead desde esta misma ficha.
- `GET /api/enrollments/:id/proof` usa el mismo token auth por query string, igual que SSE.

### Pendientes siguientes con más sentido
- Crear una vista específica de mismatches o “bandeja de cobros por revisar”
- Hacer `Marketing.jsx` funcional
- Agregar acciones desde ficha del lead:
  - abrir conversación
  - cambiar estado
  - editar notas
- Conectar Agenda 4.0 para enriquecer la ficha del lead cuando también sea cliente de terapia

### Verificación hecha
- `node --check server/routes/enrollments.js`: OK
- `node --check server/services/enrollments.js`: OK
- `node --check server/routes/leads.js`: OK
- `cd client && npm run build`: OK

---

## Estado actual: 2026-04-08 — SESIÓN 8 (completada)

### Resumen
Se fortaleció el módulo de equipo. Ahora la app permite editar usuarios existentes, cambiar el PIN propio sin depender de otro usuario, restringe mejor lo que admins y owners pueden hacer, y deja bitácora de cambios del equipo. También se resolvió un detalle importante: si el usuario actual se edita a sí mismo desde Configuración, el frontend refleja esos cambios sin tener que cerrar sesión.

### Lo implementado en esta sesión
1. **Cambio de PIN propio**
   - `server/routes/auth.js` ahora soporta:
     - `POST /api/auth/change-pin`
   - Requiere:
     - `current_pin`
     - `new_pin`
   - Valida que:
     - ambos sean de 4 dígitos
     - el actual coincida
     - el nuevo sea distinto

2. **Bitácora de acciones**
   - Nuevo archivo: `server/services/activityLog.js`
   - Inserta eventos en `activity_log`
   - `server/routes/team.js` y `server/routes/auth.js` ahora registran:
     - creación de usuario
     - actualización de usuario
     - eliminación de usuario
     - cambio de PIN propio

3. **Team route endurecida**
   - `server/routes/team.js` fue rehecha con reglas de permisos más claras:
     - solo `owner` puede crear o promover `owner`
     - `admin` no puede editar ni borrar `owner`
     - nadie puede desactivar su propia cuenta
     - nadie puede eliminar su propia cuenta
     - no se puede dejar la instalación sin al menos un `owner` activo
   - También se añadió:
     - `GET /api/team/activity`
   - Y se mejoró `PUT /api/team/:id`:
     - ahora soporta editar `username`
     - devuelve el usuario actualizado
     - si cambia el username, se actualiza `conversations.assigned_to`
   - `DELETE /api/team/:id` ahora devuelve conversaciones asignadas del usuario eliminado a `bot`

4. **Settings más operativa**
   - `client/src/pages/Settings.jsx` fue ampliada para:
     - cambiar PIN propio
     - ver explicación de roles
     - crear usuarios
     - editar usuarios existentes
     - cambiar username
     - cambiar nombre visible
     - cambiar rol
     - activar/desactivar usuario
     - resetear PIN de otro usuario
     - ver bitácora del equipo
   - Los viewers siguen pudiendo cambiar su PIN, pero no gestionar equipo

5. **Rehidratación del usuario actual**
   - `client/src/utils/api.js` ahora emite evento local cuando cambia `bos_user`
   - `client/src/hooks/useAuth.js` escucha ese evento
   - Si el usuario actual se edita a sí mismo desde Settings, el sidebar y el estado auth se actualizan sin refresh manual

### Archivos creados/modificados en sesión 8
- `server/services/activityLog.js`
- `server/routes/auth.js`
- `server/routes/team.js`
- `client/src/utils/api.js`
- `client/src/hooks/useAuth.js`
- `client/src/pages/Settings.jsx`
- `client/dist/*`
- `CLAUDE.md`
- `HANDOFF.md`

### Notas importantes
- El sistema ya no depende de “borrar y recrear” usuarios para cambiarles cosas básicas.
- `assigned_to` sigue siendo string por username; por eso en esta sesión se añadió sincronización al renombrar usuarios. A futuro, si el sistema crece, lo correcto sería migrar a `assigned_user_id`.
- La bitácora de equipo hoy vive en `activity_log` filtrando acciones `team.%`. Todavía no es una auditoría completa de toda la app.

### Pendientes siguientes con más sentido
- Convertir `assigned_to` de string a FK real cuando valga la pena
- Añadir edición inline de perfil propio (por ejemplo display name) si luego hace falta
- Extender `activity_log` a otras áreas críticas: pagos, leads, campañas
- Hacer `Marketing.jsx` funcional

### Verificación hecha
- `node --check server/routes/auth.js`: OK
- `node --check server/routes/team.js`: OK
- `node --check server/services/activityLog.js`: OK
- `cd client && npm run build`: OK

---

## Estado actual: 2026-04-08 — SESIÓN 9 (completada)

### Resumen
Se completaron los puntos 5, 6 y 7 del roadmap inmediato: el CRM de leads ahora es más serio y operable, Marketing dejó de ser placeholder y ya sirve para registrar campañas con KPIs reales, y se añadió un bridge práctico con `agenda4.0` para consultar clientes, citas y pagos sin mezclar bases de datos.

### Lo implementado en esta sesión
1. **CRM de leads fortalecido**
   - `server/routes/leads.js` ahora soporta:
     - `view=hot`
     - `view=followup`
     - `view=converted`
     - `view=agenda_pending`
   - También agrega:
     - `POST /api/leads/:id/tags`
     - `DELETE /api/leads/:id/tags/:tagId`
     - `PUT /api/leads/:id/agenda-link`
   - Las vistas rápidas permiten enfocar leads calientes, dormidos para follow-up, convertidos y los que aún no tienen vínculo con Agenda

2. **Leads.jsx más CRM real**
   - `client/src/pages/Leads.jsx` ahora tiene:
     - chips de vistas rápidas
     - creación de tags manuales
     - borrado de tags manuales
     - panel de cruce con Agenda 4.0
     - búsqueda manual de cliente en Agenda
     - vinculación/desvinculación de lead con cliente de Agenda
     - resumen de últimas citas y pagos del cliente vinculado
   - La ficha sigue mostrando timeline, conversaciones, inscripciones e ingresos del lead

3. **Marketing funcional**
   - Nuevo archivo backend real: `server/routes/marketing.js`
   - Endpoints:
     - `GET /api/marketing/summary`
     - `GET /api/marketing`
     - `POST /api/marketing`
     - `PUT /api/marketing/:id`
     - `DELETE /api/marketing/:id`
   - `campaigns` ahora incluye `revenue_generated`
   - `client/src/pages/Marketing.jsx` ahora permite:
     - registrar campañas
     - editar campañas
     - eliminar campañas
     - filtrar por estado, plataforma y búsqueda
     - ver KPIs de inversión, ingresos atribuidos, ROI, CPL y CPA
     - ver resumen por plataforma

4. **Bridge con Agenda 4.0**
   - Nuevo servicio: `server/services/agendaBridge.js`
   - Hace conexión read-only a la DB de `agenda4.0`
   - Toma configuración desde:
     - `AGENDA_DB_HOST`, `AGENDA_DB_PORT`, `AGENDA_DB_USER`, `AGENDA_DB_PASSWORD`, `AGENDA_DB_NAME`
     - o fallback local leyendo `/Users/dran/Documents/Codex openai/agenda4.0/.env`
   - Nuevo route file: `server/routes/agenda.js`
   - Endpoints:
     - `GET /api/agenda/status`
     - `GET /api/agenda/search`
     - `GET /api/agenda/lead/:leadId`
   - Devuelve:
     - cliente de Agenda
     - últimas citas
     - últimos pagos
     - coincidencias por nombre/teléfono si no hay vínculo explícito

5. **Estilos y UX**
   - `client/src/index.css` ahora incluye estilos para:
     - quick views
     - forms de tags
     - paneles de Agenda
     - layout de Marketing
   - El frontend se mantiene responsive en móvil y desktop

### Archivos creados/modificados en sesión 9
- `server/db.js`
- `server/index.js`
- `server/routes/leads.js`
- `server/routes/marketing.js`
- `server/routes/agenda.js`
- `server/services/agendaBridge.js`
- `client/src/pages/Leads.jsx`
- `client/src/pages/Marketing.jsx`
- `client/src/index.css`
- `client/dist/*`
- `CLAUDE.md`
- `HANDOFF.md`

### Notas importantes
- El bridge con Agenda es **read-only**. No escribe nada en `agenda4.0`.
- El vínculo lead ↔ agenda se hace guardando `leads.agenda_client_id` en Business OS.
- No se implementó sync bidireccional ni creación automática de clientes en Agenda. Eso sigue siendo una decisión futura, no un default.
- `node --check` no sirve para `.jsx` con la versión actual de Node del entorno; el validador real del frontend fue `vite build`.

### Pendientes siguientes con más sentido
- 6. `Marketing.jsx` ya quedó funcional; lo siguiente lógico es enriquecer insights de marketing y atribución
- 7. El bridge con Agenda ya existe; el siguiente paso razonable es decidir si habrá acciones manuales de “crear en Agenda” o solo consulta/vinculación
- Extender `activity_log` a campañas, leads, pagos y vínculos con Agenda
- Evaluar si `assigned_to` merece migrarse a FK real más adelante

### Verificación hecha
- `node --check server/routes/leads.js`: OK
- `node --check server/routes/marketing.js`: OK
- `node --check server/routes/agenda.js`: OK
- `node --check server/services/agendaBridge.js`: OK
- `cd client && npm run build`: OK

---

## Estado actual: 2026-04-09 — SESIÓN 10 (completada)

### Resumen
Daniel reportó dos síntomas: el módulo `Conversaciones` se sentía roto y el bot de Telegram aparentemente no respondió. La investigación mostró que el backend en producción seguía arriba, el webhook de Telegram estaba sano y la conversación del bot seguía registrando mensajes y respuestas. El cambio aplicado fue un endurecimiento del layout/scroll del inbox para evitar que el panel de conversaciones o el thread queden “sin responder” por comportamiento de overflow en grid/flex.

### Hallazgos reales de producción
1. **Servidor arriba**
   - `GET /api/health` respondió `200`

2. **Conversaciones API arriba**
   - `GET /api/conversations?limit=5` respondió correctamente
   - En producción había al menos una conversación Telegram activa

3. **Bot de Telegram no aparecía caído**
   - `GET /api/conversations/1/messages` mostró intercambio real
   - Último inbound registrado: `qué talleres hay?`
   - Último outbound del bot: respuesta de “Por el momento no hay talleres programados...”
   - Timestamp del último reply: `2026-04-09 02:46` hora Bolivia aproximadamente

4. **Webhook Telegram sano**
   - `getWebhookInfo` devolvió:
     - URL correcta
     - `pending_update_count: 0`
     - sin error reportado por Telegram

### Lo implementado en esta sesión
1. **Fix de scroll / robustez en Conversations**
   - `client/src/pages/Conversations.jsx`
     - ahora hace auto-scroll al final del hilo cuando cambian mensajes o conversación
   - `client/src/index.css`
     - se añadió `min-height: 0` a paneles clave del inbox
     - se añadió `overscroll-behavior: contain` a lista y thread
   - Objetivo:
     - asegurar scroll correcto en layouts grid/flex
     - evitar paneles “congelados” por comportamiento del navegador

2. **Build frontend actualizado**
   - `cd client && npm run build` corrió OK
   - `client/dist/` quedó actualizado

### Archivos modificados en sesión 10
- `client/src/pages/Conversations.jsx`
- `client/src/index.css`
- `client/dist/*`
- `CLAUDE.md`
- `HANDOFF.md`

### Notas importantes
- `node --check` no valida `.jsx` con la versión actual de Node del entorno; la validación real del frontend siguió siendo `vite build`
- No hubo evidencia dura de que el webhook de Telegram estuviera roto en el momento de la revisión
- Si Daniel vuelve a ver “silencio” del bot, el siguiente paso correcto sería instrumentar logging persistente del webhook/engine en producción para capturar fallos intermitentes

### Siguiente paso si reaparece el problema del bot
- guardar log estructurado por update inbound en `webhooks_log` o similar
- loguear:
  - update recibido
  - `incoming.contentType`
  - fase de conversación
  - respuesta elegida
  - error exacto si falla `sendText` o `sendButtons`

### Verificación hecha
- `GET https://darkred-kangaroo-559638.hostingersite.com/api/health`: 200
- `GET https://darkred-kangaroo-559638.hostingersite.com/api/conversations?limit=5`: OK
- `GET https://darkred-kangaroo-559638.hostingersite.com/api/conversations/1/messages`: OK
- `POST https://api.telegram.org/.../getWebhookInfo`: OK
- `cd client && npm run build`: OK

---

## Estado actual: 2026-04-09 — SESIÓN 11 (completada)

### Resumen
Daniel aclaró que el problema real no era Telegram sino la UI del módulo `Conversaciones`: la lista quedaba trabada, se intuían conversaciones más abajo pero no se podía scrollear, y además quería asegurar que las más recientes queden siempre arriba. Se aplicó un fix más agresivo de scroll y orden visual.

### Lo implementado en esta sesión
1. **Lista de conversaciones ordenada explícitamente**
   - `client/src/pages/Conversations.jsx`
   - Al cargar desde API, las conversaciones ahora se ordenan en frontend por:
     - `last_message_at` descendente
     - fallback `started_at` descendente
   - Eso garantiza:
     - más nuevas arriba
     - más antiguas abajo

2. **Scroll de lista endurecido**
   - `client/src/index.css`
   - Se añadió a `.conversations-list`:
     - `height: 100%`
     - `max-height: 100%`
     - `overflow-x: hidden`
     - `-webkit-overflow-scrolling: touch`
     - `touch-action: pan-y`
   - También se reforzó `.conversations-layout` con `100dvh` y `max-height`

3. **Reset visual al tope**
   - `client/src/pages/Conversations.jsx`
   - Al recargarse la lista, el contenedor vuelve al inicio para dejar visibles las conversaciones más recientes

### Archivos modificados en sesión 11
- `client/src/pages/Conversations.jsx`
- `client/src/index.css`
- `client/dist/*`
- `CLAUDE.md`
- `HANDOFF.md`

### Verificación hecha
- `cd client && npm run build`: OK

### Nota
- No se hizo push en esta sesión todavía

---

## Estado actual: 2026-04-09 — SESIÓN 12 (completada)

### Resumen
Daniel reportó que el chatbot decía que no había talleres programados aunque sí había uno creado en el admin. La causa exacta quedó verificada en producción: el taller existente estaba en estado `draft`, y el bot solo ofrece talleres en estado `planned` u `open`.

### Hallazgo exacto en producción
- `GET /api/workshops?limit=20` devolvió:
  - taller `Constel Work`
  - fecha `2026-04-18`
  - estado `draft`
- Por diseño actual del bot:
  - `getActiveWorkshops()` filtra `status IN ('open', 'planned')`
- Conclusión:
  - el bot no estaba mintiendo ni fallando
  - el taller existía, pero seguía en borrador

### Lo implementado en esta sesión
1. **Nuevo default de talleres**
   - `server/routes/workshops.js`
   - al crear taller nuevo, si no se manda `status`, ahora queda en `planned` en vez de `draft`

2. **UX más clara en el creador**
   - `client/src/pages/Workshops.jsx`
   - el form ahora arranca con `status: 'planned'`
   - se añadió una aclaración debajo del selector de estado:
     - el chatbot solo ofrece talleres en estado Planificado o Inscripciones abiertas

### Archivos modificados en sesión 12
- `server/routes/workshops.js`
- `client/src/pages/Workshops.jsx`
- `client/dist/*`
- `CLAUDE.md`
- `HANDOFF.md`

### Verificación hecha
- `node --check server/routes/workshops.js`: OK
- `cd client && npm run build`: OK

### Nota importante
- El fix evita que vuelva a pasar con talleres nuevos
- El taller ya existente en producción sigue en `draft` hasta que alguien lo cambie manualmente a `planned` u `open`
