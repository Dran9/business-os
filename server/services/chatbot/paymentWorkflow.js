const { query } = require('../../db');
const { extractReceiptData } = require('../ocr');
const {
  getActivePaymentOptions,
  getPaymentOptionBySlot,
  getPaymentQrAsset,
  getPaymentSettings,
} = require('../paymentOptions');

function parseJson(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function sanitizeReceiptDate(value) {
  return value ? String(value).slice(0, 50) : null;
}

function sanitizeReceiptDestName(value) {
  return value ? String(value).slice(0, 255) : null;
}

function parseReceiptDateKey(value) {
  if (!value) return null;
  const text = String(value).trim().toLowerCase();
  const monthMap = {
    enero: '01', febrero: '02', marzo: '03', abril: '04', mayo: '05', junio: '06',
    julio: '07', agosto: '08', septiembre: '09', setiembre: '09', octubre: '10',
    noviembre: '11', diciembre: '12',
  };

  let match = text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (match) return `${match[3]}-${match[2]}-${match[1]}`;

  match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) return `${match[1]}-${match[2]}-${match[3]}`;

  match = text.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (match) return `${match[3]}-${match[2]}-${match[1]}`;

  match = text.match(/^(\d{1,2})\s+de\s+([a-záéíóú]+),?\s*(\d{4})$/i);
  if (match) {
    const month = monthMap[match[2]];
    if (!month) return null;
    return `${match[3]}-${month}-${String(match[1]).padStart(2, '0')}`;
  }

  return null;
}

function getBoliviaDateKey(dateValue) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/La_Paz',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = formatter.formatToParts(new Date(dateValue));
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;
  return year && month && day ? `${year}-${month}-${day}` : null;
}

function buildMismatchLines(problems) {
  return problems.map((problem) => {
    if (problem.type === 'destinatario') return 'El destinatario o cuenta destino no coincide con una cuenta válida.';
    if (problem.type === 'monto') return 'El monto del comprobante no coincide con el precio solicitado.';
    if (problem.type === 'fecha_pasada') return 'La fecha del comprobante es anterior al momento en que se envió el QR.';
    return 'No se pudo validar automáticamente el comprobante.';
  });
}

async function getOrCreateEnrollment({ tenantId, leadId, workshopId }) {
  if (!workshopId) return null;

  const existing = await query(
    `SELECT *
     FROM enrollments
     WHERE tenant_id = ? AND workshop_id = ? AND lead_id = ?
     LIMIT 1`,
    [tenantId, workshopId, leadId]
  );
  if (existing.length > 0) return existing[0];

  const workshopRows = await query(
    'SELECT price, early_bird_price FROM workshops WHERE id = ? AND tenant_id = ? LIMIT 1',
    [workshopId, tenantId]
  );
  const workshop = workshopRows[0];
  if (!workshop) return null;

  const result = await query(
    `INSERT INTO enrollments (tenant_id, workshop_id, lead_id, status, amount_due, payment_status)
     VALUES (?, ?, ?, 'pending', ?, 'unpaid')`,
    [tenantId, workshopId, leadId, workshop.early_bird_price || workshop.price || 0]
  );

  const rows = await query('SELECT * FROM enrollments WHERE id = ?', [result.insertId]);
  return rows[0] || null;
}

async function setConversationPaymentContext({ tenantId, conversationId, slot, label, amount, workshopId, leadId }) {
  const rows = await query(
    'SELECT metadata FROM conversations WHERE id = ? AND tenant_id = ? LIMIT 1',
    [conversationId, tenantId]
  );
  const metadata = parseJson(rows[0]?.metadata);
  metadata.payment_request = {
    slot,
    label,
    amount,
    workshop_id: workshopId || null,
    lead_id: leadId || null,
    sent_at: new Date().toISOString(),
  };

  await query(
    'UPDATE conversations SET metadata = ? WHERE id = ? AND tenant_id = ?',
    [JSON.stringify(metadata), conversationId, tenantId]
  );
}

