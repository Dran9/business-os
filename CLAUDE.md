# Proyecto: Business OS — Daniel MacLean

## Qué es
Sistema operativo privado para gestionar el negocio de talleres terapéuticos.
Chatbot de ventas por WhatsApp, CRM de leads, finanzas, marketing, insights.
Solo admin (sin frontend público). Ultra responsivo para iOS wrapper.
Deploy en **Hostinger** (segundo sitio Node.js).

## Dueño
Daniel MacLean — psicólogo en Cochabamba, Bolivia
- Teléfono personal: 59172034151
- WhatsApp Business: 59169650802
- Negocio: talleres de constelaciones familiares, coaching, desarrollo personal
- Operación esperada hoy: una instalación por cliente/negocio, con hasta 4 usuarios internos como equipo
- Caso real actual: Daniel y su novia deben poder entrar con cuentas separadas y repartir operación

## URLs
- **App**: https://darkred-kangaroo-559638.hostingersite.com/
- **Health**: https://darkred-kangaroo-559638.hostingersite.com/api/health
- **Repo**: https://github.com/Dran9/business-os.git
- **PIN admin**: 4747

## Stack
- **Server:** Express + MySQL (Hostinger) — `server/`
- **Client:** React 18 + Vite 8 + CSS custom properties — `client/`
- **LLM:** Groq (gratis) para tagging + DeepSeek para conversaciones
- **Chat canal:** Telegram Bot API (FUNCIONANDO — @dranTele_bot)
- **Chat canal futuro:** WhatsApp Cloud API (cuando tenga otro chip)
- **Integraciones:** Google Vision OCR, Pushinator, Meta Graph API (futuro)
- **Deploy:** Hostinger Business Web Hosting (segundo sitio Node.js)
- **Auth:** usuario + PIN de 4 dígitos, JWT 90 días

## Proyecto hermano
- **Agenda 4.0:** `/Users/dran/Documents/Codex openai/agenda4.0/`
- Business OS consulta datos de Agenda 4.0 en modo read-only por bridge dedicado
- Agenda NO depende de Business OS
- Comparten: WABA (mismo WhatsApp Business Account), Google Vision, patrón de deploy

## Reglas críticas (heredadas de Agenda — NO ignorar)

### Hostinger
- `dns.setDefaultResultOrder('ipv4first')` DEBE ser la primera línea de `server/db.js`
- `client/dist/` se commitea al repo — Hostinger no ejecuta builds
- El `"build"` en package.json raíz es un no-op
- Después de cambios en client/, correr `cd client && npm run build` y commitear `client/dist/`
- `express.static()` con `maxAge: 0, etag: false` — LiteSpeed cachea agresivamente
- SPA fallback usa `fs.readFileSync()` no `res.sendFile()`

### Textos en español
- NUNCA usar unicode escapes (\u00f3, \u00e9, etc.) en archivos JSX
- Siempre escribir los caracteres directamente: ó, é, í, á, ú, ñ, ¿, ¡

### Buttons en React
- SIEMPRE poner `type="button"` en todo `<button>` que NO sea submit de form

### Timezone
- Server SIEMPRE trabaja en America/La_Paz (-04:00)
- `timezone: '-04:00'` en mysql2 pool — NUNCA quitar
- Bolivia no tiene DST
- `toISOString()` devuelve UTC. Para mostrar horas en Bolivia usar `toLocaleTimeString('es-BO', { timeZone: 'America/La_Paz' })`

### Preferencias de Daniel
- NO emojis en la UI (excepto donde sea funcionalmente necesario)
- NO usar AskUserQuestion
- Fonts: +2pt respecto al diseño base
- Mobile: padding 12px en móvil, 24px en >=520px
- Responder a TODAS las preguntas, no cherry-pick
- Nunca hacer push sin que lo pida explícitamente

### MySQL optimizada
- Connection pooling: 10 conexiones, 5 idle
- Slow query logging: >200ms se logea
- Queries paginadas con helper `queryPaginated()`
- Transacciones con `withTransaction(fn)`
- Índices estratégicos en todas las tablas (ya definidos en schema)
- Named placeholders habilitados

