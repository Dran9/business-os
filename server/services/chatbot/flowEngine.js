const { query } = require('../../db');
const { broadcast } = require('../adminEvents');
const { runGroqChat, buildRecentHistoryBlock } = require('./llm');
const { analyzeAndTagInboundMessage } = require('../analysis/tagger');
const { recalculateLeadScore } = require('../analysis/scorer');
const { buildPaymentQrResponse, maybeProcessPaymentProof, runPaymentProofDiagnostic } = require('./paymentWorkflow');
const { getPaymentSettings } = require('../paymentOptions');
const { getActivePaymentOptions } = require('../paymentOptions');
const { sendPushinatorNotification } = require('../pushinator');
const { classifyName } = require('../nameClassifier');
const { findByPhone } = require('../agendaBridge');
const { resolveIdentity, getMessageTarget } = require('../whatsappIdentity');
const {
  DEFAULT_TEXT_BUFFER_IDLE_MS,
  DEFAULT_TEXT_BUFFER_MAX_MESSAGES,
  DEFAULT_TEXT_BUFFER_MAX_WINDOW_MS,
  getLlmSettings,
  normalizeTextBufferSettings,
} = require('../llmSettings');
const { getActiveAiDocumentsContext } = require('../aiContextDocuments');
const TelegramAdapter = require('../channels/telegram');
const WhatsAppAdapter = require('../channels/whatsapp');

const INTERACTIVE_NODE_TYPES = new Set(['open_question_ai', 'open_question_detect', 'options', 'capture_data']);
const TELEGRAM_BUTTON_PREFIX = 'option:';
const CONSTELLATION_DEFAULT_LIMIT = 7;
const TEXT_BUFFER_SEPARATOR = '\n';
const TEXT_BUFFER_BY_CONVERSATION = new Map();

const CAPTURE_FIELD_LABELS = {
  first_name: 'nombre',
  last_name: 'apellido',
  phone: 'celular',
};

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

