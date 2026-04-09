const express = require('express');
const authMiddleware = require('../middleware/auth');
const { tenantMiddleware } = require('../middleware/tenant');
const { query, queryPaginated } = require('../db');
const { broadcast } = require('../services/adminEvents');

const router = express.Router();
const VALID_STATUSES = new Set(['draft', 'active', 'paused', 'completed']);

router.get('/summary', authMiddleware, tenantMiddleware, async (req, res) => {
  try {
    const [summary] = await query(
      `SELECT
         COUNT(*) AS total_campaigns,
         COALESCE(SUM(budget), 0) AS total_budget,
         COALESCE(SUM(spent), 0) AS total_spent,
         COALESCE(SUM(leads_generated), 0) AS total_leads,
         COALESCE(SUM(conversions), 0) AS total_conversions,
         COALESCE(SUM(revenue_generated), 0) AS total_revenue
       FROM campaigns
       WHERE tenant_id = ?`,
      [req.tenantId]
    );

    const byPlatform = await query(
      `SELECT COALESCE(platform, 'Sin plataforma') AS platform,
              COUNT(*) AS campaigns,
              COALESCE(SUM(spent), 0) AS spent,
              COALESCE(SUM(leads_generated), 0) AS leads,
              COALESCE(SUM(conversions), 0) AS conversions
       FROM campaigns
       WHERE tenant_id = ?
       GROUP BY platform
       ORDER BY spent DESC, campaigns DESC`,
      [req.tenantId]
    );

    const spent = Number(summary?.total_spent || 0);
    const revenue = Number(summary?.total_revenue || 0);
    const leads = Number(summary?.total_leads || 0);
    const conversions = Number(summary?.total_conversions || 0);

    res.json({
      total_campaigns: Number(summary?.total_campaigns || 0),
      total_budget: Number(summary?.total_budget || 0),
      total_spent: spent,
      total_leads: leads,
      total_conversions: conversions,
      total_revenue: revenue,
      profit: revenue - spent,
      roi_pct: spent > 0 ? Math.round(((revenue - spent) / spent) * 100) : null,
      cost_per_lead: leads > 0 ? spent / leads : null,
      cost_per_conversion: conversions > 0 ? spent / conversions : null,
      by_platform: byPlatform,
    });
  } catch (err) {
    console.error('[marketing summary]', err);
    res.status(500).json({ error: 'Error cargando resumen de campañas' });
  }
});

