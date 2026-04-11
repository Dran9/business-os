const express = require('express');
const authMiddleware = require('../middleware/auth');
const { tenantMiddleware } = require('../middleware/tenant');
const { query, queryPaginated } = require('../db');
const { broadcast } = require('../services/adminEvents');

const router = express.Router();

// GET /api/leads — listar leads
router.get('/', authMiddleware, tenantMiddleware, async (req, res) => {
  try {
    const { status, source, search, view, page = 1, limit = 50 } = req.query;
    let sql = 'SELECT * FROM leads WHERE tenant_id = ? AND deleted_at IS NULL';
    const params = [req.tenantId];

    if (view === 'commands_recent') {
      sql = `
        SELECT l.*
        FROM leads l
        WHERE l.tenant_id = ?
          AND l.deleted_at IS NULL
          AND l.last_contact_at IS NOT NULL
          AND l.status NOT IN ('converted', 'lost')
          AND NOT EXISTS (
            SELECT 1
            FROM enrollments e
            WHERE e.tenant_id = l.tenant_id
              AND e.lead_id = l.id
              AND (e.payment_status = 'paid' OR e.status = 'confirmed')
          )
      `;
    }

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
    if (view === 'hot') {
      sql += " AND quality_score >= 70 AND status NOT IN ('converted', 'lost')";
    }
    if (view === 'followup') {
      sql += " AND status NOT IN ('converted', 'lost') AND last_contact_at IS NOT NULL AND last_contact_at <= DATE_SUB(NOW(), INTERVAL 48 HOUR)";
    }
    if (view === 'converted') {
      sql += " AND status = 'converted'";
    }
    if (view === 'agenda_pending') {
      sql += ' AND agenda_client_id IS NULL';
    }

    if (view === 'commands_recent') {
      sql += ' ORDER BY l.last_contact_at DESC, l.id DESC';
    } else {
      sql += ' ORDER BY last_contact_at DESC';
    }

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
    const [total] = await query('SELECT COUNT(*) as c FROM leads WHERE tenant_id = ? AND deleted_at IS NULL', [req.tenantId]);
    const statuses = await query(
      'SELECT status, COUNT(*) as c FROM leads WHERE tenant_id = ? AND deleted_at IS NULL GROUP BY status',
      [req.tenantId]
    );
    const sources = await query(
      'SELECT source, COUNT(*) as c FROM leads WHERE tenant_id = ? AND deleted_at IS NULL AND source IS NOT NULL GROUP BY source',
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
    const rows = await query('SELECT * FROM leads WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL', [req.params.id, req.tenantId]);
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
      `SELECT *
       FROM tags
       WHERE target_type = 'lead' AND target_id = ? AND tenant_id = ?
       ORDER BY created_at DESC, id DESC`,
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
    await query(`UPDATE leads SET ${updates.join(', ')} WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL`, params);
    broadcast('lead:change', { id: Number(req.params.id), reason: 'updated' }, req.tenantId);
    res.json({ message: 'Lead actualizado' });
  } catch (err) {
    console.error('[leads PUT]', err);
    res.status(500).json({ error: 'Error actualizando lead' });
  }
});

// POST /api/leads/:id/tags — agregar tag manual
router.post('/:id/tags', authMiddleware, tenantMiddleware, async (req, res) => {
  try {
    const value = String(req.body.value || '').trim();
    const category = String(req.body.category || 'custom').trim();
    const color = req.body.color ? String(req.body.color).trim() : null;

    if (!value) {
      return res.status(400).json({ error: 'Valor del tag requerido' });
    }

    const leadRows = await query('SELECT id FROM leads WHERE id = ? AND tenant_id = ? LIMIT 1', [req.params.id, req.tenantId]);
    if (!leadRows[0]) {
      return res.status(404).json({ error: 'Lead no encontrado' });
    }

    const existing = await query(
      `SELECT id FROM tags
       WHERE tenant_id = ? AND target_type = 'lead' AND target_id = ? AND category = ? AND value = ?
       LIMIT 1`,
      [req.tenantId, Number(req.params.id), category, value]
    );

    if (existing[0]) {
      return res.json({ id: existing[0].id, message: 'Tag ya existente' });
    }

    const result = await query(
      `INSERT INTO tags (tenant_id, target_type, target_id, category, value, color, source)
       VALUES (?, 'lead', ?, ?, ?, ?, 'manual')`,
      [req.tenantId, Number(req.params.id), category, value, color]
    );

    broadcast('lead:change', { id: Number(req.params.id), reason: 'tag-created' }, req.tenantId);
    res.json({ id: result.insertId, message: 'Tag agregado' });
  } catch (err) {
    console.error('[leads POST tag]', err);
    res.status(500).json({ error: 'Error agregando tag' });
  }
});

// DELETE /api/leads/:id/tags/:tagId — quitar tag manual
router.delete('/:id/tags/:tagId', authMiddleware, tenantMiddleware, async (req, res) => {
  try {
    const tags = await query(
      `SELECT id, source FROM tags
       WHERE id = ? AND tenant_id = ? AND target_type = 'lead' AND target_id = ?
       LIMIT 1`,
      [Number(req.params.tagId), req.tenantId, Number(req.params.id)]
    );

    if (!tags[0]) {
      return res.status(404).json({ error: 'Tag no encontrado' });
    }
    if (tags[0].source !== 'manual') {
      return res.status(400).json({ error: 'Solo se pueden quitar tags manuales' });
    }

    await query('DELETE FROM tags WHERE id = ? AND tenant_id = ?', [Number(req.params.tagId), req.tenantId]);
    broadcast('lead:change', { id: Number(req.params.id), reason: 'tag-deleted' }, req.tenantId);
    res.json({ message: 'Tag eliminado' });
  } catch (err) {
    console.error('[leads DELETE tag]', err);
    res.status(500).json({ error: 'Error eliminando tag' });
  }
});

// PUT /api/leads/:id/agenda-link — vincular o desvincular lead con Agenda 4.0
router.put('/:id/agenda-link', authMiddleware, tenantMiddleware, async (req, res) => {
  try {
    const agendaClientId = req.body.agenda_client_id === '' || req.body.agenda_client_id == null
      ? null
      : Number(req.body.agenda_client_id);

    await query(
      'UPDATE leads SET agenda_client_id = ? WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL',
      [agendaClientId, Number(req.params.id), req.tenantId]
    );

    broadcast('lead:change', { id: Number(req.params.id), reason: 'agenda-linked' }, req.tenantId);
    res.json({ message: agendaClientId ? 'Lead vinculado con Agenda 4.0' : 'Vínculo removido' });
  } catch (err) {
    console.error('[leads PUT agenda-link]', err);
    res.status(500).json({ error: 'Error actualizando vínculo con Agenda 4.0' });
  }
});

// DELETE /api/leads/:id
router.delete('/:id', authMiddleware, tenantMiddleware, async (req, res) => {
  try {
    await query(
      'UPDATE leads SET deleted_at = NOW() WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL',
      [req.params.id, req.tenantId]
    );
    await query(
      "UPDATE flow_sessions SET status = 'abandoned' WHERE lead_id = ? AND tenant_id = ?",
      [req.params.id, req.tenantId]
    );
    broadcast('lead:change', { id: Number(req.params.id), reason: 'deleted' }, req.tenantId);
    res.json({ message: 'Lead eliminado' });
  } catch (err) {
    console.error('[leads DELETE]', err);
    res.status(500).json({ error: 'Error' });
  }
});

module.exports = router;
