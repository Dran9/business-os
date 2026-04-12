const express = require('express');
const authMiddleware = require('../middleware/auth');
const { tenantMiddleware } = require('../middleware/tenant');
const { query, queryPaginated, withTransaction } = require('../db');
const { classifyName } = require('../services/nameClassifier');
const { broadcast } = require('../services/adminEvents');
const { logActivity } = require('../services/activityLog');
const { getEnrollmentWithRelations, confirmEnrollmentPayment } = require('../services/enrollments');

const router = express.Router();

function normalizeParticipantRole(value) {
  return value === 'constela' ? 'constela' : 'participa';
}

function normalizePaymentState(value) {
  if (value === 'paid' || value === 'onsite') return value;
  return 'pending';
}

function normalizeAttendanceStatus(value) {
  if (value === 'present' || value === 'absent') return value;
  return 'pending';
}

function deriveDefaultAmount(participantRole) {
  return participantRole === 'constela' ? 250 : 150;
}

function mapAttendanceRow(row) {
  return {
    ...row,
    participant_role: normalizeParticipantRole(row.participant_role),
    attendance_status: normalizeAttendanceStatus(row.attendance_status),
    payment_state: row.payment_status === 'paid' ? 'paid' : (row.payment_method === 'onsite' ? 'onsite' : 'pending'),
  };
}

async function getWorkshopById(tenantId, workshopId) {
  const rows = await query(
    `SELECT w.*, v.name as venue_name, v.address as venue_address, v.city as venue_city
     FROM workshops w LEFT JOIN venues v ON v.id = w.venue_id
     WHERE w.id = ? AND w.tenant_id = ?`,
    [workshopId, tenantId]
  );
  return rows[0] || null;
}

async function upsertContact(conn, tenantId, phone, fullName) {
  if (!phone) return null;

  const [existingRows] = await conn.execute(
    'SELECT id, wa_name, clean_name, name_quality, deleted_at FROM contacts WHERE tenant_id = ? AND phone = ? LIMIT 1',
    [tenantId, phone]
  );

  const { quality, cleanName } = classifyName(fullName);

  if (existingRows[0]) {
    const contact = existingRows[0];
    await conn.execute(
      `UPDATE contacts
       SET wa_name = COALESCE(NULLIF(?, ''), wa_name),
           clean_name = COALESCE(?, clean_name),
           name_quality = CASE
             WHEN ? = 'nombre_completo' THEN 'nombre_completo'
             WHEN name_quality = 'sin_nombre' THEN ?
             ELSE name_quality
           END,
           deleted_at = NULL,
           last_contact_at = NOW(),
           updated_at = NOW()
       WHERE tenant_id = ? AND id = ?`,
      [fullName || null, cleanName, quality, quality, tenantId, contact.id]
    );
    return contact.id;
  }

  const [result] = await conn.execute(
    `INSERT INTO contacts (
       tenant_id, phone, wa_name, clean_name, name_quality, label,
       first_contact_at, last_contact_at
     ) VALUES (?, ?, ?, ?, ?, 'cold', NOW(), NOW())`,
    [tenantId, phone, fullName || null, cleanName, quality]
  );

  return result.insertId;
}

async function upsertLead(conn, tenantId, phone, fullName, contactId) {
  let lead = null;

  if (phone) {
    const [rows] = await conn.execute(
      'SELECT id, name, status, contact_id, deleted_at FROM leads WHERE tenant_id = ? AND phone = ? LIMIT 1',
      [tenantId, phone]
    );
    lead = rows[0] || null;
  }

  if (lead) {
    const shouldReplaceName = fullName && (!lead.name || fullName.length > String(lead.name || '').length);
    await conn.execute(
      `UPDATE leads
       SET name = ?,
           contact_id = COALESCE(?, contact_id),
           deleted_at = NULL,
           last_contact_at = NOW(),
           updated_at = NOW()
       WHERE tenant_id = ? AND id = ?`,
      [shouldReplaceName ? fullName : lead.name, contactId || null, tenantId, lead.id]
    );
    return lead.id;
  }

  const [result] = await conn.execute(
    `INSERT INTO leads (
       tenant_id, phone, name, source, source_detail, status, contact_id,
       notes, first_contact_at, last_contact_at
     ) VALUES (?, ?, ?, 'manual', 'attendance_module', 'qualified', ?, ?, NOW(), NOW())`,
    [tenantId, phone || null, fullName || null, contactId || null, 'Alta manual desde control de asistencia']
  );

  return result.insertId;
}

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

