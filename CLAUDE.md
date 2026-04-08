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
- Business OS consulta datos de Agenda vía API (finanzas, clientes)
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
- Motor de conversación híbrido: determinístico + LLM
- Playbooks configurables por taller (JSON en DB)
- Fases: qualify → educate (LLM) → close → confirm (OCR)
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
