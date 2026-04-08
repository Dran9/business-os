const express = require('express');
const authMiddleware = require('../middleware/auth');
const { tenantMiddleware } = require('../middleware/tenant');
const { query, pool } = require('../db');

const router = express.Router();

// GET /api/conversations — listar conversaciones
router.get('/', authMiddleware, tenantMiddleware, async (req, res) => {
  try {
    const { status, page = 1, limit = 30 } = req.query;
    let sql = `SELECT c.*, l.name as lead_name, l.phone as lead_phone, l.status as lead_status,
                      l.quality_score, w.name as workshop_name,
                      (SELECT content FROM messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1) as last_message
               FROM conversations c
               JOIN leads l ON l.id = c.lead_id
               LEFT JOIN workshops w ON w.id = c.workshop_id
               WHERE c.tenant_id = ?`;
    const params = [req.tenantId];

    if (status) {
      sql += ' AND c.status = ?';
      params.push(status);
    }

    sql += ' ORDER BY c.last_message_at DESC';

    const offset = (Number(page) - 1) * Number(limit);
    const [[{ total }]] = await pool.execute(
      `SELECT COUNT(*) as total FROM conversations WHERE tenant_id = ?${status ? ' AND status = ?' : ''}`,
      status ? [req.tenantId, status] : [req.tenantId]
    );

    sql += ` LIMIT ${Number(limit)} OFFSET ${offset}`;
    const rows = await query(sql, params);

    // Tags de cada conversación
    for (const row of rows) {
      row.tags = await query(
        "SELECT category, value, color, source FROM tags WHERE target_type = 'conversation' AND target_id = ? AND tenant_id = ?",
        [row.id, req.tenantId]
      );
    }

    res.json({ data: rows, pagination: { page: Number(page), limit: Number(limit), total, pages: Math.ceil(total / Number(limit)) } });
  } catch (err) {
    console.error('[conversations GET]', err);
    res.status(500).json({ error: 'Error cargando conversaciones' });
  }
});

// GET /api/conversations/:id/messages — mensajes de una conversación
router.get('/:id/messages', authMiddleware, tenantMiddleware, async (req, res) => {
  try {
    // Verificar pertenencia al tenant
    const convs = await query(
      'SELECT id FROM conversations WHERE id = ? AND tenant_id = ?',
      [req.params.id, req.tenantId]
    );
    if (convs.length === 0) return res.status(404).json({ error: 'Conversación no encontrada' });

    const messages = await query(
      'SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC',
      [req.params.id]
    );

    res.json(messages);
  } catch (err) {
    console.error('[conversations/:id/messages]', err);
    res.status(500).json({ error: 'Error' });
  }
});

module.exports = router;