router.get('/:id/attendance', authMiddleware, tenantMiddleware, async (req, res) => {
  try {
    const workshop = await getWorkshopById(req.tenantId, Number(req.params.id));
    if (!workshop) return res.status(404).json({ error: 'Taller no encontrado' });

    const rows = await query(
      `SELECT e.id, e.lead_id, e.status, e.participant_role, e.attendance_status,
              e.attendance_marked_at, e.attendance_marked_by,
              e.amount_paid, e.amount_due, e.payment_status, e.payment_method,
              e.confirmed_at, e.payment_recorded_at, e.payment_recorded_by,
              e.enrolled_at, e.notes,
              l.name AS lead_name, l.phone AS lead_phone
       FROM enrollments e
       JOIN leads l ON l.id = e.lead_id
       WHERE e.tenant_id = ? AND e.workshop_id = ? AND e.status NOT IN ('cancelled', 'waitlist')
       ORDER BY COALESCE(l.name, ''), e.id`,
      [req.tenantId, Number(req.params.id)]
    );

    res.json({
      workshop,
      attendees: rows.map(mapAttendanceRow),
    });
  } catch (err) {
    console.error('[workshops GET/:id/attendance]', err);
    res.status(500).json({ error: 'Error cargando control de asistencia' });
  }
});

router.post('/:id/attendance/manual-entry', authMiddleware, tenantMiddleware, async (req, res) => {
  try {
    const workshopId = Number(req.params.id);
    const workshop = await getWorkshopById(req.tenantId, workshopId);
    if (!workshop) {
      return res.status(404).json({ error: 'Taller no encontrado' });
    }

    const fullName = String(req.body?.full_name || '').trim();
    const phone = String(req.body?.phone || '').trim();
    const participantRole = normalizeParticipantRole(req.body?.participant_role);
    const paymentState = normalizePaymentState(req.body?.payment_state);
    const amountRaw = req.body?.amount;
    const amount = amountRaw === '' || amountRaw == null
      ? deriveDefaultAmount(participantRole)
      : Number(amountRaw);

    if (!fullName) {
      return res.status(400).json({ error: 'Nombre completo requerido' });
    }
    if (!(amount > 0)) {
      return res.status(400).json({ error: 'Monto inválido' });
    }

    const creation = await withTransaction(async (conn) => {
      const contactId = await upsertContact(conn, req.tenantId, phone, fullName);
      const leadId = await upsertLead(conn, req.tenantId, phone, fullName, contactId);

      const [existingEnrollments] = await conn.execute(
        'SELECT id FROM enrollments WHERE tenant_id = ? AND workshop_id = ? AND lead_id = ? LIMIT 1',
        [req.tenantId, workshopId, leadId]
      );
      if (existingEnrollments[0]) {
        throw new Error('Ese participante ya está inscrito en este taller');
      }

      const paymentMethod = paymentState === 'onsite'
        ? 'onsite'
        : (paymentState === 'paid' ? 'manual' : 'unknown');

      const [result] = await conn.execute(
        `INSERT INTO enrollments (
           tenant_id, workshop_id, lead_id, status, participant_role,
           attendance_status, amount_due, payment_status, payment_method, notes
         ) VALUES (?, ?, ?, 'pending', ?, 'pending', ?, 'unpaid', ?, ?)`,
        [
          req.tenantId,
          workshopId,
          leadId,
          participantRole,
          amount,
          paymentMethod,
          'Alta manual desde control de asistencia',
        ]
      );

      return { enrollmentId: result.insertId, leadId };
    });

    let enrollment = await getEnrollmentWithRelations(req.tenantId, creation.enrollmentId);

    if (paymentState === 'paid') {
      enrollment = await confirmEnrollmentPayment(req.tenantId, creation.enrollmentId, amount, {
        actor: req.user?.username,
        paymentMethod: 'manual',
      });
    } else {
      await logActivity({
        tenantId: req.tenantId,
        actor: req.user?.username || 'system',
        action: 'enrollment.manual_entry.create',
        targetType: 'enrollment',
        targetId: creation.enrollmentId,
        details: {
          workshop_id: workshopId,
          lead_id: creation.leadId,
          participant_role: participantRole,
          payment_state: paymentState,
          amount,
        },
      });

      broadcast('enrollment:change', { id: creation.enrollmentId, workshopId, reason: 'manual-entry-created' }, req.tenantId);
      broadcast('workshop:change', { id: workshopId, reason: 'manual-entry-created' }, req.tenantId);
      broadcast('lead:change', { id: creation.leadId, reason: 'enrollment-created' }, req.tenantId);
    }

    res.status(201).json({
      message: 'Participante agregado',
      enrollment,
    });
  } catch (err) {
    console.error('[workshops POST/:id/attendance/manual-entry]', err);
    const status = err.message === 'Ese participante ya está inscrito en este taller' ? 409 : 500;
    res.status(status).json({ error: err.message || 'Error creando participante' });
  }
});

// GET /api/workshops/:id
router.get('/:id', authMiddleware, tenantMiddleware, async (req, res) => {
  try {
    const workshop = await getWorkshopById(req.tenantId, Number(req.params.id));
    if (!workshop) return res.status(404).json({ error: 'Taller no encontrado' });
    res.json(workshop);
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
