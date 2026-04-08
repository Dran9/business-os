const express = require('express');
const bcrypt = require('bcryptjs');
const authMiddleware = require('../middleware/auth');
const { tenantMiddleware } = require('../middleware/tenant');
const { query } = require('../db');

const router = express.Router();
const VALID_ROLES = new Set(['owner', 'admin', 'viewer']);

function requireManager(req, res, next) {
  if (!['owner', 'admin'].includes(req.user?.role)) {
    return res.status(403).json({ error: 'No tienes permiso para gestionar el equipo' });
  }
  next();
}

router.get('/', authMiddleware, tenantMiddleware, requireManager, async (req, res) => {
  try {
    const rows = await query(
      `SELECT id, username, display_name, role, active, created_at
       FROM admin_users
       WHERE tenant_id = ?
       ORDER BY created_at ASC`,
      [req.tenantId]
    );
    res.json(rows);
  } catch (err) {
    console.error('[team GET]', err);
    res.status(500).json({ error: 'Error cargando equipo' });
  }
});

router.post('/', authMiddleware, tenantMiddleware, requireManager, async (req, res) => {
  try {
    const { username, display_name, pin, role } = req.body;

    if (!username || !/^[a-z0-9._-]{3,30}$/i.test(username)) {
      return res.status(400).json({ error: 'Username inválido' });
    }
    if (!pin || !/^\d{4}$/.test(pin)) {
      return res.status(400).json({ error: 'PIN de 4 dígitos requerido' });
    }
    if (!VALID_ROLES.has(role || 'viewer')) {
      return res.status(400).json({ error: 'Rol inválido' });
    }

    const existing = await query(
      'SELECT id FROM admin_users WHERE tenant_id = ? AND username = ?',
      [req.tenantId, username.trim()]
    );
    if (existing.length > 0) {
      return res.status(409).json({ error: 'Ese username ya existe' });
    }

    const passwordHash = await bcrypt.hash(pin, 12);
    const result = await query(
      `INSERT INTO admin_users (tenant_id, username, display_name, password_hash, role, active)
       VALUES (?, ?, ?, ?, ?, TRUE)`,
      [req.tenantId, username.trim(), display_name?.trim() || null, passwordHash, role || 'viewer']
    );

    res.json({ id: result.insertId, message: 'Usuario creado' });
  } catch (err) {
    console.error('[team POST]', err);
    res.status(500).json({ error: 'Error creando usuario' });
  }
});

router.put('/:id', authMiddleware, tenantMiddleware, requireManager, async (req, res) => {
  try {
    const userId = Number(req.params.id);
    const targetRows = await query(
      'SELECT id, role FROM admin_users WHERE id = ? AND tenant_id = ?',
      [userId, req.tenantId]
    );
    if (targetRows.length === 0) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    const updates = [];
    const params = [];

    if (req.body.display_name !== undefined) {
      updates.push('display_name = ?');
      params.push(req.body.display_name?.trim() || null);
    }

    if (req.body.role !== undefined) {
      if (!VALID_ROLES.has(req.body.role)) {
        return res.status(400).json({ error: 'Rol inválido' });
      }
      updates.push('role = ?');
      params.push(req.body.role);
    }

    if (req.body.active !== undefined) {
      updates.push('active = ?');
      params.push(!!req.body.active);
    }

    if (req.body.pin !== undefined && req.body.pin !== '') {
      if (!/^\d{4}$/.test(req.body.pin)) {
        return res.status(400).json({ error: 'PIN inválido' });
      }
      const passwordHash = await bcrypt.hash(req.body.pin, 12);
      updates.push('password_hash = ?');
      params.push(passwordHash);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'Nada que actualizar' });
    }

    params.push(userId, req.tenantId);
    await query(`UPDATE admin_users SET ${updates.join(', ')} WHERE id = ? AND tenant_id = ?`, params);
    res.json({ message: 'Usuario actualizado' });
  } catch (err) {
    console.error('[team PUT]', err);
    res.status(500).json({ error: 'Error actualizando usuario' });
  }
});

router.delete('/:id', authMiddleware, tenantMiddleware, requireManager, async (req, res) => {
  try {
    const userId = Number(req.params.id);
    if (req.user?.userId === userId) {
      return res.status(400).json({ error: 'No puedes eliminar tu propia cuenta' });
    }

    await query(
      'DELETE FROM admin_users WHERE id = ? AND tenant_id = ?',
      [userId, req.tenantId]
    );
    res.json({ message: 'Usuario eliminado' });
  } catch (err) {
    console.error('[team DELETE]', err);
    res.status(500).json({ error: 'Error eliminando usuario' });
  }
});

module.exports = router;