async function getConversationPaymentContext({ tenantId, conversationId }) {
  const rows = await query(
    'SELECT metadata, workshop_id, lead_id FROM conversations WHERE id = ? AND tenant_id = ? LIMIT 1',
    [conversationId, tenantId]
  );
  const row = rows[0];
  if (!row) return null;
  const metadata = parseJson(row.metadata);
  return metadata.payment_request || null;
}

async function buildEnrollmentPrompt({ tenantId, workshopId }) {
  const activeOptions = await getActivePaymentOptions(tenantId);
  if (activeOptions.length === 0) {
    return {
      response: {
        type: 'text',
        text: 'Ya registré tu interés. Aún no tengo QRs cargados aquí, así que Daniel te enviará el cobro personalmente.',
      },
      enrollment: await getOrCreateEnrollment({ tenantId, leadId: null, workshopId }),
    };
  }

  return {
    response: {
      type: 'buttons',
      text: 'Perfecto. Elige la opción de pago que corresponde para enviarte el QR correcto:',
      buttons: activeOptions.map((option) => ({
        id: `payopt_${option.slot}`,
        label: `${option.label} · Bs ${option.amount}`,
      })),
    },
  };
}

async function buildPaymentQrResponse({ tenantId, conversationId, leadId, workshopId, slot }) {
  const option = await getPaymentOptionBySlot(tenantId, slot);
  if (!option) {
    return { type: 'text', text: 'Esa opción de pago ya no está disponible. Elige otra o escribe a Daniel.' };
  }

  const asset = await getPaymentQrAsset(tenantId, slot);
  if (!asset) {
    return { type: 'text', text: `La opción ${option.label} todavía no tiene QR cargado. Daniel te lo enviará manualmente.` };
  }

  const enrollment = await getOrCreateEnrollment({ tenantId, leadId, workshopId });
  if (enrollment) {
    await query(
      `UPDATE enrollments
       SET amount_due = ?, payment_status = 'unpaid', payment_requested_at = NOW()
       WHERE id = ?`,
      [option.amount, enrollment.id]
    );
  }

  await setConversationPaymentContext({
    tenantId,
    conversationId,
    slot: option.slot,
    label: option.label,
    amount: option.amount,
    workshopId,
    leadId,
  });

  return {
    type: 'image',
    image: asset.data,
    mimeType: asset.mime_type,
    caption: `QR de pago · ${option.label} · Bs ${option.amount}\nCuando hagas el pago, envíame aquí mismo el comprobante.`,
  };
}

