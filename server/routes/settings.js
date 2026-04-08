const express = require('express');
const multer = require('multer');
const authMiddleware = require('../middleware/auth');
const { tenantMiddleware } = require('../middleware/tenant');
const {
  getPaymentSettings,
  updatePaymentSettings,
  updatePaymentQrAsset,
  getPaymentQrAsset,
} = require('../services/paymentOptions');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });

function requireManager(req, res, next) {
  if (!['owner', 'admin'].includes(req.user?.role)) {
    return res.status(403).json({ error: 'No tienes permiso para editar configuración' });
  }
  next();
}

router.get('/payment-options', authMiddleware, tenantMiddleware, async (req, res) => {
  try {
    const settings = await getPaymentSettings(req.tenantId);
    res.json(settings);
  } catch (err) {
    console.error('[settings/payment-options GET]', err);
    res.status(500).json({ error: 'Error cargando configuración de pago' });
  }
});

router.put('/payment-options', authMiddleware, tenantMiddleware, requireManager, async (req, res) => {
  try {
    await updatePaymentSettings(req.tenantId, req.body || {});
    const updated = await getPaymentSettings(req.tenantId);
    res.json(updated);
  } catch (err) {
    console.error('[settings/payment-options PUT]', err);
    res.status(500).json({ error: 'Error guardando configuración de pago' });
  }
});

router.post('/payment-options/:slot/qr', authMiddleware, tenantMiddleware, requireManager, upload.single('file'), async (req, res) => {
  try {
    const slot = Number(req.params.slot);
    if (![1, 2, 3, 4].includes(slot)) {
      return res.status(400).json({ error: 'Slot inválido' });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'Archivo requerido' });
    }

    await updatePaymentQrAsset(req.tenantId, slot, req.file.buffer, req.file.mimetype);
    res.json({ success: true });
  } catch (err) {
    console.error('[settings/payment-options QR POST]', err);
    res.status(500).json({ error: 'Error subiendo QR' });
  }
});

router.get('/payment-options/:slot/qr', authMiddleware, async (req, res) => {
  try {
    const asset = await getPaymentQrAsset(req.tenantId, Number(req.params.slot));
    if (!asset) {
      return res.status(404).json({ error: 'QR no encontrado' });
    }

    res.set('Content-Type', asset.mime_type);
    res.send(asset.data);
  } catch (err) {
    console.error('[settings/payment-options QR GET]', err);
    res.status(500).json({ error: 'Error cargando QR' });
  }
});

module.exports = router;
