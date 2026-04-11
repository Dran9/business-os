const express = require('express');
const multer = require('multer');
const authMiddleware = require('../middleware/auth');
const { tenantMiddleware, invalidateTenantCache } = require('../middleware/tenant');
const { getLlmSettings, updateLlmSettings } = require('../services/llmSettings');
const {
  createAiContextDocument,
  deleteAiContextDocument,
  listAiContextDocuments,
  updateAiContextDocument,
} = require('../services/aiContextDocuments');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

function requireManager(req, res, next) {
  if (!['owner', 'admin'].includes(req.user?.role)) {
    return res.status(403).json({ error: 'No tienes permiso para editar IA' });
  }
  next();
}

router.get('/settings', authMiddleware, tenantMiddleware, async (req, res) => {
  try {
    const settings = await getLlmSettings(req.tenantId);
    res.json(settings);
  } catch (err) {
    console.error('[ai/settings GET]', err);
    res.status(500).json({ error: 'Error cargando configuración de IA' });
  }
});

router.put('/settings', authMiddleware, tenantMiddleware, requireManager, async (req, res) => {
  try {
    await updateLlmSettings(req.tenantId, req.body || {});
    invalidateTenantCache(req.tenantId);
    const updated = await getLlmSettings(req.tenantId);
    res.json(updated);
  } catch (err) {
    console.error('[ai/settings PUT]', err);
    res.status(500).json({ error: 'Error guardando configuración de IA' });
  }
});

router.get('/documents', authMiddleware, tenantMiddleware, async (req, res) => {
  try {
    const documents = await listAiContextDocuments(req.tenantId);
    res.json(documents);
  } catch (err) {
    console.error('[ai/documents GET]', err);
    res.status(500).json({ error: 'Error cargando documentos IA' });
  }
});

router.post('/documents', authMiddleware, tenantMiddleware, requireManager, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Archivo requerido' });
    }

    const created = await createAiContextDocument(
      req.tenantId,
      req.file,
      req.user?.display_name || req.user?.username || null
    );
    invalidateTenantCache(req.tenantId);
    res.json(created);
  } catch (err) {
    console.error('[ai/documents POST]', err);
    res.status(500).json({ error: err.message || 'Error subiendo documento' });
  }
});

router.put('/documents/:id', authMiddleware, tenantMiddleware, requireManager, async (req, res) => {
  try {
    const updated = await updateAiContextDocument(req.tenantId, Number(req.params.id), req.body || {});
    invalidateTenantCache(req.tenantId);
    res.json(updated);
  } catch (err) {
    console.error('[ai/documents PUT]', err);
    res.status(500).json({ error: err.message || 'Error actualizando documento' });
  }
});

router.delete('/documents/:id', authMiddleware, tenantMiddleware, requireManager, async (req, res) => {
  try {
    await deleteAiContextDocument(req.tenantId, Number(req.params.id));
    invalidateTenantCache(req.tenantId);
    res.json({ success: true });
  } catch (err) {
    console.error('[ai/documents DELETE]', err);
    res.status(500).json({ error: err.message || 'Error eliminando documento' });
  }
});

module.exports = router;
