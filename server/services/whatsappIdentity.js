const { query, withTransaction } = require('../db');

function parseJson(value, fallback = {}) {
  if (!value) return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function normalizePhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits || null;
}

function normalizeBsuid(value) {
  const normalized = String(value || '').trim();
  return normalized || null;
}

function normalizeUsername(value) {
  const normalized = String(value || '').trim();
  return normalized || null;
}

function firstDefined(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== '') {
      return value;
    }
  }
  return null;
}

function mergeArrays(left, right) {
  const merged = [...(Array.isArray(left) ? left : []), ...(Array.isArray(right) ? right : [])];
  return merged.length ? [...new Set(merged)] : null;
}

function scoreLead(row, incomingPhone) {
  if (!row) return -1;
  let score = 0;
  if (incomingPhone && row.phone === incomingPhone) score += 100;
  if (row.phone) score += 40;
  if (row.status === 'converted') score += 20;
  if (row.agenda_client_id) score += 10;
  if (row.contact_id) score += 5;
  score += Math.min(Number(row.quality_score || 0), 10);
  score -= Number(row.id || 0) / 1000000;
  return score;
}

function chooseLeadToKeep(left, right, incomingPhone) {
  if (!left) return right || null;
  if (!right) return left;
  return scoreLead(left, incomingPhone) >= scoreLead(right, incomingPhone) ? left : right;
}

function chooseBestStatus(left, right) {
  const rank = {
    new: 0,
    qualifying: 1,
    qualified: 2,
    negotiating: 3,
    dormant: 1,
    lost: 1,
    converted: 4,
  };
  return (rank[left] ?? -1) >= (rank[right] ?? -1) ? left : right;
}

function mergeLeadMetadata(primaryLead, secondaryLead) {
  const primary = parseJson(primaryLead?.metadata, {});
  const secondary = parseJson(secondaryLead?.metadata, {});
  return {
    ...secondary,
    ...primary,
    tags: mergeArrays(primary.tags, secondary.tags) || primary.tags || secondary.tags,
  };
}

function chooseWhatsappRowToKeep(left, right, { phone, bsuid }) {
  const score = (row) => {
    if (!row) return -1;
    let value = 0;
    if (bsuid && row.bsuid === bsuid) value += 50;
    if (phone && row.phone === phone) value += 40;
    if (row.client_id) value += 20;
    if (row.username) value += 5;
    value -= Number(row.id || 0) / 1000000;
    return value;
  };

  if (score(left) >= score(right)) {
    return { keep: left, drop: right };
  }
  return { keep: right, drop: left };
}

function extractIdentity(msg = {}, value = {}) {
  const contacts = Array.isArray(value.contacts) ? value.contacts : [];
  const normalizedFrom = normalizePhone(msg.from || msg.wa_id);
  const contact = contacts.find((item) => normalizePhone(item?.wa_id) === normalizedFrom) || contacts[0] || {};

  return {
    phone: normalizePhone(
      msg.from ||
      msg.wa_id ||
      contact.wa_id ||
      value.from ||
      value.wa_id
    ),
    bsuid: normalizeBsuid(
      msg.from_user_id ||
      msg.user_id ||
      contact.user_id ||
      value.user_id
    ),
    parentBsuid: normalizeBsuid(
      msg.from_parent_user_id ||
      msg.parent_user_id ||
      contact.parent_user_id ||
      value.parent_user_id
    ),
    username: normalizeUsername(
      contact.profile?.username ||
      msg.username ||
      value.profile?.username ||
      value.username
    ),
  };
}

function extractStatusIdentity(statusItem = {}) {
  return {
    phone: normalizePhone(
      statusItem.recipient_id ||
      statusItem.to ||
      statusItem.wa_id
    ),
    bsuid: normalizeBsuid(
      statusItem.recipient_user_id ||
      statusItem.to_user_id ||
      statusItem.user_id
    ),
    parentBsuid: normalizeBsuid(
      statusItem.recipient_parent_user_id ||
      statusItem.to_parent_user_id ||
      statusItem.parent_user_id
    ),
    username: null,
  };
}

async function getLeadByIdForUpdate(conn, tenantId, leadId) {
  if (!leadId) return null;
  const [rows] = await conn.execute(
    'SELECT * FROM leads WHERE tenant_id = ? AND id = ? LIMIT 1 FOR UPDATE',
    [tenantId, leadId]
  );
  return rows[0] || null;
}

async function getLeadByPhoneForUpdate(conn, tenantId, phone) {
  if (!phone) return null;
  const [rows] = await conn.execute(
    'SELECT * FROM leads WHERE tenant_id = ? AND phone = ? LIMIT 1 FOR UPDATE',
    [tenantId, phone]
  );
  return rows[0] || null;
}

