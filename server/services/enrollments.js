const { query } = require('../db');
const TelegramAdapter = require('./channels/telegram');
const WhatsAppAdapter = require('./channels/whatsapp');
const { getActivePaymentOptions, getPaymentOptionBySlot, getPaymentQrAsset } = require('./paymentOptions');
const { broadcast } = require('./adminEvents');
const { getMessageTarget } = require('./whatsappIdentity');

function parseJson(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

async function getEnrollmentWithRelations(tenantId, enrollmentId) {
  const rows = await query(
    `SELECT e.id, e.tenant_id, e.workshop_id, e.lead_id, e.status, e.amount_paid, e.amount_due,
            e.payment_status, e.enrolled_at, e.confirmed_at, e.cancelled_at,
            e.payment_requested_at, e.verified_at, e.payment_proof_type, e.ocr_data, e.notes,
            l.name AS lead_name, l.phone AS lead_phone, l.status AS lead_status,
            w.name AS workshop_name, w.price AS workshop_price, w.early_bird_price,
            c.id AS conversation_id, c.channel, c.assigned_to, c.metadata AS conversation_metadata
     FROM enrollments e
     JOIN leads l ON l.id = e.lead_id
     JOIN workshops w ON w.id = e.workshop_id
     LEFT JOIN conversations c
       ON c.id = (
         SELECT c2.id
         FROM conversations c2
         WHERE c2.tenant_id = e.tenant_id
           AND c2.lead_id = e.lead_id
           AND (c2.workshop_id = e.workshop_id OR c2.workshop_id IS NULL)
         ORDER BY c2.started_at DESC
         LIMIT 1
       )
     WHERE e.tenant_id = ? AND e.id = ?
     LIMIT 1`,
    [tenantId, enrollmentId]
  );

  if (!rows[0]) return null;
  const enrollment = {
    ...rows[0],
    ocr_data: parseJson(rows[0].ocr_data),
    conversation_metadata: parseJson(rows[0].conversation_metadata),
  };
  enrollment.review_state = getReviewState(enrollment);
  enrollment.payment_proof_present = Boolean(rows[0].payment_proof_type);
  return enrollment;
}

function getReviewState(enrollment) {
  if (enrollment.payment_status === 'paid' || enrollment.status === 'confirmed') return 'confirmed';
  const problems = enrollment.ocr_data?.validation_problems;
  if (enrollment.payment_proof_type && Array.isArray(problems) && problems.length > 0) return 'mismatch';
  if (enrollment.payment_proof_type) return 'proof_received';
  return 'pending';
}

async function getEnrollmentProofAsset(tenantId, enrollmentId) {
  const rows = await query(
    `SELECT payment_proof, payment_proof_type
     FROM enrollments
     WHERE tenant_id = ? AND id = ?
     LIMIT 1`,
    [tenantId, enrollmentId]
  );
  if (!rows[0] || !rows[0].payment_proof) return null;
  return {
    data: rows[0].payment_proof,
    mime_type: rows[0].payment_proof_type || 'application/octet-stream',
  };
}

async function syncWorkshopParticipantCount(tenantId, workshopId) {
  const [stats] = await query(
    `SELECT COUNT(*) AS total
     FROM enrollments
     WHERE tenant_id = ? AND workshop_id = ? AND status IN ('confirmed', 'attended')`,
    [tenantId, workshopId]
  );

  await query(
    'UPDATE workshops SET current_participants = ? WHERE id = ? AND tenant_id = ?',
    [Number(stats?.total || 0), workshopId, tenantId]
  );
}

function getTelegramAdapter() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    throw new Error('TELEGRAM_BOT_TOKEN no configurado');
  }
  return new TelegramAdapter(token);
}