## Arquitectura

### Tenant / instalación
- El schema conserva `tenant_id` en todas las tablas principales
- En la práctica actual, el producto se está construyendo como **single-tenant por instalación**
- Eso permite venderlo instalado en el servidor del cliente sin tener que operar un SaaS
- `tenants` sigue siendo útil para branding, config, API keys y posible evolución futura
- Si en el futuro se ofrece SaaS, la base ya deja la puerta abierta

### Sistema de diseño
- **CSS custom properties** en `client/src/index.css`
- Para cambiar el look entero: editar `:root`
- Dark mode: `[data-theme="dark"]`
- Multi-tenant branding: se sobreescriben variables vía JS al cargar `brand_config`
- Componentes NUNCA tienen colores hardcodeados
- Tags tienen colores por categoría: intent=azul, sentiment=amarillo, objection=rojo, stage=verde, behavior=morado, quality=naranja

### Capas de la arquitectura
```
Routes (thin)  → validate request → call service → respond HTTP
Services       → toda la lógica de negocio
Middleware     → auth (JWT) + tenant resolver + validation
Cron           → followups, reminders, analysis batch
```

## Módulos del sistema

### 1. Chatbot / Embudo / Venta
- Motor de conversación híbrido: embudo determinístico por nodos + pasos con LLM
- `flow_nodes` y `flow_sessions` gobiernan el embudo actual
- El webhook de Telegram ya entra por `flowEngine`, no por fases hardcodeadas
- Fases conceptuales: qualify → educate (LLM) → close → confirm (OCR)
- Escalación a Daniel vía Pushinator
- Groq actual: `llama-3.3-70b-versatile` con fallback determinístico si falta `GROQ_API_KEY`

### 2. Conversaciones + Tags
- Almacena todo mensaje WhatsApp en `messages`
- Tags automáticos por LLM: intent, sentiment, objection, stage, behavior, quality
- Tabla `tags` polimórfica (target_type + target_id)

### 3. CRM de leads
- Tabla `leads` con scoring automático
- Status: new → qualifying → qualified → negotiating → converted | lost
- Lead scoring por reglas + señales del LLM

### 4. Finanzas
- Tabla `transactions` unifica ingresos y gastos
- `financial_goals` por período
- Integración con Agenda 4.0 para ingresos de terapia individual
- Balance items (activos, pasivos)
- Los pagos de talleres confirmados por OCR se registran como `transactions` verificadas

### 5. Marketing / Publicidad
- Catálogo de talleres (`workshops`) como productos
- `campaigns` con tracking de leads y conversiones
- registro de ingresos atribuidos por campaña
- Generador de copy con LLM (Groq/DeepSeek)
- Futuro: Meta Graph API para posts directos

### 6. Insights / Métricas
- Embudo de conversión
- ROI por campaña
- Análisis de objeciones (datos del LLM)
- Comparativa por taller
- Consolidado con Agenda 4.0

## Estado funcional añadido en sesión 2
- `server/services/chatbot/llm.js` — integración Groq OpenAI-compatible con fallback si no hay key
- `server/services/analysis/tagger.js` — tags automáticos por mensaje inbound (`intent`, `sentiment`, `quality`)
- `server/services/analysis/scorer.js` — scoring automático de leads
- `server/routes/finance.js` — CRUD de transacciones + resumen mensual + meta mensual
- `GET /api/analytics/funnel` — embudo y top fuentes
- `client/src/pages/Finance.jsx` — página funcional para registrar y filtrar ingresos/gastos
- `client/src/pages/Insights.jsx` — embudo visual y top fuentes
- Chatbot: en fase `interested`, preguntas libres usan Groq si está disponible
- Chatbot: botón `inscribir_<id>` ahora crea/actualiza enrollment pendiente y responde confirmando interés

