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
const ALLOWED_QUALITIES = new Set(['lead_caliente', 'lead_tibio', 'lead_frio', 'quiero_comprar']);

function normalizeValue(value, allowedSet, fallback) {
  const normalized = String(value || '').trim().toLowerCase();
  return allowedSet.has(normalized) ? normalized : fallback;
}

async function saveStateTag({ tenantId, targetType, targetId, category, value, source = 'llm', confidence = null }) {
  await query(
    'DELETE FROM tags WHERE tenant_id = ? AND target_type = ? AND target_id = ? AND category = ?',
    [tenantId, targetType, targetId, category]
  );
  await query(
    `INSERT INTO tags (tenant_id, target_type, target_id, category, value, source, confidence)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [tenantId, targetType, targetId, category, value, source, confidence]
  );
}

async function saveBehaviorTag({ tenantId, targetType, targetId, category, value, source = 'llm', confidence = null }) {
  const existing = await query(
    'SELECT id FROM tags WHERE tenant_id = ? AND target_type = ? AND target_id = ? AND category = ? AND value = ? LIMIT 1',
    [tenantId, targetType, targetId, category, value]
  );
  if (existing.length > 0) return;
  await query(
    `INSERT INTO tags (tenant_id, target_type, target_id, category, value, source, confidence)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [tenantId, targetType, targetId, category, value, source, confidence]
  );
}

async function analyzeAndTagInboundMessage({ tenantId, lead, conversation, workshop, messageId, messageText }) {
  if (!hasGroqKey() || !messageText) {
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

  if (conversation?.id) {
    await saveBehaviorTag({ tenantId, targetType: 'conversation', targetId: conversation.id, category: 'intent', value: intent });
    await saveStateTag({ tenantId, targetType: 'conversation', targetId: conversation.id, category: 'sentiment', value: sentiment });
    await saveStateTag({ tenantId, targetType: 'conversation', targetId: conversation.id, category: 'quality', value: quality });
  }

  if (lead?.id) {
    await saveBehaviorTag({ tenantId, targetType: 'lead', targetId: lead.id, category: 'intent', value: intent });
    await saveStateTag({ tenantId, targetType: 'lead', targetId: lead.id, category: 'sentiment', value: sentiment });
    await saveStateTag({ tenantId, targetType: 'lead', targetId: lead.id, category: 'quality', value: quality });
  }

  if (noteText && messageId) {
    await query(
      'UPDATE messages SET metadata = JSON_SET(COALESCE(metadata, JSON_OBJECT()), "$.llm_notes", ?) WHERE id = ?',
      [noteText, messageId]
    ).catch(() => {});
  }

  return { skipped: false, intent, sentiment, quality, notes: noteText };
}

module.exports = { analyzeAndTagInboundMessage };
