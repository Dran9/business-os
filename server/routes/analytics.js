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

router.get('/leads-trend', authMiddleware, tenantMiddleware, async (req, res) => {
  try {
    const tid = req.tenantId;
    const rows = await query(
      `SELECT DATE_FORMAT(DATE(DATE_SUB(created_at, INTERVAL WEEKDAY(created_at) DAY)), '%Y-%m-%d') AS week_start,
              COUNT(*) AS total
       FROM leads
       WHERE tenant_id = ? AND created_at >= DATE_SUB(NOW(), INTERVAL 8 WEEK)
       GROUP BY week_start
       ORDER BY week_start ASC`,
      [tid]
    );

    res.json(rows.map((row) => ({
      week_start: row.week_start,
      total: Number(row.total || 0),
    })));
  } catch (err) {
    console.error('[analytics/leads-trend]', err);
    res.status(500).json({ error: 'Error cargando tendencia de leads' });
  }
});

router.get('/sources', authMiddleware, tenantMiddleware, async (req, res) => {
  try {
    const tid = req.tenantId;
    const rows = await query(
      `SELECT COALESCE(NULLIF(source, ''), 'sin fuente') AS source,
              COUNT(*) AS total,
              SUM(CASE WHEN status = 'converted' THEN 1 ELSE 0 END) AS converted
       FROM leads
       WHERE tenant_id = ?
       GROUP BY COALESCE(NULLIF(source, ''), 'sin fuente')
       ORDER BY total DESC
       LIMIT 8`,
      [tid]
    );

    res.json(rows.map((row) => {
      const total = Number(row.total || 0);
      const converted = Number(row.converted || 0);
      return {
        source: row.source,
        total,
        converted,
        conversion_rate: total > 0 ? Math.round((converted / total) * 100) : 0,
      };
    }));
  } catch (err) {
    console.error('[analytics/sources]', err);
    res.status(500).json({ error: 'Error cargando fuentes' });
  }
});

router.get('/workshops-finance', authMiddleware, tenantMiddleware, async (req, res) => {
  try {
    const tid = req.tenantId;
    const rows = await query(
      `SELECT w.id,
              w.name,
              DATE_FORMAT(w.date, '%Y-%m-%d') AS date,
              w.max_participants,
              w.price,
              COUNT(e.id) AS enrolled,
              SUM(CASE WHEN e.payment_status = 'paid' THEN 1 ELSE 0 END) AS paid,
              COALESCE(
                (SELECT SUM(amount)
                 FROM transactions t
                 WHERE t.workshop_id = w.id
                   AND t.tenant_id = w.tenant_id
                   AND t.type = 'income'),
                0
              ) AS revenue
       FROM workshops w
       LEFT JOIN enrollments e ON e.workshop_id = w.id AND e.tenant_id = w.tenant_id
       WHERE w.tenant_id = ?
       GROUP BY w.id
       ORDER BY COALESCE(w.date, '9999-12-31') DESC
       LIMIT 6`,
      [tid]
    );

    res.json(rows.map((row) => {
      const enrolled = Number(row.enrolled || 0);
      const paid = Number(row.paid || 0);
      const maxParticipants = Number(row.max_participants || 0);
      return {
        id: Number(row.id),
        name: row.name,
        date: row.date,
        max_participants: maxParticipants,
        enrolled,
        paid,
        revenue: Number(row.revenue || 0),
        fill_rate: maxParticipants > 0 ? Math.round((enrolled / maxParticipants) * 100) : 0,
        payment_rate: enrolled > 0 ? Math.round((paid / enrolled) * 100) : 0,
      };
    }));
  } catch (err) {
    console.error('[analytics/workshops-finance]', err);
    res.status(500).json({ error: 'Error cargando finanzas por taller' });
  }
});

router.get('/flow-dropoff', authMiddleware, tenantMiddleware, async (req, res) => {
  try {
    const tid = req.tenantId;
    const rows = await query(
      `SELECT fs.current_node_key AS node_key,
              fn.name AS node_name,
              COUNT(*) AS total
       FROM flow_sessions fs
       LEFT JOIN flow_nodes fn
         ON fn.node_key = fs.current_node_key
        AND fn.tenant_id = fs.tenant_id
       WHERE fs.tenant_id = ? AND fs.status = 'abandoned'
       GROUP BY fs.current_node_key, fn.name
       ORDER BY total DESC`,
      [tid]
    );

    res.json(rows.map((row) => ({
      node_key: row.node_key,
      node_name: row.node_name,
      total: Number(row.total || 0),
    })));
  } catch (err) {
    console.error('[analytics/flow-dropoff]', err);
    res.status(500).json({ error: 'Error cargando abandono del bot' });
  }
});

module.exports = router;