## Estado funcional añadido en sesión 3
- Login actualizado a `username + PIN`
- `GET /api/auth/me` para rehidratar usuario autenticado
- Nuevo módulo `server/routes/team.js`
- `client/src/pages/Settings.jsx` ya no es placeholder: ahora gestiona equipo interno
- `admin_users` soporta `display_name` y `active`
- Las conversaciones pueden asignarse manualmente a usuarios internos
- Sidebar muestra usuario y rol activos
- La lista de conversaciones muestra a quién está asignado cada chat
- `GET /api/leads/stats/summary` quedó corregido en el orden de rutas

## Estado funcional añadido en sesión 4
- `server/routes/settings.js` gestiona opciones de cobro y subida de QR
- Hay 4 slots de cobro configurables por instalación:
  - etiqueta
  - monto
  - activo/inactivo
  - imagen QR
- Se pueden usar etiquetas como `Precio constelar` y `Precio participar`
- `tenants` ahora guarda:
  - `payment_options`
  - `payment_destination_accounts`
  - `payment_qr_1..4`
- `server/services/ocr.js` integra Google Vision para comprobantes
- `server/services/chatbot/paymentWorkflow.js` maneja:
  - selección de opción de cobro
  - envío de QR por Telegram
  - contexto de pago en conversación
  - validación OCR del comprobante
- Reglas OCR heredadas de agenda4.0:
  - destinatario/cuenta destino válida
  - monto correcto
  - fecha del comprobante no anterior al último QR enviado
- `client/src/pages/Settings.jsx` ya permite subir los 4 QR y definir cuentas destino válidas

## Estado funcional añadido en sesión 5
- Nuevo módulo `server/routes/enrollments.js`
- Nuevo servicio `server/services/enrollments.js`
- `server/index.js` ahora expone `/api/enrollments`
- `client/src/pages/Workshops.jsx` ahora incluye una vista operativa de inscripciones dentro del módulo de talleres
- La vista de inscripciones permite filtrar por:
  - taller
  - estado de revisión
  - asignado
  - búsqueda por lead o taller
- Estados operativos visibles:
  - pendiente
  - comprobante recibido
  - mismatch
  - confirmado
- Acciones manuales disponibles desde admin:
  - confirmar pago
  - rechazar comprobante
  - reenviar QR
  - reenviar instrucciones
- La confirmación manual:
  - confirma `enrollment`
  - crea o actualiza `transactions`
  - convierte lead y conversación
  - sincroniza `current_participants` del taller
- El rechazo manual:
  - conserva historial
  - agrega `mismatch_manual` a `ocr_data.validation_problems`
  - mantiene el enrollment en revisión operativa
- El workflow OCR automático ahora también sincroniza `current_participants` cuando valida un pago

## Estado funcional añadido en sesión 6
- Nuevo servicio `server/services/adminEvents.js` para Server-Sent Events admin
- `server/index.js` ahora expone `GET /api/admin/events`
- La app ya soporta actualización en vivo en:
  - Leads
  - Conversaciones / Inbox
  - Finanzas
- `conversations` ahora soporta:
  - `inbox_state` (`open`, `pending`, `resolved`)
  - `internal_notes`
- El inbox admin ya permite:
  - filtrar por estado comercial
  - filtrar por estado operativo del inbox
  - filtrar por asignado
  - buscar por lead o taller
  - guardar notas internas
  - cambiar estado operativo
  - enviar mensajes manuales desde el panel
- Al entrar un mensaje inbound:
  - la conversación vuelve a `open`
  - se emiten eventos admin en vivo
- Al enviar mensaje manual desde admin:
  - se manda por Telegram
  - se guarda en `messages`
  - la conversación pasa a `pending`
  - se autoasigna al operador si estaba en `bot`
- `server/services/chatbot/engine.js` ahora actualiza `last_message_at` también en outbound
- Leads y Finanzas escuchan eventos en vivo y recargan sin refresh manual

## Estado funcional añadido en sesión 7
- `server/routes/enrollments.js` ahora soporta:
  - `GET /api/enrollments/:id`
  - `GET /api/enrollments/:id/proof`
- `server/services/enrollments.js` ahora expone:
  - `getEnrollmentProofAsset`
  - `getReviewState`
