# Business OS — Daniel MacLean

Sistema operativo privado para gestión de talleres terapéuticos. Chatbot de ventas por WhatsApp/Telegram, CRM de leads, finanzas, marketing, insights. Solo admin, sin frontend público.

**Dueño:** Daniel MacLean, psicólogo en Cochabamba, Bolivia. Tel: 59172034151. WA Business: 59169650802.
**URLs:** app `https://darkred-kangaroo-559638.hostingersite.com` · health `/api/health`
**Repo:** `Dran9/business-os` rama `main` · **PIN admin:** 4747
**Proyecto hermano:** `agenda4.0` en `/Users/dran/Documents/Codex openai/agenda4.0/` (bridge read-only)

## Stack
- Backend: Express + MySQL (Hostinger) — `server/`
- Frontend: React 18 + Vite + CSS custom properties — `client/`
- LLM: Groq (`llama-3.3-70b-versatile`) + DeepSeek. Fallback determinístico si falta `GROQ_API_KEY`
- Chat: Telegram Bot API (`@dranTele_bot`, funcionando) · WhatsApp Cloud API (preparado, BSUID-ready)
- OCR: Google Vision API
- Notificaciones: Pushinator (`PUSHINATOR_TOKEN` + `PUSHINATOR_CHANNEL_ID`)
- Auth: username + PIN 4 dígitos, JWT 90 días

## Reglas Hostinger (CRÍTICAS — mismas que agenda4.0)
- `dns.setDefaultResultOrder('ipv4first')` DEBE ser la primera línea de `server/db.js`
- `client/dist/` se commitea — Hostinger no ejecuta builds
- El script `"build"` en `package.json` raíz es un **no-op**
- Después de cambios en `client/`: `cd client && npm run build` → commitear `client/dist/`
- `express.static()` con `maxAge: 0, etag: false` — LiteSpeed cachea agresivamente
- SPA fallback usa `fs.readFileSync()`, no `res.sendFile()`
- **NUNCA abrir branches.** Todo va directo a `main`

## Reglas React + código
- `type="button"` en todo `<button>` que no sea submit de form
- Textos en español: NUNCA unicode escapes (`\u00f3`), siempre caracteres directos (`ó`, `é`, etc.)
- Sin emojis en la UI salvo donde sea funcionalmente necesario
- Sin `AskUserQuestion`
- Responder TODAS las preguntas, sin cherry-pick
- Nunca hacer push sin pedido explícito

## Reglas Timezone
- Siempre `America/La_Paz` (-04:00). Bolivia no tiene DST
- `timezone: '-04:00'` en mysql2 pool — NUNCA quitar
- `toISOString()` devuelve UTC — usar `toLocaleTimeString('es-BO', { timeZone: 'America/La_Paz' })`

## WhatsApp / Telegram
- WABA ID: `1400277624968330` · Phone Number ID: `887756534426165` (compartido con agenda4.0)
- Graph API: `v22.0`
- BSUID: infraestructura lista en `server/services/whatsappIdentity.js` (FK a `leads.id`)
- Telegram: canal de prueba activo. Webhook sin `secret_token` (intencional)

## Arquitectura
```
Routes (thin)  →  validate request → call service → respond HTTP
Services       →  toda la lógica de negocio
Middleware     →  auth (JWT) + tenant resolver + validation
Cron           →  followups, reminders, analysis batch
```
- Design system: CSS custom properties en `client/src/index.css`. Componentes NUNCA tienen colores hardcodeados.
- Dark mode: `[data-theme="dark"]`. Multi-tenant branding: override de variables vía JS.
- Tags por categoría: intent=azul, sentiment=amarillo, objection=rojo, stage=verde, behavior=morado, quality=naranja.
- Single-tenant por instalación en la práctica; schema conserva `tenant_id` para evolución futura.

## Módulos
Chatbot/Embudo · CRM Leads · Finanzas · Marketing/Campañas · Insights · Conversaciones/Inbox · Talleres/Workshops · Inscripciones · Contactos · Configuración · Equipo

## Archivos clave
- `server/db.js` — schema MySQL + migraciones (corren al arrancar)
- `server/routes/webhook.js` — webhook Telegram/WhatsApp entrante
- `server/services/chatbot/flowEngine.js` — motor de flujos conversacionales
- `server/services/chatbot/paymentWorkflow.js` — OCR + validación de comprobantes
- `server/services/whatsappIdentity.js` — resolución BSUID ↔ teléfono (leads)
- `server/services/channels/whatsapp.js` — envío WA (phone o BSUID)
- `server/services/channels/telegram.js` — envío Telegram
- `server/services/enrollments.js` — inscripciones a talleres
- `server/services/agendaBridge.js` — bridge read-only con agenda4.0
- `server/services/analysis/tagger.js` — tags automáticos por LLM
- `server/services/analysis/scorer.js` — lead scoring automático
- `client/src/index.css` — design system completo (editar `:root` para cambiar el look)

## DB Schema (16 tablas)
`tenants` · `admin_users` · `contacts` · `leads` · `venues` · `workshops` · `conversations` · `messages` · `tags` · `transactions` · `financial_goals` · `enrollments` · `campaigns` · `followup_queue` · `activity_log` · `whatsapp_users`

## Modelo de datos WhatsApp
- `leads` — entidad principal, tiene `phone`
- `conversations` / `messages` — con columna `bsuid`
- `whatsapp_users` — identidad: `bsuid ↔ phone ↔ lead_id`

## Regla de deploy operativa
Al cerrar cualquier sesión con cambios en `client/src/`:
1. `cd client && npm run build`
2. Commitear `client/dist/`
3. Avisar al usuario antes de hacer push

## Variables de entorno clave
`GROQ_API_KEY` · `DEEPSEEK_API_KEY` · `GOOGLE_VISION_API_KEY` · `PUSHINATOR_TOKEN` · `PUSHINATOR_CHANNEL_ID` · `TELEGRAM_BOT_TOKEN` · `WA_TOKEN` · `WA_PHONE_ID` · `JWT_SECRET` · `DB_*` · `AGENDA_DB_*`

## Approach
- Think before acting. Read existing files before writing code.
- Be concise in output but thorough in reasoning.
- Prefer editing over rewriting whole files.
- Do not re-read files you have already read unless the file may have changed.
- Test your code before declaring done.
- No sycophantic openers or closing fluff.
- Keep solutions simple and direct.
- User instructions always override this file.