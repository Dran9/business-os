const express = require('express');
const authMiddleware = require('../middleware/auth');
const { tenantMiddleware } = require('../middleware/tenant');
const { query } = require('../db');
const { getAgendaClientBundle, searchAgendaClients, resolveAgendaConfig } = require('../services/agendaBridge');

const router = express.Router();

router.get('/status', authMiddleware, tenantMiddleware, async (req, res) => {
  const config = resolveAgendaConfig();
  res.json({
    configured: Boolean(config),
    source: config?.source || null,
    tenant_id: config?.tenantId || null,
  });
});

router.get('/search', authMiddleware, tenantMiddleware, async (req, res) => {
  try {
    const results = await searchAgendaClients(req.query.query || '', Number(req.query.limit || 8));
    res.json(results);
  } catch (err) {
    if (err.code === 'AGENDA_UNAVAILABLE') {
      return res.status(503).json({ error: 'Agenda 4.0 no configurada' });
    }
    console.error('[agenda search]', err);
    res.status(500).json({ error: 'Error buscando clientes en Agenda 4.0' });
  }
});

router.get('/lead/:leadId', authMiddleware, tenantMiddleware, async (req, res) => {
  try {
    const rows = await query(
      'SELECT id, phone, name, agenda_client_id FROM leads WHERE id = ? AND tenant_id = ? LIMIT 1',
      [Number(req.params.leadId), req.tenantId]
    );
    if (!rows[0]) {
      return res.status(404).json({ error: 'Lead no encontrado' });
    }

    const lead = rows[0];
    const bundle = await getAgendaClientBundle({
      agendaClientId: lead.agenda_client_id,
      phone: lead.phone,
      name: lead.name,
    });

    res.json({
      lead_id: lead.id,
      agenda_client_id: lead.agenda_client_id || bundle.client?.id || null,
      ...bundle,
    });
  } catch (err) {
    if (err.code === 'AGENDA_UNAVAILABLE') {
      return res.status(503).json({ error: 'Agenda 4.0 no configurada' });
    }
    console.error('[agenda lead]', err);
    res.status(500).json({ error: 'Error consultando Agenda 4.0' });
  }
});

module.exports = router;
