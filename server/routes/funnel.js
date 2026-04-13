const express = require('express');
const authMiddleware = require('../middleware/auth');
const { tenantMiddleware } = require('../middleware/tenant');
const { query } = require('../db');
const { broadcast } = require('../services/adminEvents');
const { getCurrentNodeEnteredAt, clearTextBuffersForTenant } = require('../services/chatbot/flowEngine');
const { getFunnelControl, setFunnelPaused } = require('../services/funnelControl');

const router = express.Router();
const NODE_TYPES = new Set(['message', 'open_question_ai', 'open_question_detect', 'options', 'action', 'capture_data']);

function requireManager(req, res, next) {
  if (!['owner', 'admin'].includes(req.user?.role)) {
    return res.status(403).json({ error: 'No tienes permiso para editar el embudo' });
  }
  next();
}

function parseJson(value, fallback = null) {
  if (!value) return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function serializeJson(value) {
  return value == null ? null : JSON.stringify(value);
}

function normalizeNode(row) {
  return {
    ...row,
    keywords: parseJson(row.keywords, []),
    options: parseJson(row.options, []),
    capture_field: row.capture_field || null,
  };
}

async function getTenantNodes(tenantId) {
  const rows = await query(
    'SELECT * FROM flow_nodes WHERE tenant_id = ? ORDER BY position ASC, id ASC',
    [tenantId]
  );
  return rows.map(normalizeNode);
}

function validateNodePayload(body, { isCreate = false } = {}) {
  const payload = {
    node_key: body?.node_key ? String(body.node_key).trim() : '',
    name: body?.name ? String(body.name).trim() : '',
    type: body?.type ? String(body.type).trim() : '',
    message_text: body?.message_text == null ? null : String(body.message_text),
    ai_system_prompt: body?.ai_system_prompt == null ? null : String(body.ai_system_prompt),
    keywords: Array.isArray(body?.keywords) ? body.keywords : null,
    options: Array.isArray(body?.options) ? body.options : null,
    next_node_key: body?.next_node_key ? String(body.next_node_key).trim() : null,
    keyword_match_next: body?.keyword_match_next ? String(body.keyword_match_next).trim() : null,
    keyword_nomatch_next: body?.keyword_nomatch_next ? String(body.keyword_nomatch_next).trim() : null,
    capture_field: body?.capture_field ? String(body.capture_field).trim() : null,
    action_type: body?.action_type ? String(body.action_type).trim() : null,
    position: Number(body?.position ?? 0),
    active: body?.active !== false,
  };

  if (isCreate && !payload.node_key) {
    throw new Error('node_key es requerido');
  }
  if (!payload.name) {
    throw new Error('name es requerido');
  }
  if (!NODE_TYPES.has(payload.type)) {
    throw new Error('type inválido');
  }
  if (!Number.isFinite(payload.position)) {
    throw new Error('position inválido');
  }
  if (payload.type === 'open_question_ai' && !payload.ai_system_prompt) {
    throw new Error('ai_system_prompt es requerido para open_question_ai');
  }
  if (payload.type === 'open_question_detect' && !Array.isArray(payload.keywords)) {
    throw new Error('keywords debe ser un array para open_question_detect');
  }
  if (payload.type === 'options' && !Array.isArray(payload.options)) {
    throw new Error('options debe ser un array para options');
  }
  if (payload.type === 'capture_data' && !payload.capture_field) {
    throw new Error('capture_field es requerido para capture_data');
  }

  return payload;
}

async function isNodeReferenced(tenantId, nodeKey, excludeId = null) {
  const nodes = await getTenantNodes(tenantId);
  for (const node of nodes) {
    if (excludeId && Number(node.id) === Number(excludeId)) continue;
    if (
      node.next_node_key === nodeKey
      || node.keyword_match_next === nodeKey
      || node.keyword_nomatch_next === nodeKey
    ) {
      return true;
    }

    if (Array.isArray(node.options) && node.options.some((option) => option?.next_node_key === nodeKey)) {
      return true;
    }
  }
  return false;
}

router.get('/control', authMiddleware, tenantMiddleware, async (req, res) => {
  try {
    const control = await getFunnelControl(req.tenantId);
    res.json(control);
  } catch (err) {
    console.error('[funnel control GET]', err);
    res.status(500).json({ error: 'Error cargando control del embudo' });
  }
});

router.put('/control', authMiddleware, tenantMiddleware, requireManager, async (req, res) => {
  try {
    const rawPaused = req.body?.funnel_paused ?? req.body?.paused;
    if (typeof rawPaused !== 'boolean') {
      return res.status(400).json({ error: 'funnel_paused debe ser booleano' });
    }

    const control = await setFunnelPaused(req.tenantId, rawPaused);
    const clearedTextBuffers = control.funnel_paused
      ? clearTextBuffersForTenant(req.tenantId)
      : 0;

    const payload = {
      ...control,
      cleared_text_buffers: clearedTextBuffers,
      updated_by: req.user?.username || 'admin',
    };
    broadcast('funnel:control', payload, req.tenantId);
    res.json(payload);
  } catch (err) {
    console.error('[funnel control PUT]', err);
    res.status(500).json({ error: 'Error actualizando control del embudo' });
  }
});

router.get('/nodes', authMiddleware, tenantMiddleware, async (req, res) => {
  try {
    const nodes = await getTenantNodes(req.tenantId);
    res.json(nodes);
  } catch (err) {
    console.error('[funnel nodes GET]', err);
    res.status(500).json({ error: 'Error cargando nodos del embudo' });
  }
});

router.post('/nodes', authMiddleware, tenantMiddleware, requireManager, async (req, res) => {
  try {
    const payload = validateNodePayload(req.body, { isCreate: true });
    const result = await query(
      `INSERT INTO flow_nodes (
         tenant_id, node_key, name, type, message_text, ai_system_prompt, keywords, options,
         next_node_key, keyword_match_next, keyword_nomatch_next, capture_field, action_type, position, active
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        req.tenantId,
        payload.node_key,
        payload.name,
        payload.type,
        payload.message_text,
        payload.ai_system_prompt,
        serializeJson(payload.keywords),
        serializeJson(payload.options),
        payload.next_node_key,
        payload.keyword_match_next,
        payload.keyword_nomatch_next,
        payload.capture_field,
        payload.action_type,
        payload.position,
        payload.active,
      ]
    );

    const rows = await query('SELECT * FROM flow_nodes WHERE id = ? LIMIT 1', [result.insertId]);
    res.json(normalizeNode(rows[0]));
  } catch (err) {
    console.error('[funnel nodes POST]', err);
    if (err.message?.includes('Duplicate')) {
      return res.status(400).json({ error: 'Ya existe un nodo con ese node_key' });
    }
    res.status(400).json({ error: err.message || 'Error creando nodo' });
  }
});

router.put('/nodes/:id', authMiddleware, tenantMiddleware, requireManager, async (req, res) => {
  try {
    const existingRows = await query(
      'SELECT * FROM flow_nodes WHERE tenant_id = ? AND id = ? LIMIT 1',
      [req.tenantId, Number(req.params.id)]
    );
    const existing = existingRows[0];
    if (!existing) {
      return res.status(404).json({ error: 'Nodo no encontrado' });
    }

    if (req.body?.node_key && String(req.body.node_key).trim() !== existing.node_key) {
      return res.status(400).json({ error: 'node_key no se puede editar una vez creado' });
    }

    const payload = validateNodePayload({ ...existing, ...req.body });
    await query(
      `UPDATE flow_nodes
       SET name = ?, type = ?, message_text = ?, ai_system_prompt = ?, keywords = ?, options = ?,
           next_node_key = ?, keyword_match_next = ?, keyword_nomatch_next = ?, capture_field = ?, action_type = ?,
           position = ?, active = ?
       WHERE tenant_id = ? AND id = ?`,
      [
        payload.name,
        payload.type,
        payload.message_text,
        payload.ai_system_prompt,
        serializeJson(payload.keywords),
        serializeJson(payload.options),
        payload.next_node_key,
        payload.keyword_match_next,
        payload.keyword_nomatch_next,
        payload.capture_field,
        payload.action_type,
        payload.position,
        payload.active,
        req.tenantId,
        Number(req.params.id),
      ]
    );

    const rows = await query('SELECT * FROM flow_nodes WHERE id = ? LIMIT 1', [Number(req.params.id)]);
    res.json(normalizeNode(rows[0]));
  } catch (err) {
    console.error('[funnel nodes PUT]', err);
    res.status(400).json({ error: err.message || 'Error actualizando nodo' });
  }
});

router.delete('/nodes/:id', authMiddleware, tenantMiddleware, requireManager, async (req, res) => {
  try {
    const rows = await query(
      'SELECT * FROM flow_nodes WHERE tenant_id = ? AND id = ? LIMIT 1',
      [req.tenantId, Number(req.params.id)]
    );
    const node = rows[0];
    if (!node) {
      return res.status(404).json({ error: 'Nodo no encontrado' });
    }

    const referenced = await isNodeReferenced(req.tenantId, node.node_key, node.id);
    if (referenced) {
      return res.status(400).json({ error: 'No puedes eliminar este nodo porque está referenciado por otro nodo' });
    }

    const activeSessions = await query(
      `SELECT COUNT(*) AS total
       FROM flow_sessions
       WHERE tenant_id = ? AND current_node_key = ? AND status IN ('active', 'escalated')`,
      [req.tenantId, node.node_key]
    );
    if (Number(activeSessions?.[0]?.total || 0) > 0) {
      return res.status(400).json({ error: 'No puedes eliminar este nodo porque hay sesiones activas usándolo' });
    }

    await query(
      'DELETE FROM flow_nodes WHERE tenant_id = ? AND id = ?',
      [req.tenantId, Number(req.params.id)]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('[funnel nodes DELETE]', err);
    res.status(500).json({ error: 'Error eliminando nodo' });
  }
});

router.get('/sessions', authMiddleware, tenantMiddleware, async (req, res) => {
  try {
    const rows = await query(
      `SELECT fs.*, l.name AS lead_name, l.phone AS lead_phone, c.status AS conversation_status,
              c.channel, c.last_message_at, fn.name AS current_node_name, fn.type AS current_node_type
       FROM flow_sessions fs
       LEFT JOIN leads l ON l.id = fs.lead_id
       JOIN conversations c ON c.id = fs.conversation_id
       LEFT JOIN flow_nodes fn
         ON fn.tenant_id = fs.tenant_id AND fn.node_key = fs.current_node_key
       WHERE fs.tenant_id = ? AND fs.status IN ('active', 'escalated')
       ORDER BY fs.updated_at DESC, fs.id DESC`,
      [req.tenantId]
    );

    res.json(rows.map((row) => {
      const context = parseJson(row.context, {});
      return {
        ...row,
        context,
        current_node_entered_at: getCurrentNodeEnteredAt(context),
      };
    }));
  } catch (err) {
    console.error('[funnel sessions GET]', err);
    res.status(500).json({ error: 'Error cargando sesiones del embudo' });
  }
});

router.get('/sessions/:id', authMiddleware, tenantMiddleware, async (req, res) => {
  try {
    const rows = await query(
      `SELECT fs.*, l.name AS lead_name, l.phone AS lead_phone, c.channel, c.status AS conversation_status,
              c.current_phase, c.last_message_at, c.internal_notes, fn.name AS current_node_name, fn.type AS current_node_type
       FROM flow_sessions fs
       LEFT JOIN leads l ON l.id = fs.lead_id
       JOIN conversations c ON c.id = fs.conversation_id
       LEFT JOIN flow_nodes fn
         ON fn.tenant_id = fs.tenant_id AND fn.node_key = fs.current_node_key
       WHERE fs.tenant_id = ? AND fs.id = ?
       LIMIT 1`,
      [req.tenantId, Number(req.params.id)]
    );

    const session = rows[0];
    if (!session) {
      return res.status(404).json({ error: 'Sesión no encontrada' });
    }

    const messages = await query(
      `SELECT id, direction, sender, content, content_type, metadata, created_at
       FROM messages
       WHERE conversation_id = ?
       ORDER BY created_at ASC, id ASC`,
      [session.conversation_id]
    );

    const context = parseJson(session.context, {});
    res.json({
      ...session,
      context,
      history: Array.isArray(context.history) ? context.history : [],
      current_node_entered_at: getCurrentNodeEnteredAt(context),
      messages: messages.map((message) => ({
        ...message,
        metadata: parseJson(message.metadata, null),
      })),
    });
  } catch (err) {
    console.error('[funnel sessions/:id GET]', err);
    res.status(500).json({ error: 'Error cargando detalle de sesión' });
  }
});

module.exports = router;
