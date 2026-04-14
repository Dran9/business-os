const express = require('express');
const authMiddleware = require('../middleware/auth');
const { tenantMiddleware } = require('../middleware/tenant');
const { query } = require('../db');
const { broadcast } = require('../services/adminEvents');
const { getCurrentNodeEnteredAt, clearTextBuffersForTenant } = require('../services/chatbot/flowEngine');
const { getFunnelControl, setFunnelPaused } = require('../services/funnelControl');

const router = express.Router();
const NODE_TYPES = new Set(['message', 'open_question_ai', 'open_question_detect', 'options', 'action', 'capture_data']);
const MAX_SEND_DELAY_SECONDS = 120;
const SESSION_STATUSES = new Set(['active', 'escalated', 'completed', 'abandoned']);

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

function clampSendDelaySeconds(value) {
  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(MAX_SEND_DELAY_SECONDS, Math.round(numeric)));
}

function buildHistoryEntry(node) {
  return {
    node_key: node?.node_key || null,
    name: node?.name || node?.node_key || '',
    type: node?.type || null,
    entered_at: new Date().toISOString(),
  };
}

function normalizeNode(row) {
  return {
    ...row,
    keywords: parseJson(row.keywords, []),
    options: parseJson(row.options, []),
    capture_field: row.capture_field || null,
    send_delay_seconds: clampSendDelaySeconds(row.send_delay_seconds),
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
    send_delay_seconds: clampSendDelaySeconds(body?.send_delay_seconds),
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

function resolveReplacementNodeKey(currentNodeKey, fallbackNodeKey) {
  if (!fallbackNodeKey) return null;
  if (fallbackNodeKey === currentNodeKey) return null;
  return fallbackNodeKey;
}

async function cleanupReferencesToNode(tenantId, deletedNodeKey, fallbackNodeKey = null) {
  const rows = await query(
    `SELECT id, node_key, next_node_key, keyword_match_next, keyword_nomatch_next, options
     FROM flow_nodes
     WHERE tenant_id = ? AND node_key <> ?`,
    [tenantId, deletedNodeKey]
  );

  let changedRows = 0;
  const normalizedFallback = fallbackNodeKey ? String(fallbackNodeKey).trim() : null;

  for (const row of rows) {
    const replacement = resolveReplacementNodeKey(row.node_key, normalizedFallback);
    let changed = false;

    let nextNodeKey = row.next_node_key || null;
    let keywordMatchNext = row.keyword_match_next || null;
    let keywordNoMatchNext = row.keyword_nomatch_next || null;

    if (nextNodeKey === deletedNodeKey) {
      nextNodeKey = replacement;
      changed = true;
    }
    if (keywordMatchNext === deletedNodeKey) {
      keywordMatchNext = replacement;
      changed = true;
    }
    if (keywordNoMatchNext === deletedNodeKey) {
      keywordNoMatchNext = replacement;
      changed = true;
    }

    const optionsRaw = parseJson(row.options, []);
    const options = Array.isArray(optionsRaw) ? optionsRaw : [];
    const nextOptions = options.map((option) => {
      if (!option || option.next_node_key !== deletedNodeKey) return option;
      changed = true;
      return {
        ...option,
        next_node_key: replacement,
      };
    });

    if (!changed) continue;

    await query(
      `UPDATE flow_nodes
       SET next_node_key = ?, keyword_match_next = ?, keyword_nomatch_next = ?, options = ?
       WHERE tenant_id = ? AND id = ?`,
      [
        nextNodeKey,
        keywordMatchNext,
        keywordNoMatchNext,
        serializeJson(nextOptions),
        tenantId,
        Number(row.id),
      ]
    );
    changedRows += 1;
  }

  return changedRows;
}

async function rerouteSessionsFromDeletedNode(tenantId, deletedNode, fallbackNode) {
  const sessions = await query(
    `SELECT id, conversation_id, context, status
     FROM flow_sessions
     WHERE tenant_id = ? AND current_node_key = ? AND status IN ('active', 'escalated')`,
    [tenantId, deletedNode.node_key]
  );

  let rerouted = 0;
  let abandoned = 0;

  for (const session of sessions) {
    const context = parseJson(session.context, {});
    context.pending_input_for = null;
    context.last_error = `Nodo eliminado manualmente: ${deletedNode.node_key}`;

    if (fallbackNode?.node_key) {
      const history = Array.isArray(context.history) ? context.history : [];
      context.history = [...history, buildHistoryEntry(fallbackNode)];

      await query(
        `UPDATE flow_sessions
         SET current_node_key = ?, status = 'active', context = ?, updated_at = NOW()
         WHERE tenant_id = ? AND id = ?`,
        [fallbackNode.node_key, serializeJson(context), tenantId, Number(session.id)]
      );
      await query(
        `UPDATE conversations
         SET current_phase = ?, status = 'active', inbox_state = 'open', escalation_reason = NULL
         WHERE tenant_id = ? AND id = ?`,
        [fallbackNode.node_key, tenantId, Number(session.conversation_id)]
      );
      rerouted += 1;
    } else {
      await query(
        `UPDATE flow_sessions
         SET status = 'abandoned', context = ?, updated_at = NOW()
         WHERE tenant_id = ? AND id = ?`,
        [serializeJson(context), tenantId, Number(session.id)]
      );
      await query(
        `UPDATE conversations
         SET current_phase = NULL
         WHERE tenant_id = ? AND id = ?`,
        [tenantId, Number(session.conversation_id)]
      );
      abandoned += 1;
    }

    broadcast('funnel_session_update', { id: Number(session.id), reason: 'flow-node-deleted' }, tenantId);
    broadcast('conversation:change', { id: Number(session.conversation_id), reason: 'flow-node-deleted' }, tenantId);
  }

  return { rerouted, abandoned };
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
         next_node_key, keyword_match_next, keyword_nomatch_next, capture_field, action_type, position, send_delay_seconds, active
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        payload.send_delay_seconds,
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
           position = ?, send_delay_seconds = ?, active = ?
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
        payload.send_delay_seconds,
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

    const fallbackCandidates = await query(
      `SELECT node_key, name, type
       FROM flow_nodes
       WHERE tenant_id = ? AND id <> ? AND active = TRUE
       ORDER BY CASE WHEN node_key = ? THEN 0 ELSE 1 END, position ASC, id ASC
       LIMIT 1`,
      [req.tenantId, Number(req.params.id), node.next_node_key || '']
    );
    const fallbackNode = fallbackCandidates[0] || null;
    const detachedReferences = await cleanupReferencesToNode(
      req.tenantId,
      node.node_key,
      fallbackNode?.node_key || null
    );
    const sessionImpact = await rerouteSessionsFromDeletedNode(req.tenantId, node, fallbackNode);

    await query(
      'DELETE FROM flow_nodes WHERE tenant_id = ? AND id = ?',
      [req.tenantId, Number(req.params.id)]
    );
    res.json({
      success: true,
      detached_references: detachedReferences,
      rerouted_sessions: sessionImpact.rerouted,
      abandoned_sessions: sessionImpact.abandoned,
      fallback_node_key: fallbackNode?.node_key || null,
    });
  } catch (err) {
    console.error('[funnel nodes DELETE]', err);
    res.status(500).json({ error: 'Error eliminando nodo' });
  }
});