async function getWhatsappUserByFieldForUpdate(conn, tenantId, field, value) {
  if (!value) return null;
  const [rows] = await conn.execute(
    `SELECT * FROM whatsapp_users WHERE tenant_id = ? AND ${field} = ? LIMIT 1 FOR UPDATE`,
    [tenantId, value]
  );
  return rows[0] || null;
}

async function mergeLeadRecords(conn, {
  tenantId,
  primaryLeadId,
  secondaryLeadId,
  incomingPhone = null,
  displayName = null,
}) {
  if (!primaryLeadId && !secondaryLeadId) return null;
  if (!primaryLeadId || !secondaryLeadId || primaryLeadId === secondaryLeadId) {
    return primaryLeadId || secondaryLeadId || null;
  }

  const primaryLead = await getLeadByIdForUpdate(conn, tenantId, primaryLeadId);
  const secondaryLead = await getLeadByIdForUpdate(conn, tenantId, secondaryLeadId);
  if (!primaryLead || !secondaryLead) {
    return primaryLead?.id || secondaryLead?.id || null;
  }

  const keepLead = chooseLeadToKeep(primaryLead, secondaryLead, incomingPhone);
  const dropLead = keepLead.id === primaryLead.id ? secondaryLead : primaryLead;
  const mergedPhone = firstDefined(incomingPhone, keepLead.phone, dropLead.phone);
  const mergedTags = mergeArrays(parseJson(keepLead.tags, []), parseJson(dropLead.tags, []));
  const mergedNotes = [keepLead.notes, dropLead.notes].filter(Boolean).join('\n\n').trim() || null;
  const mergedMetadata = mergeLeadMetadata(keepLead, dropLead);
  const firstContactAt = [keepLead.first_contact_at, dropLead.first_contact_at]
    .filter(Boolean)
    .sort((left, right) => new Date(left).getTime() - new Date(right).getTime())[0] || null;
  const lastContactAt = [keepLead.last_contact_at, dropLead.last_contact_at]
    .filter(Boolean)
    .sort((left, right) => new Date(right).getTime() - new Date(left).getTime())[0] || null;
  const convertedAt = firstDefined(keepLead.converted_at, dropLead.converted_at);

  await conn.execute(
    `DELETE e1 FROM enrollments e1
     INNER JOIN enrollments e2
       ON e2.tenant_id = e1.tenant_id
      AND e2.workshop_id = e1.workshop_id
      AND e2.lead_id = ?
     WHERE e1.tenant_id = ? AND e1.lead_id = ?`,
    [keepLead.id, tenantId, dropLead.id]
  );

  await conn.execute(
    'UPDATE leads SET phone = NULL WHERE tenant_id = ? AND id = ?',
    [tenantId, dropLead.id]
  );

  await conn.execute(
    `UPDATE leads
     SET phone = ?,
         name = ?,
         city = ?,
         source = ?,
         source_detail = ?,
         status = ?,
         quality_score = ?,
         lifetime_value = ?,
         workshops_attended = ?,
         referred_by_lead_id = ?,
         tags = ?,
         notes = ?,
         metadata = ?,
         agenda_client_id = ?,
         contact_id = ?,
         first_contact_at = COALESCE(?, first_contact_at),
         last_contact_at = COALESCE(?, last_contact_at),
         converted_at = COALESCE(?, converted_at),
         deleted_at = NULL
     WHERE tenant_id = ? AND id = ?`,
    [
      mergedPhone,
      firstDefined(keepLead.name, dropLead.name, displayName),
      firstDefined(keepLead.city, dropLead.city),
      firstDefined(keepLead.source, dropLead.source),
      firstDefined(keepLead.source_detail, dropLead.source_detail),
      chooseBestStatus(keepLead.status, dropLead.status),
      Math.max(Number(keepLead.quality_score || 0), Number(dropLead.quality_score || 0)),
      Math.max(Number(keepLead.lifetime_value || 0), Number(dropLead.lifetime_value || 0)),
      Math.max(Number(keepLead.workshops_attended || 0), Number(dropLead.workshops_attended || 0)),
      firstDefined(keepLead.referred_by_lead_id, dropLead.referred_by_lead_id),
      mergedTags ? JSON.stringify(mergedTags) : null,
      mergedNotes,
      JSON.stringify(mergedMetadata),
      firstDefined(keepLead.agenda_client_id, dropLead.agenda_client_id),
      firstDefined(keepLead.contact_id, dropLead.contact_id),
      firstContactAt,
      lastContactAt,
      convertedAt,
      tenantId,
      keepLead.id,
    ]
  );

  await conn.execute('UPDATE conversations SET lead_id = ? WHERE tenant_id = ? AND lead_id = ?', [keepLead.id, tenantId, dropLead.id]);
  await conn.execute('UPDATE flow_sessions SET lead_id = ? WHERE tenant_id = ? AND lead_id = ?', [keepLead.id, tenantId, dropLead.id]);
  await conn.execute('UPDATE enrollments SET lead_id = ? WHERE tenant_id = ? AND lead_id = ?', [keepLead.id, tenantId, dropLead.id]);
  await conn.execute('UPDATE transactions SET lead_id = ? WHERE tenant_id = ? AND lead_id = ?', [keepLead.id, tenantId, dropLead.id]);
  await conn.execute('UPDATE followup_queue SET lead_id = ? WHERE tenant_id = ? AND lead_id = ?', [keepLead.id, tenantId, dropLead.id]);
  await conn.execute("UPDATE tags SET target_id = ? WHERE tenant_id = ? AND target_type = 'lead' AND target_id = ?", [keepLead.id, tenantId, dropLead.id]);
  await conn.execute('UPDATE leads SET referred_by_lead_id = ? WHERE tenant_id = ? AND referred_by_lead_id = ?', [keepLead.id, tenantId, dropLead.id]);
  await conn.execute('UPDATE whatsapp_users SET client_id = ? WHERE tenant_id = ? AND client_id = ?', [keepLead.id, tenantId, dropLead.id]);

  const tombstoneMetadata = {
    ...parseJson(dropLead.metadata, {}),
    merged_into_lead_id: keepLead.id,
    merged_at: new Date().toISOString(),
  };

  await conn.execute(
    `UPDATE leads
     SET deleted_at = NOW(),
         metadata = ?,
         notes = ?,
         status = 'dormant'
     WHERE tenant_id = ? AND id = ?`,
    [
      JSON.stringify(tombstoneMetadata),
      [dropLead.notes, `Merged into lead ${keepLead.id}`].filter(Boolean).join('\n\n'),
      tenantId,
      dropLead.id,
    ]
  );

  return keepLead.id;
}

