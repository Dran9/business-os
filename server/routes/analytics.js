const express = require('express');
const authMiddleware = require('../middleware/auth');
const { tenantMiddleware } = require('../middleware/tenant');
const { query } = require('../db');

const router = express.Router();

// GET /api/analytics/dashboard
router.get('/dashboard', authMiddleware, tenantMiddleware, async (req, res) => {
  try {
    const tid = req.tenantId;
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];

    const [[leadsTotal], [leadsNew], [leadsConverted], [workshopsActive], [income], [expense]] = await Promise.all([
      query('SELECT COUNT(*) as c FROM leads WHERE tenant_id = ? AND deleted_at IS NULL AND created_at >= ?', [tid, monthStart]),
      query('SELECT COUNT(*) as c FROM leads WHERE tenant_id = ? AND deleted_at IS NULL AND status = "new" AND created_at >= ?', [tid, monthStart]),
      query('SELECT COUNT(*) as c FROM leads WHERE tenant_id = ? AND deleted_at IS NULL AND status = "converted" AND converted_at >= ?', [tid, monthStart]),
      query('SELECT COUNT(*) as c FROM workshops WHERE tenant_id = ? AND status IN ("open","full","planned")', [tid]),
      query('SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE tenant_id = ? AND type = "income" AND date >= ?', [tid, monthStart]),
      query('SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE tenant_id = ? AND type = "expense" AND date >= ?', [tid, monthStart]),
    ]);

    const total = leadsTotal.c || 0;
    const converted = leadsConverted.c || 0;
    res.json({
      leads_total: total,
      leads_new: leadsNew.c || 0,
      leads_converted: converted,
      conversion_rate: total > 0 ? Math.round((converted / total) * 100) : 0,
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

// GET /api/analytics/funnel — embudo extendido con conversaciones e inscripciones
router.get('/funnel', authMiddleware, tenantMiddleware, async (req, res) => {
  try {
    const tid = req.tenantId;

    const [statuses, [withConversation], [enrolled], [paid], [referidos]] = await Promise.all([
      query('SELECT status, COUNT(*) AS c FROM leads WHERE tenant_id = ? AND deleted_at IS NULL GROUP BY status', [tid]),
      query(
        `SELECT COUNT(DISTINCT c.lead_id) AS c
         FROM conversations c
         JOIN leads l ON l.id = c.lead_id AND l.tenant_id = c.tenant_id
         WHERE c.tenant_id = ? AND l.deleted_at IS NULL`,
        [tid],
      ),
      query(
        `SELECT COUNT(*) AS c
         FROM enrollments e
         JOIN leads l ON l.id = e.lead_id AND l.tenant_id = e.tenant_id
         WHERE e.tenant_id = ? AND l.deleted_at IS NULL`,
        [tid],
      ),
      query(
        `SELECT COUNT(*) AS c
         FROM enrollments e
         JOIN leads l ON l.id = e.lead_id AND l.tenant_id = e.tenant_id
         WHERE e.tenant_id = ? AND l.deleted_at IS NULL AND e.payment_status = 'paid'`,
        [tid],
      ),
      query('SELECT COUNT(*) AS c FROM leads WHERE tenant_id = ? AND deleted_at IS NULL AND referred_by_lead_id IS NOT NULL', [tid]),
    ]);

    const byStatus = Object.fromEntries(statuses.map((r) => [r.status, Number(r.c)]));
    const total = statuses.reduce((s, r) => s + Number(r.c), 0);
    const qualified = (byStatus.qualifying || 0) + (byStatus.qualified || 0) + (byStatus.negotiating || 0) + (byStatus.converted || 0);
    const converted = byStatus.converted || 0;
    const lost = byStatus.lost || 0;

    res.json({
      total,
      with_conversation: Number(withConversation?.c || 0),
      qualified,
      negotiating: byStatus.negotiating || 0,
      enrolled: Number(enrolled?.c || 0),
      paid: Number(paid?.c || 0),
      converted,
      lost,
      referidos: Number(referidos?.c || 0),
      conversion_rate: total > 0 ? Math.round((converted / total) * 100) : 0,
      loss_rate: total > 0 ? Math.round((lost / total) * 100) : 0,
      by_status: byStatus,
    });
  } catch (err) {
    console.error('[analytics/funnel]', err);
    res.status(500).json({ error: 'Error cargando funnel' });
  }
});

// GET /api/analytics/leads-trend — leads y convertidos por semana (8 semanas)
router.get('/leads-trend', authMiddleware, tenantMiddleware, async (req, res) => {
  try {
    const tid = req.tenantId;
    const [newLeads, convertedLeads] = await Promise.all([
      query(
        `SELECT DATE_FORMAT(DATE(DATE_SUB(created_at, INTERVAL WEEKDAY(created_at) DAY)), '%Y-%m-%d') AS week_start,
                COUNT(*) AS total
         FROM leads WHERE tenant_id = ? AND deleted_at IS NULL AND created_at >= DATE_SUB(NOW(), INTERVAL 8 WEEK)
         GROUP BY week_start ORDER BY week_start ASC`,
        [tid],
      ),
      query(
        `SELECT DATE_FORMAT(DATE(DATE_SUB(converted_at, INTERVAL WEEKDAY(converted_at) DAY)), '%Y-%m-%d') AS week_start,
                COUNT(*) AS total
         FROM leads WHERE tenant_id = ? AND deleted_at IS NULL AND status = 'converted' AND converted_at >= DATE_SUB(NOW(), INTERVAL 8 WEEK)
         GROUP BY week_start ORDER BY week_start ASC`,
        [tid],
      ),
    ]);

    const convertedMap = Object.fromEntries(convertedLeads.map((r) => [r.week_start, Number(r.total)]));
    res.json(newLeads.map((r) => ({
      week_start: r.week_start,
      total: Number(r.total || 0),
      converted: convertedMap[r.week_start] || 0,
    })));
  } catch (err) {
    console.error('[analytics/leads-trend]', err);
    res.status(500).json({ error: 'Error cargando tendencia de leads' });
  }
});

// GET /api/analytics/sources
router.get('/sources', authMiddleware, tenantMiddleware, async (req, res) => {
  try {
    const tid = req.tenantId;
    const rows = await query(
      `SELECT COALESCE(NULLIF(source, ''), 'sin fuente') AS source,
              COUNT(*) AS total,
              SUM(CASE WHEN status = 'converted' THEN 1 ELSE 0 END) AS converted
       FROM leads WHERE tenant_id = ? AND deleted_at IS NULL
       GROUP BY COALESCE(NULLIF(source, ''), 'sin fuente')
       ORDER BY total DESC LIMIT 8`,
      [tid],
    );
    res.json(rows.map((r) => {
      const total = Number(r.total || 0);
      const converted = Number(r.converted || 0);
      return { source: r.source, total, converted, conversion_rate: total > 0 ? Math.round((converted / total) * 100) : 0 };
    }));
  } catch (err) {
    console.error('[analytics/sources]', err);
    res.status(500).json({ error: 'Error cargando fuentes' });
  }
});

// GET /api/analytics/workshops-finance
router.get('/workshops-finance', authMiddleware, tenantMiddleware, async (req, res) => {
  try {
    const tid = req.tenantId;
    const rows = await query(
      `SELECT w.id, w.name, DATE_FORMAT(w.date, '%Y-%m-%d') AS date, w.max_participants, w.price,
              COUNT(l.id) AS enrolled,
              SUM(CASE WHEN l.id IS NOT NULL AND e.payment_status = 'paid' THEN 1 ELSE 0 END) AS paid,
              SUM(CASE WHEN l.id IS NOT NULL AND e.payment_status = 'partial' THEN 1 ELSE 0 END) AS partial_count,
              COALESCE((
                SELECT SUM(t.amount)
                FROM transactions t
                LEFT JOIN leads tl ON tl.id = t.lead_id AND tl.tenant_id = t.tenant_id
                WHERE t.workshop_id = w.id
                  AND t.tenant_id = w.tenant_id
                  AND t.type = 'income'
                  AND (t.lead_id IS NULL OR tl.deleted_at IS NULL)
              ), 0) AS revenue
       FROM workshops w
       LEFT JOIN enrollments e ON e.workshop_id=w.id AND e.tenant_id=w.tenant_id
       LEFT JOIN leads l ON l.id = e.lead_id AND l.tenant_id = e.tenant_id AND l.deleted_at IS NULL
       WHERE w.tenant_id = ?
       GROUP BY w.id ORDER BY COALESCE(w.date,'9999-12-31') DESC LIMIT 6`,
      [tid],
    );
    res.json(rows.map((r) => {
      const enrolled = Number(r.enrolled || 0);
      const paid = Number(r.paid || 0);
      const partial = Number(r.partial_count || 0);
      const max = Number(r.max_participants || 0);
      const price = Number(r.price || 0);
      const goal = price * max;
      return {
        id: Number(r.id), name: r.name, date: r.date, max_participants: max, price, enrolled, paid,
        partial, revenue: Number(r.revenue || 0), goal,
        unpaid: enrolled - paid - partial,
        fill_rate: max > 0 ? Math.round((enrolled / max) * 100) : 0,
        payment_rate: enrolled > 0 ? Math.round((paid / enrolled) * 100) : 0,
        paid_pct: goal > 0 ? Math.round((Number(r.revenue || 0) / goal) * 100) : 0,
      };
    }));
  } catch (err) {
    console.error('[analytics/workshops-finance]', err);
    res.status(500).json({ error: 'Error cargando finanzas por taller' });
  }
});

// GET /api/analytics/flow-dropoff
router.get('/flow-dropoff', authMiddleware, tenantMiddleware, async (req, res) => {
  try {
    const tid = req.tenantId;
    const [rows, [totalAbandoned]] = await Promise.all([
      query(
        `SELECT fs.current_node_key AS node_key, fn.name AS node_name, COUNT(*) AS total
         FROM flow_sessions fs
         LEFT JOIN leads l ON l.id = fs.lead_id AND l.tenant_id = fs.tenant_id
         LEFT JOIN flow_nodes fn ON fn.node_key=fs.current_node_key AND fn.tenant_id=fs.tenant_id
         WHERE fs.tenant_id=? AND fs.status='abandoned' AND (fs.lead_id IS NULL OR l.deleted_at IS NULL)
         GROUP BY fs.current_node_key, fn.name ORDER BY total DESC`,
        [tid],
      ),
      query(
        `SELECT COUNT(*) AS c
         FROM flow_sessions fs
         LEFT JOIN leads l ON l.id = fs.lead_id AND l.tenant_id = fs.tenant_id
         WHERE fs.tenant_id = ? AND fs.status = 'abandoned' AND (fs.lead_id IS NULL OR l.deleted_at IS NULL)`,
        [tid],
      ),
    ]);
    const total = Number(totalAbandoned?.c || 0);
    res.json(rows.map((r) => ({
      node_key: r.node_key,
      node_name: r.node_name,
      total: Number(r.total || 0),
      pct: total > 0 ? Math.round((Number(r.total) / total) * 100) : 0,
    })));
  } catch (err) {
    console.error('[analytics/flow-dropoff]', err);
    res.status(500).json({ error: 'Error cargando abandono del bot' });
  }
});

// GET /api/analytics/kpis — KPIs financieros y de retención
router.get('/kpis', authMiddleware, tenantMiddleware, async (req, res) => {
  try {
    const tid = req.tenantId;
    const [[income], [pending], [timeToPay], [referidos]] = await Promise.all([
      query(
        `SELECT COALESCE(SUM(t.amount),0) AS total
         FROM transactions t
         LEFT JOIN leads l ON l.id = t.lead_id AND l.tenant_id = t.tenant_id
         WHERE t.tenant_id = ? AND t.type = 'income' AND (t.lead_id IS NULL OR l.deleted_at IS NULL)`,
        [tid],
      ),
      query(
        `SELECT COALESCE(SUM(w.price),0) AS total
         FROM enrollments e
         JOIN workshops w ON w.id=e.workshop_id
         JOIN leads l ON l.id = e.lead_id AND l.tenant_id = e.tenant_id
         WHERE e.tenant_id=? AND l.deleted_at IS NULL AND e.payment_status NOT IN ('paid')`,
        [tid],
      ),
      query(
        `SELECT ROUND(AVG(DATEDIFF(e.enrolled_at, l.created_at)),1) AS avg_days
         FROM enrollments e
         JOIN leads l ON l.id=e.lead_id
         WHERE e.tenant_id=? AND e.payment_status='paid' AND l.created_at IS NOT NULL AND l.deleted_at IS NULL`,
        [tid],
      ),
      query('SELECT COUNT(*) AS c FROM leads WHERE tenant_id=? AND deleted_at IS NULL AND referred_by_lead_id IS NOT NULL', [tid]),
    ]);
    res.json({
      income_total: Number(income?.total || 0),
      pending_cobro: Number(pending?.total || 0),
      avg_days_to_pay: timeToPay?.avg_days != null ? Number(timeToPay.avg_days) : null,
      referidos: Number(referidos?.c || 0),
    });
  } catch (err) {
    console.error('[analytics/kpis]', err);
    res.status(500).json({ error: 'Error cargando KPIs' });
  }
});

// GET /api/analytics/conversation-stats — promedio de mensajes por estado
router.get('/conversation-stats', authMiddleware, tenantMiddleware, async (req, res) => {
  try {
    const tid = req.tenantId;
    const rows = await query(
      `SELECT c.status,
              AVG(msg_count.cnt) AS avg_msgs
       FROM conversations c
       JOIN leads l ON l.id = c.lead_id AND l.tenant_id = c.tenant_id
       JOIN (
         SELECT conversation_id, COUNT(*) AS cnt FROM messages GROUP BY conversation_id
       ) msg_count ON msg_count.conversation_id = c.id
       WHERE c.tenant_id = ? AND l.deleted_at IS NULL
       GROUP BY c.status`,
      [tid],
    );
    const byStatus = Object.fromEntries(rows.map((r) => [r.status, Math.round((Number(r.avg_msgs) || 0) * 10) / 10]));
    res.json({
      avg_msgs_converted: byStatus.converted || 0,
      avg_msgs_lost: byStatus.lost || 0,
      avg_msgs_active: byStatus.active || 0,
    });
  } catch (err) {
    console.error('[analytics/conversation-stats]', err);
    res.status(500).json({ error: 'Error cargando stats de conversación' });
  }
});

// GET /api/analytics/lead-profile — ciudad, scores, top tags, top LTV
router.get('/lead-profile', authMiddleware, tenantMiddleware, async (req, res) => {
  try {
    const tid = req.tenantId;
    const [cities, scores, topTags, topLtv] = await Promise.all([
      query(
        `SELECT COALESCE(NULLIF(TRIM(city),''),'Sin ciudad') AS city, COUNT(*) AS total
         FROM leads WHERE tenant_id=? AND deleted_at IS NULL GROUP BY city ORDER BY total DESC LIMIT 8`,
        [tid],
      ),
      query(
        `SELECT
           ROUND(AVG(CASE WHEN status='converted' THEN quality_score END),0) AS avg_converted,
           ROUND(AVG(CASE WHEN status='lost'      THEN quality_score END),0) AS avg_lost
         FROM leads WHERE tenant_id=? AND deleted_at IS NULL AND quality_score IS NOT NULL`,
        [tid],
      ),
      query(
        `SELECT t.category, t.value, COUNT(*) AS total
         FROM tags t
         JOIN leads l ON l.id = t.target_id AND l.tenant_id = t.tenant_id
         WHERE t.tenant_id=? AND t.target_type='lead' AND l.deleted_at IS NULL
         GROUP BY category, value ORDER BY total DESC LIMIT 12`,
        [tid],
      ),
      query(
        `SELECT l.id, l.name, COALESCE(SUM(t.amount),0) AS ltv
         FROM leads l
         JOIN enrollments e ON e.lead_id=l.id AND e.tenant_id=l.tenant_id
         LEFT JOIN transactions t ON t.workshop_id=e.workshop_id AND t.tenant_id=l.tenant_id AND t.type='income'
         WHERE l.tenant_id=? AND l.deleted_at IS NULL
         GROUP BY l.id, l.name ORDER BY ltv DESC LIMIT 5`,
        [tid],
      ),
    ]);

    res.json({
      cities: cities.map((r) => ({ city: r.city, total: Number(r.total) })),
      avg_score_converted: Number(scores[0]?.avg_converted || 0),
      avg_score_lost: Number(scores[0]?.avg_lost || 0),
      top_tags: topTags.map((r) => ({ category: r.category, value: r.value, total: Number(r.total) })),
      top_ltv: topLtv.map((r) => ({ id: Number(r.id), name: r.name, ltv: Number(r.ltv || 0) })),
    });
  } catch (err) {
    console.error('[analytics/lead-profile]', err);
    res.status(500).json({ error: 'Error cargando perfil de leads' });
  }
});

// GET /api/analytics/monthly-revenue — ingresos por mes (6 meses)
router.get('/monthly-revenue', authMiddleware, tenantMiddleware, async (req, res) => {
  try {
    const tid = req.tenantId;
    const rows = await query(
      `SELECT DATE_FORMAT(t.date, '%Y-%m') AS month, COALESCE(SUM(t.amount),0) AS total
       FROM transactions t
       LEFT JOIN leads l ON l.id = t.lead_id AND l.tenant_id = t.tenant_id
       WHERE t.tenant_id=? AND t.type='income'
         AND (t.lead_id IS NULL OR l.deleted_at IS NULL)
         AND t.date >= DATE_SUB(NOW(), INTERVAL 6 MONTH)
       GROUP BY month ORDER BY month ASC`,
      [tid],
    );
    res.json(rows.map((r) => ({ month: r.month, total: Number(r.total || 0) })));
  } catch (err) {
    console.error('[analytics/monthly-revenue]', err);
    res.status(500).json({ error: 'Error cargando ingresos mensuales' });
  }
});

module.exports = router;