router.get('/sessions', authMiddleware, tenantMiddleware, async (req, res) => {
  try {
    const statusFilter = String(req.query?.status || '').trim().toLowerCase();
    let whereStatus = "fs.status IN ('active', 'escalated')";
    const params = [req.tenantId];
    if (statusFilter === 'all') {
      whereStatus = '1=1';
    } else if (statusFilter && SESSION_STATUSES.has(statusFilter)) {
      whereStatus = 'fs.status = ?';
      params.push(statusFilter);
    }

    const rows = await query(
      `SELECT fs.*, l.name AS lead_name, l.phone AS lead_phone, c.status AS conversation_status,
              c.channel, c.last_message_at, fn.name AS current_node_name, fn.type AS current_node_type
       FROM flow_sessions fs
       LEFT JOIN leads l ON l.id = fs.lead_id
       JOIN conversations c ON c.id = fs.conversation_id
       LEFT JOIN flow_nodes fn
         ON fn.tenant_id = fs.tenant_id AND fn.node_key = fs.current_node_key
       WHERE fs.tenant_id = ? AND ${whereStatus}
       ORDER BY fs.updated_at DESC, fs.id DESC`,
      params
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

router.put('/sessions/:id/status', authMiddleware, tenantMiddleware, requireManager, async (req, res) => {
  try {
    const nextStatus = String(req.body?.status || '').trim().toLowerCase();
    if (!SESSION_STATUSES.has(nextStatus)) {
      return res.status(400).json({ error: 'Estado de sesión inválido' });
    }

    const rows = await query(
      `SELECT fs.*, c.status AS conversation_status, c.current_phase, c.inbox_state, c.assigned_to, c.escalation_reason
       FROM flow_sessions fs
       JOIN conversations c ON c.id = fs.conversation_id
       WHERE fs.tenant_id = ? AND fs.id = ?
       LIMIT 1`,
      [req.tenantId, Number(req.params.id)]
    );
    const session = rows[0];
    if (!session) {
      return res.status(404).json({ error: 'Sesión no encontrada' });
    }

    const context = parseJson(session.context, {});
    context.pending_input_for = null;

    let currentNodeKey = session.current_node_key;
    if (nextStatus === 'active') {
      const currentNodeRows = currentNodeKey
        ? await query(
            'SELECT node_key FROM flow_nodes WHERE tenant_id = ? AND node_key = ? AND active = TRUE LIMIT 1',
            [req.tenantId, currentNodeKey]
          )
        : [];
      if (!currentNodeRows[0]) {
        const fallbackNodeRows = await query(
          `SELECT node_key
           FROM flow_nodes
           WHERE tenant_id = ? AND active = TRUE
           ORDER BY position ASC, id ASC
           LIMIT 1`,
          [req.tenantId]
        );
        currentNodeKey = fallbackNodeRows[0]?.node_key || null;
      }

      if (!currentNodeKey) {
        return res.status(400).json({ error: 'No hay nodos activos para reactivar esta sesión' });
      }
    }

    await query(
      `UPDATE flow_sessions
       SET status = ?, current_node_key = ?, context = ?, updated_at = NOW()
       WHERE tenant_id = ? AND id = ?`,
      [nextStatus, currentNodeKey, serializeJson(context), req.tenantId, Number(req.params.id)]
    );

    if (nextStatus === 'active') {
      await query(
        `UPDATE flow_sessions
         SET status = 'abandoned', updated_at = NOW()
         WHERE tenant_id = ? AND conversation_id = ? AND status = 'active' AND id <> ?`,
        [req.tenantId, session.conversation_id, Number(req.params.id)]
      );
      await query(
        `UPDATE conversations
         SET status = 'active',
             assigned_to = 'bot',
             inbox_state = 'open',
             escalation_reason = NULL,
             current_phase = ?
         WHERE tenant_id = ? AND id = ?`,
        [currentNodeKey, req.tenantId, session.conversation_id]
      );
    } else if (nextStatus === 'escalated') {
      await query(
        `UPDATE conversations
         SET status = 'escalated',
             assigned_to = 'bot',
             inbox_state = 'open',
             escalated_at = COALESCE(escalated_at, NOW()),
             escalation_reason = ?
         WHERE tenant_id = ? AND id = ?`,
        [
          String(req.body?.reason || session.escalation_reason || 'Escalación manual desde embudo').trim(),
          req.tenantId,
          session.conversation_id,
        ]
      );
    } else {
      await query(
        `UPDATE conversations
         SET status = 'active',
             assigned_to = 'bot',
             escalation_reason = NULL
         WHERE tenant_id = ? AND id = ?`,
        [req.tenantId, session.conversation_id]
      );
    }

    broadcast('funnel_session_update', { id: Number(req.params.id), reason: 'manual-status-change' }, req.tenantId);
    broadcast('conversation:change', { id: session.conversation_id, reason: 'manual-status-change' }, req.tenantId);

    const updatedRows = await query(
      `SELECT fs.*, l.name AS lead_name, l.phone AS lead_phone, c.status AS conversation_status,
              c.channel, c.last_message_at, c.current_phase, fn.name AS current_node_name, fn.type AS current_node_type
       FROM flow_sessions fs
       LEFT JOIN leads l ON l.id = fs.lead_id
       JOIN conversations c ON c.id = fs.conversation_id
       LEFT JOIN flow_nodes fn
         ON fn.tenant_id = fs.tenant_id AND fn.node_key = fs.current_node_key
       WHERE fs.tenant_id = ? AND fs.id = ?
       LIMIT 1`,
      [req.tenantId, Number(req.params.id)]
    );
    const updated = updatedRows[0];
    if (!updated) {
      return res.status(404).json({ error: 'Sesión no encontrada tras actualizar' });
    }

    const updatedContext = parseJson(updated.context, {});
    return res.json({
      ...updated,
      context: updatedContext,
      current_node_entered_at: getCurrentNodeEnteredAt(updatedContext),
    });
  } catch (err) {
    console.error('[funnel sessions/:id/status PUT]', err);
    return res.status(500).json({ error: 'Error actualizando estado de sesión' });
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
