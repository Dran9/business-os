const { query } = require('../../db');
const { hasGroqKey, analyzeMessageForTags } = require('../chatbot/llm');

const ALLOWED_INTENTS = new Set([
  'saludo',
  'info_general',
  'quiero_comprar',
  'objecion',
  'pregunta_precio',
  'pregunta_fecha',
  'pregunta_ubicacion',
  'hablar_con_daniel',
  'solo_curiosidad',
  'otro',
]);
const ALLOWED_SENTIMENTS = new Set(['positivo', 'negativo', 'neutral', 'indeciso']);
const ALLOWED_QUALITIES = new Set(['lead_caliente', 'lead_tibio', 'lead_frio']);

function normalizeValue(value, allowedSet, fallback) {
  const normalized = String(value || '').trim().toLowerCase();
  return allowedSet.has(normalized) ? normalized : fallback;
}

async function saveTag({ tenantId, targetType, targetId, category, value, source = 'llm', confidence = null }) {
  await query(
    `INSERT INTO tags (tenant_id, target_type, target_id, category, value, source, confidence)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [tenantId, targetType, targetId, category, value, source, confidence]
  );
}

async function analyzeAndTagInboundMessage({ tenantId, lead, conversation, workshop, messageId, messageText }) {
  if (!hasGroqKey() || !messageId || !messageText) {
    return { skipped: true };
  }

  const analysis = await analyzeMessageForTags({ lead, workshop, messageText });
  if (!analysis) {
    return { skipped: true };
  }

  const intent = normalizeValue(analysis.intent, ALLOWED_INTENTS, 'otro');
  const sentiment = normalizeValue(analysis.sentiment, ALLOWED_SENTIMENTS, 'neutral');
  const quality = normalizeValue(analysis.quality, ALLOWED_QUALITIES, 'lead_tibio');
  const noteText = String(analysis.notes || '').trim();

  await saveTag({ tenantId, targetType: 'message', targetId: messageId, category: 'intent', value: intent });
  await saveTag({ tenantId, targetType: 'message', targetId: messageId, category: 'sentiment', value: sentiment });
  await saveTag({ tenantId, targetType: 'message', targetId: messageId, category: 'quality', value: quality });

  if (conversation?.id) {
    await saveTag({ tenantId, targetType: 'conversation', targetId: conversation.id, category: 'intent', value: intent });
    await saveTag({ tenantId, targetType: 'conversation', targetId: conversation.id, category: 'sentiment', value: sentiment });
    await saveTag({ tenantId, targetType: 'conversation', targetId: conversation.id, category: 'quality', value: quality });
  }

  if (lead?.id) {
    await saveTag({ tenantId, targetType: 'lead', targetId: lead.id, category: 'intent', value: intent });
    await saveTag({ tenantId, targetType: 'lead', targetId: lead.id, category: 'quality', value: quality });
  }

  if (noteText) {
    await query(
      'UPDATE messages SET metadata = JSON_SET(COALESCE(metadata, JSON_OBJECT()), "$.llm_notes", ?) WHERE id = ?',
      [noteText, messageId]
    ).catch(() => {});
  }

  return { skipped: false, intent, sentiment, quality, notes: noteText };
}

module.exports = { analyzeAndTagInboundMessage };