- La revisión de OCR/pagos en `client/src/pages/Workshops.jsx` ahora muestra:
  - ficha detallada por inscripción
  - monto esperado vs monto detectado
  - fecha, cuenta, banco, referencia
  - lista de reglas fallidas
  - texto OCR crudo
  - apertura/descarga del comprobante
  - confirmación manual con monto corregido
- `client/src/pages/Leads.jsx` ahora funciona como CRM con ficha lateral:
  - datos del lead
  - tags
  - notas
  - resumen de conversaciones
  - resumen de inscripciones
  - timeline consolidado de mensajes, enrollments y transacciones
- `server/routes/leads.js` ahora devuelve en detalle:
  - `enrollments`
  - `transactions`
  - `timeline`

## Estado funcional añadido en sesión 8
- Nuevo servicio `server/services/activityLog.js`
- `server/routes/auth.js` ahora soporta `POST /api/auth/change-pin`
- `server/routes/team.js` ahora quedó más estricto:
  - admins no pueden gestionar owners
  - solo owners pueden crear/promover owners
  - no se puede desactivar o eliminar la propia cuenta
  - no se puede dejar la instalación sin al menos un owner activo
  - si cambia el username de un usuario, se sincroniza `conversations.assigned_to`
  - si se elimina un usuario, sus conversaciones asignadas vuelven a `bot`
- `client/src/pages/Settings.jsx` ahora permite:
  - cambiar tu propio PIN
  - editar usuarios existentes
  - cambiar username, nombre visible, rol y estado
  - resetear PIN de otro usuario
  - ver descripciones claras de roles
  - ver bitácora reciente del equipo
- `client/src/hooks/useAuth.js` y `client/src/utils/api.js` ahora rehidratan en vivo el usuario actual si se edita su propio perfil desde Settings

## Estado funcional añadido en sesión 9
- `server/routes/marketing.js` ahora ya soporta CRUD completo de campañas y resumen:
  - `GET /api/marketing/summary`
  - `GET /api/marketing`
  - `POST /api/marketing`
  - `PUT /api/marketing/:id`
  - `DELETE /api/marketing/:id`
- `campaigns` ahora soporta `revenue_generated`
- `client/src/pages/Marketing.jsx` dejó de ser placeholder:
  - KPIs de inversión, ingresos atribuidos, resultado, ROI, CPL y CPA
  - formulario operativo de campañas
  - filtros por estado, plataforma y búsqueda
  - tabla de campañas con edición y borrado
  - resumen por plataforma
- `server/services/agendaBridge.js` crea un bridge read-only con Agenda 4.0:
  - puede tomar config desde env vars `AGENDA_DB_*`
  - si no existe, intenta leer `/Users/dran/Documents/Codex openai/agenda4.0/.env`
  - busca clientes, citas y pagos
- `server/routes/agenda.js` expone:
  - `GET /api/agenda/status`
  - `GET /api/agenda/search`
  - `GET /api/agenda/lead/:leadId`
- `server/routes/leads.js` ahora soporta CRM más serio:
  - quick views por `view=hot|followup|converted|agenda_pending`
  - `POST /api/leads/:id/tags` para tags manuales
  - `DELETE /api/leads/:id/tags/:tagId` para quitar tags manuales
  - `PUT /api/leads/:id/agenda-link` para vincular o desvincular con Agenda 4.0
- `client/src/pages/Leads.jsx` ahora suma:
  - vistas rápidas
  - tags manuales editables
  - panel de cruce con Agenda 4.0
  - búsqueda y vinculación manual de cliente de Agenda
  - resumen de citas y pagos del cliente vinculado

## Estado funcional añadido en sesión 10
- `client/src/pages/Conversations.jsx` ahora hace auto-scroll al final del hilo al cargar mensajes o cambiar de conversación
- `client/src/index.css` endurece el layout de inbox para navegadores sensibles a grid/flex:
  - `min-height: 0` en paneles con scroll
  - `overscroll-behavior: contain` en lista y thread
