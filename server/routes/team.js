const express = require('express');
const bcrypt = require('bcryptjs');
const authMiddleware = require('../middleware/auth');
const { tenantMiddleware } = require('../middleware/tenant');
const { query } = require('../db');
const { logActivity } = require('../services/activityLog');

const router = express.Router();
const VALID_ROLES = new Set(['owner', 'admin', 'viewer']);

function requireManager(req, res, next) {
  if (!['owner', 'admin'].includes(req.user?.role)) {
    return res.status(403).json({ error: 'No tienes permiso para gestionar el equipo' });
  }
  next();
}

async function getUserById(tenantId, userId) {
  const rows = await query(
    `SELECT id, tenant_id, username, display_name, role, active, created_at
     FROM admin_users
     WHERE id = ? AND tenant_id = ?
     LIMIT 1`,
    [userId, tenantId]
  );
  return rows[0] || null;
}

async function countActiveOwners(tenantId) {
  const [row] = await query(
    `SELECT COUNT(*) AS total
     FROM admin_users
     WHERE tenant_id = ? AND role = 'owner' AND active = TRUE`,
    [tenantId]
  );
  return Number(row?.total || 0);
}

function validateUsername(username) {
  return !!username && /^[a-z0-9._-]{3,30}$/i.test(username);
}

function canManageTarget(actorRole, targetRole) {
  if (actorRole === 'owner') return true;
  if (actorRole === 'admin') return targetRole !== 'owner';
  return false;
}

function canSetRole(actorRole, nextRole) {
  if (actorRole === 'owner') return VALID_ROLES.has(nextRole);
  if (actorRole === 'admin') return nextRole === 'admin' || nextRole === 'viewer';
  return false;
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

router.get('/activity', authMiddleware, tenantMiddleware, requireManager, async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit || 30), 1), 100);
    const rows = await query(
      `SELECT id, actor, action, target_type, target_id, details, created_at
       FROM activity_log
       WHERE tenant_id = ? AND action LIKE 'team.%'
       ORDER BY created_at DESC, id DESC
       LIMIT ?`,
      [req.tenantId, limit]
    );

    res.json(rows.map((row) => {
      let details = null;
      try {
        details = row.details ? JSON.parse(row.details) : null;
      } catch {
        details = null;
      }
      return { ...row, details };
    }));
  } catch (err) {
    console.error('[team activity GET]', err);
    res.status(500).json({ error: 'Error cargando actividad del equipo' });
  }
});

router.post('/', authMiddleware, tenantMiddleware, requireManager, async (req, res) => {
  try {
    const { username, display_name, pin, role } = req.body;
    const normalizedUsername = username?.trim();
    const nextRole = role || 'viewer';

    if (!validateUsername(normalizedUsername)) {
      return res.status(400).json({ error: 'Username inválido' });
    }
    if (!pin || !/^\d{4}$/.test(pin)) {
      return res.status(400).json({ error: 'PIN de 4 dígitos requerido' });
    }
    if (!canSetRole(req.user?.role, nextRole)) {
      return res.status(403).json({ error: 'No tienes permiso para crear usuarios con ese rol' });
    }

    const existing = await query(
      'SELECT id FROM admin_users WHERE tenant_id = ? AND username = ?',
      [req.tenantId, normalizedUsername]
    );
    if (existing.length > 0) {
      return res.status(409).json({ error: 'Ese username ya existe' });
    }

    const passwordHash = await bcrypt.hash(pin, 12);
    const result = await query(
      `INSERT INTO admin_users (tenant_id, username, display_name, password_hash, role, active)
       VALUES (?, ?, ?, ?, ?, TRUE)`,
      [req.tenantId, normalizedUsername, display_name?.trim() || null, passwordHash, nextRole]
    );

    await logActivity({
      tenantId: req.tenantId,
      actor: req.user.username,
      action: 'team.user.create',
      targetType: 'admin_user',
      targetId: result.insertId,
      details: {
        username: normalizedUsername,
        display_name: display_name?.trim() || null,
        role: nextRole,
      },
    });

    res.json({ id: result.insertId, message: 'Usuario creado' });
  } catch (err) {
    console.error('[team POST]', err);
    res.status(500).json({ error: 'Error creando usuario' });
  }
});