async function getMessagingContext(tenantId, enrollment) {
  if (enrollment.channel === 'whatsapp') {
    const adapter = await WhatsAppAdapter.forTenant(tenantId);
    const target = await getMessageTarget(tenantId, enrollment.lead_id);
    if (!target?.phone && !target?.bsuid) {
      throw new Error('No hay target de WhatsApp disponible para esta inscripción');
    }
    return { adapter, target };
  }

  return {
    adapter: getTelegramAdapter(),
    target: enrollment.lead_phone,
  };
}

async function resendPaymentInstructions(tenantId, enrollment) {
  const { adapter, target } = await getMessagingContext(tenantId, enrollment);
  const options = await getActivePaymentOptions(tenantId);

  if (!options.length) {
    await adapter.sendText(
      target,
      `Hola ${enrollment.lead_name || ''}. Aún no tengo opciones de cobro cargadas aquí. Daniel te enviará el cobro manualmente.`
    );
    return { mode: 'text' };
  }

  const text = options.length === 1
    ? `Hola ${enrollment.lead_name || ''}. Te reenvío la instrucción de pago para ${enrollment.workshop_name}.`
    : `Hola ${enrollment.lead_name || ''}. Te reenvío las opciones de pago para ${enrollment.workshop_name}. Elige la que corresponda:`;

  await adapter.sendButtons(
    target,
    text,
    options.map((option) => ({
      id: `payopt_${option.slot}`,
      label: `${option.label} · Bs ${option.amount}`,
    }))
  );

  return { mode: 'buttons' };
}

async function resendPaymentQr(tenantId, enrollment) {
  const { adapter, target } = await getMessagingContext(tenantId, enrollment);
  let slot = Number(enrollment.conversation_metadata?.payment_request?.slot || 0);

  if (!slot) {
    const options = await getActivePaymentOptions(tenantId);
    if (options.length === 1) {
      slot = options[0].slot;
    } else {
      throw new Error('No hay un QR previamente seleccionado para reenviar');
    }
  }

  const option = await getPaymentOptionBySlot(tenantId, slot);
  const asset = await getPaymentQrAsset(tenantId, slot);
  if (!option || !asset) {
    throw new Error('QR no disponible para reenviar');
  }

  await adapter.sendImage(
    target,
    asset.data,
    `QR de pago · ${option.label} · Bs ${option.amount}\nCuando hagas el pago, envíame aquí mismo el comprobante.`,
    asset.mime_type
  );

  if (enrollment.conversation_id) {
    const metadata = parseJson(enrollment.conversation_metadata);
    metadata.payment_request = {
      ...(metadata.payment_request || {}),
      slot: option.slot,
      label: option.label,
      amount: option.amount,
      workshop_id: enrollment.workshop_id,
      lead_id: enrollment.lead_id,
      sent_at: new Date().toISOString(),
    };

    await query(
      'UPDATE conversations SET metadata = ? WHERE id = ? AND tenant_id = ?',
      [JSON.stringify(metadata), enrollment.conversation_id, tenantId]
    );
  }

  await query(
    `UPDATE enrollments
     SET amount_due = ?, payment_status = 'unpaid', payment_requested_at = NOW()
     WHERE id = ? AND tenant_id = ?`,
    [option.amount, enrollment.id, tenantId]
  );

  return { slot: option.slot, amount: option.amount };
}

