const express = require('express');
const authMiddleware = require('../middleware/auth');
const { tenantMiddleware } = require('../middleware/tenant');
const { query, queryPaginated } = require('../db');
const { broadcast } = require('../services/adminEvents');

const router = express.Router();

// GET /api/leads — listar leads
router.get('/', authMiddleware, tenantMiddleware, async (req, res) => {
  try {
    const { status, source, search, page = 1, limit = 50 } = req.query;
    let sql = 'SELECT * FROM leads WHERE tenant_id = ?';
    const params = [req.tenantId];

    if (status) {
      sql += ' AND status = ?';
      params.push(status);
    }
    if (source) {
      sql += ' AND source = ?';
      params.push(source);
    }
    if (search) {
      sql += ' AND (name LIKE ? OR phone LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }

    sql += ' ORDER BY last_contact_at DESC';

    const result = await queryPaginated(sql, params, { page: Number(page), limit: Number(limit) });
    res.json(result);
  } catch (err) {
    console.error('[leads GET]', err);
    res.status(500).json({ error: 'Error cargando leads' });
  }
});

// GET /api/leads/stats/summary — estadísticas rápidas
router.get('/stats/summary', authMiddleware, tenantMiddleware, async (req, res) => {
  try {
    const [total] = await query('SELECT COUNT(*) as c FROM leads WHERE tenant_id = ?', [req.tenantId]);
    const statuses = await query(
      'SELECT status, COUNT(*) as c FROM leads WHERE tenant_id = ? GROUP BY status',
      [req.tenantId]
    );
    const sources = await query(
      'SELECT source, COUNT(*) as c FROM leads WHERE tenant_id = ? AND source IS NOT NULL GROUP BY source',
      [req.tenantId]
    );

    res.json({
      total: total.c,
      by_status: Object.fromEntries(statuses.map(r => [r.status, r.c])),
      by_source: Object.fromEntries(sources.map(r => [r.source, r.c])),
    });
  } catch (err) {
    console.error('[leads stats]', err);
    res.status(500).json({ error: 'Error' });
  }
});

// GET /api/leads/:id — detalle de un lead con conversaciones
router.get('/:id', authMiddleware, tenantMiddleware, async (req, res) => {
  try {
    const rows = await query('SELECT * FROM leads WHERE id = ? AND tenant_id = ?', [req.params.id, req.tenantId]);
    if (rows.length === 0) return res.status(404).json({ error: 'Lead no encontrado' });

    const lead = rows[0];

    // Conversaciones del lead
    const conversations = await query(
      `SELECT c.*, w.name as workshop_name FROM conversations c
       LEFT JOIN workshops w ON w.id = c.workshop_id
       WHERE c.lead_id = ? AND c.tenant_id = ?
       ORDER BY c.started_at DESC`,
      [lead.id, req.tenantId]
    );

    // Tags del lead
    const tags = await query(
      "SELECT * FROM tags WHERE target_type = 'lead' AND target_id = ? AND tenant_id = ?",
      [lead.id, req.tenantId]
    );

    const enrollments = await query(
      `SELECT e.id, e.status, e.payment_status, e.amount_due, e.amount_paid, e.enrolled_at, e.confirmed_at,
              w.name AS workshop_name, w.date AS workshop_date
       FROM enrollments e
       JOIN workshops w ON w.id = e.workshop_id
       WHERE e.lead_id = ? AND e.tenant_id = ?
       ORDER BY COALESCE(e.confirmed_at, e.enrolled_at) DESC`,
      [lead.id, req.tenantId]
    );

    const transactions = await query(
      `SELECT id, type, category, amount, description, date, verified, verification_method
       FROM transactions
       WHERE lead_id = ? AND tenant_id = ?
       ORDER BY date DESC, id DESC
       LIMIT 50`,
      [lead.id, req.tenantId]
    );

    const messageEvents = await query(
      `SELECT m.id, 'message' AS event_type, m.direction, m.sender, m.content, m.content_type, m.created_at,
              c.id AS conversation_id, w.name AS workshop_name
       FROM messages m
       JOIN conversations c ON c.id = m.conversation_id
       LEFT JOIN workshops w ON w.id = c.workshop_id
       WHERE c.lead_id = ? AND c.tenant_id = ?
       ORDER BY m.created_at DESC, m.id DESC
       LIMIT 40`,
      [lead.id, req.tenantId]
    );

    const enrollmentEvents = enrollments.map((enrollment) => ({
      id: `enrollment-${enrollment.id}`,
      event_type: 'enrollment',
      created_at: enrollment.confirmed_at || enrollment.enrolled_at,
      status: enrollment.status,
      payment_status: enrollment.payment_status,
      amount_due: enrollment.amount_due,
      amount_paid: enrollment.amount_paid,
      workshop_name: enrollment.workshop_name,
      workshop_date: enrollment.workshop_date,
    }));

    const transactionEvents = transactions.map((transaction) => ({
      id: `transaction-${transaction.id}`,
      event_type: 'transaction',
      created_at: transaction.date,
      type: transaction.type,
      category: transaction.category,
      amount: transaction.amount,
      description: transaction.description,
      verified: transaction.verified,
      verification_method: transaction.verification_method,
    }));

    const timeline = [...messageEvents, ...enrollmentEvents, ...transactionEvents]
      .filter((item) => item.created_at)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, 80);

    res.json({ ...lead, conversations, tags, enrollments, transactions, timeline });
  } catch (err) {
    console.error('[leads GET/:id]', err);
    res.status(500).json({ error: 'Error' });
  }
});

// PUT /api/leads/:id — editar lead
router.put('/:id', authMiddleware, tenantMiddleware, async (req, res) => {
  try {
    const fields = ['name', 'city', 'source', 'status', 'quality_score', 'notes'];
    const updates = [];
    const params = [];

    for (const f of fields) {
      if (req.body[f] !== undefined) {
        updates.push(`${f} = ?`);
        params.push(req.body[f] === '' ? null : req.body[f]);
      }
    }

    if (updates.length === 0) return res.status(400).json({ error: 'Nada que actualizar' });

    params.push(req.params.id, req.tenantId);
    await query(`UPDATE leads SET ${updates.join(', ')} WHERE id = ? AND tenant_id = ?`, params);
    broadcast('lead:change', { id: Number(req.params.id), reason: 'updated' }, req.tenantId);
    res.json({ message: 'Lead actualizado' });
  } catch (err) {
    console.error('[leads PUT]', err);
    res.status(500).json({ error: 'Error actualizando lead' });
  }
});

// DELETE /api/leads/:id
router.delete('/:id', authMiddleware, tenantMiddleware, async (req, res) => {
  try {
    await query('DELETE FROM leads WHERE id = ? AND tenant_id = ?', [req.params.id, req.tenantId]);
    broadcast('lead:change', { id: Number(req.params.id), reason: 'deleted' }, req.tenantId);
    res.json({ message: 'Lead eliminado' });
  } catch (err) {
    console.error('[leads DELETE]', err);
    res.status(500).json({ error: 'Error' });
  }
});

module.exports = router;
