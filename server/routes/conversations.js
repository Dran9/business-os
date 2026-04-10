const express = require('express');
const authMiddleware = require('../middleware/auth');
const { tenantMiddleware } = require('../middleware/tenant');
const { query, queryPaginated } = require('../db');
const TelegramAdapter = require('../services/channels/telegram');
const WhatsAppAdapter = require('../services/channels/whatsapp');
const { broadcast } = require('../services/adminEvents');
const { getMessageTarget } = require('../services/whatsappIdentity');

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
                      ) AS last_message
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
    result.data = await attachTags(req.tenantId, result.data);
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

    const adapter = await getChannelAdapter(conversation.channel, req.tenantId);
    let target = conversation.lead_phone;

    if (conversation.channel === 'whatsapp') {
      target = await getMessageTarget(req.tenantId, conversation.lead_id);
      if (!target?.phone && !target?.bsuid) {
        return res.status(400).json({ error: 'No hay target de WhatsApp disponible para esta conversación' });
      }
    }

    const sent = await adapter.sendText(target, escapeHtml(content));
    const outboundBsuid = target && typeof target === 'object' ? target.bsuid || null : null;

    const result = await query(
      `INSERT INTO messages (conversation_id, direction, sender, bsuid, content, wa_message_id, content_type, created_at)
       VALUES (?, 'outbound', ?, ?, ?, ?, 'text', NOW())`,
      [conversation.id, req.user?.username || 'admin', outboundBsuid, content, sent.messageId || '']
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
      [outboundBsuid, req.user?.username || 'admin', conversation.id, req.tenantId]
    );

    broadcast('message:change', { conversationId: conversation.id, messageId: result.insertId, reason: 'manual-send' }, req.tenantId);
    broadcast('conversation:change', { id: conversation.id, reason: 'manual-send' }, req.tenantId);

    res.json({
      id: result.insertId,
      message: 'Mensaje enviado',
    });
  } catch (err) {
    console.error('[conversations send message]', err);
    res.status(500).json({ error: err.message || 'Error enviando mensaje' });
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
