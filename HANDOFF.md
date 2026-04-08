# HANDOFF — Business OS

## Para qué es este archivo
Log de progreso para que cualquier instancia de IA (Claude, Codex, etc.) pueda retomar el trabajo exactamente donde se dejó. Se actualiza al final de cada sesión.

---

## Estado actual: 2026-04-08 — SESIÓN 1

### Lo que se hizo
1. **Estructura de carpetas completa** — server/ (routes, services, middleware, cron) + client/ (pages, components, hooks, utils)
2. **Git inicializado** con remote `Dran9/business-os`
3. **package.json** raíz + server (con dependencias Express, mysql2, JWT, bcrypt, cors, date-fns, zod)
4. **server/db.js** — Pool MySQL optimizado para Hostinger:
   - `dns.setDefaultResultOrder('ipv4first')` en línea 1
   - Pool con connection limit, keepalive, timezone -04:00
   - Helper `query()` con slow query logging (>200ms)
   - Helper `queryPaginated()` para listados
   - Helper `withTransaction()` para operaciones atómicas
   - **15 tablas** definidas en `initializeDatabase()`:
     tenants, admin_users, venues, workshops, leads, playbooks, conversations, messages, tags, transactions, financial_goals, enrollments, campaigns, followup_queue, activity_log
   - Seed automático del tenant de Daniel
5. **server/index.js** — Express skeleton con health check, rutas comentadas (listas para activar), static file serving con las reglas de Hostinger
6. **server/middleware/auth.js** — JWT con soporte para header Y query param (para SSE)
7. **server/middleware/tenant.js** — Resuelve tenant del request con cache en memoria (TTL 5 min)
8. **client/src/index.css** — Sistema de diseño completo:
   - Tokens de diseño en CSS custom properties (:root)
   - Light + Dark mode
   - Tags por categoría con colores
   - Componentes base: card, btn, input, tag, table, kpi-card, badge, funnel-bar
   - Responsive mobile-first (768px breakpoint)
   - Safe area para iOS wrapper
   - Scrollbar custom
   - Utilidades CSS básicas
9. **CLAUDE.md** — Especificaciones completas del proyecto
10. **.env.example** — Todas las variables de entorno documentadas

### Lo que falta — por prioridad

#### Fase 1: Esqueleto funcional (SIGUIENTE)
- [ ] `npm install` en server/ y client/
- [ ] Crear repo en GitHub (puede que no exista aún, hacer `gh repo create`)
- [ ] **server/routes/auth.js** — Login admin (JWT)
- [ ] **client/** — Inicializar Vite + React + configurar
- [ ] **client/src/App.jsx** — Router con lazy loading
- [ ] **client/src/components/layout/AdminLayout.jsx** — Sidebar + header + mobile nav
- [ ] **client/src/components/layout/Sidebar.jsx** — Navegación entre módulos
- [ ] **client/src/pages/Login.jsx**
- [ ] **client/src/pages/Dashboard.jsx** — KPIs básicos
- [ ] **client/src/hooks/useAdminEvents.js** — SSE para real-time
- [ ] **client/src/hooks/useTheme.js** — Light/dark/system
- [ ] **client/src/utils/api.js** — Fetch wrapper con auth
- [ ] Build inicial + commit de client/dist/

#### Fase 2: CRUD base
- [ ] Routes + services para: workshops, venues, leads
- [ ] Páginas admin: Workshops.jsx, Leads.jsx
- [ ] Tabla de workshops con CRUD
- [ ] Tabla de leads con filtros y scoring visual

#### Fase 3: WhatsApp + Chatbot
- [ ] **server/routes/webhook.js** — Recibir mensajes de WhatsApp
- [ ] **server/services/whatsapp.js** — Envío de mensajes (copiar de Agenda, adaptar)
- [ ] **server/services/chatbot/engine.js** — Motor de playbooks
- [ ] **server/services/chatbot/llm.js** — Router Groq/DeepSeek
- [ ] **Conversations.jsx** — Inbox con tags

#### Fase 4: Finanzas + Integración Agenda
- [ ] **server/routes/finance.js** + service
- [ ] **server/routes/agenda-bridge.js** — Proxy a Agenda 4.0
- [ ] **Finance.jsx** — Dashboard financiero
- [ ] Endpoint nuevo en Agenda 4.0 para exponer datos read-only

#### Fase 5: Marketing + Insights
- [ ] **server/routes/marketing.js** — Campaigns CRUD
- [ ] **server/services/meta.js** — Meta Graph API (posts)
- [ ] **Marketing.jsx** — Catálogo de publicidades + generador de copy
- [ ] **Insights.jsx** — Métricas y embudos

#### Fase 6: Chatbot avanzado + Sequences
- [ ] Playbook builder en UI
- [ ] Follow-up sequences (cron)
- [ ] Escalation con Pushinator
- [ ] Análisis batch nocturno de conversaciones

#### Fase 7: Pulido para venta
- [ ] Settings.jsx — Config completa por tenant
- [ ] Onboarding de nuevo tenant
- [ ] Documentación para compradores

### Decisiones de arquitectura tomadas

1. **Multi-tenant en DB, no en .env** — Las API keys van en tabla `tenants`, no en variables de entorno. El .env solo tiene infra (DB, JWT). Esto es clave para vender el software.

2. **CSS custom properties, no Tailwind classes para diseño** — El look & feel se controla desde :root. Para cambiar el diseño entero, se edita un bloque de variables. Los componentes usan clases CSS semánticas (.btn-primary, .card, .tag-intent) que internamente referencian las variables.

3. **Playbooks como JSON en DB** — Los embudos conversacionales se definen como JSON estructurado en la tabla `playbooks`. No son código. Esto permite: crear embudos desde UI, A/B testing, que cada tenant tenga los suyos.

4. **Tags polimórficos** — Una sola tabla `tags` con `target_type` + `target_id` sirve para conversaciones, mensajes, leads y workshops. Simplifica queries y UI.

5. **Chatbot híbrido** — Las fases de calificación y cierre son determinísticas (templates con variables). Las fases de educación y manejo de objeciones usan LLM. Esto minimiza costo y maximiza control.

6. **Groq para tagging, DeepSeek para conversación** — Groq es gratis y rápido para clasificación. DeepSeek es barato para conversaciones largas. Router en `llm.js` selecciona según la tarea.

### Archivos de referencia en Agenda 4.0
Para copiar/adaptar cuando se necesiten:
- `server/services/whatsapp.js` — envío WhatsApp Cloud API
- `server/services/ocr.js` — Google Vision OCR (imágenes + PDF)
- `server/routes/webhook.js` — recepción de webhooks Meta
- `server/services/adminEvents.js` — SSE pattern
- `client/src/hooks/useAdminEvents.js` — SSE client
- `client/src/hooks/useUiTheme.jsx` — theme toggle
- `client/src/components/ThemeModeButton.jsx` — botón light/dark

### Notas para la próxima sesión
- El repo de GitHub `Dran9/business-os` puede que no exista aún. Verificar y crear si hace falta.
- No se hizo `npm install` todavía. Hacerlo antes de cualquier otra cosa.
- El client/ no tiene Vite configurado aún. Necesita `npm create vite@latest` o setup manual.
- Daniel quiere poder cerrar la laptop. Todo el trabajo debe ser commitable y resumible.
