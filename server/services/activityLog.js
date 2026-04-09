const { query } = require('../db');

async function logActivity({ tenantId, actor, action, targetType = null, targetId = null, details = null }) {
  if (!tenantId || !actor || !action) return;

  await query(
    `INSERT INTO activity_log (tenant_id, actor, action, target_type, target_id, details)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [tenantId, actor, action, targetType, targetId, details ? JSON.stringify(details) : null]
  ).catch(() => {});
}

module.exports = { logActivity };