function normalizeInternalWhitespace(value) {
  return normalizeText(value).replace(/\s+/g, ' ');
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

function formatMoneyBs(amount) {
  const numeric = Number(amount || 0);
  if (!numeric) return '';
  return `${Number.isInteger(numeric) ? numeric : numeric.toFixed(2)} Bs`;
}

function formatSelectedModality(value) {
  if (value === 'constelar') return 'Constelar';
  if (value === 'participar') return 'Participar';
  return normalizeText(value);
}

function buildFullName(firstName, lastName) {
  return normalizeInternalWhitespace([firstName, lastName].filter(Boolean).join(' '));
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

async function getRecentLeadMessages(tenantId, leadId, limit = 4) {
  if (!leadId) return [];
  const safeLimit = Math.max(1, Math.min(Number(limit) || 4, 10));
  const rows = await query(
    `SELECT m.direction, m.content, m.created_at
     FROM messages m
     JOIN conversations c ON c.id = m.conversation_id
     WHERE c.tenant_id = ?
       AND c.lead_id = ?
       AND m.content IS NOT NULL
       AND m.content <> ''
     ORDER BY m.id DESC
     LIMIT ?`,
    [tenantId, leadId, safeLimit + 1]
  );

  return rows.reverse();
}

async function getTenantById(tenantId) {
  const rows = await query('SELECT * FROM tenants WHERE id = ? LIMIT 1', [tenantId]);
  const tenant = rows[0] || null;
  if (!tenant) return null;
  for (const field of ['llm_config', 'push_config', 'payment_options']) {
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

async function getLatestFlowSession(tenantId, conversationId) {
  const rows = await query(
    `SELECT *
     FROM flow_sessions
     WHERE tenant_id = ? AND conversation_id = ?
     ORDER BY updated_at DESC, id DESC
     LIMIT 1`,
    [tenantId, conversationId]
  );
  return rows[0] || null;
}

async function createFlowSession({ tenantId, conversationId, leadId, startNode, context = {} }) {
  const nextContext = {
    ...context,
    tag_on_next: context.tag_on_next !== false,
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

async function setConversationBotActive(tenantId, conversationId, nodeKey = null) {
  const params = [tenantId, conversationId];
  let sql = `UPDATE conversations
             SET status = 'active',
                 assigned_to = 'bot',
                 inbox_state = 'open',
                 escalation_reason = NULL`;

  if (nodeKey) {
    sql += ', current_phase = ?';
    params.unshift(nodeKey);
  }

  sql += ' WHERE tenant_id = ? AND id = ?';
  await query(sql, params);
  broadcast('conversation:change', { id: conversationId, reason: 'flow-resumed' }, tenantId);
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
    tag_on_next: true,
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

async function escalateConversationFlow({
  tenantId,
  session,
  conversationId,
  lead,
  context,
  lastMessageText,
  reason,
  customerMessage,
}) {
  const nextContext = {
    ...(context || parseJson(session.context, {})),
    last_error: reason || null,
  };

  await markSessionEscalated(tenantId, session, nextContext);
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
    text: customerMessage || 'Gracias. Daniel revisará tu caso personalmente y te escribirá pronto.',
  };
}

async function handleMissingNode({ tenantId, session, conversationId, lead, lastMessageText, reason }) {
  console.error(`[FlowEngine] ${reason} tenant=${tenantId} conversation=${conversationId}`);
  return escalateConversationFlow({
    tenantId,
    session,
    conversationId,
    lead,
    context: parseJson(session.context, {}),
    lastMessageText,
    reason,
    customerMessage: 'Gracias. Daniel revisará tu caso personalmente y te escribirá pronto.',
  });
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

function getCapturedIdentity(context = {}, lead = null) {
  const metadata = parseJson(lead?.metadata, {});
  const captured = parseJson(metadata.identity_capture, {});
  const firstName = normalizeInternalWhitespace(context.captured_first_name || captured.first_name || '');
  const lastName = normalizeInternalWhitespace(context.captured_last_name || captured.last_name || '');
  const fullName = normalizeInternalWhitespace(
    context.captured_full_name
    || captured.full_name
    || buildFullName(firstName, lastName)
    || lead?.name
    || ''
  );
  const phone = normalizeInternalWhitespace(context.captured_phone || captured.phone || lead?.phone || '');

  return {
    first_name: firstName,
    last_name: lastName,
    full_name: fullName,
    phone,
  };
}

function validateCaptureInput(field, rawValue) {
  const value = normalizeInternalWhitespace(rawValue);
  const label = CAPTURE_FIELD_LABELS[field] || 'dato';

  if (!value) {
    return { error: `Necesito tu ${label} para continuar.` };
  }

  if (field === 'phone') {
    const digits = value.replace(/\D+/g, '');
    if (digits.length < 7) {
      return { error: 'Necesito un celular válido para continuar.' };
    }
    return { value: digits };
  }

  if (!/[A-Za-zÀ-ÖØ-öø-ÿ]/.test(value)) {
    return { error: `Necesito un ${label} válido para continuar.` };
  }

  return { value };
}

async function persistCapturedIdentity({ tenantId, lead, contact, field, value }) {
  if (!lead?.id || !field || !value) return null;

  const metadata = parseJson(lead.metadata, {});
  const identityCapture = parseJson(metadata.identity_capture, {});

  if (field === 'first_name') identityCapture.first_name = value;
  if (field === 'last_name') identityCapture.last_name = value;
  if (field === 'phone') identityCapture.phone = value;

  const fullName = buildFullName(identityCapture.first_name, identityCapture.last_name);
  if (fullName) {
    identityCapture.full_name = fullName;
  }

  metadata.identity_capture = identityCapture;
  metadata.first_name = identityCapture.first_name || null;
  metadata.last_name = identityCapture.last_name || null;
  metadata.full_name = identityCapture.full_name || null;
  if (identityCapture.phone) {
    metadata.phone = identityCapture.phone;
  }

  const leadUpdates = [];
  const leadParams = [];

  leadUpdates.push('metadata = ?');
  leadParams.push(toJson(metadata));

  if (fullName) {
    leadUpdates.push('name = ?');
    leadParams.push(fullName);
  }

  if (field === 'phone') {
    leadUpdates.push('phone = COALESCE(phone, ?)');
    leadParams.push(value);
  }

  leadParams.push(tenantId, lead.id);
  await query(
    `UPDATE leads
     SET ${leadUpdates.join(', ')},
         last_contact_at = NOW()
     WHERE tenant_id = ? AND id = ?`,
    leadParams
  );

  if (contact?.id && fullName) {
    await query(
      `UPDATE contacts
       SET clean_name = ?,
           name_quality = 'nombre_completo',
           updated_at = NOW()
       WHERE tenant_id = ? AND id = ?`,
      [fullName, tenantId, contact.id]
    ).catch(() => {});
  }

  broadcast('lead:change', { id: lead.id, reason: 'identity-captured' }, tenantId);
  return {
    ...identityCapture,
    full_name: fullName || identityCapture.full_name || null,
  };
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
  const participantRole = modality === 'constelar' ? 'constela' : 'participa';
  const notes = `Embudo · Modalidad: ${participantRole === 'constela' ? 'constelar' : 'participar'}`;
  await query(
    `INSERT INTO enrollments (tenant_id, workshop_id, lead_id, status, participant_role, amount_due, payment_status, notes)
     VALUES (?, ?, ?, 'pending', ?, ?, 'unpaid', ?)
     ON DUPLICATE KEY UPDATE
       status = IF(status IN ('confirmed', 'attended'), status, VALUES(status)),
       participant_role = VALUES(participant_role),
       amount_due = IF(status IN ('confirmed', 'attended'), amount_due, VALUES(amount_due)),
       payment_status = IF(payment_status = 'paid', payment_status, VALUES(payment_status)),
       notes = IF(status IN ('confirmed', 'attended'), notes, VALUES(notes))`,
    [tenantId, workshopId, leadId, participantRole, amountDue || 0, notes]
  );
}

async function countConstellationEnrollments(tenantId, workshopId) {
  const rows = await query(
    `SELECT COUNT(*) AS total
     FROM enrollments
     WHERE tenant_id = ?
       AND workshop_id = ?
       AND status IN ('pending', 'confirmed', 'attended')
       AND participant_role = 'constela'`,
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

async function createOrUpdateLeadForInbound({
  tenantId,
  channel,
  senderId,
  senderName,
  firstMessage,
  identity = null,
}) {
  const phone = identity?.phone || senderId || null;
  let lead = null;

  if (identity?.client_id) {
    const rows = await query(
      'SELECT * FROM leads WHERE tenant_id = ? AND id = ? LIMIT 1',
      [tenantId, identity.client_id]
    );
    lead = rows[0] || null;
  }

  if (!lead && phone) {
    const rows = await query(
      'SELECT * FROM leads WHERE tenant_id = ? AND phone = ? LIMIT 1',
      [tenantId, phone]
    );
    lead = rows[0] || null;
  }

  if (lead) {
    const metadata = parseJson(lead.metadata, {});
    if (identity?.bsuid) {
      metadata.whatsapp_identity = {
        bsuid: identity.bsuid,
        parent_bsuid: identity.parent_bsuid || null,
        username: identity.username || null,
      };
    }
    if (!metadata.first_message) {
      metadata.first_message = normalizeText(firstMessage) || null;
    }

    await query(
      `UPDATE leads
       SET deleted_at = NULL,
           phone = COALESCE(phone, ?),
           name = COALESCE(?, name),
           source = COALESCE(?, source),
           metadata = ?,
           last_contact_at = NOW()
       WHERE id = ? AND tenant_id = ?`,
      [phone || null, senderName || null, channel || null, toJson(metadata), lead.id, tenantId]
    );

    if (identity?.id && identity.client_id !== lead.id) {
      await query(
        'UPDATE whatsapp_users SET client_id = ? WHERE tenant_id = ? AND id = ?',
        [lead.id, tenantId, identity.id]
      );
    }

    const refreshed = await query('SELECT * FROM leads WHERE id = ? LIMIT 1', [lead.id]);
    return refreshed[0] || null;
  }

  const metadata = {
    first_message: normalizeText(firstMessage) || null,
  };
  if (identity?.bsuid) {
    metadata.whatsapp_identity = {
      bsuid: identity.bsuid,
      parent_bsuid: identity.parent_bsuid || null,
      username: identity.username || null,
    };
  }

  const result = await query(
    `INSERT INTO leads (
       tenant_id, phone, name, source, status, metadata, first_contact_at, last_contact_at
     ) VALUES (?, ?, ?, ?, 'new', ?, NOW(), NOW())`,
    [tenantId, phone || null, senderName || null, channel, toJson(metadata)]
  );

  if (identity?.id) {
    await query(
      'UPDATE whatsapp_users SET client_id = ? WHERE tenant_id = ? AND id = ?',
      [result.insertId, tenantId, identity.id]
    );
  }

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

async function ensureConversationForLead({ tenantId, leadId, channel, bsuid = null }) {
  const existing = await query(
    `SELECT *
     FROM conversations
     WHERE tenant_id = ? AND lead_id = ? AND status IN ('active', 'escalated')
     ORDER BY started_at DESC, id DESC
     LIMIT 1`,
    [tenantId, leadId]
  );

  if (existing[0]) {
    if (bsuid) {
      await query(
        'UPDATE conversations SET bsuid = COALESCE(?, bsuid), last_message_at = NOW() WHERE tenant_id = ? AND id = ?',
        [bsuid, tenantId, existing[0].id]
      );
      const rows = await query('SELECT * FROM conversations WHERE id = ? LIMIT 1', [existing[0].id]);
      return rows[0] || existing[0];
    }
    return existing[0];
  }

  const result = await query(
    `INSERT INTO conversations (
       tenant_id, lead_id, channel, bsuid, current_phase, status, started_at, last_message_at, inbox_state, assigned_to
     ) VALUES (?, ?, ?, ?, ?, 'active', NOW(), NOW(), 'open', 'bot')`,
    [tenantId, leadId, channel, bsuid || null, 'nodo_01']
  );

  broadcast('conversation:change', { id: result.insertId, reason: 'created', leadId }, tenantId);
  const rows = await query('SELECT * FROM conversations WHERE id = ? LIMIT 1', [result.insertId]);
  return rows[0] || null;
}

async function saveConversationMessage({
  conversationId,
  direction,
  sender,
  bsuid = null,
  content,
  messageId,
  contentType,
  metadata = null,
}) {
  const result = await query(
    `INSERT INTO messages (
       conversation_id, direction, sender, bsuid, content, wa_message_id, content_type, metadata, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
    [
      conversationId,
      direction,
      sender,
      bsuid || null,
      content || '',
      messageId || '',
      contentType || 'text',
      metadata ? toJson(metadata) : null,
    ]
  );
  return result.insertId;
}

async function sendResponses(channelAdapter, recipientTarget, conversationId, tenantId, responses) {
  for (const response of responses) {
    let sent = null;

    if (response.type === 'image') {
      sent = await channelAdapter.sendImage(
        recipientTarget,
        response.image,
        formatRichText(response.caption || ''),
        response.mimeType
      );
    } else if (response.type === 'buttons') {
      sent = await channelAdapter.sendButtons(
        recipientTarget,
        formatRichText(response.text || ''),
        response.buttons || []
      );
    } else {
      sent = await channelAdapter.sendText(
        recipientTarget,
        formatRichText(response.text || '')
      );
    }

    const messageTarget = recipientTarget && typeof recipientTarget === 'object'
      ? recipientTarget
      : { phone: recipientTarget || null, bsuid: null };

    await saveConversationMessage({
      conversationId,
      direction: 'outbound',
      sender: 'bot',
      bsuid: messageTarget.bsuid || null,
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
        const escalationResponse = await escalateConversationFlow({
          tenantId,
          session,
          conversationId: conversation.id,
          lead,
          context,
          lastMessageText: incoming?.message_text || context.last_inbound_message || '',
          reason: 'No hay taller activo configurado para continuar el embudo',
          customerMessage: 'Ahora mismo no tengo un taller activo para ofrecerte. Daniel te escribirá personalmente.',
        });
        return {
          responses: [escalationResponse],
          nextNodeKey: null,
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
        const escalationResponse = await escalateConversationFlow({
          tenantId,
          session,
          conversationId: conversation.id,
          lead,
          context,
          lastMessageText: incoming?.message_text || context.last_inbound_message || '',
          reason: 'Falta un QR configurado para la inscripción del embudo',
          customerMessage: 'Registré tu interés, pero no hay un QR configurado para esta opción. Daniel te escribirá personalmente para cerrar la reserva.',
        });
        return {
          responses: [escalationResponse],
          nextNodeKey: null,
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
      const escalationResponse = await escalateConversationFlow({
        tenantId,
        session,
        conversationId: conversation.id,
        lead,
        context,
        lastMessageText: incoming?.message_text || context.last_inbound_message || '',
        reason: 'Escalación clínica o manual desde embudo',
        customerMessage: 'Perfecto. Daniel revisará tu caso personalmente y te contactará lo antes posible.',
      });

      return {
        responses: [escalationResponse],
        nextNodeKey: null,
        actionTaken: 'escalate',
      };
    }

    default:
      const escalationResponse = await escalateConversationFlow({
        tenantId,
        session,
        conversationId: conversation.id,
        lead,
        context,
        lastMessageText: incoming?.message_text || context.last_inbound_message || '',
        reason: `Acción de embudo desconocida: ${node.action_type || 'none'}`,
        customerMessage: 'Hubo un paso interno que no pude completar. Daniel continuará la conversación personalmente.',
      });
      return {
        responses: [escalationResponse],
        nextNodeKey: null,
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

  let lead = await getLeadById(tenant_id, lead_id || conversation.lead_id);
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
        tag_on_next: true,
      };
    }

    if (!startNode && contact?.label === 'nurture') {
      startNode = await getStartNode(tenant_id);
      initialContext = {
        contact_label: 'nurture',
        groq_context: 'Este contacto ya mostró interés anteriormente. Ser cálido y directo.',
        tag_on_next: true,
      };
    }

    if (!startNode && contact?.label === 'cold' && contact?._existing && contact?._previous_last_contact_at) {
      const daysSinceLast = (Date.now() - new Date(contact._previous_last_contact_at).getTime()) / (1000 * 60 * 60 * 24);
      if (daysSinceLast < 180) {
        startNode = await getStartNode(tenant_id);
        initialContext = {
          contact_label: 'cold_returning',
          groq_context: 'Este contacto ya preguntó antes sin comprar. Ser más directo, menos calentamiento.',
          tag_on_next: true,
        };
      }
    }

    if (!startNode) {
      startNode = await getStartNode(tenant_id);
      initialContext = { contact_label: contact?.label || 'new', tag_on_next: true };
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
  const capturedIdentity = getCapturedIdentity(rawContext, lead);
  let context = {
    ...rawContext,
    history: Array.isArray(rawContext.history) ? rawContext.history : [],
    pending_input_for: rawContext.pending_input_for || null,
    last_inbound_message: normalizeText(message_text),
    channel,
    captured_first_name: rawContext.captured_first_name || capturedIdentity.first_name || null,
    captured_last_name: rawContext.captured_last_name || capturedIdentity.last_name || null,
    captured_full_name: rawContext.captured_full_name || capturedIdentity.full_name || null,
    captured_phone: rawContext.captured_phone || capturedIdentity.phone || null,
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
      let renderedText = resolveMessageText(currentNode.message_text, context, workshop, lead, conversation);
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
      const promptText = resolveMessageText(currentNode.message_text, context, workshop, lead, conversation);
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

      const [tenant, workshop, rawRecentMessages, aiDocumentContext] = await Promise.all([
        getTenantById(tenant_id),
        getLatestWorkshop(tenant_id),
        getRecentLeadMessages(tenant_id, lead?.id, 4),
        getActiveAiDocumentsContext(tenant_id).catch((err) => {
          console.error('[FlowEngine] AI context docs error:', err.message);
          return '';
        }),
      ]);
      const normalizedCurrentMessage = normalizeInternalWhitespace(message_text);
      let recentMessages = rawRecentMessages;
      if (
        normalizedCurrentMessage
        && recentMessages.length > 0
        && recentMessages[recentMessages.length - 1]?.direction === 'inbound'
        && normalizeInternalWhitespace(recentMessages[recentMessages.length - 1]?.content) === normalizedCurrentMessage
      ) {
        recentMessages = recentMessages.slice(0, -1);
      }
      recentMessages = recentMessages.slice(-4);

      const aiReply = await runGroqChat({
        systemPrompt: buildAiSystemPrompt({
          node: currentNode,
          context,
          tenant,
          workshop,
          lead,
          conversation,
          aiDocumentContext,
        }),
        userPrompt: buildAiUserPrompt({
          lead,
          messageText: message_text,
          recentMessages,
        }),
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

    if (currentNode.type === 'capture_data') {
      const validation = validateCaptureInput(currentNode.capture_field, message_text);
      if (validation.error) {
        const workshop = await getLatestWorkshop(tenant_id);
        responses.push({
          type: 'text',
          text: validation.error,
          metadata: { flow_node_key: currentNode.node_key, flow_type: currentNode.type },
        });
        responses.push({
          type: 'text',
          text: resolveMessageText(currentNode.message_text, context, workshop, lead, conversation),
          metadata: { flow_node_key: currentNode.node_key, flow_type: currentNode.type },
        });
        context.pending_input_for = currentNode.node_key;
        await updateFlowSession(session.id, { context });
        await emitSessionUpdate(tenant_id, session.id);
        break;
      }

      context.pending_input_for = null;
      if (currentNode.capture_field === 'first_name') {
        context.captured_first_name = validation.value;
      }
      if (currentNode.capture_field === 'last_name') {
        context.captured_last_name = validation.value;
      }
      if (currentNode.capture_field === 'phone') {
        context.captured_phone = validation.value;
      }

      const persistedIdentity = await persistCapturedIdentity({
        tenantId: tenant_id,
        lead,
        contact,
        field: currentNode.capture_field,
        value: validation.value,
      });

      if (persistedIdentity?.first_name) context.captured_first_name = persistedIdentity.first_name;
      if (persistedIdentity?.last_name) context.captured_last_name = persistedIdentity.last_name;
      if (persistedIdentity?.phone) context.captured_phone = persistedIdentity.phone;

      context.captured_full_name = buildFullName(context.captured_first_name, context.captured_last_name) || null;
      if (context.captured_full_name && lead) {
        lead = {
          ...lead,
          name: context.captured_full_name,
          metadata: toJson({
            ...parseJson(lead.metadata, {}),
            identity_capture: {
              first_name: context.captured_first_name,
              last_name: context.captured_last_name,
              full_name: context.captured_full_name,
              phone: context.captured_phone || null,
            },
          }),
        };
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
          reason: `Nodo siguiente inexistente desde captura ${currentNode.node_key}: ${currentNode.next_node_key}`,
        });
        responses.push(fallback);
        actionTaken = 'missing_capture_node';
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
    session_id: session?.id || null,
    session_context: context,
    tag_analysis_pending: Boolean(context?.tag_on_next),
    responses,
  };
}

function buildPlaceholderMap(context = {}, workshop = null, lead = null, conversation = null) {
  const identity = getCapturedIdentity(context, lead);
  const amount = inferAmountFromContext(context) || workshop?.price || null;
  const canonicalFirstName = identity.first_name
    || normalizeInternalWhitespace((identity.full_name || '').split(' ')[0] || '')
    || 'amigo/a';

  return {
    FECHA: workshop ? formatBoliviaDate(workshop.date) : 'fecha por confirmar',
    VENUE: workshop?.venue_name || 'venue por confirmar',
    VENUE_DIRECCION: workshop?.venue_address || '',
    HORA_INICIO: workshop ? formatBoliviaTime(workshop.time_start) : 'hora por confirmar',
    HORA_FIN: workshop ? formatBoliviaTime(workshop.time_end) : 'hora por confirmar',
    TALLER: workshop?.name || '',
    PRECIO: formatMoneyBs(workshop?.price),
    PRECIO_NORMAL: formatMoneyBs(workshop?.price),
    PRECIO_EARLY_BIRD: formatMoneyBs(workshop?.early_bird_price),
    PRECIO_GRUPAL: formatMoneyBs(workshop?.group_price),
    NOMBRE: canonicalFirstName,
    NOMBRES: identity.first_name || '',
    APELLIDOS: identity.last_name || '',
    NOMBRE_COMPLETO: identity.full_name || lead?.name || '',
    CELULAR: identity.phone || '',
    TELEFONO: identity.phone || '',
    MODALIDAD: formatSelectedModality(context.selected_modality || inferModalityFromNode(conversation?.current_phase || '')),
    MONTO: formatMoneyBs(amount),
  };
}

function formatMessageWithWorkshop(messageText, workshop, context = {}, lead = null, conversation = null) {
  if (!messageText) return '';
  const placeholders = buildPlaceholderMap(context, workshop, lead, conversation);
  return String(messageText).replace(/\[([A-Z0-9_]+)\]/g, (match, key) => {
    if (!Object.prototype.hasOwnProperty.call(placeholders, key)) {
      return match;
    }
    return placeholders[key] ?? '';
  });
}

function resolveMessageText(messageText, context, workshop, lead = null, conversation = null) {
  return formatMessageWithWorkshop(messageText, workshop, context, lead, conversation);
}

function buildAiSystemPrompt({ node, context, tenant, workshop, lead, conversation, aiDocumentContext = '' }) {
  const sections = [];
  const globalContext = resolveMessageText(
    tenant?.llm_config?.global_open_question_context || '',
    context,
    workshop,
    lead,
    conversation
  ).trim();

  if (globalContext) {
    sections.push(globalContext);
  }

  if (context.groq_context) {
    sections.push(`Contexto adicional sobre este contacto:\n${context.groq_context}`);
  }

  if (aiDocumentContext) {
    sections.push(`Documentos activos para contexto de negocio:\n${aiDocumentContext}`);
  }

  const nodePrompt = resolveMessageText(
    node.ai_system_prompt || '',
    context,
    workshop,
    lead,
    conversation
  ).trim();

  sections.push(nodePrompt || 'Responde con empatía y brevedad en español.');
  return sections.join('\n\n');
}

function buildAiUserPrompt({ lead, messageText, recentMessages = [] }) {
  const historyBlock = buildRecentHistoryBlock(recentMessages);
  return [
    `Lead: ${lead?.name || 'Sin nombre'} (${lead?.phone || 'Sin teléfono'})`,
    historyBlock,
    `Mensaje actual del lead: ${normalizeText(messageText)}`,
    '',
    'Responde al mensaje actual siguiendo el contexto global y la instrucción específica de este nodo.',
  ].filter(Boolean).join('\n\n');
}

function shouldBufferIncomingText(incoming) {
  return incoming?.contentType === 'text' && Boolean(normalizeText(incoming.text));
}

function getDefaultTextBufferSettings() {
  return {
    text_buffer_idle_ms: DEFAULT_TEXT_BUFFER_IDLE_MS,
    text_buffer_max_messages: DEFAULT_TEXT_BUFFER_MAX_MESSAGES,
    text_buffer_max_window_ms: DEFAULT_TEXT_BUFFER_MAX_WINDOW_MS,
  };
}

function getTextBufferKey(tenantId, conversationId) {
  return `${tenantId}:${conversationId}`;
}

function clearBufferedText(key) {
  const existing = TEXT_BUFFER_BY_CONVERSATION.get(key);
  if (!existing) return;
  if (existing.timer) clearTimeout(existing.timer);
  TEXT_BUFFER_BY_CONVERSATION.delete(key);
}

function scheduleBufferedTextFlush(key) {
  const existing = TEXT_BUFFER_BY_CONVERSATION.get(key);
  if (!existing) return;
  if (existing.timer) clearTimeout(existing.timer);
  const idleMs = existing.settings?.text_buffer_idle_ms || DEFAULT_TEXT_BUFFER_IDLE_MS;
  existing.timer = setTimeout(() => {
    flushBufferedText(key).catch((err) => {
      console.error('[FlowEngine] Text buffer flush failed:', err.stack || err.message || err);
    });
  }, idleMs);
  existing.timer.unref?.();
}

async function processFlowAfterInboundPersist({
  tenantId,
  lead,
  conversation,
  incoming,
  channelAdapter,
  inboundMessageId,
  messageTextOverride = null,
}) {
  const effectiveText = messageTextOverride == null ? incoming.text : messageTextOverride;

  if (['image', 'document'].includes(incoming.contentType)) {
    const paymentSettings = await getPaymentSettings(tenantId).catch(() => null);
    if (paymentSettings?.payment_proof_debug_mode) {
      const diagnosticResponse = await runPaymentProofDiagnostic({
        tenantId,
        conversation,
        incoming: { ...incoming, channel: channelAdapter },
      }).catch((err) => {
        console.error('[FlowEngine] Payment proof diagnostic failed:', err.message);
        return {
          type: 'text',
          text: `Modo prueba de comprobantes: ocurrió un error interno.\n${err.message}`,
        };
      });

      if (diagnosticResponse) {
        await sendResponses(
          channelAdapter,
          incoming.replyTarget || incoming.senderId,
          conversation.id,
          tenantId,
          [diagnosticResponse]
        );
        return {
          lead,
          conversation,
          response_text: diagnosticResponse.text || '',
          buttons: [],
          action_taken: 'payment_proof_debug',
          session_id: null,
          session_context: null,
          tag_analysis_pending: false,
          responses: [diagnosticResponse],
        };
      }
    }
  }

  const result = await runFlowEngine({
    tenant_id: tenantId,
    conversation_id: conversation.id,
    lead_id: lead.id,
    message_text: effectiveText,
    channel: incoming.channel || channelAdapter.channelName,
    content_type: incoming.contentType,
    incoming: { ...incoming, text: effectiveText, channel: channelAdapter },
  });

  if (result.tag_analysis_pending && result.session_id && inboundMessageId) {
    const latestConversation = await getConversationById(tenantId, conversation.id);
    const latestLead = await getLeadById(tenantId, lead.id);
    const workshop = latestConversation?.workshop_id
      ? await getLatestWorkshop(tenantId)
      : null;

    await analyzeAndTagInboundMessage({
      tenantId,
      lead: latestLead || lead,
      conversation: latestConversation || conversation,
      workshop,
      messageId: inboundMessageId,
      messageText: effectiveText,
    }).catch((err) => {
      console.error('[FlowEngine] Tagging skipped:', err.message);
    });

    const nextContext = {
      ...(result.session_context || {}),
    };
    delete nextContext.tag_on_next;
    await updateFlowSession(result.session_id, { context: nextContext });
  }

  await recalculateLeadScore({
    tenantId,
    leadId: lead.id,
  }).catch((err) => {
    console.error('[FlowEngine] Scoring skipped:', err.message);
  });

  if (Array.isArray(result.responses) && result.responses.length > 0) {
    await sendResponses(
      channelAdapter,
      incoming.replyTarget || incoming.senderId,
      conversation.id,
      tenantId,
      result.responses
    );
  }

  return {
    lead,
    conversation,
    ...result,
  };
}

async function flushBufferedText(key, { force = false } = {}) {
  const entry = TEXT_BUFFER_BY_CONVERSATION.get(key);
  if (!entry) return null;

  const now = Date.now();
  const idleMs = now - entry.lastAt;
  const ageMs = now - entry.firstAt;
  const bufferIdleMs = entry.settings?.text_buffer_idle_ms || DEFAULT_TEXT_BUFFER_IDLE_MS;
  const maxMessages = entry.settings?.text_buffer_max_messages || DEFAULT_TEXT_BUFFER_MAX_MESSAGES;
  const maxWindowMs = entry.settings?.text_buffer_max_window_ms || DEFAULT_TEXT_BUFFER_MAX_WINDOW_MS;
  const reachedLimit = entry.messages.length >= maxMessages || ageMs >= maxWindowMs;

  if (!force && !reachedLimit && idleMs < bufferIdleMs) {
    scheduleBufferedTextFlush(key);
    return null;
  }

  clearBufferedText(key);
  const aggregatedText = entry.messages
    .map((item) => normalizeText(item))
    .filter(Boolean)
    .join(TEXT_BUFFER_SEPARATOR);

  if (!aggregatedText) {
    return {
      lead: entry.lead,
      conversation: entry.conversation,
      response_text: '',
      buttons: [],
      action_taken: 'text_buffer_empty',
      responses: [],
    };
  }

  return processFlowAfterInboundPersist({
    tenantId: entry.tenantId,
    lead: entry.lead,
    conversation: entry.conversation,
    incoming: {
      ...entry.incoming,
      text: aggregatedText,
      contentType: 'text',
    },
    channelAdapter: entry.channelAdapter,
    inboundMessageId: entry.lastInboundMessageId,
    messageTextOverride: aggregatedText,
  });
}

async function bufferIncomingText({
  tenantId,
  lead,
  conversation,
  incoming,
  channelAdapter,
  inboundMessageId,
  settings = null,
}) {
  const key = getTextBufferKey(tenantId, conversation.id);
  const now = Date.now();
  const text = normalizeText(incoming.text);
  const existing = TEXT_BUFFER_BY_CONVERSATION.get(key);
  const nextSettings = normalizeTextBufferSettings(settings || getDefaultTextBufferSettings());

  if (existing) {
    existing.messages.push(text);
    existing.lastAt = now;
    existing.channelAdapter = channelAdapter;
    existing.settings = nextSettings;
    existing.incoming = {
      ...existing.incoming,
      ...incoming,
      text,
    };
    existing.lastInboundMessageId = inboundMessageId;
    existing.lead = lead;
    existing.conversation = conversation;
  } else {
    TEXT_BUFFER_BY_CONVERSATION.set(key, {
      tenantId,
      lead,
      conversation,
      incoming: {
        ...incoming,
        text,
      },
      channelAdapter,
      settings: nextSettings,
      messages: [text],
      firstAt: now,
      lastAt: now,
      lastInboundMessageId: inboundMessageId,
      timer: null,
    });
  }

  const entry = TEXT_BUFFER_BY_CONVERSATION.get(key);
  const maxMessages = entry.settings?.text_buffer_max_messages || DEFAULT_TEXT_BUFFER_MAX_MESSAGES;
  const maxWindowMs = entry.settings?.text_buffer_max_window_ms || DEFAULT_TEXT_BUFFER_MAX_WINDOW_MS;
  const reachedLimit = entry.messages.length >= maxMessages || now - entry.firstAt >= maxWindowMs;
  if (reachedLimit) {
    return flushBufferedText(key, { force: true });
  }

  scheduleBufferedTextFlush(key);
  return {
    lead,
    conversation,
    response_text: '',
    buttons: [],
    action_taken: 'text_buffer_waiting',
    session_id: null,
    session_context: null,
    tag_analysis_pending: false,
    responses: [],
  };
}

function getTelegramAdapterForFlow() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    throw new Error('TELEGRAM_BOT_TOKEN no configurado');
  }
  return new TelegramAdapter(token);
}

async function getChannelAdapterForFlow(channel, tenantId) {
  if (channel === 'telegram') {
    return getTelegramAdapterForFlow();
  }
  if (channel === 'whatsapp') {
    return WhatsAppAdapter.forTenant(tenantId);
  }
  throw new Error('Canal no soportado');
}

async function getReplyTargetForConversation(tenantId, conversation) {
  if (conversation.channel === 'whatsapp') {
    const target = await getMessageTarget(tenantId, conversation.lead_id).catch(() => null);
    if (target?.phone || target?.bsuid) {
      return target;
    }
    if (conversation.lead_phone || conversation.bsuid) {
      return {
        phone: conversation.lead_phone || null,
        bsuid: conversation.bsuid || null,
        preferPhone: Boolean(conversation.lead_phone),
      };
    }
    throw new Error('No hay target de WhatsApp disponible para esta conversación');
  }

  if (!conversation.lead_phone) {
    throw new Error('No hay target disponible para esta conversación');
  }

  return conversation.lead_phone;
}

async function resolveResumeNode({ tenantId, session, requestedNodeKey = null }) {
  if (requestedNodeKey) {
    const requestedNode = await getFlowNodeByKey(tenantId, requestedNodeKey);
    if (!requestedNode) {
      throw new Error('El nodo elegido para reanudar no existe o está inactivo');
    }
    return requestedNode;
  }

  const currentNode = session?.current_node_key
    ? await getFlowNodeByKey(tenantId, session.current_node_key)
    : null;

  if (currentNode && !(currentNode.type === 'action' && currentNode.action_type === 'escalate')) {
    return currentNode;
  }

  const history = Array.isArray(parseJson(session?.context, {}).history)
    ? parseJson(session.context, {}).history
    : [];

  for (let index = history.length - 1; index >= 0; index -= 1) {
    const nodeKey = history[index]?.node_key;
    if (!nodeKey) continue;
    const candidate = await getFlowNodeByKey(tenantId, nodeKey);
    if (candidate && !(candidate.type === 'action' && candidate.action_type === 'escalate')) {
      return candidate;
    }
  }

  const startNode = await getStartNode(tenantId);
  if (!startNode) {
    throw new Error('No existe un nodo inicial activo para reanudar el bot');
  }
  return startNode;
}

async function stopConversationBot({
  tenantId,
  conversationId,
  actor = 'admin',
  reason = 'Bot detenido manualmente desde Comandos',
}) {
  const conversation = await getConversationById(tenantId, conversationId);
  if (!conversation) {
    throw new Error('Conversación no encontrada');
  }

  const session = await getActiveFlowSession(tenantId, conversationId);
  if (session) {
    const context = parseJson(session.context, {});
    context.pending_input_for = null;
    context.stopped_at = new Date().toISOString();
    context.stopped_by = actor;
    await updateFlowSession(session.id, {
      status: 'escalated',
      context,
    });
    await emitSessionUpdate(tenantId, session.id);
  }

  await query(
    `UPDATE conversations
     SET status = 'escalated',
         inbox_state = 'open',
         assigned_to = ?,
         escalated_at = COALESCE(escalated_at, NOW()),
         escalation_reason = ?
     WHERE tenant_id = ? AND id = ?`,
    [actor, reason, tenantId, conversationId]
  );
  broadcast('conversation:change', { id: conversationId, reason: 'manual-stop-bot' }, tenantId);

  return {
    conversation_id: conversationId,
    session_id: session?.id || null,
    status: 'escalated',
    assigned_to: actor,
  };
}

async function resumeConversationBot({ tenantId, conversationId, nodeKey = null, actor = 'admin' }) {
  const conversation = await getConversationById(tenantId, conversationId);
  if (!conversation) {
    throw new Error('Conversación no encontrada');
  }

  const lead = await getLeadById(tenantId, conversation.lead_id);
  let session = await getLatestFlowSession(tenantId, conversation.id);
  const resumeNode = await resolveResumeNode({ tenantId, session, requestedNodeKey: nodeKey });

  const baseContext = parseJson(session?.context, {});
  const history = Array.isArray(baseContext.history) ? baseContext.history : [];
  const nextContext = {
    ...baseContext,
    pending_input_for: null,
    last_error: null,
    tag_on_next: false,
    resumed_at: new Date().toISOString(),
    resumed_by: actor,
    history: history.length > 0 ? history : [buildHistoryEntry(resumeNode)],
  };

  if (nextContext.history[nextContext.history.length - 1]?.node_key !== resumeNode.node_key) {
    nextContext.history = [...nextContext.history, buildHistoryEntry(resumeNode)];
  }

  await query(
    `UPDATE flow_sessions
     SET status = 'abandoned'
     WHERE tenant_id = ? AND conversation_id = ? AND status = 'active'${session?.id ? ' AND id <> ?' : ''}`,
    session?.id ? [tenantId, conversation.id, session.id] : [tenantId, conversation.id]
  ).catch(() => {});

  if (session) {
    await updateFlowSession(session.id, {
      current_node_key: resumeNode.node_key,
      context: nextContext,
      status: 'active',
    });
    session.current_node_key = resumeNode.node_key;
    session.context = toJson(nextContext);
    session.status = 'active';
  } else {
    session = await createFlowSession({
      tenantId,
      conversationId: conversation.id,
      leadId: lead?.id || conversation.lead_id,
      startNode: resumeNode,
      context: nextContext,
    });
  }

  await setConversationBotActive(tenantId, conversation.id, resumeNode.node_key);
  await emitSessionUpdate(tenantId, session.id);

  const channelAdapter = await getChannelAdapterForFlow(conversation.channel, tenantId);
  const replyTarget = await getReplyTargetForConversation(tenantId, conversation);
  const result = await runFlowEngine({
    tenant_id: tenantId,
    conversation_id: conversation.id,
    lead_id: lead?.id || conversation.lead_id,
    message_text: '',
    channel: conversation.channel,
    content_type: 'system',
    incoming: {
      senderId: null,
      senderName: null,
      text: '',
      contentType: 'system',
      replyTarget,
      metadataSource: 'manual-resume',
    },
  });

  if (result.tag_analysis_pending && result.session_id) {
    const nextContext = {
      ...(result.session_context || {}),
    };
    delete nextContext.tag_on_next;
    await updateFlowSession(result.session_id, { context: nextContext });
  }

  if (Array.isArray(result.responses) && result.responses.length > 0) {
    await sendResponses(
      channelAdapter,
      replyTarget,
      conversation.id,
      tenantId,
      result.responses
    );
  }

  return {
    session_id: session.id,
    resumed_node_key: resumeNode.node_key,
    resumed_node_name: resumeNode.name,
    action_taken: result.action_taken || 'manual-resume',
    responses_sent: result.responses?.length || 0,
  };
}

async function processIncomingMessage({ tenantId, incoming, channelAdapter }) {
  let identity = incoming.identity || null;
  if ((incoming.channel || channelAdapter.channelName) === 'whatsapp' && (!identity || (!identity.id && (identity.phone || identity.bsuid)))) {
    identity = await resolveIdentity({
      tenantId,
      phone: identity?.phone || incoming.replyTarget?.phone || incoming.senderId || null,
      bsuid: identity?.bsuid || incoming.replyTarget?.bsuid || null,
      parentBsuid: identity?.parent_bsuid || identity?.parentBsuid || null,
      username: identity?.username || null,
      displayName: incoming.senderName || null,
    });
  }

  const lead = await createOrUpdateLeadForInbound({
    tenantId,
    channel: incoming.channel || channelAdapter.channelName,
    senderId: incoming.senderId,
    senderName: incoming.senderName,
    firstMessage: incoming.text,
    identity,
  });

  const conversation = await ensureConversationForLead({
    tenantId,
    leadId: lead.id,
    channel: incoming.channel || channelAdapter.channelName,
    bsuid: identity?.bsuid || incoming.replyTarget?.bsuid || null,
  });

  const inboundMessageId = await saveConversationMessage({
    conversationId: conversation.id,
    direction: 'inbound',
    sender: incoming.senderId,
    bsuid: identity?.bsuid || incoming.replyTarget?.bsuid || null,
    content: incoming.text,
    messageId: incoming.messageId,
    contentType: incoming.contentType,
    metadata: {
      source: incoming.metadataSource || `${incoming.channel || channelAdapter.channelName}-webhook`,
      whatsapp_identity: identity?.bsuid ? {
        bsuid: identity.bsuid,
        parent_bsuid: identity.parent_bsuid || null,
        username: identity.username || null,
      } : null,
    },
  });

  await query(
    `UPDATE leads
     SET last_contact_at = NOW(),
         name = COALESCE(name, ?),
         phone = COALESCE(phone, ?)
     WHERE tenant_id = ? AND id = ?`,
    [incoming.senderName || null, identity?.phone || null, tenantId, lead.id]
  );

  await query(
    `UPDATE conversations
     SET last_message_at = NOW(),
         bsuid = COALESCE(?, bsuid),
         human_messages_count = human_messages_count + 1,
         inbox_state = 'open'
     WHERE tenant_id = ? AND id = ?`,
    [identity?.bsuid || incoming.replyTarget?.bsuid || null, tenantId, conversation.id]
  );

  broadcast('lead:change', { id: lead.id, reason: 'inbound-message' }, tenantId);
  broadcast('conversation:change', { id: conversation.id, reason: 'inbound-message' }, tenantId);
  broadcast('message:change', { conversationId: conversation.id, messageId: inboundMessageId, direction: 'inbound' }, tenantId);

  const bufferKey = getTextBufferKey(tenantId, conversation.id);
  const llmSettings = await getLlmSettings(tenantId).catch(() => null);
  const textBufferSettings = normalizeTextBufferSettings(llmSettings || getDefaultTextBufferSettings());
  if (!shouldBufferIncomingText(incoming)) {
    clearBufferedText(bufferKey);
  }

  if (shouldBufferIncomingText(incoming)) {
    return bufferIncomingText({
      tenantId,
      lead,
      conversation,
      incoming,
      channelAdapter,
      inboundMessageId,
      settings: textBufferSettings,
    });
  }

  return processFlowAfterInboundPersist({
    tenantId,
    lead,
    conversation,
    incoming,
    channelAdapter,
    inboundMessageId,
  });
}

module.exports = {
  processIncomingMessage,
  runFlowEngine,
  formatMessageWithWorkshop,
  getCurrentNodeEnteredAt,
  resumeConversationBot,
  stopConversationBot,
};