async function confirmEnrollmentPayment(tenantId, enrollmentId, amountOverride = null) {
  const enrollment = await getEnrollmentWithRelations(tenantId, enrollmentId);
  if (!enrollment) throw new Error('Inscripción no encontrada');

  const amount = amountOverride == null || amountOverride === ''
    ? Number(enrollment.amount_due || enrollment.amount_paid || enrollment.workshop_price || 0)
    : Number(amountOverride);
  if (!(amount > 0)) throw new Error('Monto inválido para confirmar');

  await query(
    `UPDATE enrollments
     SET payment_status = 'paid',
         amount_paid = ?,
         status = 'confirmed',
         confirmed_at = COALESCE(confirmed_at, NOW()),
         verified_at = NOW(),
         notes = NULL
     WHERE id = ? AND tenant_id = ?`,
    [amount, enrollmentId, tenantId]
  );

  const existingIncome = await query(
    `SELECT id
     FROM transactions
     WHERE tenant_id = ? AND type = 'income' AND lead_id = ? AND workshop_id = ?
     ORDER BY id DESC
     LIMIT 1`,
    [tenantId, enrollment.lead_id, enrollment.workshop_id]
  );

  if (existingIncome.length > 0) {
    await query(
      `UPDATE transactions
       SET amount = ?, verified = TRUE, verification_method = 'manual', description = ?
       WHERE id = ?`,
      [amount, `Pago confirmado manualmente · ${enrollment.workshop_name}`, existingIncome[0].id]
    );
  } else {
    await query(
      `INSERT INTO transactions (
         tenant_id, type, category, amount, currency, description, date,
         lead_id, workshop_id, verified, verification_method
       ) VALUES (?, 'income', 'taller', ?, 'BOB', ?, CURDATE(), ?, ?, TRUE, 'manual')`,
      [tenantId, amount, `Pago confirmado manualmente · ${enrollment.workshop_name}`, enrollment.lead_id, enrollment.workshop_id]
    );
  }

  await query(
    `UPDATE leads
     SET status = 'converted', converted_at = COALESCE(converted_at, NOW())
     WHERE id = ? AND tenant_id = ?`,
    [enrollment.lead_id, tenantId]
  );

  if (enrollment.conversation_id) {
    await query(
      `UPDATE conversations
       SET status = 'converted', converted_at = COALESCE(converted_at, NOW())
       WHERE id = ? AND tenant_id = ?`,
      [enrollment.conversation_id, tenantId]
    );
  }

  await syncWorkshopParticipantCount(tenantId, enrollment.workshop_id);
  broadcast('finance:change', { workshopId: enrollment.workshop_id, leadId: enrollment.lead_id, reason: 'manual-payment-confirmed' }, tenantId);
  broadcast('lead:change', { id: enrollment.lead_id, reason: 'converted' }, tenantId);
  if (enrollment.conversation_id) {
    broadcast('conversation:change', { id: enrollment.conversation_id, reason: 'converted' }, tenantId);
  }
  return getEnrollmentWithRelations(tenantId, enrollmentId);
}

async function rejectEnrollmentPayment(tenantId, enrollmentId, reason = '') {
  const enrollment = await getEnrollmentWithRelations(tenantId, enrollmentId);
  if (!enrollment) throw new Error('Inscripción no encontrada');

  const ocrData = parseJson(enrollment.ocr_data);
  const manualProblem = {
    type: 'mismatch_manual',
    reason: reason || 'Revisión manual',
    at: new Date().toISOString(),
  };

  ocrData.validation_problems = Array.isArray(ocrData.validation_problems)
    ? [...ocrData.validation_problems, manualProblem]
    : [manualProblem];

  await query(
    `UPDATE enrollments
     SET payment_status = 'unpaid',
         status = 'pending',
         notes = ?,
         ocr_data = ?
     WHERE id = ? AND tenant_id = ?`,
    [reason || 'Comprobante rechazado manualmente', JSON.stringify(ocrData), enrollmentId, tenantId]
  );

  await syncWorkshopParticipantCount(tenantId, enrollment.workshop_id);
  if (enrollment.conversation_id) {
    broadcast('conversation:change', { id: enrollment.conversation_id, reason: 'payment-rejected' }, tenantId);
  }
  return getEnrollmentWithRelations(tenantId, enrollmentId);
}

module.exports = {
  getEnrollmentWithRelations,
  getEnrollmentProofAsset,
  getReviewState,
  syncWorkshopParticipantCount,
  resendPaymentInstructions,
  resendPaymentQr,
  confirmEnrollmentPayment,
  rejectEnrollmentPayment,
};