router.put('/:id', authMiddleware, tenantMiddleware, requireManager, async (req, res) => {
  try {
    const userId = Number(req.params.id);
    const target = await getUserById(req.tenantId, userId);
    if (!target) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }
    if (!canManageTarget(req.user?.role, target.role)) {
      return res.status(403).json({ error: 'No tienes permiso para editar este usuario' });
    }

    const updates = [];
    const params = [];
    const details = {};

    if (req.body.username !== undefined) {
      const nextUsername = req.body.username?.trim();
      if (!validateUsername(nextUsername)) {
        return res.status(400).json({ error: 'Username inválido' });
      }
      if (nextUsername !== target.username) {
        const existing = await query(
          'SELECT id FROM admin_users WHERE tenant_id = ? AND username = ? AND id <> ? LIMIT 1',
          [req.tenantId, nextUsername, userId]
        );
        if (existing.length > 0) {
          return res.status(409).json({ error: 'Ese username ya existe' });
        }
        updates.push('username = ?');
        params.push(nextUsername);
        details.username = { from: target.username, to: nextUsername };
      }
    }

    if (req.body.display_name !== undefined) {
      const nextDisplayName = req.body.display_name?.trim() || null;
      if (nextDisplayName !== (target.display_name || null)) {
        updates.push('display_name = ?');
        params.push(nextDisplayName);
        details.display_name = { from: target.display_name || null, to: nextDisplayName };
      }
    }

    if (req.body.role !== undefined) {
      if (!VALID_ROLES.has(req.body.role)) {
        return res.status(400).json({ error: 'Rol inválido' });
      }
      if (!canSetRole(req.user?.role, req.body.role)) {
        return res.status(403).json({ error: 'No tienes permiso para asignar ese rol' });
      }
      if (target.role === 'owner' && req.body.role !== 'owner') {
        const activeOwners = await countActiveOwners(req.tenantId);
        if (activeOwners <= 1) {
          return res.status(400).json({ error: 'Debe existir al menos un owner activo' });
        }
      }
      if (req.body.role !== target.role) {
        updates.push('role = ?');
        params.push(req.body.role);
        details.role = { from: target.role, to: req.body.role };
      }
    }

    if (req.body.active !== undefined) {
      const nextActive = !!req.body.active;
      if (req.user?.userId === userId && !nextActive) {
        return res.status(400).json({ error: 'No puedes desactivar tu propia cuenta' });
      }
      if (target.role === 'owner' && !nextActive) {
        const activeOwners = await countActiveOwners(req.tenantId);
        if (activeOwners <= 1) {
          return res.status(400).json({ error: 'Debe existir al menos un owner activo' });
        }
      }
      if (nextActive !== !!target.active) {
        updates.push('active = ?');
        params.push(nextActive);
        details.active = { from: !!target.active, to: nextActive };
      }
    }

    if (req.body.pin !== undefined && req.body.pin !== '') {
      if (!/^\d{4}$/.test(req.body.pin)) {
        return res.status(400).json({ error: 'PIN inválido' });
      }
      const passwordHash = await bcrypt.hash(req.body.pin, 12);
      updates.push('password_hash = ?');
      params.push(passwordHash);
      details.pin_reset = true;
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'Nada que actualizar' });
    }

    params.push(userId, req.tenantId);
    await query(`UPDATE admin_users SET ${updates.join(', ')} WHERE id = ? AND tenant_id = ?`, params);

    if (details.username?.to) {
      await query(
        'UPDATE conversations SET assigned_to = ? WHERE tenant_id = ? AND assigned_to = ?',
        [details.username.to, req.tenantId, target.username]
      );
    }

    await logActivity({
      tenantId: req.tenantId,
      actor: req.user.username,
      action: 'team.user.update',
      targetType: 'admin_user',
      targetId: userId,
      details,
    });

    const updated = await getUserById(req.tenantId, userId);
    res.json({ message: 'Usuario actualizado', user: updated });
  } catch (err) {
    console.error('[team PUT]', err);
    res.status(500).json({ error: 'Error actualizando usuario' });
  }
});

router.delete('/:id', authMiddleware, tenantMiddleware, requireManager, async (req, res) => {
  try {
    const userId = Number(req.params.id);
    const target = await getUserById(req.tenantId, userId);
    if (!target) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }
    if (!canManageTarget(req.user?.role, target.role)) {
      return res.status(403).json({ error: 'No tienes permiso para eliminar este usuario' });
    }
    if (req.user?.userId === userId) {
      return res.status(400).json({ error: 'No puedes eliminar tu propia cuenta' });
    }
    if (target.role === 'owner') {
      const activeOwners = await countActiveOwners(req.tenantId);
      if (activeOwners <= 1) {
        return res.status(400).json({ error: 'Debe existir al menos un owner activo' });
      }
    }

    await query(
      'UPDATE conversations SET assigned_to = ? WHERE tenant_id = ? AND assigned_to = ?',
      ['bot', req.tenantId, target.username]
    );
    await query(
      'DELETE FROM admin_users WHERE id = ? AND tenant_id = ?',
      [userId, req.tenantId]
    );

    await logActivity({
      tenantId: req.tenantId,
      actor: req.user.username,
      action: 'team.user.delete',
      targetType: 'admin_user',
      targetId: userId,
      details: {
        username: target.username,
        role: target.role,
      },
    });

    res.json({ message: 'Usuario eliminado' });
  } catch (err) {
    console.error('[team DELETE]', err);
    res.status(500).json({ error: 'Error eliminando usuario' });
  }
});

module.exports = router;
