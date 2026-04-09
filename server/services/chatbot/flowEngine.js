const { query } = require('../../db');
const { broadcast } = require('../adminEvents');
const { runGroqChat } = require('./llm');
const { analyzeAndTagInboundMessage } = require('../analysis/tagger');
const { recalculateLeadScore } = require('../analysis/scorer');
const { buildPaymentQrResponse, maybeProcessPaymentProof } = require('./paymentWorkflow');
const { getActivePaymentOptions } = require('../paymentOptions');
const { sendPushinatorNotification } = require('../pushinator');
const { classifyName } = require('../nameClassifier');
const { findByPhone } = require('../agendaBridge');

const INTERACTIVE_NODE_TYPES = new Set(['open_question_ai', 'open_question_detect', 'options']);
const TELEGRAM_BUTTON_PREFIX = 'option:';
const CONSTELLATION_DEFAULT_LIMIT = 7;

function parseJson(value, fallback = {}) {
  if (!value) return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function toJson(value) {
  return JSON.stringify(value == null ? {} : value);
}

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeComparableText(value) {
  return normalizeText(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function formatRichText(value) {
  const safe = escapeHtml(value || '');
  return safe.replace(/\*(.+?)\*/g, '<b>$1</b>');
}

function parseNodeOptions(rawValue) {
  const parsed = parseJson(rawValue, []);
  return Array.isArray(parsed) ? parsed : [];
}

function parseNodeKeywords(rawValue) {
  const parsed = parseJson(rawValue, []);
  return Array.isArray(parsed) ? parsed : [];
}

function formatBoliviaDate(dateValue) {
  if (!dateValue) return 'Fecha por confirmar';
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return 'Fecha por confirmar';
  return new Intl.DateTimeFormat('es-BO', {
    timeZone: 'America/La_Paz',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(date);
}

function formatBoliviaTime(timeValue) {
  if (!timeValue) return 'Hora por confirmar';
  return String(timeValue).slice(0, 5);
}

function buildHistoryEntry(node) {
  return {
    node_key: node.node_key,
    name: node.name,
    type: node.type,
    entered_at: new Date().toISOString(),
  };
}

function getCurrentNodeEnteredAt(context) {
  const history = Array.isArray(context.history) ? context.history : [];
  return history[history.length - 1]?.entered_at || null;
}

function getResponsePreview(response) {
  if (!response) return '';
  return response.text || response.caption || '';
}

async function getLeadById(tenantId, leadId) {
  if (!leadId) return null;
  const rows = await query(
    'SELECT * FROM leads WHERE tenant_id = ? AND id = ? LIMIT 1',
    [tenantId, leadId]
  );
  return rows[0] || null;
}

async function getConversationById(tenantId, conversationId) {
  const rows = await query(
    `SELECT c.*, l.name AS lead_name, l.phone AS lead_phone, l.status AS lead_status, l.metadata AS lead_metadata
     FROM conversations c
     JOIN leads l ON l.id = c.lead_id
     WHERE c.tenant_id = ? AND c.id = ?
     LIMIT 1`,
    [tenantId, conversationId]
  );
  return rows[0] || null;
}

async function getTenantById(tenantId) {
  const rows = await query('SELECT * FROM tenants WHERE id = ? LIMIT 1', [tenantId]);
  const tenant = rows[0] || null;
  if (!tenant) return null;
  for (const field of ['push_config', 'payment_options']) {
    tenant[field] = parseJson(tenant[field], {});
  }
  return tenant;
}

async function getLatestWorkshop(tenantId) {
  const rows = await query(
    `SELECT w.*, v.name AS venue_name, v.address AS venue_address
     FROM workshops w
     LEFT JOIN venues v ON v.id = w.venue_id
     WHERE w.tenant_id = ? AND w.status IN ('planned', 'open')
     ORDER BY w.date ASC, w.time_start ASC, w.id ASC
     LIMIT 1`,
    [tenantId]
  );
  return rows[0] || null;
}

async function getFlowNodeByKey(tenantId, nodeKey) {
  const rows = await query(
    'SELECT * FROM flow_nodes WHERE tenant_id = ? AND node_key = ? AND active = TRUE LIMIT 1',
    [tenantId, nodeKey]
  );
  return rows[0] || null;
}

async function getStartNode(tenantId) {
  const rows = await query(
    'SELECT * FROM flow_nodes WHERE tenant_id = ? AND active = TRUE ORDER BY position ASC, id ASC LIMIT 1',
    [tenantId]
  );
  return rows[0] || null;
}

async function getActiveFlowSession(tenantId, conversationId) {
  const rows = await query(
    `SELECT *
     FROM flow_sessions
     WHERE tenant_id = ? AND conversation_id = ? AND status = 'active'
     ORDER BY updated_at DESC, id DESC
     LIMIT 1`,
    [tenantId, conversationId]
  );
  return rows[0] || null;
}

async function createFlowSession({ tenantId, conversationId, leadId, startNode, context = {} }) {
  const nextContext = {
    ...context,
    history: Array.isArray(context.history) && context.history.length > 0
      ? context.history
      : [buildHistoryEntry(startNode)],
    pending_input_for: context.pending_input_for || null,
  };

  const result = await query(
    `INSERT INTO flow_sessions (tenant_id, conversation_id, lead_id, current_node_key, context, status)
     VALUES (?, ?, ?, ?, ?, 'active')`,
    [tenantId, conversationId, leadId || null, startNode.node_key, toJson(nextContext)]
  );

  await query(
    'UPDATE conversations SET current_phase = ? WHERE tenant_id = ? AND id = ?',
    [startNode.node_key, tenantId, conversationId]
  );

  const rows = await query('SELECT * FROM flow_sessions WHERE id = ? LIMIT 1', [result.insertId]);
  return rows[0] || null;
}

async function updateFlowSession(sessionId, patch) {
  const updates = [];
  const params = [];

  for (const [key, value] of Object.entries(patch)) {
    updates.push(`${key} = ?`);
    params.push(key === 'context' ? toJson(value) : value);
  }

  if (!updates.length) return;
  params.push(sessionId);
  await query(`UPDATE flow_sessions SET ${updates.join(', ')} WHERE id = ?`, params);
}

async function emitSessionUpdate(tenantId, sessionId) {
  broadcast('funnel_session_update', { id: sessionId }, tenantId);
}

async function setConversationHumanAttention(tenantId, conversationId, reason) {
  await query(
    `UPDATE conversations
     SET status = 'escalated',
         inbox_state = 'open',
         assigned_to = 'bot',
         escalated_at = COALESCE(escalated_at, NOW()),
         escalation_reason = ?
     WHERE tenant_id = ? AND id = ?`,
    [reason || 'Escalación automática del embudo', tenantId, conversationId]
  );
  broadcast('conversation:change', { id: conversationId, reason: 'funnel-escalated' }, tenantId);
}

async function setLeadStatus(tenantId, leadId, nextStatus) {
  if (!leadId || !nextStatus) return;
  await query(
    'UPDATE leads SET status = ?, last_contact_at = NOW() WHERE tenant_id = ? AND id = ?',
    [nextStatus, tenantId, leadId]
  );
  broadcast('lead:change', { id: leadId, reason: 'funnel-status' }, tenantId);
}

async function markSessionCompleted(tenantId, session) {
  const context = parseJson(session.context, {});
  context.pending_input_for = null;
  await updateFlowSession(session.id, {
    status: 'completed',
    context,
  });
  session.status = 'completed';
  session.context = toJson(context);
  await emitSessionUpdate(tenantId, session.id);
}

async function markSessionEscalated(tenantId, session, contextOverride = null) {
  const context = contextOverride || parseJson(session.context, {});
  context.pending_input_for = null;
  await updateFlowSession(session.id, {
    status: 'escalated',
    context,
  });
  session.status = 'escalated';
  session.context = toJson(context);
  await emitSessionUpdate(tenantId, session.id);
}

async function transitionSessionToNode({ tenantId, session, nextNodeKey, context }) {
  if (!nextNodeKey) {
    await markSessionCompleted(tenantId, session);
    session.status = 'completed';
    return null;
  }

  const nextNode = await getFlowNodeByKey(tenantId, nextNodeKey);
  if (!nextNode) {
    return null;
  }

  const nextContext = {
    ...context,
    history: [...(Array.isArray(context.history) ? context.history : []), buildHistoryEntry(nextNode)],
    pending_input_for: null,
  };

  await updateFlowSession(session.id, {
    current_node_key: nextNode.node_key,
    context: nextContext,
  });

  await query(
    'UPDATE conversations SET current_phase = ? WHERE tenant_id = ? AND id = ?',
    [nextNode.node_key, tenantId, session.conversation_id]
  );

  await emitSessionUpdate(tenantId, session.id);
  session.current_node_key = nextNode.node_key;
  session.context = toJson(nextContext);
  session.status = 'active';
  return nextNode;
}

async function handleMissingNode({ tenantId, session, conversationId, lead, lastMessageText, reason }) {
  console.error(`[FlowEngine] ${reason} tenant=${tenantId} conversation=${conversationId}`);

  const context = parseJson(session.context, {});
  context.last_error = reason;
  await markSessionEscalated(tenantId, session, context);
  await setConversationHumanAttention(tenantId, conversationId, reason);

  const tenant = await getTenantById(tenantId);
  const leadLabel = lead?.name || lead?.phone || 'Lead sin identificar';
  await sendPushinatorNotification(
    tenant?.push_config,
    `Embudo escalado: ${leadLabel}\n${normalizeText(lastMessageText) || 'Sin mensaje reciente'}`,
    { acknowledgment_required: false }
  ).catch((err) => {
    console.error('[FlowEngine] Pushinator skipped:', err.message);
  });

  return {
    type: 'text',
    text: 'Gracias. Daniel revisará tu caso personalmente y te escribirá pronto.',
  };
}

function buildOptionButtonId(nodeKey, index) {
  return `${TELEGRAM_BUTTON_PREFIX}${nodeKey}:${index}`;
}

function parseSelectedOption(node, messageText) {
  const options = parseNodeOptions(node.options);
  const normalizedText = normalizeComparableText(messageText);

  const callbackMatch = normalizeText(messageText).match(/^option:([^:]+):(\d+)$/);
  if (callbackMatch && callbackMatch[1] === node.node_key) {
    const index = Number(callbackMatch[2]);
    return options[index] ? { ...options[index], index } : null;
  }

  const numericIndex = Number(normalizedText);
  if (numericIndex >= 1 && numericIndex <= options.length) {
    return options[numericIndex - 1] ? { ...options[numericIndex - 1], index: numericIndex - 1 } : null;
  }

  const indexByLabel = options.findIndex((option) => normalizeComparableText(option.label) === normalizedText);
  if (indexByLabel >= 0) {
    return { ...options[indexByLabel], index: indexByLabel };
  }

  return null;
}

function detectKeywords(node, messageText) {
  const normalized = normalizeComparableText(messageText);
  const keywords = parseNodeKeywords(node.keywords);
  const matched = keywords.filter((keyword) => normalized.includes(normalizeComparableText(keyword)));
  return matched;
}

function inferModalityFromNode(nodeKey) {
  if (nodeKey?.includes('constelar')) return 'constelar';
  if (nodeKey?.includes('participante') || nodeKey?.includes('participar')) return 'participar';
  return null;
}

function inferAmountFromContext(context) {
  const numeric = Number(context?.selected_amount || 0);
  return numeric > 0 ? numeric : null;
}

async function ensureEnrollment({ tenantId, workshopId, leadId, amountDue, modality }) {
  if (!workshopId || !leadId) return;
  const notes = `Embudo · Modalidad: ${modality || 'participar'}`;
  await query(
    `INSERT INTO enrollments (tenant_id, workshop_id, lead_id, status, amount_due, payment_status, notes)
     VALUES (?, ?, ?, 'pending', ?, 'unpaid', ?)
     ON DUPLICATE KEY UPDATE
       status = IF(status IN ('confirmed', 'completed'), status, VALUES(status)),
       amount_due = IF(status IN ('confirmed', 'completed'), amount_due, VALUES(amount_due)),
       payment_status = IF(payment_status = 'paid', payment_status, VALUES(payment_status)),
       notes = IF(status IN ('confirmed', 'completed'), notes, VALUES(notes))`,
    [tenantId, workshopId, leadId, amountDue || 0, notes]
  );
}

async function countConstellationEnrollments(tenantId, workshopId) {
  const rows = await query(
    `SELECT COUNT(*) AS total
     FROM enrollments
     WHERE tenant_id = ?
       AND workshop_id = ?
       AND status IN ('pending', 'confirmed', 'attended')
       AND notes LIKE '%Modalidad: constelar%'`,
    [tenantId, workshopId]
  );
  return Number(rows?.[0]?.total || 0);
}

async function findPaymentOptionSlot(tenantId, amount) {
  const options = await getActivePaymentOptions(tenantId);
  if (!options.length) return null;
  const exactMatch = options.find((option) => Number(option.amount) === Number(amount));
  return (exactMatch || options[0] || null)?.slot || null;
}

async function createOrUpdateLeadForInbound({ tenantId, channel, senderId, senderName, firstMessage }) {
  const existing = await query(
    'SELECT * FROM leads WHERE tenant_id = ? AND phone = ? LIMIT 1',
    [tenantId, senderId]
  );

  if (existing[0]) {
    if (existing[0].deleted_at) {
      await query(
        `UPDATE leads
         SET deleted_at = NULL,
             name = COALESCE(?, name),
             source = COALESCE(?, source),
             last_contact_at = NOW()
         WHERE id = ? AND tenant_id = ?`,
        [senderName || null, channel || null, existing[0].id, tenantId]
      );
      const restored = await query('SELECT * FROM leads WHERE id = ? LIMIT 1', [existing[0].id]);
      return restored[0] || null;
    }
    return existing[0];
  }

  const metadata = {
    first_message: normalizeText(firstMessage) || null,
  };

  const result = await query(
    `INSERT INTO leads (
       tenant_id, phone, name, source, status, metadata, first_contact_at, last_contact_at
     ) VALUES (?, ?, ?, ?, 'new', ?, NOW(), NOW())`,
    [tenantId, senderId, senderName || null, channel, toJson(metadata)]
  );

  broadcast('lead:change', { id: result.insertId, reason: 'created' }, tenantId);
  const rows = await query('SELECT * FROM leads WHERE id = ? LIMIT 1', [result.insertId]);
  return rows[0] || null;
}

async function lookupOrCreateContact({ tenantId, phone, waName }) {
  if (!phone) return null;

  const existing = await query(
    'SELECT * FROM contacts WHERE tenant_id = ? AND phone = ? AND deleted_at IS NULL LIMIT 1',
    [tenantId, phone]
  );

  if (existing[0]) {
    await query(
      'UPDATE contacts SET last_contact_at = NOW(), wa_name = COALESCE(?, wa_name) WHERE id = ?',
      [waName || null, existing[0].id]
    );
    return {
      ...existing[0],
      wa_name: waName || existing[0].wa_name,
      _existing: true,
      _previous_last_contact_at: existing[0].last_contact_at,
    };
  }

  const deleted = await query(
    'SELECT * FROM contacts WHERE tenant_id = ? AND phone = ? LIMIT 1',
    [tenantId, phone]
  );

  const { quality, cleanName } = classifyName(waName);

  let label = 'cold';
  let city = null;
  try {
    const agendaClient = await findByPhone(phone);
    if (agendaClient) {
      label = 'cliente_agenda';
      city = agendaClient.city || null;
    }
  } catch (err) {
    console.error('[lookupOrCreateContact] agenda lookup failed:', err.message);
  }

  if (deleted[0]) {
    await query(
      `UPDATE contacts
       SET wa_name = ?, clean_name = ?, name_quality = ?, label = ?, city = ?,
           deleted_at = NULL, first_contact_at = COALESCE(first_contact_at, NOW()),
           last_contact_at = NOW(), updated_at = NOW()
       WHERE id = ?`,
      [waName || null, cleanName, quality, label, city, deleted[0].id]
    );
    return {
      ...deleted[0],
      wa_name: waName || null,
      clean_name: cleanName,
      name_quality: quality,
      label,
      city,
      deleted_at: null,
      _existing: false,
      _previous_last_contact_at: null,
    };
  }

  const result = await query(
    `INSERT INTO contacts (tenant_id, phone, wa_name, clean_name, name_quality, label, city, first_contact_at, last_contact_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
    [tenantId, phone, waName || null, cleanName, quality, label, city]
  );

  return {
    id: result.insertId,
    tenant_id: tenantId,
    phone,
    wa_name: waName,
    clean_name: cleanName,
    name_quality: quality,
    label,
    city,
    _existing: false,
    _previous_last_contact_at: null,
  };
}

async function ensureConversationForLead({ tenantId, leadId, channel }) {
  const existing = await query(
    `SELECT *
     FROM conversations
     WHERE tenant_id = ? AND lead_id = ? AND status IN ('active', 'escalated')
     ORDER BY started_at DESC, id DESC
     LIMIT 1`,
    [tenantId, leadId]
  );

  if (existing[0]) {
    return existing[0];
  }

  const result = await query(
    `INSERT INTO conversations (
       tenant_id, lead_id, channel, current_phase, status, started_at, last_message_at, inbox_state, assigned_to
     ) VALUES (?, ?, ?, ?, 'active', NOW(), NOW(), 'open', 'bot')`,
    [tenantId, leadId, channel, 'nodo_01']
  );

  broadcast('conversation:change', { id: result.insertId, reason: 'created', leadId }, tenantId);
  const rows = await query('SELECT * FROM conversations WHERE id = ? LIMIT 1', [result.insertId]);
  return rows[0] || null;
}

async function saveConversationMessage({ conversationId, direction, sender, content, messageId, contentType, metadata = null }) {
  const result = await query(
    `INSERT INTO messages (
       conversation_id, direction, sender, content, wa_message_id, content_type, metadata, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
    [
      conversationId,
      direction,
      sender,
      content || '',
      messageId || '',
      contentType || 'text',
      metadata ? toJson(metadata) : null,
    ]
  );
  return result.insertId;
}

async function sendResponses(channelAdapter, recipientId, conversationId, tenantId, responses) {
  for (const response of responses) {
    let sent = null;

    if (response.type === 'image') {
      sent = await channelAdapter.sendImage(
        recipientId,
        response.image,
        formatRichText(response.caption || ''),
        response.mimeType
      );
    } else if (response.type === 'buttons') {
      sent = await channelAdapter.sendButtons(
        recipientId,
        formatRichText(response.text || ''),
        response.buttons || []
      );
    } else {
      sent = await channelAdapter.sendText(
        recipientId,
        formatRichText(response.text || '')
      );
    }

    await saveConversationMessage({
      conversationId,
      direction: 'outbound',
      sender: 'bot',
      content: getResponsePreview(response),
      messageId: sent?.messageId || '',
      contentType: response.type === 'image' ? 'image' : 'text',
      metadata: response.metadata || null,
    });
  }

  if (responses.length > 0) {
    await query(
      `UPDATE conversations
       SET bot_messages_count = bot_messages_count + ?,
           last_message_at = NOW()
       WHERE id = ? AND tenant_id = ?`,
      [responses.length, conversationId, tenantId]
    );
    broadcast('conversation:change', { id: conversationId, reason: 'outbound-message' }, tenantId);
  }
}

async function applyLeadQualifyingUpdate({ tenantId, leadId, messageText }) {
  const rows = await query('SELECT metadata FROM leads WHERE tenant_id = ? AND id = ? LIMIT 1', [tenantId, leadId]);
  const metadata = parseJson(rows[0]?.metadata, {});
  if (!metadata.first_message) {
    metadata.first_message = normalizeText(messageText) || null;
  }

  await query(
    'UPDATE leads SET status = ?, metadata = ?, last_contact_at = NOW() WHERE tenant_id = ? AND id = ?',
    ['qualifying', toJson(metadata), tenantId, leadId]
  );

  broadcast('lead:change', { id: leadId, reason: 'qualified-by-funnel' }, tenantId);
}

async function executeActionNode({
  tenantId,
  node,
  session,
  context,
  conversation,
  lead,
  incoming,
}) {
  const workshop = await getLatestWorkshop(tenantId);
  const modality = context.selected_modality || inferModalityFromNode(node.node_key);
  const amount = inferAmountFromContext(context) || (modality === 'constelar' ? 250 : 150);

  if (workshop?.id && (!context.workshop_id || context.workshop_id !== workshop.id)) {
    context.workshop_id = workshop.id;
    await query(
      'UPDATE conversations SET workshop_id = ? WHERE tenant_id = ? AND id = ?',
      [workshop.id, tenantId, conversation.id]
    );
  }

  switch (node.action_type) {
    case 'check_workshop_capacity': {
      if (!workshop) {
        return {
          responses: [{
            type: 'text',
            text: 'Ahora mismo no tengo un taller activo para ofrecerte. Daniel te escribirá personalmente.',
          }],
          nextNodeKey: 'nodo_escalacion',
          actionTaken: 'check_workshop_capacity:no-workshop',
        };
      }

      const workshopMetadata = parseJson(workshop.metadata, {});
      const limit = Number(workshopMetadata.constellation_capacity || workshopMetadata.constelar_capacity || CONSTELLATION_DEFAULT_LIMIT);
      const reserved = await countConstellationEnrollments(tenantId, workshop.id);

      return {
        responses: [],
        nextNodeKey: reserved >= limit ? 'nodo_09_sin_cupos' : node.next_node_key,
        actionTaken: reserved >= limit ? 'check_workshop_capacity:full' : 'check_workshop_capacity:ok',
      };
    }

    case 'send_qr': {
      const slot = await findPaymentOptionSlot(tenantId, amount);
      await ensureEnrollment({
        tenantId,
        workshopId: workshop?.id || context.workshop_id || null,
        leadId: lead?.id || null,
        amountDue: amount,
        modality,
      });

      if (!slot) {
        return {
          responses: [{
            type: 'text',
            text: 'Registré tu interés, pero no hay un QR configurado para esta opción. Daniel te escribirá personalmente para cerrar la reserva.',
          }],
          nextNodeKey: 'nodo_escalacion',
          actionTaken: 'send_qr:missing-slot',
        };
      }

      const qrResponse = await buildPaymentQrResponse({
        tenantId,
        conversationId: conversation.id,
        leadId: lead?.id || null,
        workshopId: workshop?.id || context.workshop_id || null,
        slot,
      });

      return {
        responses: [qrResponse],
        nextNodeKey: node.next_node_key,
        actionTaken: `send_qr:${slot}`,
      };
    }

    case 'process_payment_proof': {
      const qrResponse = await maybeProcessPaymentProof({
        tenantId,
        conversation,
        lead,
        incoming,
      });

      if (!qrResponse) {
        return {
          responses: [{
            type: 'text',
            text: 'Necesito que me envíes la foto del comprobante para validar tu pago.',
          }],
          nextNodeKey: 'nodo_10_espera_pago',
          actionTaken: 'process_payment_proof:missing-media',
        };
      }

      const refreshedConversation = await getConversationById(tenantId, conversation.id);
      const success = refreshedConversation?.status === 'converted';
      return {
        responses: [qrResponse],
        nextNodeKey: success ? node.next_node_key : 'nodo_10_espera_pago',
        actionTaken: success ? 'process_payment_proof:confirmed' : 'process_payment_proof:retry',
      };
    }

    case 'escalate': {
      const tenant = await getTenantById(tenantId);
      const leadLabel = lead?.name || lead?.phone || 'Lead sin identificar';
      const latestMessage = normalizeText(incoming?.message_text || context.last_inbound_message || '');

      await setConversationHumanAttention(tenantId, conversation.id, 'Escalación clínica o manual desde embudo');
      await markSessionEscalated(tenantId, session, context);

      await sendPushinatorNotification(
        tenant?.push_config,
        `Embudo escalado: ${leadLabel}\n${latestMessage || 'Sin mensaje reciente'}`,
        { acknowledgment_required: false }
      ).catch((err) => {
        console.error('[FlowEngine] Pushinator skipped:', err.message);
      });

      return {
        responses: [{
          type: 'text',
          text: 'Perfecto. Daniel revisará tu caso personalmente y te contactará lo antes posible.',
        }],
        nextNodeKey: null,
        actionTaken: 'escalate',
      };
    }

    default:
      return {
        responses: [{
          type: 'text',
          text: 'Hubo un paso interno que no pude completar. Daniel continuará la conversación personalmente.',
        }],
        nextNodeKey: 'nodo_escalacion',
        actionTaken: `unknown_action:${node.action_type || 'none'}`,
      };
  }
}

async function runFlowEngine({
  tenant_id,
  conversation_id,
  lead_id,
  message_text,
  channel,
  content_type = 'text',
  incoming = null,
}) {
  const conversation = await getConversationById(tenant_id, conversation_id);
  if (!conversation) {
    throw new Error('Conversación no encontrada para flowEngine');
  }

  const lead = await getLeadById(tenant_id, lead_id || conversation.lead_id);
  let session = await getActiveFlowSession(tenant_id, conversation_id);

  const phone = lead?.phone || incoming?.from || incoming?.senderId || null;
  const waName = lead?.name || incoming?.senderName || null;
  const contact = await lookupOrCreateContact({ tenantId: tenant_id, phone, waName });

  if (contact && lead && !lead.contact_id) {
    await query('UPDATE leads SET contact_id = ? WHERE id = ?', [contact.id, lead.id]);
    lead.contact_id = contact.id;
  }

  if (!session) {
    let startNode;
    let initialContext = {};

    if (contact?.label === 'lista_negra') {
      return {
        response_text: 'Hola, en este momento no tenemos disponibilidad.',
        buttons: [],
        action_taken: 'blocked_contact',
        responses: [{ type: 'text', text: 'Hola, en este momento no tenemos disponibilidad.' }],
      };
    }

    if (contact?.label === 'cliente_agenda' || contact?.label === 'cliente') {
      startNode = await getFlowNodeByKey(tenant_id, 'nodo_06_presentacion');
      const displayName = contact.clean_name || contact.wa_name || 'amigo/a';
      initialContext = {
        skipped_screening: true,
        contact_label: contact.label,
        contact_name: displayName,
        greeting_override: `¡Hola ${displayName}! Qué gusto verte por aquí.`,
      };
    }

    if (!startNode && contact?.label === 'nurture') {
      startNode = await getStartNode(tenant_id);
      initialContext = {
        contact_label: 'nurture',
        groq_context: 'Este contacto ya mostró interés anteriormente. Ser cálido y directo.',
      };
    }

    if (!startNode && contact?.label === 'cold' && contact?._existing && contact?._previous_last_contact_at) {
      const daysSinceLast = (Date.now() - new Date(contact._previous_last_contact_at).getTime()) / (1000 * 60 * 60 * 24);
      if (daysSinceLast < 180) {
        startNode = await getStartNode(tenant_id);
        initialContext = {
          contact_label: 'cold_returning',
          groq_context: 'Este contacto ya preguntó antes sin comprar. Ser más directo, menos calentamiento.',
        };
      }
    }

    if (!startNode) {
      startNode = await getStartNode(tenant_id);
      initialContext = { contact_label: contact?.label || 'new' };
    }

    if (!startNode) {
      throw new Error('No existe nodo inicial activo para el tenant');
    }
    session = await createFlowSession({
      tenantId: tenant_id,
      conversationId: conversation_id,
      leadId: lead?.id || null,
      startNode,
      context: initialContext,
    });
    await emitSessionUpdate(tenant_id, session.id);
  }

  const responses = [];
  const rawContext = parseJson(session.context, {});
  let context = {
    ...rawContext,
    history: Array.isArray(rawContext.history) ? rawContext.history : [],
    pending_input_for: rawContext.pending_input_for || null,
    last_inbound_message: normalizeText(message_text),
    channel,
  };

  let currentNode = await getFlowNodeByKey(tenant_id, session.current_node_key);
  if (!currentNode) {
    const fallback = await handleMissingNode({
      tenantId: tenant_id,
      session,
      conversationId: conversation_id,
      lead,
      lastMessageText: message_text,
      reason: `Nodo actual inexistente: ${session.current_node_key}`,
    });
    responses.push(fallback);
    return {
      response_text: fallback.text,
      buttons: [],
      action_taken: 'missing_current_node',
      responses,
    };
  }

  let actionTaken = null;
  let safetyCounter = 0;

  while (currentNode && safetyCounter < 20) {
    safetyCounter += 1;
    const expectsInput = INTERACTIVE_NODE_TYPES.has(currentNode.type);
    const isAwaitingInput = context.pending_input_for === currentNode.node_key;

    if (currentNode.type === 'message') {
      const workshop = await getLatestWorkshop(tenant_id);
      let renderedText = resolveMessageText(currentNode.message_text, context, workshop);
      if (context.greeting_override && safetyCounter === 1) {
        renderedText = `${context.greeting_override}\n\n${renderedText}`;
        delete context.greeting_override;
      }
      responses.push({
        type: 'text',
        text: renderedText,
        metadata: { flow_node_key: currentNode.node_key, flow_type: currentNode.type },
      });

      const nextNode = await transitionSessionToNode({
        tenantId: tenant_id,
        session,
        nextNodeKey: currentNode.next_node_key,
        context,
      });

      if (!currentNode.next_node_key) {
        break;
      }

      if (!nextNode) {
        const fallback = await handleMissingNode({
          tenantId: tenant_id,
          session,
          conversationId: conversation_id,
          lead,
          lastMessageText: message_text,
          reason: `Nodo siguiente inexistente desde ${currentNode.node_key}: ${currentNode.next_node_key}`,
        });
        responses.push(fallback);
        actionTaken = 'missing_next_node';
        break;
      }

      context = parseJson(session.context, context);
      currentNode = nextNode;
      continue;
    }

    if (currentNode.type === 'action') {
      const actionResult = await executeActionNode({
        tenantId: tenant_id,
        node: currentNode,
        session,
        context,
        conversation,
        lead,
        incoming: {
          ...(incoming || {}),
          message_text,
          content_type,
          channel,
        },
      });

      if (actionResult.responses?.length) {
        responses.push(...actionResult.responses.map((item) => ({
          ...item,
          metadata: {
            ...(item.metadata || {}),
            flow_node_key: currentNode.node_key,
            flow_type: currentNode.type,
          },
        })));
      }

      actionTaken = actionResult.actionTaken || actionTaken;

      if (session.status === 'escalated') {
        break;
      }

      const nextNodeKey = actionResult.nextNodeKey !== undefined
        ? actionResult.nextNodeKey
        : currentNode.next_node_key;

      const nextNode = await transitionSessionToNode({
        tenantId: tenant_id,
        session,
        nextNodeKey,
        context,
      });

      if (!nextNodeKey || session.status === 'completed') {
        break;
      }

      if (!nextNode) {
        const fallback = await handleMissingNode({
          tenantId: tenant_id,
          session,
          conversationId: conversation_id,
          lead,
          lastMessageText: message_text,
          reason: `Nodo siguiente inexistente desde acción ${currentNode.node_key}: ${nextNodeKey}`,
        });
        responses.push(fallback);
        actionTaken = actionTaken || 'missing_next_node';
        break;
      }

      context = parseJson(session.context, context);
      currentNode = nextNode;
      continue;
    }

    if (expectsInput && !isAwaitingInput) {
      const workshop = await getLatestWorkshop(tenant_id);
      const promptText = formatMessageWithWorkshop(currentNode.message_text, workshop);
      if (currentNode.type === 'options') {
        const options = parseNodeOptions(currentNode.options);
        responses.push({
          type: 'buttons',
          text: promptText,
          buttons: options.map((option, index) => ({
            id: buildOptionButtonId(currentNode.node_key, index),
            label: option.label,
          })),
          metadata: { flow_node_key: currentNode.node_key, flow_type: currentNode.type },
        });
      } else {
        responses.push({
          type: 'text',
          text: promptText,
          metadata: { flow_node_key: currentNode.node_key, flow_type: currentNode.type },
        });
      }

      context.pending_input_for = currentNode.node_key;
      await updateFlowSession(session.id, { context });
      await emitSessionUpdate(tenant_id, session.id);
      break;
    }

    if (currentNode.type === 'open_question_ai') {
      context.pending_input_for = null;
      context.tema = normalizeText(message_text);
      if (currentNode.node_key === 'nodo_02' && lead?.id) {
        await applyLeadQualifyingUpdate({ tenantId: tenant_id, leadId: lead.id, messageText: message_text });
      }

      const aiReply = await runGroqChat({
        systemPrompt: buildAiSystemPrompt(currentNode, context),
        userPrompt: normalizeText(message_text),
        temperature: 0.4,
        maxTokens: 180,
      }).catch((err) => {
        console.error('[FlowEngine] Groq error:', err.message);
        return null;
      });

      if (aiReply) {
        responses.push({
          type: 'text',
          text: aiReply,
          metadata: { flow_node_key: currentNode.node_key, flow_type: currentNode.type },
        });
      }

      const nextNode = await transitionSessionToNode({
        tenantId: tenant_id,
        session,
        nextNodeKey: currentNode.next_node_key,
        context,
      });

      if (!currentNode.next_node_key || session.status === 'completed') {
        break;
      }

      if (!nextNode) {
        const fallback = await handleMissingNode({
          tenantId: tenant_id,
          session,
          conversationId: conversation_id,
          lead,
          lastMessageText: message_text,
          reason: `Nodo siguiente inexistente desde ${currentNode.node_key}: ${currentNode.next_node_key}`,
        });
        responses.push(fallback);
        actionTaken = 'missing_next_node';
        break;
      }

      context = parseJson(session.context, context);
      currentNode = nextNode;
      continue;
    }

    if (currentNode.type === 'open_question_detect') {
      context.pending_input_for = null;
      const matchedKeywords = ['image', 'document'].includes(content_type)
        ? ['__media__']
        : detectKeywords(currentNode, message_text);

      context.detected_keywords = matchedKeywords;
      context.last_detect_input = normalizeText(message_text);
      if (currentNode.node_key === 'nodo_10_espera_pago') {
        context.payment_proof_received = matchedKeywords.length > 0;
      }

      const nextNodeKey = matchedKeywords.length > 0
        ? currentNode.keyword_match_next
        : currentNode.keyword_nomatch_next;

      const nextNode = await transitionSessionToNode({
        tenantId: tenant_id,
        session,
        nextNodeKey,
        context,
      });

      if (!nextNodeKey || session.status === 'completed') {
        break;
      }

      if (!nextNode) {
        const fallback = await handleMissingNode({
          tenantId: tenant_id,
          session,
          conversationId: conversation_id,
          lead,
          lastMessageText: message_text,
          reason: `Nodo detect inexistente desde ${currentNode.node_key}: ${nextNodeKey}`,
        });
        responses.push(fallback);
        actionTaken = 'missing_detect_node';
        break;
      }

      context = parseJson(session.context, context);
      currentNode = nextNode;
      continue;
    }

    if (currentNode.type === 'options') {
      const selectedOption = parseSelectedOption(currentNode, message_text);
      if (!selectedOption) {
        const options = parseNodeOptions(currentNode.options);
        responses.push({
          type: 'buttons',
          text: 'Elige una de estas opciones para continuar:',
          buttons: options.map((option, index) => ({
            id: buildOptionButtonId(currentNode.node_key, index),
            label: option.label,
          })),
          metadata: { flow_node_key: currentNode.node_key, flow_type: currentNode.type },
        });
        context.pending_input_for = currentNode.node_key;
        await updateFlowSession(session.id, { context });
        await emitSessionUpdate(tenant_id, session.id);
        break;
      }

      context.pending_input_for = null;
      context.selected_option = selectedOption.label;
      context.selected_option_index = selectedOption.index;

      if (currentNode.node_key === 'nodo_07_eleccion') {
        context.selected_modality = selectedOption.label.includes('Constelar') ? 'constelar' : 'participar';
        const amountMatch = selectedOption.label.match(/(\d+(?:[.,]\d+)?)/);
        context.selected_amount = amountMatch ? Number(amountMatch[1].replace(',', '.')) : null;
      }

      const nextNode = await transitionSessionToNode({
        tenantId: tenant_id,
        session,
        nextNodeKey: selectedOption.next_node_key,
        context,
      });

      if (!selectedOption.next_node_key || session.status === 'completed') {
        break;
      }

      if (!nextNode) {
        const fallback = await handleMissingNode({
          tenantId: tenant_id,
          session,
          conversationId: conversation_id,
          lead,
          lastMessageText: message_text,
          reason: `Nodo de opción inexistente desde ${currentNode.node_key}: ${selectedOption.next_node_key}`,
        });
        responses.push(fallback);
        actionTaken = 'missing_option_node';
        break;
      }

      context = parseJson(session.context, context);
      currentNode = nextNode;
      continue;
    }

    break;
  }

  if (safetyCounter >= 20) {
    const fallback = await handleMissingNode({
      tenantId: tenant_id,
      session,
      conversationId: conversation_id,
      lead,
      lastMessageText: message_text,
      reason: 'Flow detenido por exceso de transiciones en un solo mensaje',
    });
    responses.push(fallback);
    actionTaken = 'loop_guard';
  } else if (session.status === 'active') {
    await updateFlowSession(session.id, { context });
    await emitSessionUpdate(tenant_id, session.id);
  }

  return {
    response_text: responses[responses.length - 1]?.text || '',
    buttons: responses[responses.length - 1]?.buttons || [],
    action_taken: actionTaken,
    responses,
  };
}

function formatMessageWithWorkshop(messageText, workshop) {
  if (!messageText) return '';
  return String(messageText)
    .replaceAll('[FECHA]', workshop ? formatBoliviaDate(workshop.date) : 'fecha por confirmar')
    .replaceAll('[VENUE]', workshop?.venue_name || 'venue por confirmar')
    .replaceAll('[HORA_INICIO]', workshop ? formatBoliviaTime(workshop.time_start) : 'hora por confirmar')
    .replaceAll('[HORA_FIN]', workshop ? formatBoliviaTime(workshop.time_end) : 'hora por confirmar');
}

function resolveMessageText(messageText, context, workshop) {
  return formatMessageWithWorkshop(messageText, workshop, context);
}

function buildAiSystemPrompt(node, context) {
  let systemPrompt = node.ai_system_prompt || 'Responde con empatía y brevedad en español.';
  if (context.groq_context) {
    systemPrompt += `\n\nContexto adicional sobre este contacto: ${context.groq_context}`;
  }
  return systemPrompt;
}

async function processIncomingMessage({ tenantId, incoming, channelAdapter }) {
  const lead = await createOrUpdateLeadForInbound({
    tenantId,
    channel: incoming.channel || channelAdapter.channelName,
    senderId: incoming.senderId,
    senderName: incoming.senderName,
    firstMessage: incoming.text,
  });

  const conversation = await ensureConversationForLead({
    tenantId,
    leadId: lead.id,
    channel: incoming.channel || channelAdapter.channelName,
  });

  const inboundMessageId = await saveConversationMessage({
    conversationId: conversation.id,
    direction: 'inbound',
    sender: incoming.senderId,
    content: incoming.text,
    messageId: incoming.messageId,
    contentType: incoming.contentType,
    metadata: { source: 'telegram-webhook' },
  });

  await query(
    `UPDATE leads
     SET last_contact_at = NOW(),
         name = COALESCE(name, ?)
     WHERE tenant_id = ? AND id = ?`,
    [incoming.senderName || null, tenantId, lead.id]
  );

  await query(
    `UPDATE conversations
     SET last_message_at = NOW(),
         human_messages_count = human_messages_count + 1,
         inbox_state = 'open'
     WHERE tenant_id = ? AND id = ?`,
    [tenantId, conversation.id]
  );

  broadcast('lead:change', { id: lead.id, reason: 'inbound-message' }, tenantId);
  broadcast('conversation:change', { id: conversation.id, reason: 'inbound-message' }, tenantId);
  broadcast('message:change', { conversationId: conversation.id, messageId: inboundMessageId, direction: 'inbound' }, tenantId);

  const workshop = conversation.workshop_id
    ? await getLatestWorkshop(tenantId)
    : null;

  await analyzeAndTagInboundMessage({
    tenantId,
    lead,
    conversation,
    workshop,
    messageId: inboundMessageId,
    messageText: incoming.text,
  }).catch((err) => {
    console.error('[FlowEngine] Tagging skipped:', err.message);
  });

  await recalculateLeadScore({
    tenantId,
    leadId: lead.id,
  }).catch((err) => {
    console.error('[FlowEngine] Scoring skipped:', err.message);
  });

  const result = await runFlowEngine({
    tenant_id: tenantId,
    conversation_id: conversation.id,
    lead_id: lead.id,
    message_text: incoming.text,
    channel: incoming.channel || channelAdapter.channelName,
    content_type: incoming.contentType,
    incoming,
  });

  if (Array.isArray(result.responses) && result.responses.length > 0) {
    await sendResponses(channelAdapter, incoming.senderId, conversation.id, tenantId, result.responses);
  }

  return {
    lead,
    conversation,
    ...result,
  };
}

module.exports = {
  processIncomingMessage,
  runFlowEngine,
  formatMessageWithWorkshop,
  getCurrentNodeEnteredAt,
};
