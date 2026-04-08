# Prompt para Codex — Siguientes pasos Business OS

## Contexto
Lee CLAUDE.md y HANDOFF.md COMPLETOS antes de tocar cualquier código. Son tu biblia.

Business OS es una app admin-only (Express + React + MySQL en Hostinger) para gestionar un negocio de talleres terapéuticos. Ya funciona en producción: login con PIN, dashboard, CRUD de talleres/leads, bot de Telegram que responde y crea leads. El dueño es Daniel MacLean, psicólogo en Bolivia.

## Reglas CRÍTICAS
- `dns.setDefaultResultOrder('ipv4first')` PRIMERA línea de server/db.js — NO TOCAR
- Textos en español: NUNCA unicode escapes (\u00f3), siempre caracteres directos (ó, é, í)
- Todo `<button>` que NO sea submit: `type="button"`
- Timezone: America/La_Paz (-04:00), NUNCA usar toISOString() para mostrar horas
- NO emojis en la UI
- Después de cambios en client/: `cd client && npm run build` y commitear `client/dist/`
- Dependencias van en package.json RAÍZ (no en server/)

## Tareas por prioridad

### TAREA 1: Integrar Groq LLM al chatbot
El chatbot (server/services/chatbot/engine.js) hoy responde con mensajes determinísticos. Agregar una fase "educate" que use Groq (llama-3.3-70b-versatile) para respuestas conversacionales.

Crear `server/services/chatbot/llm.js`:
```javascript
// Router de LLM — usa Groq (gratis) para análisis rápido
// API: https://api.groq.com/openai/v1/chat/completions
// Model: llama-3.3-70b-versatile
// API key irá en env var GROQ_API_KEY (Daniel la pondrá en Hostinger después)
// Si no hay API key, el chatbot sigue funcionando en modo determinístico (fallback)
```

El system prompt debe incluir:
- Que es asistente de Daniel MacLean, psicólogo
- Info del taller seleccionado (si hay uno vinculado a la conversación)
- Que debe ser empático, profesional, responder objeciones de precio/tiempo
- Que NUNCA invente precios ni fechas — solo usar datos reales del taller
- Que si no puede resolver, sugerir hablar con Daniel
- Máximo 3-4 oraciones por respuesta
- Idioma: español boliviano

Conectar al engine.js: cuando la fase es "interested" y el lead hace preguntas libres (no botones), usar LLM en vez de respuesta genérica.

### TAREA 2: Página de Finanzas funcional
`client/src/pages/Finance.jsx` es placeholder. Hacerla funcional:
- `server/routes/finance.js` con CRUD de transacciones (income/expense)
- Vista de transacciones con filtros por tipo, categoría, mes
- Form para agregar ingreso o gasto (categoría, monto, descripción, fecha)
- KPIs arriba: ingreso mes, gasto mes, neto, comparación con meta
- Categorías predefinidas: taller, publicidad, venue, materiales, herramientas, transporte, otros
- Usar los estilos existentes: .card, .kpi-grid, .table, .btn, .form-group

### TAREA 3: Tags automáticos con LLM
Después de cada mensaje inbound, analizar con Groq y crear tags en la tabla `tags`:
- intent: info_general, quiero_comprar, objecion, saludo, pregunta_precio, etc.
- sentiment: positivo, negativo, neutral, indeciso
- quality: lead_caliente, lead_tibio, lead_frio

Crear `server/services/analysis/tagger.js`. Llamar después de guardar cada mensaje inbound en engine.js. Si no hay GROQ_API_KEY, no tagear (graceful skip).

### TAREA 4: Lead scoring automático
En `server/services/analysis/scorer.js`, calcular quality_score (0-100) del lead basado en:
- +20 respondió al primer mensaje
- +15 preguntó precio (intent = pregunta_precio)
- +25 pidió inscribirse
- +10 cada mensaje que envía
- -15 ghosteó (>48h sin responder)
- -10 intent = solo_curiosidad

Llamar después de cada interacción. Actualizar `leads.quality_score` en DB.

### TAREA 5: Mejorar Insights
`client/src/pages/Insights.jsx` es placeholder. Crear:
- `server/routes/analytics.js` ya existe — agregar endpoint GET /api/analytics/funnel
- Embudo visual: leads totales → calificados → negociando → convertidos → perdidos
- Top fuentes de leads (por source)
- Usar los estilos .funnel-bar, .funnel-step que ya existen en index.css

## Env vars que necesitará
- GROQ_API_KEY — Daniel la pondrá cuando la tenga. El código debe funcionar SIN ella (fallback determinístico)

## Testing
- Bot Telegram: mandarle mensajes a @dranTele_bot para probar chatbot
- Admin: https://darkred-kangaroo-559638.hostingersite.com/ PIN: 4747
- Health: /api/health

## Al terminar
- Actualizar HANDOFF.md con todo lo que hiciste
- `cd client && npm run build`
- Commitear TODO incluyendo client/dist/
- Push a main
