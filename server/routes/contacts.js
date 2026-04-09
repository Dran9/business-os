const express = require('express');
const { query } = require('../db');
const { classifyName } = require('../services/nameClassifier');

const router = express.Router();

function normalizeEmpty(value) {
  return value === '' ? null : value;
}

async function getContactCounts(tenantId, contactId) {
  const rows = await query(
    `SELECT
       (
         SELECT COUNT(*)
         FROM leads l
         WHERE l.tenant_id = ? AND l.contact_id = ? AND l.deleted_at IS NULL
       ) AS times_inquired,
       (
         SELECT COUNT(*)
         FROM enrollments e
         JOIN leads l ON l.id = e.lead_id
         WHERE e.tenant_id = ?
           AND l.tenant_id = ?
           AND l.contact_id = ?
           AND l.deleted_at IS NULL
           AND e.status = 'confirmed'
       ) AS times_purchased`,
    [tenantId, contactId, tenantId, tenantId, contactId]
  );
  return {
    times_inquired: Number(rows[0]?.times_inquired || 0),
    times_purchased: Number(rows[0]?.times_purchased || 0),
  };
}

router.get('/', async (req, res) => {
  try {
    const { label, name_quality, search, page = 1, limit = 50 } = req.query;
    const safePage = Math.max(1, Number(page) || 1);
    const safeLimit = Math.max(1, Math.min(200, Number(limit) || 50));
    const offset = (safePage - 1) * safeLimit;

    let sql = `SELECT c.*,
                      (
                        SELECT COUNT(*)
                        FROM leads l
                        WHERE l.tenant_id = c.tenant_id AND l.contact_id = c.id AND l.deleted_at IS NULL
                      ) AS times_inquired,
                      (
                        SELECT COUNT(*)
                        FROM enrollments e
                        JOIN leads l2 ON l2.id = e.lead_id
                        WHERE e.tenant_id = c.tenant_id
                          AND l2.tenant_id = c.tenant_id
                          AND l2.contact_id = c.id
                          AND l2.deleted_at IS NULL
                          AND e.status = 'confirmed'
                      ) AS times_purchased
               FROM contacts c
               WHERE c.tenant_id = ? AND c.deleted_at IS NULL`;
    const params = [req.tenantId];

    if (label) {
      sql += ' AND c.label = ?';
      params.push(label);
    }

    if (name_quality) {
      sql += ' AND c.name_quality = ?';
      params.push(name_quality);
    }

    if (search) {
      sql += ' AND (c.phone LIKE ? OR COALESCE(c.wa_name, "") LIKE ? OR COALESCE(c.clean_name, "") LIKE ?)';
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    sql += ' ORDER BY COALESCE(c.last_contact_at, c.created_at) DESC, c.id DESC LIMIT ? OFFSET ?';
    params.push(safeLimit, offset);

    const rows = await query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error('[contacts GET]', err);
    res.status(500).json({ error: 'Error cargando contactos' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const rows = await query(
      'SELECT * FROM contacts WHERE tenant_id = ? AND id = ? AND deleted_at IS NULL LIMIT 1',
      [req.tenantId, Number(req.params.id)]
    );

    const contact = rows[0];
    if (!contact) {
      return res.status(404).json({ error: 'Contacto no encontrado' });
    }

    const [counts, leads] = await Promise.all([
      getContactCounts(req.tenantId, contact.id),
      query(
        `SELECT l.*,
                (
                  SELECT w.name
                  FROM conversations c
                  LEFT JOIN workshops w ON w.id = c.workshop_id
                  WHERE c.tenant_id = l.tenant_id AND c.lead_id = l.id
                  ORDER BY COALESCE(c.last_message_at, c.started_at) DESC, c.id DESC
                  LIMIT 1
                ) AS workshop_name
         FROM leads l
         WHERE l.tenant_id = ? AND l.contact_id = ? AND l.deleted_at IS NULL
         ORDER BY COALESCE(l.last_contact_at, l.created_at) DESC, l.id DESC`,
        [req.tenantId, contact.id]
      ),
    ]);

    res.json({
      ...contact,
      ...counts,
      leads,
    });
  } catch (err) {
    console.error('[contacts GET/:id]', err);
    res.status(500).json({ error: 'Error cargando contacto' });
  }
});

router.post('/', async (req, res) => {
  try {
    const phone = String(req.body?.phone || '').trim();
    if (!phone) {
      return res.status(400).json({ error: 'Teléfono requerido' });
    }

    const existing = await query(
      'SELECT id, deleted_at FROM contacts WHERE tenant_id = ? AND phone = ? LIMIT 1',
      [req.tenantId, phone]
    );

    const { quality, cleanName } = classifyName(req.body?.wa_name);

    if (existing[0] && !existing[0].deleted_at) {
      return res.status(400).json({ error: 'Ya existe un contacto con ese teléfono' });
    }

    if (existing[0]?.deleted_at) {
      await query(
        `UPDATE contacts
         SET wa_name = ?, clean_name = ?, name_quality = ?, label = ?, city = ?, needs_review = ?,
             review_reason = ?, notes = ?, deleted_at = NULL, last_contact_at = NOW(), updated_at = NOW()
         WHERE tenant_id = ? AND id = ?`,
        [
          normalizeEmpty(req.body?.wa_name) || null,
          cleanName,
          quality,
          req.body?.label || 'cold',
          normalizeEmpty(req.body?.city) || null,
          Boolean(req.body?.needs_review),
          req.body?.needs_review ? normalizeEmpty(req.body?.review_reason) || null : null,
          normalizeEmpty(req.body?.notes) || null,
          req.tenantId,
          existing[0].id,
        ]
      );
      const restored = await query(
        'SELECT * FROM contacts WHERE tenant_id = ? AND id = ? LIMIT 1',
        [req.tenantId, existing[0].id]
      );
      return res.json(restored[0]);
    }

    const result = await query(
      `INSERT INTO contacts (
         tenant_id, phone, wa_name, clean_name, name_quality, label, city,
         needs_review, review_reason, notes, first_contact_at, last_contact_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
      [
        req.tenantId,
        phone,
        normalizeEmpty(req.body?.wa_name) || null,
        cleanName,
        quality,
        req.body?.label || 'cold',
        normalizeEmpty(req.body?.city) || null,
        Boolean(req.body?.needs_review),
        req.body?.needs_review ? normalizeEmpty(req.body?.review_reason) || null : null,
        normalizeEmpty(req.body?.notes) || null,
      ]
    );

    const created = await query(
      'SELECT * FROM contacts WHERE tenant_id = ? AND id = ? LIMIT 1',
      [req.tenantId, result.insertId]
    );
    res.status(201).json(created[0]);
  } catch (err) {
    console.error('[contacts POST]', err);
    res.status(500).json({ error: 'Error creando contacto' });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const rows = await query(
      'SELECT * FROM contacts WHERE tenant_id = ? AND id = ? AND deleted_at IS NULL LIMIT 1',
      [req.tenantId, Number(req.params.id)]
    );
    const contact = rows[0];
    if (!contact) {
      return res.status(404).json({ error: 'Contacto no encontrado' });
    }

    const nextWaName = req.body?.wa_name !== undefined ? normalizeEmpty(req.body.wa_name) : contact.wa_name;
    const classification = req.body?.wa_name !== undefined
      ? classifyName(nextWaName)
      : { quality: contact.name_quality, cleanName: contact.clean_name };

    const nextPhone = req.body?.phone !== undefined ? String(req.body.phone || '').trim() : contact.phone;
    if (!nextPhone) {
      return res.status(400).json({ error: 'Teléfono requerido' });
    }

    await query(
      `UPDATE contacts
       SET phone = ?, wa_name = ?, clean_name = ?, name_quality = ?, label = ?, city = ?,
           needs_review = ?, review_reason = ?, notes = ?, last_contact_at = last_contact_at
       WHERE tenant_id = ? AND id = ?`,
      [
        nextPhone,
        nextWaName || null,
        classification.cleanName,
        classification.quality,
        req.body?.label !== undefined ? req.body.label : contact.label,
        req.body?.city !== undefined ? normalizeEmpty(req.body.city) : contact.city,
        req.body?.needs_review !== undefined ? Boolean(req.body.needs_review) : Boolean(contact.needs_review),
        req.body?.needs_review === false
          ? null
          : req.body?.review_reason !== undefined
            ? normalizeEmpty(req.body.review_reason)
            : contact.review_reason,
        req.body?.notes !== undefined ? normalizeEmpty(req.body.notes) : contact.notes,
        req.tenantId,
        contact.id,
      ]
    );

    const updated = await query(
      'SELECT * FROM contacts WHERE tenant_id = ? AND id = ? LIMIT 1',
      [req.tenantId, contact.id]
    );
    res.json(updated[0]);
  } catch (err) {
    console.error('[contacts PUT]', err);
    res.status(500).json({ error: 'Error actualizando contacto' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const contactRows = await query(
      'SELECT id FROM contacts WHERE tenant_id = ? AND id = ? AND deleted_at IS NULL LIMIT 1',
      [req.tenantId, Number(req.params.id)]
    );
    const contact = contactRows[0];
    if (!contact) {
      return res.status(404).json({ error: 'Contacto no encontrado' });
    }

    await query(
      'UPDATE contacts SET deleted_at = NOW() WHERE tenant_id = ? AND id = ?',
      [req.tenantId, contact.id]
    );
    await query(
      'UPDATE leads SET deleted_at = NOW() WHERE tenant_id = ? AND contact_id = ?',
      [req.tenantId, contact.id]
    );
    await query(
      `UPDATE flow_sessions
       SET status = 'abandoned'
       WHERE tenant_id = ?
         AND lead_id IN (
           SELECT id FROM leads WHERE tenant_id = ? AND contact_id = ?
         )`,
      [req.tenantId, req.tenantId, contact.id]
    );

    res.json({ message: 'Contacto eliminado' });
  } catch (err) {
    console.error('[contacts DELETE]', err);
    res.status(500).json({ error: 'Error eliminando contacto' });
  }
});

module.exports = router;