router.get('/', authMiddleware, tenantMiddleware, async (req, res) => {
  try {
    const { status, platform, workshop_id, search, page = 1, limit = 50 } = req.query;
    let sql = `SELECT c.*, w.name AS workshop_name
               FROM campaigns c
               LEFT JOIN workshops w ON w.id = c.workshop_id
               WHERE c.tenant_id = ?`;
    const params = [req.tenantId];

    if (status && VALID_STATUSES.has(status)) {
      sql += ' AND c.status = ?';
      params.push(status);
    }
    if (platform) {
      sql += ' AND c.platform = ?';
      params.push(platform);
    }
    if (workshop_id) {
      sql += ' AND c.workshop_id = ?';
      params.push(Number(workshop_id));
    }
    if (search) {
      sql += ' AND (c.name LIKE ? OR COALESCE(c.copy_text, "") LIKE ? OR COALESCE(w.name, "") LIKE ?)';
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    sql += ' ORDER BY c.created_at DESC, c.id DESC';
    const result = await queryPaginated(sql, params, { page: Number(page), limit: Number(limit) });
    res.json(result);
  } catch (err) {
    console.error('[marketing GET]', err);
    res.status(500).json({ error: 'Error cargando campañas' });
  }
});

router.post('/', authMiddleware, tenantMiddleware, async (req, res) => {
  try {
    const payload = sanitizeCampaignPayload(req.body, req.user?.role);
    if (!payload.name) {
      return res.status(400).json({ error: 'Nombre requerido' });
    }

    const result = await query(
      `INSERT INTO campaigns (
         tenant_id, workshop_id, name, platform, status, budget, spent,
         leads_generated, conversions, revenue_generated, copy_text, image_url, meta_post_id,
         started_at, ended_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        req.tenantId,
        payload.workshop_id,
        payload.name,
        payload.platform,
        payload.status,
        payload.budget,
        payload.spent,
        payload.leads_generated,
        payload.conversions,
        payload.revenue_generated,
        payload.copy_text,
        payload.image_url,
        payload.meta_post_id,
        payload.started_at,
        payload.ended_at,
      ]
    );

    broadcast('marketing:change', { id: result.insertId, reason: 'created' }, req.tenantId);
    res.json({ id: result.insertId, message: 'Campaña creada' });
  } catch (err) {
    console.error('[marketing POST]', err);
    res.status(500).json({ error: 'Error creando campaña' });
  }
});

router.put('/:id', authMiddleware, tenantMiddleware, async (req, res) => {
  try {
    const payload = sanitizeCampaignPayload(req.body, req.user?.role);
    const updates = [];
    const params = [];

    for (const [key, value] of Object.entries(payload)) {
      if (value !== undefined) {
        updates.push(`${key} = ?`);
        params.push(value);
      }
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'Nada que actualizar' });
    }

    params.push(Number(req.params.id), req.tenantId);
    await query(`UPDATE campaigns SET ${updates.join(', ')} WHERE id = ? AND tenant_id = ?`, params);
    broadcast('marketing:change', { id: Number(req.params.id), reason: 'updated' }, req.tenantId);
    res.json({ message: 'Campaña actualizada' });
  } catch (err) {
    console.error('[marketing PUT]', err);
    res.status(500).json({ error: 'Error actualizando campaña' });
  }
});

router.delete('/:id', authMiddleware, tenantMiddleware, async (req, res) => {
  try {
    await query('DELETE FROM campaigns WHERE id = ? AND tenant_id = ?', [Number(req.params.id), req.tenantId]);
    broadcast('marketing:change', { id: Number(req.params.id), reason: 'deleted' }, req.tenantId);
    res.json({ message: 'Campaña eliminada' });
  } catch (err) {
    console.error('[marketing DELETE]', err);
    res.status(500).json({ error: 'Error eliminando campaña' });
  }
});

function sanitizeCampaignPayload(body) {
  const payload = {};

  if (body.workshop_id !== undefined) payload.workshop_id = body.workshop_id ? Number(body.workshop_id) : null;
  if (body.name !== undefined) payload.name = String(body.name || '').trim();
  if (body.platform !== undefined) payload.platform = body.platform ? String(body.platform).trim() : null;
  if (body.status !== undefined) {
    if (!VALID_STATUSES.has(body.status)) throw new Error('Estado inválido');
    payload.status = body.status;
  }
  if (body.budget !== undefined) payload.budget = body.budget === '' || body.budget == null ? null : Number(body.budget);
  if (body.spent !== undefined) payload.spent = body.spent === '' || body.spent == null ? 0 : Number(body.spent);
  if (body.leads_generated !== undefined) payload.leads_generated = body.leads_generated === '' || body.leads_generated == null ? 0 : Number(body.leads_generated);
  if (body.conversions !== undefined) payload.conversions = body.conversions === '' || body.conversions == null ? 0 : Number(body.conversions);
  if (body.revenue_generated !== undefined) payload.revenue_generated = body.revenue_generated === '' || body.revenue_generated == null ? 0 : Number(body.revenue_generated);
  if (body.copy_text !== undefined) payload.copy_text = body.copy_text || null;
  if (body.image_url !== undefined) payload.image_url = body.image_url || null;
  if (body.meta_post_id !== undefined) payload.meta_post_id = body.meta_post_id || null;
  if (body.started_at !== undefined) payload.started_at = body.started_at || null;
  if (body.ended_at !== undefined) payload.ended_at = body.ended_at || null;

  return payload;
}

module.exports = router;