async function updateWhatsappUser(conn, tenantId, rowId, patch) {
  await conn.execute(
    `UPDATE whatsapp_users
     SET bsuid = COALESCE(?, bsuid),
         parent_bsuid = COALESCE(?, parent_bsuid),
         phone = COALESCE(?, phone),
         username = COALESCE(?, username),
         client_id = COALESCE(?, client_id),
         source_waba_id = COALESCE(?, source_waba_id),
         source_phone_number_id = COALESCE(?, source_phone_number_id),
         first_seen_at = COALESCE(first_seen_at, NOW()),
         last_seen_at = NOW()
     WHERE tenant_id = ? AND id = ?`,
    [
      patch.bsuid || null,
      patch.parentBsuid || null,
      patch.phone || null,
      patch.username || null,
      patch.clientId || null,
      patch.sourceWabaId || null,
      patch.sourcePhoneNumberId || null,
      tenantId,
      rowId,
    ]
  );
}

async function getWhatsappUserById(conn, tenantId, rowId) {
  const [rows] = await conn.execute(
    'SELECT * FROM whatsapp_users WHERE tenant_id = ? AND id = ? LIMIT 1',
    [tenantId, rowId]
  );
  return rows[0] || null;
}

async function resolveIdentity({
  tenantId,
  phone,
  bsuid,
  parentBsuid = null,
  username = null,
  clientId = null,
  displayName = null,
  sourceWabaId = null,
  sourcePhoneNumberId = null,
}) {
  const normalizedPhone = normalizePhone(phone);
  const normalizedBsuid = normalizeBsuid(bsuid);
  const normalizedParentBsuid = normalizeBsuid(parentBsuid);
  const normalizedUsername = normalizeUsername(username);

  if (!tenantId) {
    throw new Error('tenantId es requerido para resolveIdentity');
  }

  if (!normalizedPhone && !normalizedBsuid) {
    return null;
  }

  return withTransaction(async (conn) => {
    const rowByBsuid = await getWhatsappUserByFieldForUpdate(conn, tenantId, 'bsuid', normalizedBsuid);
    const rowByPhone = await getWhatsappUserByFieldForUpdate(conn, tenantId, 'phone', normalizedPhone);

    let mergedClientId = clientId || null;
    const clientCandidates = new Set();

    for (const candidate of [clientId, rowByBsuid?.client_id, rowByPhone?.client_id]) {
      if (candidate) clientCandidates.add(Number(candidate));
    }

    const leadByPhone = await getLeadByPhoneForUpdate(conn, tenantId, normalizedPhone);
    if (leadByPhone?.id) {
      clientCandidates.add(Number(leadByPhone.id));
    }

    const clientIds = [...clientCandidates];
    if (clientIds.length > 1) {
      mergedClientId = clientIds[0];
      for (let index = 1; index < clientIds.length; index += 1) {
        mergedClientId = await mergeLeadRecords(conn, {
          tenantId,
          primaryLeadId: mergedClientId,
          secondaryLeadId: clientIds[index],
          incomingPhone: normalizedPhone,
          displayName,
        });
      }
    } else {
      mergedClientId = clientIds[0] || null;
    }

    if (rowByBsuid && rowByPhone && rowByBsuid.id !== rowByPhone.id) {
      const { keep, drop } = chooseWhatsappRowToKeep(rowByBsuid, rowByPhone, {
        phone: normalizedPhone,
        bsuid: normalizedBsuid,
      });

      const mergedRow = {
        bsuid: firstDefined(normalizedBsuid, keep.bsuid, drop.bsuid),
        parentBsuid: firstDefined(normalizedParentBsuid, keep.parent_bsuid, drop.parent_bsuid),
        phone: firstDefined(normalizedPhone, keep.phone, drop.phone),
        username: firstDefined(normalizedUsername, keep.username, drop.username),
        clientId: firstDefined(mergedClientId, keep.client_id, drop.client_id),
        sourceWabaId: firstDefined(sourceWabaId, keep.source_waba_id, drop.source_waba_id),
        sourcePhoneNumberId: firstDefined(sourcePhoneNumberId, keep.source_phone_number_id, drop.source_phone_number_id),
      };

      await conn.execute('DELETE FROM whatsapp_users WHERE tenant_id = ? AND id = ?', [tenantId, drop.id]);
      await updateWhatsappUser(conn, tenantId, keep.id, mergedRow);
      return getWhatsappUserById(conn, tenantId, keep.id);
    }

    const existing = rowByBsuid || rowByPhone;
    if (existing) {
      await updateWhatsappUser(conn, tenantId, existing.id, {
        bsuid: normalizedBsuid,
        parentBsuid: normalizedParentBsuid,
        phone: normalizedPhone,
        username: normalizedUsername,
        clientId: mergedClientId,
        sourceWabaId,
        sourcePhoneNumberId,
      });
      return getWhatsappUserById(conn, tenantId, existing.id);
    }

    const [result] = await conn.execute(
      `INSERT INTO whatsapp_users (
         tenant_id, bsuid, parent_bsuid, phone, username, client_id,
         source_waba_id, source_phone_number_id, first_seen_at, last_seen_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
      [
        tenantId,
        normalizedBsuid,
        normalizedParentBsuid,
        normalizedPhone,
        normalizedUsername,
        mergedClientId,
        sourceWabaId || null,
        sourcePhoneNumberId || null,
      ]
    );

    return getWhatsappUserById(conn, tenantId, result.insertId);
  });
}

async function getMessageTarget(tenantId, clientId) {
  if (!tenantId || !clientId) return null;

  const rows = await query(
    `SELECT phone, bsuid
     FROM whatsapp_users
     WHERE tenant_id = ? AND client_id = ?
     ORDER BY CASE WHEN phone IS NULL OR phone = '' THEN 1 ELSE 0 END ASC,
              last_seen_at DESC, id DESC
     LIMIT 1`,
    [tenantId, clientId]
  );

  if (rows[0]) {
    return {
      phone: normalizePhone(rows[0].phone),
      bsuid: normalizeBsuid(rows[0].bsuid),
      preferPhone: Boolean(rows[0].phone),
    };
  }

  const leads = await query(
    'SELECT phone FROM leads WHERE tenant_id = ? AND id = ? LIMIT 1',
    [tenantId, clientId]
  );

  return {
    phone: normalizePhone(leads[0]?.phone),
    bsuid: null,
    preferPhone: Boolean(leads[0]?.phone),
  };
}

async function resolveClientByBsuid(tenantId, bsuid) {
  const normalizedBsuid = normalizeBsuid(bsuid);
  if (!tenantId || !normalizedBsuid) return null;

  const rows = await query(
    'SELECT client_id FROM whatsapp_users WHERE tenant_id = ? AND bsuid = ? LIMIT 1',
    [tenantId, normalizedBsuid]
  );

  return rows[0]?.client_id || null;
}

module.exports = {
  normalizePhone,
  normalizeBsuid,
  normalizeUsername,
  extractIdentity,
  extractStatusIdentity,
  resolveIdentity,
  getMessageTarget,
  resolveClientByBsuid,
};
