const express = require('express');
const authMiddleware = require('../middleware/auth');
const { tenantMiddleware } = require('../middleware/tenant');
const { query, queryPaginated } = require('../db');
const {
  getEnrollmentWithRelations,
  getEnrollmentProofAsset,
  getReviewState,
  resendPaymentInstructions,
  resendPaymentQr,
  updateEnrollmentAttendance,
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
      SELECT e.id, e.tenant_id, e.workshop_id, e.lead_id, e.status, e.participant_role,
             e.attendance_status, e.amount_paid, e.amount_due, e.payment_status, e.payment_method,
             e.enrolled_at, e.confirmed_at, e.cancelled_at,
             e.payment_requested_at, e.verified_at, e.payment_recorded_at, e.payment_proof_type, e.ocr_data, e.notes,
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
      return {
        ...item,
        ocr_data: ocrData,
        participant_role: item.participant_role || (String(item.notes || '').includes('Modalidad: constelar') ? 'constela' : 'participa'),
        attendance_status: item.attendance_status || 'pending',
        payment_proof_present: Boolean(item.payment_proof_type),
      };
    });

    res.json(result);
  } catch (err) {
    console.error('[enrollments GET]', err);
    res.status(500).json({ error: 'Error cargando inscripciones' });
  }
});

router.get('/:id', authMiddleware, tenantMiddleware, async (req, res) => {
  try {
    const enrollment = await getEnrollmentWithRelations(req.tenantId, Number(req.params.id));
    if (!enrollment) {
      return res.status(404).json({ error: 'Inscripción no encontrada' });
    }
    res.json({
      ...enrollment,
      review_state: getReviewState(enrollment),
    });
  } catch (err) {
    console.error('[enrollments GET/:id]', err);
    res.status(500).json({ error: 'Error cargando inscripción' });
  }
});

router.get('/:id/proof', authMiddleware, tenantMiddleware, async (req, res) => {
  try {
    const asset = await getEnrollmentProofAsset(req.tenantId, Number(req.params.id));
    if (!asset) {
      return res.status(404).json({ error: 'Comprobante no encontrado' });
    }
    res.setHeader('Content-Type', asset.mime_type);
    res.setHeader('Cache-Control', 'no-store');
    res.send(asset.data);
  } catch (err) {
    console.error('[enrollments proof]', err);
    res.status(500).json({ error: 'Error cargando comprobante' });
  }
});

router.post('/:id/confirm', authMiddleware, tenantMiddleware, requireManager, async (req, res) => {
  try {
    const enrollment = await confirmEnrollmentPayment(req.tenantId, Number(req.params.id), req.body?.amount, {
      actor: req.user?.username,
      paymentMethod: req.body?.payment_method || undefined,
    });
    res.json({ message: 'Pago confirmado', enrollment });
  } catch (err) {
    console.error('[enrollments confirm]', err);
    res.status(500).json({ error: err.message || 'Error confirmando pago' });
  }
});

router.put('/:id/attendance', authMiddleware, tenantMiddleware, async (req, res) => {
  try {
    const enrollment = await updateEnrollmentAttendance(
      req.tenantId,
      Number(req.params.id),
      req.body?.attendance_status,
      req.user?.username
    );
    res.json({ message: 'Asistencia actualizada', enrollment });
  } catch (err) {
    console.error('[enrollments attendance PUT]', err);
    res.status(500).json({ error: err.message || 'Error actualizando asistencia' });
  }
});

router.post('/:id/confirm-onsite', authMiddleware, tenantMiddleware, async (req, res) => {
  try {
    const enrollmentId = Number(req.params.id);
    const enrollment = await getEnrollmentWithRelations(req.tenantId, enrollmentId);
    if (!enrollment) {
      return res.status(404).json({ error: 'Inscripción no encontrada' });
    }
    if (enrollment.payment_status === 'paid') {
      return res.status(400).json({ error: 'Esta inscripción ya está pagada' });
    }
    if (enrollment.payment_method !== 'onsite') {
      return res.status(400).json({ error: 'Esta inscripción no está marcada como pago en sitio' });
    }

    const updated = await confirmEnrollmentPayment(req.tenantId, enrollmentId, req.body?.amount, {
      actor: req.user?.username,
      paymentMethod: 'onsite',
    });
    res.json({ message: 'Pago en sitio confirmado', enrollment: updated });
  } catch (err) {
    console.error('[enrollments confirm-onsite]', err);
    res.status(500).json({ error: err.message || 'Error confirmando pago en sitio' });
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
