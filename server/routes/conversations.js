const express = require('express');
const authMiddleware = require('../middleware/auth');
const { tenantMiddleware } = require('../middleware/tenant');
const { query, queryPaginated } = require('../db');
const TelegramAdapter = require('../services/channels/telegram');
const WhatsAppAdapter = require('../services/channels/whatsapp');
const { broadcast } = require('../services/adminEvents');
const { getMessageTarget } = require('../services/whatsappIdentity');
const {
  formatMessageWithWorkshop,
  resumeConversationBot,
  stopConversationBot,
} = require('../services/chatbot/flowEngine');
const { getEnrollmentWithRelations } = require('../services/enrollments');
const { getLlmSettings } = require('../services/llmSettings');

const router = express.Router();
const VALID_INBOX_STATES = new Set(['open', 'pending', 'resolved']);

function parseJson(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function escapeHtml(text) {
  return String(text || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function canAutoManageInboxState(conversation) {
  return ['active', 'escalated'].includes(conversation?.status);
}

function normalizeOperationalInboxState(conversation) {
  if (!canAutoManageInboxState(conversation)) return conversation;

  if (conversation?.last_message_direction === 'inbound' && conversation.inbox_state !== 'open') {
    return { ...conversation, inbox_state: 'open' };
  }

  if (conversation?.last_message_direction === 'outbound' && conversation.inbox_state === 'resolved') {
    return { ...conversation, inbox_state: 'pending' };
  }

  return conversation;
}

async function reconcileOperationalInboxStates(tenantId, conversations) {
  const toOpen = [];
  const toPending = [];

  for (const conversation of conversations) {
    if (!canAutoManageInboxState(conversation)) continue;

    if (conversation?.last_message_direction === 'inbound' && conversation.inbox_state !== 'open') {
      toOpen.push(conversation.id);
      continue;
    }

    if (conversation?.last_message_direction === 'outbound' && conversation.inbox_state === 'resolved') {
      toPending.push(conversation.id);
    }
  }

  if (toOpen.length > 0) {
    const placeholders = toOpen.map(() => '?').join(', ');
    await query(
      `UPDATE conversations
       SET inbox_state = 'open'
       WHERE tenant_id = ? AND id IN (${placeholders})`,
      [tenantId, ...toOpen]
    );
  }

  if (toPending.length > 0) {
    const placeholders = toPending.map(() => '?').join(', ');
    await query(
      `UPDATE conversations
       SET inbox_state = 'pending'
       WHERE tenant_id = ? AND id IN (${placeholders})`,
      [tenantId, ...toPending]
    );
  }
}

function getTelegramAdapter() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    throw new Error('TELEGRAM_BOT_TOKEN no configurado');
  }
  return new TelegramAdapter(token);
}

async function getChannelAdapter(channel, tenantId) {
  if (channel === 'telegram') {
    return getTelegramAdapter();
  }
  if (channel === 'whatsapp') {
    return WhatsAppAdapter.forTenant(tenantId);
  }
  throw new Error('Canal no soportado');
}

async function getConversationById(tenantId, id) {
  const rows = await query(
    `SELECT c.*, l.name AS lead_name, l.phone AS lead_phone, l.status AS lead_status,
            l.quality_score, w.name AS workshop_name
     FROM conversations c
     JOIN leads l ON l.id = c.lead_id
     LEFT JOIN workshops w ON w.id = c.workshop_id
     WHERE c.id = ? AND c.tenant_id = ?
     LIMIT 1`,
    [id, tenantId]
  );
  return rows[0] || null;
}

async function getLeadById(tenantId, id) {
  const rows = await query(
    'SELECT * FROM leads WHERE id = ? AND tenant_id = ? LIMIT 1',
    [id, tenantId]
  );
  return rows[0] || null;
}

async function getWorkshopById(tenantId, workshopId) {
  if (!workshopId) return null;
  const rows = await query(
    `SELECT w.*, v.name AS venue_name, v.address AS venue_address
     FROM workshops w
     LEFT JOIN venues v ON v.id = w.venue_id
     WHERE w.id = ? AND w.tenant_id = ?
     LIMIT 1`,
    [workshopId, tenantId]
  );
  return rows[0] || null;
}

async function getLatestFlowContext(tenantId, conversationId) {
  const rows = await query(
    `SELECT context
     FROM flow_sessions
     WHERE tenant_id = ? AND conversation_id = ?
     ORDER BY id DESC
     LIMIT 1`,
    [tenantId, conversationId]
  );
  return parseJson(rows[0]?.context) || {};
}

async function resolvePracticalInfoWorkshop(tenantId, conversation, leadId, enrollmentId = null) {
  if (enrollmentId) {
    const enrollment = await getEnrollmentWithRelations(tenantId, Number(enrollmentId));
    if (!enrollment) {
      throw new Error('Inscripción no encontrada');
    }
    const workshop = await getWorkshopById(tenantId, enrollment.workshop_id);
    return { workshop, enrollment };
  }

  if (conversation?.workshop_id) {
    const workshop = await getWorkshopById(tenantId, conversation.workshop_id);
    if (workshop) return { workshop, enrollment: null };
  }

  const latestEnrollment = await query(
    `SELECT id, workshop_id
     FROM enrollments
     WHERE tenant_id = ? AND lead_id = ?
     ORDER BY
       CASE WHEN payment_status = 'unpaid' THEN 0 ELSE 1 END,
       COALESCE(payment_requested_at, enrolled_at) DESC,
       id DESC
     LIMIT 1`,
    [tenantId, leadId]
  );

  if (latestEnrollment[0]?.workshop_id) {
    const workshop = await getWorkshopById(tenantId, latestEnrollment[0].workshop_id);
    if (workshop) {
      return {
        workshop,
        enrollment: latestEnrollment[0],
      };
    }
  }

  const fallback = await query(
    `SELECT id
     FROM workshops
     WHERE tenant_id = ?
       AND status IN ('planned', 'open', 'draft', 'full', 'completed')
     ORDER BY
       CASE
         WHEN date IS NULL THEN 2
         WHEN date >= CURDATE() THEN 0
         ELSE 1
       END,
       CASE WHEN date >= CURDATE() THEN date END ASC,
       CASE WHEN date < CURDATE() THEN date END DESC,
       id DESC
     LIMIT 1`,
    [tenantId]
  );

  if (fallback[0]?.id) {
    const workshop = await getWorkshopById(tenantId, fallback[0].id);
    if (workshop) return { workshop, enrollment: null };
  }

  return { workshop: null, enrollment: null };
}

async function sendConversationText({
  tenantId,
  conversation,
  content,
  sender,
}) {
  const adapter = await getChannelAdapter(conversation.channel, tenantId);
  let target = conversation.lead_phone;

  if (conversation.channel === 'whatsapp') {
    target = await getMessageTarget(tenantId, conversation.lead_id);
    if (!target?.phone && !target?.bsuid) {
      throw new Error('No hay target de WhatsApp disponible para esta conversación');
    }
  }

  const sent = await adapter.sendText(target, content);
  const outboundBsuid = target && typeof target === 'object' ? target.bsuid || null : null;

  const result = await query(
    `INSERT INTO messages (conversation_id, direction, sender, bsuid, content, wa_message_id, content_type, created_at)
     VALUES (?, 'outbound', ?, ?, ?, ?, 'text', NOW())`,
    [conversation.id, sender, outboundBsuid, content, sent.messageId || '']
  );

  await query(
    `UPDATE conversations
     SET last_message_at = NOW(),
         bsuid = COALESCE(?, bsuid),
         inbox_state = 'pending',
         assigned_to = CASE
           WHEN assigned_to IS NULL OR assigned_to = '' OR assigned_to = 'bot' THEN ?
           ELSE assigned_to
         END
     WHERE id = ? AND tenant_id = ?`,
    [outboundBsuid, sender, conversation.id, tenantId]
  );

  broadcast('message:change', { conversationId: conversation.id, messageId: result.insertId, reason: 'manual-send' }, tenantId);
  broadcast('conversation:change', { id: conversation.id, reason: 'manual-send' }, tenantId);

  return {
    messageId: result.insertId,
    sent,
  };
}

async function attachTags(tenantId, items) {
  if (!items.length) return items;
  const ids = items.map((item) => item.id);
  const placeholders = ids.map(() => '?').join(', ');
  const tagRows = await query(
    `SELECT target_id, category, value, color, source
     FROM tags
     WHERE tenant_id = ? AND target_type = 'conversation' AND target_id IN (${placeholders})
     ORDER BY id DESC`,
    [tenantId, ...ids]
  );

  const tagsByConversation = new Map();
  for (const row of tagRows) {
    if (!tagsByConversation.has(row.target_id)) {
      tagsByConversation.set(row.target_id, []);
    }
    tagsByConversation.get(row.target_id).push(row);
  }

  return items.map((item) => ({
    ...item,
    metadata: parseJson(item.metadata),
    tags: tagsByConversation.get(item.id) || [],
  }));
}

router.get('/', authMiddleware, tenantMiddleware, async (req, res) => {
  try {
    const { status, assigned_to, inbox_state, search, page = 1, limit = 30 } = req.query;
    let sql = `SELECT c.*, l.name AS lead_name, l.phone AS lead_phone, l.status AS lead_status,
                      l.quality_score, w.name AS workshop_name,
                      (
                        SELECT content
                        FROM messages
                        WHERE conversation_id = c.id
                        ORDER BY created_at DESC, id DESC
                        LIMIT 1
                      ) AS last_message,
                      (
                        SELECT direction
                        FROM messages
                        WHERE conversation_id = c.id
                        ORDER BY created_at DESC, id DESC
                        LIMIT 1
                      ) AS last_message_direction
               FROM conversations c
               JOIN leads l ON l.id = c.lead_id
               LEFT JOIN workshops w ON w.id = c.workshop_id
               WHERE c.tenant_id = ?`;
    const params = [req.tenantId];

    if (status) {
      sql += ' AND c.status = ?';
      params.push(status);
    }

    if (assigned_to) {
      if (assigned_to === 'bot') {
        sql += " AND COALESCE(c.assigned_to, 'bot') = 'bot'";
      } else {
        sql += ' AND c.assigned_to = ?';
        params.push(assigned_to);
      }
    }

    if (inbox_state && VALID_INBOX_STATES.has(inbox_state)) {
      sql += ' AND c.inbox_state = ?';
      params.push(inbox_state);
    }

    if (search) {
      sql += ' AND (COALESCE(l.name, "") LIKE ? OR COALESCE(l.phone, "") LIKE ? OR COALESCE(c.bsuid, "") LIKE ? OR COALESCE(w.name, "") LIKE ?)';
      params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
    }

    sql += ' ORDER BY COALESCE(c.last_message_at, c.started_at) DESC';

    const result = await queryPaginated(sql, params, { page: Number(page), limit: Number(limit) });
    const normalized = (result.data || []).map(normalizeOperationalInboxState);
    await reconcileOperationalInboxStates(req.tenantId, normalized);
    result.data = await attachTags(req.tenantId, normalized);
    res.json(result);
  } catch (err) {
    console.error('[conversations GET]', err);
    res.status(500).json({ error: 'Error cargando conversaciones' });
  }
});

router.get('/:id/messages', authMiddleware, tenantMiddleware, async (req, res) => {
  try {
    const conversation = await getConversationById(req.tenantId, req.params.id);
    if (!conversation) {
      return res.status(404).json({ error: 'Conversación no encontrada' });
    }

    const messages = await query(
      `SELECT id, conversation_id, direction, sender, bsuid, content_type, content, metadata, created_at
       FROM messages
       WHERE conversation_id = ?
       ORDER BY created_at ASC, id ASC`,
      [req.params.id]
    );

    res.json(messages.map((message) => ({
      ...message,
      metadata: parseJson(message.metadata),
    })));
  } catch (err) {
    console.error('[conversations/:id/messages]', err);
    res.status(500).json({ error: 'Error cargando mensajes' });
  }
});

router.put('/:id/assign', authMiddleware, tenantMiddleware, async (req, res) => {
  try {
    if (!['owner', 'admin'].includes(req.user?.role)) {
      return res.status(403).json({ error: 'No tienes permiso para asignar conversaciones' });
    }

    const { assigned_to } = req.body;
    const conversation = await getConversationById(req.tenantId, req.params.id);
    if (!conversation) {
      return res.status(404).json({ error: 'Conversación no encontrada' });
    }

    if (assigned_to) {
      const users = await query(
        'SELECT username FROM admin_users WHERE tenant_id = ? AND username = ? AND active = TRUE LIMIT 1',
        [req.tenantId, assigned_to]
      );
      if (users.length === 0) {
        return res.status(400).json({ error: 'Usuario inválido para asignación' });
      }
    }

    await query(
      'UPDATE conversations SET assigned_to = ? WHERE id = ? AND tenant_id = ?',
      [assigned_to || 'bot', req.params.id, req.tenantId]
    );

    broadcast('conversation:change', { id: Number(req.params.id), reason: 'assigned' }, req.tenantId);
    res.json({ message: 'Conversación asignada' });
  } catch (err) {
    console.error('[conversations assign]', err);
    res.status(500).json({ error: 'Error asignando conversación' });
  }
});

router.put('/:id/inbox-state', authMiddleware, tenantMiddleware, async (req, res) => {
  try {
    const { inbox_state } = req.body;
    if (!VALID_INBOX_STATES.has(inbox_state)) {
      return res.status(400).json({ error: 'Estado operativo inválido' });
    }

    const conversation = await getConversationById(req.tenantId, req.params.id);
    if (!conversation) {
      return res.status(404).json({ error: 'Conversación no encontrada' });
    }

    await query(
      'UPDATE conversations SET inbox_state = ? WHERE id = ? AND tenant_id = ?',
      [inbox_state, req.params.id, req.tenantId]
    );

    broadcast('conversation:change', { id: Number(req.params.id), reason: 'inbox-state' }, req.tenantId);
    res.json({ message: 'Estado operativo actualizado' });
  } catch (err) {
    console.error('[conversations inbox-state]', err);
    res.status(500).json({ error: 'Error actualizando estado operativo' });
  }
});

router.put('/:id/notes', authMiddleware, tenantMiddleware, async (req, res) => {
  try {
    const conversation = await getConversationById(req.tenantId, req.params.id);
    if (!conversation) {
      return res.status(404).json({ error: 'Conversación no encontrada' });
    }

    await query(
      'UPDATE conversations SET internal_notes = ? WHERE id = ? AND tenant_id = ?',
      [req.body?.internal_notes || null, req.params.id, req.tenantId]
    );

    broadcast('conversation:change', { id: Number(req.params.id), reason: 'notes' }, req.tenantId);
    res.json({ message: 'Notas internas guardadas' });
  } catch (err) {
    console.error('[conversations notes]', err);
    res.status(500).json({ error: 'Error guardando notas internas' });
  }
});

router.post('/:id/messages', authMiddleware, tenantMiddleware, async (req, res) => {
  try {
    const content = String(req.body?.content || '').trim();
    if (!content) {
      return res.status(400).json({ error: 'Mensaje vacío' });
    }

    const conversation = await getConversationById(req.tenantId, req.params.id);
    if (!conversation) {
      return res.status(404).json({ error: 'Conversación no encontrada' });
    }

    const result = await sendConversationText({
      tenantId: req.tenantId,
      conversation,
      content,
      sender: req.user?.username || 'admin',
    });

    res.json({
      id: result.messageId,
      message: 'Mensaje enviado',
    });
  } catch (err) {
    console.error('[conversations send message]', err);
    res.status(500).json({ error: err.message || 'Error enviando mensaje' });
  }
});

router.post('/:id/stop-bot', authMiddleware, tenantMiddleware, async (req, res) => {
  try {
    if (!['owner', 'admin'].includes(req.user?.role)) {
      return res.status(403).json({ error: 'No tienes permiso para detener el bot' });
    }

    const conversation = await getConversationById(req.tenantId, req.params.id);
    if (!conversation) {
      return res.status(404).json({ error: 'Conversación no encontrada' });
    }

    const result = await stopConversationBot({
      tenantId: req.tenantId,
      conversationId: conversation.id,
      actor: req.user?.username || 'admin',
      reason: String(req.body?.reason || 'Bot detenido manualmente desde Comandos').trim(),
    });

    res.json({
      message: 'Bot detenido',
      ...result,
    });
  } catch (err) {
    console.error('[conversations stop-bot]', err);
    res.status(500).json({ error: err.message || 'Error deteniendo el bot' });
  }
});

router.post('/:id/resume-bot', authMiddleware, tenantMiddleware, async (req, res) => {
  try {
    if (!['owner', 'admin'].includes(req.user?.role)) {
      return res.status(403).json({ error: 'No tienes permiso para reanudar el bot' });
    }

    const conversation = await getConversationById(req.tenantId, req.params.id);
    if (!conversation) {
      return res.status(404).json({ error: 'Conversación no encontrada' });
    }

    const result = await resumeConversationBot({
      tenantId: req.tenantId,
      conversationId: conversation.id,
      nodeKey: req.body?.node_key ? String(req.body.node_key).trim() : null,
      actor: req.user?.username || 'admin',
    });

    res.json({
      message: 'Bot reanudado',
      ...result,
    });
  } catch (err) {
    console.error('[conversations resume-bot]', err);
    if (err.code === 'FUNNEL_PAUSED') {
      return res.status(409).json({ error: err.message });
    }
    res.status(500).json({ error: err.message || 'Error reanudando el bot' });
  }
});

router.post('/:id/send-practical-info', authMiddleware, tenantMiddleware, async (req, res) => {
  try {
    if (!['owner', 'admin'].includes(req.user?.role)) {
      return res.status(403).json({ error: 'No tienes permiso para enviar datos prácticos' });
    }

    const conversation = await getConversationById(req.tenantId, req.params.id);
    if (!conversation) {
      return res.status(404).json({ error: 'Conversación no encontrada' });
    }

    const lead = await getLeadById(req.tenantId, conversation.lead_id);
    if (!lead) {
      return res.status(404).json({ error: 'Lead no encontrado' });
    }

    const llmSettings = await getLlmSettings(req.tenantId);
    const template = String(req.body?.template || llmSettings.practical_info_template || '').trim();
    if (!template) {
      return res.status(400).json({ error: 'No hay template de datos prácticos configurado' });
    }

    const { workshop } = await resolvePracticalInfoWorkshop(
      req.tenantId,
      conversation,
      lead.id,
      req.body?.enrollment_id || null
    );
    const context = await getLatestFlowContext(req.tenantId, conversation.id);
    const rendered = formatMessageWithWorkshop(template, workshop, context, lead, conversation).trim();
    if (!rendered) {
      return res.status(400).json({ error: 'El mensaje generado quedó vacío' });
    }

    const result = await sendConversationText({
      tenantId: req.tenantId,
      conversation,
      content: rendered,
      sender: req.user?.username || 'admin',
    });

    res.json({
      message: 'Datos prácticos enviados',
      rendered_text: rendered,
      workshop_name: workshop?.name || null,
      message_id: result.messageId,
    });
  } catch (err) {
    console.error('[conversations send-practical-info]', err);
    res.status(500).json({ error: err.message || 'Error enviando datos prácticos' });
  }
});

router.delete('/:id', authMiddleware, tenantMiddleware, async (req, res) => {
  try {
    const conversation = await getConversationById(req.tenantId, req.params.id);
    if (!conversation) {
      return res.status(404).json({ error: 'Conversación no encontrada' });
    }

    await query('DELETE FROM messages WHERE conversation_id = ?', [conversation.id]);
    await query(
      "DELETE FROM tags WHERE tenant_id = ? AND target_type = 'conversation' AND target_id = ?",
      [req.tenantId, conversation.id]
    );
    await query('DELETE FROM conversations WHERE id = ? AND tenant_id = ?', [conversation.id, req.tenantId]);

    broadcast('conversation:change', { id: conversation.id, reason: 'deleted' }, req.tenantId);
    res.json({ message: 'Conversación eliminada' });
  } catch (err) {
    console.error('[conversations DELETE]', err);
    res.status(500).json({ error: 'Error eliminando conversación' });
  }
});

module.exports = router;
