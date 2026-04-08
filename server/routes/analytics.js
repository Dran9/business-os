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

module.exports = router;
