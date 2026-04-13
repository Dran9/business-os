const { query } = require('../db');

const controlCache = new Map();
const CACHE_TTL_MS = 15000;

function parseFeaturesEnabled(rawValue) {
  if (!rawValue) return {};
  if (typeof rawValue === 'object') return rawValue;
  try {
    return JSON.parse(rawValue);
  } catch {
    return {};
  }
}

function normalizeControl(features) {
  return {
    funnel_paused: features?.funnel_paused === true,
  };
}

async function getFunnelControl(tenantId, { force = false } = {}) {
  if (!force) {
    const cached = controlCache.get(tenantId);
    if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
      return cached.data;
    }
  }

  const rows = await query(
    'SELECT features_enabled FROM tenants WHERE id = ? LIMIT 1',
    [tenantId]
  );
  const tenant = rows[0];
  if (!tenant) {
    throw new Error('Tenant no encontrado');
  }

  const features = parseFeaturesEnabled(tenant.features_enabled);
  const control = normalizeControl(features);
  controlCache.set(tenantId, { data: control, ts: Date.now() });
  return control;
}

async function isFunnelPaused(tenantId) {
  const control = await getFunnelControl(tenantId);
  return control.funnel_paused === true;
}

async function setFunnelPaused(tenantId, paused) {
  const rows = await query(
    'SELECT features_enabled FROM tenants WHERE id = ? LIMIT 1',
    [tenantId]
  );
  const tenant = rows[0];
  if (!tenant) {
    throw new Error('Tenant no encontrado');
  }

  const features = parseFeaturesEnabled(tenant.features_enabled);
  features.funnel_paused = paused === true;

  await query(
    'UPDATE tenants SET features_enabled = ? WHERE id = ?',
    [JSON.stringify(features), tenantId]
  );

  const control = normalizeControl(features);
  controlCache.set(tenantId, { data: control, ts: Date.now() });
  return control;
}

function invalidateFunnelControlCache(tenantId) {
  if (tenantId) {
    controlCache.delete(tenantId);
    return;
  }
  controlCache.clear();
}

module.exports = {
  getFunnelControl,
  isFunnelPaused,
  setFunnelPaused,
  invalidateFunnelControlCache,
};
