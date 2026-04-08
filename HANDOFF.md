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