async function maybeProcessPaymentProof({ tenantId, conversation, lead, incoming }) {
  if (!['image', 'document'].includes(incoming.contentType) || !incoming.mediaFileId) {
    return null;
  }

  const paymentContext = await getConversationPaymentContext({ tenantId, conversationId: conversation.id });
  if (!paymentContext?.amount) {
    return null;
  }

  const media = await incoming.channel.getMedia(incoming.mediaFileId, {
    filename: incoming.filename,
    mimeType: incoming.mimeType,
  });

  if (!media?.buffer) {
    return {
      type: 'text',
      text: 'No pude descargar el comprobante para revisarlo. Intenta enviarlo otra vez.',
    };
  }

  const settings = await getPaymentSettings(tenantId);
  const ocrResult = await extractReceiptData(media.buffer, media.mimeType, {
    validDestinationAccounts: settings.payment_destination_accounts,
  });

  if (!ocrResult?.amount) {
    return {
      type: 'text',
      text: 'No pude leer bien el comprobante. Reenvíalo con mejor resolución o escribe a Daniel.',
    };
  }

  const problems = [];
  if (ocrResult.destAccountVerified !== true) {
    problems.push({ type: 'destinatario' });
  }
  if (Number(paymentContext.amount) !== Number(ocrResult.amount)) {
    problems.push({ type: 'monto', expectedAmount: paymentContext.amount, receivedAmount: ocrResult.amount });
  }

  const receiptDateKey = parseReceiptDateKey(ocrResult.date);
  const contextDateKey = paymentContext.sent_at ? getBoliviaDateKey(paymentContext.sent_at) : null;
  if (receiptDateKey && contextDateKey && receiptDateKey < contextDateKey) {
    problems.push({ type: 'fecha_pasada', receiptDate: ocrResult.date, contextDate: contextDateKey });
  }

  const enrollmentRows = await query(
    `SELECT *
     FROM enrollments
     WHERE tenant_id = ? AND workshop_id = ? AND lead_id = ?
     ORDER BY id DESC
     LIMIT 1`,
    [tenantId, conversation.workshop_id, lead.id]
  );
  const enrollment = enrollmentRows[0] || null;

  const ocrPayload = JSON.stringify({
    name: ocrResult.name || null,
    amount: ocrResult.amount || null,
    date: sanitizeReceiptDate(ocrResult.date),
    time: ocrResult.time || null,
    reference: ocrResult.reference || null,
    bank: ocrResult.bank || null,
    destName: sanitizeReceiptDestName(ocrResult.destName),
    destAccount: ocrResult.destAccount || null,
    destAccountVerified: !!ocrResult.destAccountVerified,
    raw_text: ocrResult.raw_text || null,
    validation_problems: problems,
  });

  if (enrollment) {
    await query(
      `UPDATE enrollments
       SET payment_proof = ?, payment_proof_type = ?, ocr_data = ?, notes = ?
       WHERE id = ?`,
      [
        media.buffer,
        media.mimeType || 'application/octet-stream',
        ocrPayload,
        problems.length ? `OCR pendiente de revisión: ${buildMismatchLines(problems).join(' | ')}` : enrollment.notes,
        enrollment.id,
      ]
    );
  }

  if (problems.length > 0) {
    return {
      type: 'text',
      text: [
        'Gracias por enviar el comprobante.',
        '',
        'No pude validarlo automáticamente por estos motivos:',
        ...buildMismatchLines(problems).map((line) => `• ${line}`),
        '',
        'Revisa el comprobante o escribe a Daniel para que lo revise manualmente.',
      ].join('\n'),
    };
  }

  if (enrollment) {
    await query(
      `UPDATE enrollments
       SET payment_status = 'paid',
           amount_paid = ?,
           status = 'confirmed',
           confirmed_at = NOW(),
           verified_at = NOW(),
           notes = NULL
       WHERE id = ?`,
      [paymentContext.amount, enrollment.id]
    );
  }

  const existingIncome = await query(
    `SELECT id
     FROM transactions
     WHERE tenant_id = ? AND type = 'income' AND lead_id = ? AND workshop_id = ?
     ORDER BY id DESC
     LIMIT 1`,
    [tenantId, lead.id, conversation.workshop_id || null]
  );

  if (existingIncome.length > 0) {
    await query(
      `UPDATE transactions
       SET amount = ?, verified = TRUE, verification_method = 'ocr', payment_proof = ?, payment_proof_type = ?, ocr_data = ?
       WHERE id = ?`,
      [paymentContext.amount, media.buffer, media.mimeType || 'application/octet-stream', ocrPayload, existingIncome[0].id]
    );
  } else {
    await query(
      `INSERT INTO transactions (
         tenant_id, type, category, amount, currency, description, date,
         lead_id, workshop_id, payment_proof, payment_proof_type, verified, verification_method, ocr_data
       ) VALUES (?, 'income', 'taller', ?, 'BOB', ?, CURDATE(), ?, ?, ?, ?, TRUE, 'ocr', ?)`,
      [
        tenantId,
        paymentContext.amount,
        `Pago verificado por OCR · ${paymentContext.label || 'Taller'}`,
        lead.id,
        conversation.workshop_id || null,
        media.buffer,
        media.mimeType || 'application/octet-stream',
        ocrPayload,
      ]
    );
  }

  await query(
    `UPDATE leads
     SET status = 'converted', converted_at = COALESCE(converted_at, NOW())
     WHERE id = ? AND tenant_id = ?`,
    [lead.id, tenantId]
  );
  await query(
    `UPDATE conversations
     SET status = 'converted', converted_at = COALESCE(converted_at, NOW())
     WHERE id = ? AND tenant_id = ?`,
    [conversation.id, tenantId]
  );

  return {
    type: 'text',
    text: 'Pago recibido y validado correctamente. Tu inscripción quedó confirmada. Gracias.',
  };
}

module.exports = {
  buildEnrollmentPrompt,
  buildPaymentQrResponse,
  maybeProcessPaymentProof,
};
