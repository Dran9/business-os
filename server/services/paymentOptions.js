const { query } = require('../db');

function normalizePaymentOptions(rawValue) {
  let parsed = rawValue;
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      parsed = null;
    }
  }

  const source = Array.isArray(parsed) ? parsed : [];
  const normalized = [];

  for (let index = 0; index < 4; index += 1) {
    const item = source[index] || {};
    normalized.push({
      slot: index + 1,
      label: String(item.label || `Opción ${index + 1}`).trim(),
      amount: item.amount == null || item.amount === '' ? null : Number(item.amount),
      active: item.active !== false,
      has_qr: false,
    });
  }

  return normalized;
}

function normalizeDestinationAccounts(value) {
  return String(value || '')
    .split(/\r?\n|,/)
    .map((item) => item.replace(/\D/g, '').trim())
    .filter(Boolean);
}

async function getPaymentSettings(tenantId) {
  const rows = await query(
    `SELECT payment_options, payment_destination_accounts, features_enabled,
            payment_qr_1, payment_qr_2, payment_qr_3, payment_qr_4
     FROM tenants
     WHERE id = ?
     LIMIT 1`,
    [tenantId]
  );

  const tenant = rows[0] || {};
  const options = normalizePaymentOptions(tenant.payment_options);
  let features = tenant.features_enabled;
  if (typeof features === 'string') {
    try {
      features = JSON.parse(features);
    } catch {
      features = {};
    }
  }
  features = features && typeof features === 'object' ? features : {};

  options.forEach((option, idx) => {
    option.has_qr = !!tenant[`payment_qr_${idx + 1}`];
  });

  return {
    payment_options: options,
    payment_destination_accounts: normalizeDestinationAccounts(tenant.payment_destination_accounts),
    payment_proof_debug_mode: features.payment_proof_debug_mode === true,
  };
}

async function updatePaymentSettings(tenantId, { payment_options, payment_destination_accounts, payment_proof_debug_mode }) {
  const options = normalizePaymentOptions(payment_options).map(({ slot, has_qr, ...item }) => item);
  const accounts = Array.isArray(payment_destination_accounts)
    ? payment_destination_accounts.map((item) => String(item || '').replace(/\D/g, '')).filter(Boolean).join('\n')
    : String(payment_destination_accounts || '')
        .split(/\r?\n|,/)
        .map((item) => item.replace(/\D/g, '').trim())
        .filter(Boolean)
        .join('\n');
  const currentRows = await query(
    'SELECT features_enabled FROM tenants WHERE id = ? LIMIT 1',
    [tenantId]
  );
  let features = currentRows[0]?.features_enabled;
  if (typeof features === 'string') {
    try {
      features = JSON.parse(features);
    } catch {
      features = {};
    }
  }
  features = features && typeof features === 'object' ? features : {};
  features.payment_proof_debug_mode = payment_proof_debug_mode === true;

  await query(
    'UPDATE tenants SET payment_options = ?, payment_destination_accounts = ?, features_enabled = ? WHERE id = ?',
    [JSON.stringify(options), accounts || null, JSON.stringify(features), tenantId]
  );
}

async function updatePaymentProofDebugMode(tenantId, enabled) {
  const currentRows = await query(
    'SELECT features_enabled FROM tenants WHERE id = ? LIMIT 1',
    [tenantId]
  );
  let features = currentRows[0]?.features_enabled;
  if (typeof features === 'string') {
    try {
      features = JSON.parse(features);
    } catch {
      features = {};
    }
  }
  features = features && typeof features === 'object' ? features : {};
  features.payment_proof_debug_mode = enabled === true;

  await query(
    'UPDATE tenants SET features_enabled = ? WHERE id = ?',
    [JSON.stringify(features), tenantId]
  );
}

async function updatePaymentQrAsset(tenantId, slot, buffer, mimeType) {
  if (![1, 2, 3, 4].includes(Number(slot))) {
    throw new Error('Slot inválido');
  }

  await query(
    `UPDATE tenants
     SET payment_qr_${slot} = ?, payment_qr_${slot}_mime = ?
     WHERE id = ?`,
    [buffer, mimeType, tenantId]
  );
}

async function getPaymentQrAsset(tenantId, slot) {
  if (![1, 2, 3, 4].includes(Number(slot))) {
    return null;
  }

  const rows = await query(
    `SELECT payment_qr_${slot} AS data, payment_qr_${slot}_mime AS mime_type
     FROM tenants
     WHERE id = ?
     LIMIT 1`,
    [tenantId]
  );

  const file = rows[0];
  if (!file?.data) return null;

  return {
    data: file.data,
    mime_type: file.mime_type || 'image/png',
  };
}

async function getActivePaymentOptions(tenantId) {
  const settings = await getPaymentSettings(tenantId);
  return settings.payment_options.filter((option) => option.active && option.amount != null);
}

async function getPaymentOptionBySlot(tenantId, slot) {
  const options = await getActivePaymentOptions(tenantId);
  return options.find((option) => option.slot === Number(slot)) || null;
}

module.exports = {
  normalizePaymentOptions,
  normalizeDestinationAccounts,
  getPaymentSettings,
  updatePaymentSettings,
  updatePaymentProofDebugMode,
  updatePaymentQrAsset,
  getPaymentQrAsset,
  getActivePaymentOptions,
  getPaymentOptionBySlot,
};
