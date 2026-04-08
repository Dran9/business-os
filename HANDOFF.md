# HANDOFF — Business OS

## Para qué es este archivo
Log de progreso para que cualquier instancia de IA (Claude, Codex, etc.) pueda retomar el trabajo exactamente donde se dejó. Se actualiza al final de cada sesión.

---

## Estado actual: 2026-04-08 — SESIÓN 1 (completada)

### Resumen
App desplegada y funcionando en Hostinger. Login con PIN, dashboard con KPIs, sidebar con navegación a 8 módulos, dark/light mode. Las 15 tablas MySQL se crean solas al primer startup.

### URL producción
- **App**: https://darkred-kangaroo-559638.hostingersite.com/
- **Health**: https://darkred-kangaroo-559638.hostingersite.com/api/health
- **Repo**: https://github.com/Dran9/business-os.git

### Credenciales
- **PIN admin**: 4747 (bcrypt hash en seed de db.js)
- **MySQL**: DB=u926460478_OS, user=u926460478_OS_user, pass=OSultraApp909
- **JWT_SECRET**: bos_j8k2m9x4w7p1v6n3q5t0r
- Env vars configuradas en hPanel de Hostinger

### Lo que se construyó

#### Server
- `server/db.js` — Pool MySQL optimizado para Hostinger (dns ipv4first, timezone -04:00, connection pooling, slow query logging >200ms, helpers: query, queryPaginated, withTransaction). **15 tablas** con índices: tenants, admin_users, venues, workshops, leads, playbooks, conversations, messages, tags, transactions, financial_goals, enrollments, campaigns, followup_queue, activity_log. Seed automático de tenant Daniel + admin con PIN 4747.
- `server/index.js` — Express con health check, rutas auth y analytics activas, static serving estilo Hostinger (maxAge:0, etag:false, readFileSync para SPA fallback)
- `server/routes/auth.js` — Login con PIN de 4 dígitos (bcrypt), setup endpoint, JWT con 90 días de expiración
- `server/routes/analytics.js` — Dashboard KPIs (leads, conversiones, talleres activos, ingresos/gastos/neto del mes)
- `server/middleware/auth.js` — JWT verificación (header Bearer + query param para SSE)
- `server/middleware/tenant.js` — Resolver multi-tenant con cache en memoria (TTL 5 min)

#### Client
- React 18 + Vite 8 + React Router 7
- `client/src/App.jsx` — Router con lazy loading de todas las páginas
- `client/src/pages/Login.jsx` — PIN de 4 dígitos con auto-avance, auto-submit, soporte paste
- `client/src/pages/Dashboard.jsx` — KPI cards leyendo /api/analytics/dashboard
- 7 páginas placeholder: Conversations, Leads, Workshops, Finance, Marketing, Insights, Settings
- `client/src/components/layout/AdminLayout.jsx` — Layout con Outlet de React Router
- `client/src/components/layout/Sidebar.jsx` — Navegación completa con iconos SVG inline, dark/light toggle, logout. Responsive con slide-out en mobile.
- `client/src/hooks/useAuth.js` — JWT auth con sync cross-tab
- `client/src/hooks/useTheme.js` — Light/dark/system con persistencia en localStorage
- `client/src/utils/api.js` — Fetch wrapper con auto-redirect a login en 401
- `client/src/utils/dates.js` — Formatters de fecha, hora, moneda, timeAgo (timezone America/La_Paz)
- `client/src/index.css` — Sistema de diseño completo con CSS custom properties: tokens de color, tipografía, espaciado, sombras; dark mode; componentes (card, btn, input, tag, table, kpi-card, badge, funnel-bar, pin-input); responsive mobile-first; safe area iOS

#### Deploy
- `client/dist/` pre-built y commiteado (Hostinger no ejecuta builds)
- `package.json` raíz con dependencias del server (Hostinger instala desde raíz)
- Build script es no-op: `echo 'client/dist is pre-built...'`
- Node 22.x, Entry file: server/index.js

### Bugs encontrados y resueltos
1. **Dependencias en server/package.json** — Hostinger instala desde la raíz. Fix: mover todo a package.json raíz.
2. **dns.setDefaultResultOrder antes de require** — Crasheaba. Fix: `require('dns').setDefaultResultOrder('ipv4first')`.
3. **date-fns v3 + date-fns-tz v2** — Peer dependency conflict. Fix: actualizar a date-fns v4 + date-fns-tz v3.

---

## Lo que falta — por prioridad

### Fase 2: CRUD base (SIGUIENTE)
- [ ] `server/routes/workshops.js` — CRUD talleres + venues
- [ ] `server/routes/leads.js` — CRUD leads con filtros y paginación
- [ ] `client/src/pages/Workshops.jsx` — Tabla de talleres, crear/editar/eliminar, venues
- [ ] `client/src/pages/Leads.jsx` — Tabla de leads con scoring visual, filtros por status/source
- [ ] Componentes reutilizables: Modal, DataTable, StatusBadge, SearchInput

