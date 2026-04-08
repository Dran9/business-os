const express = require('express');
const authMiddleware = require('../middleware/auth');
const { tenantMiddleware } = require('../middleware/tenant');
const { query } = require('../db');

const router = express.Router();

// GET /api/analytics/dashboard
router.get('/dashboard', authMiddleware, tenantMiddleware, async (req, res) => {
  try {
    const tid = req.tenantId;

    // Primer día del mes actual (Bolivia)
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
      .toISOString().split('T')[0];

    const [leadsTotal] = await query(
      'SELECT COUNT(*) as c FROM leads WHERE tenant_id = ? AND created_at >= ?',
      [tid, monthStart]
    );

    const [leadsNew] = await query(
      'SELECT COUNT(*) as c FROM leads WHERE tenant_id = ? AND status = "new" AND created_at >= ?',
      [tid, monthStart]
    );

    const [leadsConverted] = await query(
      'SELECT COUNT(*) as c FROM leads WHERE tenant_id = ? AND status = "converted" AND converted_at >= ?',
      [tid, monthStart]
    );

    const [workshopsActive] = await query(
      'SELECT COUNT(*) as c FROM workshops WHERE tenant_id = ? AND status IN ("open","full","planned")',
      [tid]
    );

    const [income] = await query(
      'SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE tenant_id = ? AND type = "income" AND date >= ?',
      [tid, monthStart]
    );

    const [expense] = await query(
      'SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE tenant_id = ? AND type = "expense" AND date >= ?',
      [tid, monthStart]
    );

    const total = leadsTotal.c || 0;
    const converted = leadsConverted.c || 0;
    const rate = total > 0 ? Math.round((converted / total) * 100) : 0;

    res.json({
      leads_total: total,
      leads_new: leadsNew.c || 0,
      leads_converted: converted,
      conversion_rate: rate,
      workshops_active: workshopsActive.c || 0,
      income_month: income.total || 0,
      expense_month: expense.total || 0,
      net_month: (income.total || 0) - (expense.total || 0),
    });
  } catch (err) {
    console.error('[analytics/dashboard]', err);
    res.status(500).json({ error: 'Error cargando dashboard' });
  }
});

router.get('/funnel', authMiddleware, tenantMiddleware, async (req, res) => {
  try {
    const tid = req.tenantId;

    const [totalLeads] = await query(
      'SELECT COUNT(*) AS c FROM leads WHERE tenant_id = ?',
      [tid]
    );

    const statuses = await query(
      'SELECT status, COUNT(*) AS c FROM leads WHERE tenant_id = ? GROUP BY status',
      [tid]
    );

    const sources = await query(
      `SELECT COALESCE(source, 'sin_fuente') AS source, COUNT(*) AS total
       FROM leads
       WHERE tenant_id = ?
       GROUP BY COALESCE(source, 'sin_fuente')
       ORDER BY total DESC
       LIMIT 6`,
      [tid]
    );

    const byStatus = Object.fromEntries(statuses.map((row) => [row.status, Number(row.c)]));
    const total = Number(totalLeads?.c || 0);
    const qualified = (byStatus.qualifying || 0) + (byStatus.qualified || 0) + (byStatus.negotiating || 0) + (byStatus.converted || 0);
    const negotiating = byStatus.negotiating || 0;
    const converted = byStatus.converted || 0;
    const lost = byStatus.lost || 0;

    res.json({
      total,
      qualified,
      negotiating,
      converted,
      lost,
      conversion_rate: total > 0 ? Math.round((converted / total) * 100) : 0,
      loss_rate: total > 0 ? Math.round((lost / total) * 100) : 0,
      top_sources: sources.map((row) => ({ source: row.source, total: Number(row.total) })),
      by_status: byStatus,
    });
  } catch (err) {
    console.error('[analytics/funnel]', err);
    res.status(500).json({ error: 'Error cargando funnel' });
  }
});

module.exports = router;