- Verificación operativa hecha en producción:
  - `GET /api/health` responde `200`
  - `GET /api/conversations?limit=5` responde correctamente
  - la conversación de Telegram seguía registrando mensajes y respuesta del bot a las `02:46` hora Bolivia del `2026-04-09`
  - `getWebhookInfo` de Telegram reportó `pending_update_count: 0`
- Conclusión de sesión 10:
  - no hubo evidencia de caída del webhook
  - el fix aplicado fue sobre robustez del módulo `Conversaciones`

## Estado funcional añadido en sesión 11
- `client/src/pages/Conversations.jsx` ahora fuerza orden descendente por `last_message_at` / `started_at`
- la lista de conversaciones se resetea arriba al recargar para dejar siempre las más recientes al tope
- `client/src/index.css` endurece todavía más el scroll de la lista:
  - `height: 100%`
  - `overflow-x: hidden`
  - `-webkit-overflow-scrolling: touch`
  - `touch-action: pan-y`
  - uso de `100dvh` para altura real del panel
- objetivo de sesión 11:
  - corregir lista de conversaciones “trancada”
  - asegurar que las más nuevas queden arriba y las más antiguas abajo

## Estado funcional añadido en sesión 12
- hallazgo de producción:
  - el taller `Constel Work` existía pero estaba en estado `draft`
  - el chatbot solo ofrece talleres `planned` u `open`
- `client/src/pages/Workshops.jsx` ahora crea talleres nuevos con estado por defecto `planned`
- la UI de talleres ahora explica explícitamente:
  - el chatbot solo muestra talleres en estado Planificado o Inscripciones abiertas
- `server/routes/workshops.js` también cambia el default backend de creación a `planned`

## Estado funcional añadido en sesión 13
- Nuevo módulo admin `Embudo`:
  - `client/src/pages/Funnel.jsx`
  - ruta `/funnel`
  - ítem en sidebar entre Conversaciones y Leads
- Nuevo schema conversacional:
  - tabla `flow_nodes`
  - tabla `flow_sessions`
  - seed inicial automático del flujo base para `tenant_id = 1` si `flow_nodes` está vacía
- Nuevo backend admin:
  - `server/routes/funnel.js`
  - `GET /api/funnel/nodes`
  - `POST /api/funnel/nodes`
  - `PUT /api/funnel/nodes/:id`
  - `DELETE /api/funnel/nodes/:id`
  - `GET /api/funnel/sessions`
  - `GET /api/funnel/sessions/:id`
- Nuevo motor `server/services/chatbot/flowEngine.js`:
  - reemplaza el webhook hardcodeado actual de Telegram
  - inicia sesión en el nodo de menor `position`
  - soporta `message`, `open_question_ai`, `open_question_detect`, `options`, `action`
  - guarda contexto en `flow_sessions.context`
  - reemplaza placeholders `[FECHA]`, `[VENUE]`, `[HORA_INICIO]`, `[HORA_FIN]` con el taller más próximo `planned/open`
  - crea lead automáticamente al responder `nodo_02` y lo pasa a `qualifying`
  - emite SSE `funnel_session_update` en cada cambio de nodo
  - si un `node_key` referenciado no existe, loggea y escala automáticamente
- Integraciones del embudo:
  - `send_qr` reutiliza `payment_options` del tenant y `paymentWorkflow`
  - `process_payment_proof` reutiliza OCR + confirmación de pagos existente
  - `check_workshop_capacity` valida cupos para constelar
  - `escalate` marca conversación como `escalated`, sesión como `escalated` y dispara Pushinator si hay config
- Nuevo servicio `server/services/pushinator.js`
  - usa `PUSHINATOR_API_TOKEN` / `PUSHINATOR_CHANNEL_ID` o `tenant.push_config`
  - si faltan credenciales, falla de forma tolerante sin romper el bot
- `client/src/pages/Conversations.jsx` ahora acepta `?conversationId=` para deep-link desde Embudo

## Estado funcional añadido en sesión 14
- Ajuste operativo en talleres:
  - `server/routes/workshops.js` crea talleres nuevos con default `planned` en vez de `draft`
  - `client/src/pages/Workshops.jsx` refleja ese default y muestra una nota aclarando que el bot/embudo solo ofrece talleres `planned` u `open`