### Fase 3: Chatbot + Telegram (canal de testing)
- [ ] **Decisión: Telegram primero, WhatsApp después** — Daniel necesita comprar otro chip para WA. Telegram es gratis e instantáneo para testing.
- [ ] **Arquitectura agnóstica al canal**: motor de chatbot NO sabe si es Telegram o WhatsApp. Adaptadores intercambiables.
- [ ] `server/services/channels/telegram.js` — Adaptador Telegram Bot API (enviar/recibir)
- [ ] `server/services/channels/whatsapp.js` — Adaptador WhatsApp Cloud API (para después)
- [ ] `server/services/channels/base.js` — Interfaz común de canal
- [ ] `server/services/chatbot/engine.js` — Motor de playbooks (state machine)
- [ ] `server/services/chatbot/llm.js` — Router Groq/DeepSeek
- [ ] `server/services/chatbot/qualify.js` — Lógica de calificación
- [ ] `server/services/chatbot/prompts.js` — System prompts por fase
- [ ] `server/routes/webhook.js` — Recibir mensajes (Telegram primero)
- [ ] `client/src/pages/Conversations.jsx` — Inbox con tags LLM
- [ ] Env var nueva: `TELEGRAM_BOT_TOKEN`
- [ ] Daniel creará el bot via @BotFather en Telegram

### Fase 4: Finanzas + Integración Agenda
- [ ] `server/routes/finance.js` + service — Transacciones CRUD, metas, balance
- [ ] `server/routes/agenda-bridge.js` — Proxy a Agenda 4.0 API
- [ ] `client/src/pages/Finance.jsx` — Dashboard financiero completo
- [ ] Endpoint nuevo en Agenda 4.0 para exponer datos financieros read-only
- [ ] Google Vision OCR para comprobantes (copiar de Agenda)

### Fase 5: Marketing + Insights
- [ ] `server/routes/marketing.js` — Campaigns CRUD
- [ ] Generador de copy con LLM (Groq/DeepSeek)
- [ ] `client/src/pages/Marketing.jsx` — Catálogo de publicidades
- [ ] `client/src/pages/Insights.jsx` — Métricas, embudos, análisis de objeciones
- [ ] Meta Graph API para posts orgánicos (futuro)

### Fase 6: Chatbot avanzado + Sequences
- [ ] Playbook builder en UI
- [ ] Follow-up sequences con cron
- [ ] Escalación con Pushinator
- [ ] Análisis batch nocturno de conversaciones
- [ ] Migración de Telegram a WhatsApp (adaptador WA)

### Fase 7: Pulido para venta
- [ ] Settings.jsx — Config completa por tenant (logo, colores, API keys desde UI)
- [ ] Onboarding wizard para nuevo tenant
- [ ] Documentación para compradores

---

## Decisiones de arquitectura tomadas

1. **Multi-tenant en DB, no en .env** — Las API keys van en tabla `tenants`, no en variables de entorno. El .env solo tiene infra (DB, JWT). Esto es clave para vender el software.

2. **CSS custom properties para diseño** — El look & feel se controla desde :root. Para cambiar el diseño entero, se edita un bloque de variables. Los componentes usan clases CSS semánticas que referencian las variables. Permite theming por tenant sin duplicar código.

3. **PIN de 4 dígitos para auth** — Es app personal de admin. No necesita usuario/contraseña. JWT dura 90 días. Esto lo definió Daniel.

4. **Playbooks como JSON en DB** — Los embudos conversacionales son JSON estructurado, no código. Permite crear/editar desde UI, A/B testing, y que cada tenant tenga los suyos.

5. **Tags polimórficos** — Tabla `tags` con `target_type` + `target_id` sirve para conversaciones, mensajes, leads y workshops. Una sola tabla, queries simples.

6. **Chatbot agnóstico al canal** — El engine no sabe si es Telegram o WhatsApp. Adaptadores de canal intercambiables. Telegram para desarrollo, WhatsApp para producción.

7. **Groq para tagging, DeepSeek para conversación** — Groq es gratis y rápido para clasificación. DeepSeek es barato para conversaciones largas.

8. **Lazy loading de páginas** — Cada módulo se carga solo cuando se navega a él. Mantiene el bundle inicial pequeño.

9. **client/dist/ commiteado** — Hostinger no ejecuta builds. Se buildea local, se commitea dist/, Hostinger lo sirve.

---

## Archivos de referencia en Agenda 4.0
Path: `/Users/dran/Documents/Codex openai/agenda4.0/`
Para copiar/adaptar cuando se necesiten:
- `server/services/whatsapp.js` — envío WhatsApp Cloud API
- `server/services/ocr.js` — Google Vision OCR
- `server/routes/webhook.js` — recepción de webhooks Meta
- `server/services/adminEvents.js` — SSE real-time pattern
- `client/src/hooks/useAdminEvents.js` — SSE client hook
- `server/services/contacts.js` — gestión de contactos WhatsApp

---

## Skills disponibles en .claude/skills/
- app-builder — orquestador de construcción
- fullstack-developer — React + Node.js + DB
- frontend-design-skill — diseño de alta calidad
- react-best-practices-skill — optimización React
- react-vite-best-practices — React + Vite patterns
- debugger — debugging sistemático
- simplify-code — revisión y simplificación
- mcp-apps-builder — apps MCP
- webapp-testing — Playwright testing

---

## Notas para la próxima sesión
- La app está LIVE y funcionando en Hostinger
- El PIN de Daniel es 4747
- Los módulos Conversations, Leads, Workshops, Finance, Marketing, Insights, Settings son placeholders — necesitan CRUD real
- Daniel va a crear un bot de Telegram via @BotFather — necesitará el token para conectar
- Los webhooks de Meta/WhatsApp están atados a agenda.danielmaclean.com (Agenda 4.0) — NO mover. Para Business OS usaremos Telegram como canal de chat
- Las dependencias de server están en el package.json RAÍZ (no en server/package.json que fue eliminado)
- Para hacer cambios en el frontend: editar en client/src/, correr `cd client && npm run build`, commitear client/dist/, push
