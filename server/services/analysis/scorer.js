const { query } = require('../../db');

function clampScore(value) {
  return Math.max(0, Math.min(100, value));
}

async function recalculateLeadScore({ tenantId, leadId }) {
  const [lead] = await query(
    'SELECT id, last_contact_at FROM leads WHERE id = ? AND tenant_id = ?',
    [leadId, tenantId]
  );

  if (!lead) {
    return { updated: false, score: 0 };
  }

  const [messageStats] = await query(
    `SELECT COUNT(*) AS inbound_count
     FROM messages m
     JOIN conversations c ON c.id = m.conversation_id
     WHERE c.tenant_id = ? AND c.lead_id = ? AND m.direction = 'inbound'`,
    [tenantId, leadId]
  );

  const [priceTag] = await query(
    `SELECT COUNT(*) AS total
     FROM tags t
     JOIN messages m ON m.id = t.target_id
     JOIN conversations c ON c.id = m.conversation_id
     WHERE t.tenant_id = ?
       AND t.target_type = 'message'
       AND t.category = 'intent'
       AND t.value = 'pregunta_precio'
       AND c.lead_id = ?`,
    [tenantId, leadId]
  );

  const [buySignal] = await query(
    `SELECT COUNT(*) AS total
     FROM messages m
     JOIN conversations c ON c.id = m.conversation_id
     WHERE c.tenant_id = ?
       AND c.lead_id = ?
       AND m.direction = 'inbound'
       AND (m.content LIKE 'inscribir_%' OR m.content REGEXP 'inscrib|reserv|quiero comprar|quiero participar')`,
    [tenantId, leadId]
  );

  const [curiosityTag] = await query(
    `SELECT COUNT(*) AS total
     FROM tags t
     JOIN messages m ON m.id = t.target_id
     JOIN conversations c ON c.id = m.conversation_id
     WHERE t.tenant_id = ?
       AND t.target_type = 'message'
       AND t.category = 'intent'
       AND t.value = 'solo_curiosidad'
       AND c.lead_id = ?`,
    [tenantId, leadId]
  );

  let score = 0;
  const inboundCount = Number(messageStats?.inbound_count || 0);

  if (inboundCount > 0) score += 20;
  score += inboundCount * 10;
  if (Number(priceTag?.total || 0) > 0) score += 15;
  if (Number(buySignal?.total || 0) > 0) score += 25;
  if (Number(curiosityTag?.total || 0) > 0) score -= 10;

  if (lead.last_contact_at) {
    const hoursSinceLastContact = (Date.now() - new Date(lead.last_contact_at).getTime()) / 36e5;
    if (hoursSinceLastContact > 48) {
      score -= 15;
    }
  }

  score = clampScore(score);

  await query(
    'UPDATE leads SET quality_score = ? WHERE id = ? AND tenant_id = ?',
    [score, leadId, tenantId]
  );

  return { updated: true, score };
}

module.exports = { recalculateLeadScore };
