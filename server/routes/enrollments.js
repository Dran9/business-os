const express = require('express');
const authMiddleware = require('../middleware/auth');
const { tenantMiddleware } = require('../middleware/tenant');
const { query, queryPaginated } = require('../db');
const {
  getEnrollmentWithRelations,
  resendPaymentInstructions,
  resendPaymentQr,
  confirmEnrollmentPayment,
  rejectEnrollmentPayment,
} = require('../services/enrollments');

const router = express.Router();

function requireManager(req, res, next) {
  if (!['owner', 'admin'].includes(req.user?.role)) {
    return res.status(403).json({ error: 'No tienes permiso para gestionar inscripciones' });
  }
  next();
}

router.get('/', authMiddleware, tenantMiddleware, async (req, res) => {
  try {
    const { workshop_id, state, assigned_to, search, page = 1, limit = 50 } = req.query;
    let sql = `
      SELECT e.id, e.tenant_id, e.workshop_id, e.lead_id, e.status, e.amount_paid, e.amount_due,
             e.payment_status, e.enrolled_at, e.confirmed_at, e.cancelled_at,
             e.payment_requested_at, e.verified_at, e.payment_proof_type, e.ocr_data, e.notes,
             l.name AS lead_name, l.phone AS lead_phone,
             w.name AS workshop_name, w.date AS workshop_date,
             c.assigned_to,
             CASE
               WHEN e.payment_status = 'paid' OR e.status = 'confirmed' THEN 'confirmed'
               WHEN e.payment_proof IS NOT NULL
                 AND JSON_UNQUOTE(JSON_EXTRACT(e.ocr_data, '$.validation_problems[0].type')) IS NOT NULL THEN 'mismatch'
               WHEN e.payment_proof IS NOT NULL THEN 'proof_received'
               ELSE 'pending'
             END AS review_state
      FROM enrollments e
      JOIN leads l ON l.id = e.lead_id
      JOIN workshops w ON w.id = e.workshop_id
      LEFT JOIN conversations c
        ON c.id = (
          SELECT c2.id
          FROM conversations c2
          WHERE c2.tenant_id = e.tenant_id
            AND c2.lead_id = e.lead_id
            AND (c2.workshop_id = e.workshop_id OR c2.workshop_id IS NULL)
          ORDER BY c2.started_at DESC
          LIMIT 1
        )
      WHERE e.tenant_id = ?`;
    const params = [req.tenantId];

    if (workshop_id) {
      sql += ' AND e.workshop_id = ?';
      params.push(Number(workshop_id));
    }

    if (assigned_to) {
      if (assigned_to === 'bot') {
        sql += " AND COALESCE(c.assigned_to, 'bot') = 'bot'";
      } else {
        sql += ' AND c.assigned_to = ?';
        params.push(assigned_to);
      }
    }

    if (search) {
      sql += ' AND (l.name LIKE ? OR l.phone LIKE ? OR w.name LIKE ?)';
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    if (state) {
      sql += `
        AND (
          CASE
            WHEN e.payment_status = 'paid' OR e.status = 'confirmed' THEN 'confirmed'
            WHEN e.payment_proof IS NOT NULL
              AND JSON_UNQUOTE(JSON_EXTRACT(e.ocr_data, '$.validation_problems[0].type')) IS NOT NULL THEN 'mismatch'
            WHEN e.payment_proof IS NOT NULL THEN 'proof_received'
            ELSE 'pending'
          END
        ) = ?`;
      params.push(state);
    }

    sql += ' ORDER BY COALESCE(e.verified_at, e.confirmed_at, e.enrolled_at) DESC';
    const result = await queryPaginated(sql, params, { page: Number(page), limit: Number(limit) });

    result.data = result.data.map((item) => {
      let ocrData = null;
      try {
        ocrData = item.ocr_data ? JSON.parse(item.ocr_data) : null;
      } catch {
        ocrData = null;
      }
      return { ...item, ocr_data: ocrData };
    });

    res.json(result);
  } catch (err) {
    console.error('[enrollments GET]', err);
    res.status(500).json({ error: 'Error cargando inscripciones' });
  }
});

router.post('/:id/confirm', authMiddleware, tenantMiddleware, requireManager, async (req, res) => {
  try {
    const enrollment = await confirmEnrollmentPayment(req.tenantId, Number(req.params.id), req.body?.amount);
    res.json({ message: 'Pago confirmado', enrollment });
  } catch (err) {
    console.error('[enrollments confirm]', err);
    res.status(500).json({ error: err.message || 'Error confirmando pago' });
  }
});

router.post('/:id/reject', authMiddleware, tenantMiddleware, requireManager, async (req, res) => {
  try {
    const enrollment = await rejectEnrollmentPayment(req.tenantId, Number(req.params.id), req.body?.reason || '');
    res.json({ message: 'Comprobante marcado como mismatch', enrollment });
  } catch (err) {
    console.error('[enrollments reject]', err);
    res.status(500).json({ error: err.message || 'Error rechazando comprobante' });
  }
});

router.post('/:id/resend-qr', authMiddleware, tenantMiddleware, requireManager, async (req, res) => {
  try {
    const enrollment = await getEnrollmentWithRelations(req.tenantId, Number(req.params.id));
    if (!enrollment) {
      return res.status(404).json({ error: 'Inscripción no encontrada' });
    }
    const result = await resendPaymentQr(req.tenantId, enrollment);
    res.json({ message: 'QR reenviado', result });
  } catch (err) {
    console.error('[enrollments resend-qr]', err);
    res.status(500).json({ error: err.message || 'Error reenviando QR' });
  }
});

router.post('/:id/resend-instructions', authMiddleware, tenantMiddleware, requireManager, async (req, res) => {
  try {
    const enrollment = await getEnrollmentWithRelations(req.tenantId, Number(req.params.id));
    if (!enrollment) {
      return res.status(404).json({ error: 'Inscripción no encontrada' });
    }
    const result = await resendPaymentInstructions(req.tenantId, enrollment);
    res.json({ message: 'Instrucciones reenviadas', result });
  } catch (err) {
    console.error('[enrollments resend-instructions]', err);
    res.status(500).json({ error: err.message || 'Error reenviando instrucciones' });
  }
});

module.exports = router;
