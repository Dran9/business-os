const express = require('express');
const authMiddleware = require('../middleware/auth');
const { tenantMiddleware } = require('../middleware/tenant');
const { query, queryPaginated } = require('../db');

const router = express.Router();

// GET /api/workshops — listar talleres
router.get('/', authMiddleware, tenantMiddleware, async (req, res) => {
  try {
    const { status, page = 1, limit = 50 } = req.query;
    let sql = `SELECT w.*, v.name as venue_name
               FROM workshops w LEFT JOIN venues v ON v.id = w.venue_id
               WHERE w.tenant_id = ?`;
    const params = [req.tenantId];

    if (status) {
      sql += ' AND w.status = ?';
      params.push(status);
    }
    sql += ' ORDER BY w.date DESC';

    const result = await queryPaginated(sql, params, { page: Number(page), limit: Number(limit) });
    res.json(result);
  } catch (err) {
    console.error('[workshops GET]', err);
    res.status(500).json({ error: 'Error cargando talleres' });
  }
});

// GET /api/workshops/venues/list
router.get('/venues/list', authMiddleware, tenantMiddleware, async (req, res) => {
  try {
    const rows = await query('SELECT * FROM venues WHERE tenant_id = ? AND active = TRUE ORDER BY name', [req.tenantId]);
    res.json(rows);
  } catch (err) {
    console.error('[venues GET]', err);
    res.status(500).json({ error: 'Error' });
  }
});

// GET /api/workshops/:id
router.get('/:id', authMiddleware, tenantMiddleware, async (req, res) => {
  try {
    const rows = await query(
      `SELECT w.*, v.name as venue_name, v.address as venue_address, v.city as venue_city
       FROM workshops w LEFT JOIN venues v ON v.id = w.venue_id
       WHERE w.id = ? AND w.tenant_id = ?`,
      [req.params.id, req.tenantId]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Taller no encontrado' });
    res.json(rows[0]);
  } catch (err) {
    console.error('[workshops GET/:id]', err);
    res.status(500).json({ error: 'Error' });
  }
});

// POST /api/workshops — crear taller
router.post('/', authMiddleware, tenantMiddleware, async (req, res) => {
  try {
    const { name, type, modality, status, date, time_start, time_end,
            venue_id, max_participants, price, early_bird_price,
            early_bird_deadline, description } = req.body;

    if (!name) return res.status(400).json({ error: 'Nombre requerido' });

    const result = await query(
      `INSERT INTO workshops (tenant_id, name, type, modality, status, date, time_start, time_end,
        venue_id, max_participants, price, early_bird_price, early_bird_deadline, description)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.tenantId, name, type || null, modality || 'presencial',
       status || 'planned', date || null, time_start || null, time_end || null,
       venue_id || null, max_participants || 25, price === '' || price == null ? null : price,
       early_bird_price === '' || early_bird_price == null ? null : early_bird_price, early_bird_deadline || null, description || null]
    );

    res.json({ id: result.insertId, message: 'Taller creado' });
  } catch (err) {
    console.error('[workshops POST]', err);
    res.status(500).json({ error: 'Error creando taller' });
  }
});

// PUT /api/workshops/:id — editar taller
router.put('/:id', authMiddleware, tenantMiddleware, async (req, res) => {
  try {
    const fields = ['name', 'type', 'modality', 'status', 'date', 'time_start', 'time_end',
                    'venue_id', 'max_participants', 'price', 'early_bird_price',
                    'early_bird_deadline', 'description'];
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
    await query(`UPDATE workshops SET ${updates.join(', ')} WHERE id = ? AND tenant_id = ?`, params);
    res.json({ message: 'Taller actualizado' });
  } catch (err) {
    console.error('[workshops PUT]', err);
    res.status(500).json({ error: 'Error actualizando taller' });
  }
});

// DELETE /api/workshops/:id
router.delete('/:id', authMiddleware, tenantMiddleware, async (req, res) => {
  try {
    await query('DELETE FROM workshops WHERE id = ? AND tenant_id = ?', [req.params.id, req.tenantId]);
    res.json({ message: 'Taller eliminado' });
  } catch (err) {
    console.error('[workshops DELETE]', err);
    res.status(500).json({ error: 'Error eliminando taller' });
  }
});

// --- VENUES ---

// POST /api/workshops/venues
router.post('/venues', authMiddleware, tenantMiddleware, async (req, res) => {
  try {
    const { name, address, city, capacity, cost_per_use, contact_phone, maps_url, notes } = req.body;
    if (!name) return res.status(400).json({ error: 'Nombre requerido' });

    const result = await query(
      `INSERT INTO venues (tenant_id, name, address, city, capacity, cost_per_use, contact_phone, maps_url, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.tenantId, name, address || null, city || null, capacity || null,
       cost_per_use || null, contact_phone || null, maps_url || null, notes || null]
    );
    res.json({ id: result.insertId, message: 'Venue creado' });
  } catch (err) {
    console.error('[venues POST]', err);
    res.status(500).json({ error: 'Error' });
  }
});

module.exports = router;