## Estado funcional añadido en sesión 15
- Ajuste visual global de tipografía:
  - se subieron `+2px` los tokens tipográficos base en `client/src/index.css`
  - aplica igual a tema claro y oscuro porque ambos consumen la misma escala desde `:root`
  - no se tocaron colores, layout estructural ni lógica

## Estado funcional añadido en sesión 16
- Correcciones puntuales de server sobre bugs operativos:
  - `server/services/chatbot/flowEngine.js` ya no degrada enrollments confirmados al reingresar por el embudo
  - `server/routes/workshops.js` expone correctamente `GET /api/workshops/venues/list` antes de `/:id`
  - `server/routes/webhook.js` y `server/services/channels/telegram.js` ahora usan `secret_token` para proteger el webhook de Telegram
  - `server/routes/auth.js` ahora:
    - exige seleccionar usuario si hay más de un admin activo
    - limita intentos de login con `express-rate-limit`
  - `server/middleware/tenant.js` ya no cachea los BLOBs de QR del tenant
  - `server/routes/workshops.js` conserva `price: 0` y `early_bird_price: 0` en creación

## Estado funcional añadido en sesión 17
- Corrección del módulo `Configuración`:
  - `client/src/pages/Settings.jsx` ya no pisa cambios locales del formulario de cobros cuando termina una carga tardía o cuando se sube un QR
  - al subir un QR solo se refresca `has_qr`, sin resetear etiquetas, montos ni cuentas destino que el usuario aún no guardó
  - se agregó feedback visual de estado:
    - `Cambios guardados`
    - `Hay cambios sin guardar`
    - confirmación explícita cuando el guardado fue exitoso
- `client/src/index.css` suma estilos para avisos inline en Configuración

## Regla operativa de deploy
- Este proyecto despliega desde `main` para Hostinger
- No abrir branches intermedias para trabajo normal salvo pedido explícito del usuario
- Cuando se haga un cambio funcional, actualizar también `CLAUDE.md` y `HANDOFF.md` en la misma sesión

### 7. Comandos rápidos
- Acciones sobre leads: follow-up, cobrar, escalar, descartar
- Acciones sobre talleres: broadcast, recordatorio, clonar

### 8. Catálogo de talleres
- CRUD de talleres con venues, precios, fechas
- Enrollments (inscripciones) con status
- Waitlist automática cuando se llena

## Estructura de archivos
```
business-os/
├── server/
│   ├── index.js
│   ├── db.js                     (MySQL pool + schema + helpers)
│   ├── routes/                   (thin routes)
│   ├── services/                 (business logic)
│   │   ├── chatbot/              (engine, llm, qualify, prompts)
│   │   └── analysis/             (tagger, scorer, insights)
│   ├── middleware/               (auth, tenant, validate)
│   └── cron/                     (followups, reminders, sync)
├── client/
│   ├── src/
│   │   ├── index.css             (design system — CSS custom properties)
│   │   ├── pages/                (una por módulo)
│   │   ├── components/           (ui/, layout/, por-módulo/)
│   │   ├── hooks/
│   │   └── utils/
│   └── vite.config.js
├── CLAUDE.md                     (este archivo)
├── HANDOFF.md                    (log de progreso para continuidad entre IAs)
└── package.json
```

## DB Schema (15 tablas)
1. `tenants` — config multi-tenant
2. `admin_users` — login admin
3. `venues` — lugares para talleres
4. `workshops` — talleres como productos
5. `leads` — CRM
6. `playbooks` — embudos conversacionales
7. `conversations` — hilos de conversación
8. `messages` — mensajes individuales
9. `tags` — clasificación polimórfica
10. `transactions` — ingresos y gastos
11. `financial_goals` — metas por período
12. `enrollments` — inscripciones a talleres
13. `campaigns` — tracking de publicidad
14. `followup_queue` — secuencias de seguimiento
15. `activity_log` — auditoría
