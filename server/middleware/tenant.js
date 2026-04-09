const { query } = require('../db');

// Cache en memoria de configs de tenants (se invalida cada 5 min)
const tenantCache = new Map();
const CACHE_TTL = 5 * 60 * 1000;

async function tenantMiddleware(req, res, next) {
  const tenantId = req.tenantId;
  if (!tenantId) {
    return res.status(400).json({ error: 'Tenant no identificado' });
  }

  // Check cache
  const cached = tenantCache.get(tenantId);
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    req.tenant = cached.data;
    return next();
  }

  try {
    const rows = await query(
      `SELECT id, name, brand_config, wa_config, llm_config, google_config,
              meta_config, push_config, agenda_config, features_enabled,
              payment_options, payment_destination_accounts,
              created_at, updated_at
       FROM tenants WHERE id = ?`,
      [tenantId]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Tenant no encontrado' });
    }

    const tenant = rows[0];
    // Parse JSON fields
    for (const field of ['brand_config', 'wa_config', 'llm_config', 'google_config', 'meta_config', 'push_config', 'agenda_config', 'features_enabled', 'payment_options']) {
      if (tenant[field] && typeof tenant[field] === 'string') {
        try { tenant[field] = JSON.parse(tenant[field]); } catch {}
      }
    }

    tenantCache.set(tenantId, { data: tenant, ts: Date.now() });
    req.tenant = tenant;
    next();
  } catch (err) {
    console.error('[tenant middleware]', err);
    res.status(500).json({ error: 'Error cargando tenant' });
  }
}

// Para invalidar cache manualmente (después de cambiar config)
function invalidateTenantCache(tenantId) {
  if (tenantId) {
    tenantCache.delete(tenantId);
  } else {
    tenantCache.clear();
  }
}

module.exports = { tenantMiddleware, invalidateTenantCache };
