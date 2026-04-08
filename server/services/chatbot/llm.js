const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = 'llama-3.3-70b-versatile';

function hasGroqKey() {
  return !!process.env.GROQ_API_KEY;
}

function buildWorkshopContext(workshop) {
  if (!workshop) {
    return 'No hay un taller seleccionado todavía.';
  }

  const parts = [
    `Nombre: ${workshop.name || 'No definido'}`,
    `Precio normal: ${workshop.price != null ? `Bs ${workshop.price}` : 'No definido'}`,
    `Precio early bird: ${workshop.early_bird_price != null ? `Bs ${workshop.early_bird_price}` : 'No definido'}`,
    `Fecha: ${workshop.date || 'No definida'}`,
    `Hora inicio: ${workshop.time_start || 'No definida'}`,
    `Hora fin: ${workshop.time_end || 'No definida'}`,
    `Lugar: ${workshop.venue_name || 'No definido'}`,
    `Dirección: ${workshop.venue_address || 'No definida'}`,
    `Descripción: ${workshop.description || 'Sin descripción'}`,
  ];

  return parts.join('\n');
}

async function runGroqChat({
  systemPrompt,
  userPrompt,
  temperature = 0.3,
  maxTokens = 300,
  jsonMode = false,
}) {
  if (!hasGroqKey()) {
    return null;
  }

  const response = await fetch(GROQ_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      temperature,
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
    }),
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const err = new Error(data?.error?.message || `Groq error ${response.status}`);
    err.details = data;
    throw err;
  }

  return data?.choices?.[0]?.message?.content?.trim() || null;
}

async function generateInterestedReply({ lead, workshop, messageText, recentMessages = [] }) {
  const systemPrompt = [
    'Eres el asistente de Daniel MacLean, psicólogo en Bolivia.',
    'Tu estilo es empático, profesional, concreto y cálido.',
    'Respondes en español boliviano.',
    'Debes ayudar a resolver dudas y objeciones de precio, tiempo, ubicación o participación.',
    'Nunca inventes precios, fechas, horarios ni lugares.',
    'Solo puedes usar la información real del taller provista abajo.',
    'Si no puedes responder con certeza, sugiere hablar con Daniel.',
    'Máximo 3 o 4 oraciones.',
    '',
    'Datos reales del taller:',
    buildWorkshopContext(workshop),
  ].join('\n');

  const historyBlock = recentMessages.length
    ? `Historial reciente:\n${recentMessages.map((msg) => `${msg.direction === 'outbound' ? 'Bot' : 'Lead'}: ${msg.content}`).join('\n')}\n\n`
    : '';

  const userPrompt = [
    `Lead: ${lead.name || 'Sin nombre'} (${lead.phone})`,
    historyBlock,
    `Mensaje actual del lead: ${messageText}`,
    '',
    'Responde de forma útil y breve. Si falta un dato real, dilo con honestidad y ofrece pasar con Daniel.',
  ].join('\n');

  return runGroqChat({
    systemPrompt,
    userPrompt,
    temperature: 0.35,
    maxTokens: 220,
  });
}

async function analyzeMessageForTags({ lead, workshop, messageText }) {
  const systemPrompt = [
    'Analiza el mensaje de un lead para un negocio de talleres terapéuticos.',
    'Responde únicamente con JSON válido.',
    'Debes incluir exactamente estas claves: intent, sentiment, quality, notes.',
    'Valores permitidos para intent: saludo, info_general, quiero_comprar, objecion, pregunta_precio, pregunta_fecha, pregunta_ubicacion, hablar_con_daniel, solo_curiosidad, otro.',
    'Valores permitidos para sentiment: positivo, negativo, neutral, indeciso.',
    'Valores permitidos para quality: lead_caliente, lead_tibio, lead_frio.',
    'notes debe ser una frase corta en español.',
    'No agregues texto fuera del JSON.',
    '',
    'Contexto del lead:',
    `Nombre: ${lead?.name || 'Sin nombre'}`,
    `Teléfono: ${lead?.phone || 'Sin teléfono'}`,
    `Taller vinculado: ${workshop?.name || 'Ninguno'}`,
    `Precio real del taller: ${workshop?.price != null ? `Bs ${workshop.price}` : 'No definido'}`,
  ].join('\n');

  const userPrompt = `Mensaje a analizar: ${messageText}`;
  const raw = await runGroqChat({
    systemPrompt,
    userPrompt,
    temperature: 0.2,
    maxTokens: 180,
    jsonMode: true,
  });

  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch (err) {
    console.warn('[llm] No se pudo parsear JSON de tags:', raw);
    return null;
  }
}

module.exports = {
  GROQ_MODEL,
  hasGroqKey,
  runGroqChat,
  generateInterestedReply,
  analyzeMessageForTags,
};
