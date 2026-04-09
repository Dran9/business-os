const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { query } = require('../db');
const authMiddleware = require('../middleware/auth');
const { logActivity } = require('../services/activityLog');

const router = express.Router();

// POST /api/auth/login — solo PIN de 4 dígitos
router.post('/login', async (req, res) => {
  try {
    const { pin, username } = req.body;

    if (!pin || pin.length !== 4) {
      return res.status(400).json({ error: 'PIN de 4 dígitos requerido' });
    }

    let users;
    if (username) {
      users = await query(
        `SELECT au.*, t.name as tenant_name
         FROM admin_users au
         JOIN tenants t ON t.id = au.tenant_id
         WHERE au.username = ? AND au.active = TRUE
         LIMIT 1`,
        [username.trim()]
      );
    } else {
      users = await query(
        `SELECT au.*, t.name as tenant_name
         FROM admin_users au
         JOIN tenants t ON t.id = au.tenant_id
         WHERE au.active = TRUE
         ORDER BY au.id ASC
         LIMIT 1`
      );
    }

    if (users.length === 0) {
      return res.status(401).json({ error: 'Usuario no encontrado o inactivo' });
    }

    const user = users[0];
    const valid = await bcrypt.compare(pin, user.password_hash);

    if (!valid) {
      return res.status(401).json({ error: 'PIN incorrecto' });
    }

    const token = jwt.sign(
      {
        userId: user.id,
        tenantId: user.tenant_id,
        role: user.role,
        username: user.username,
        displayName: user.display_name || user.username,
      },
      process.env.JWT_SECRET,
      { expiresIn: '90d' }
    );

    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        display_name: user.display_name || user.username,
        role: user.role,
        tenant_id: user.tenant_id,
      },
    });
  } catch (err) {
    console.error('[auth/login]', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

router.get('/me', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Token requerido' });
    }
    const token = authHeader.slice(7);
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const users = await query(
      `SELECT id, tenant_id, username, display_name, role, active
       FROM admin_users
       WHERE id = ? AND tenant_id = ? AND active = TRUE
       LIMIT 1`,
      [payload.userId, payload.tenantId]
    );
    if (users.length === 0) {
      return res.status(401).json({ error: 'Usuario no encontrado' });
    }
    res.json({ user: users[0] });
  } catch (err) {
    res.status(401).json({ error: 'Token inválido o expirado' });
  }
});

router.post('/change-pin', authMiddleware, async (req, res) => {
  try {
    const { current_pin, new_pin } = req.body;

    if (!current_pin || !/^\d{4}$/.test(current_pin)) {
      return res.status(400).json({ error: 'PIN actual inválido' });
    }
    if (!new_pin || !/^\d{4}$/.test(new_pin)) {
      return res.status(400).json({ error: 'PIN nuevo inválido' });
    }
    if (current_pin === new_pin) {
      return res.status(400).json({ error: 'El PIN nuevo debe ser distinto al actual' });
    }

    const users = await query(
      `SELECT id, tenant_id, username, password_hash
       FROM admin_users
       WHERE id = ? AND tenant_id = ? AND active = TRUE
       LIMIT 1`,
      [req.user.userId, req.tenantId]
    );

    if (users.length === 0) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    const user = users[0];
    const valid = await bcrypt.compare(current_pin, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'PIN actual incorrecto' });
    }

    const passwordHash = await bcrypt.hash(new_pin, 12);
    await query(
      'UPDATE admin_users SET password_hash = ? WHERE id = ? AND tenant_id = ?',
      [passwordHash, user.id, req.tenantId]
    );

    await logActivity({
      tenantId: req.tenantId,
      actor: req.user.username || user.username,
      action: 'team.change_pin.self',
      targetType: 'admin_user',
      targetId: user.id,
      details: { username: user.username },
    });

    res.json({ message: 'PIN actualizado' });
  } catch (err) {
    console.error('[auth/change-pin]', err);
    res.status(500).json({ error: 'Error actualizando PIN' });
  }
});

// POST /api/auth/setup — configura el PIN (solo si no hay admin aún)
router.post('/setup', async (req, res) => {
  try {
    const existing = await query('SELECT id FROM admin_users LIMIT 1');
    if (existing.length > 0) {
      return res.status(403).json({ error: 'Ya existe un administrador' });
    }

    const { pin } = req.body;
    if (!pin || !/^\d{4}$/.test(pin)) {
      return res.status(400).json({ error: 'PIN debe ser exactamente 4 dígitos' });
    }

    const tenants = await query('SELECT id FROM tenants LIMIT 1');
    if (tenants.length === 0) {
      return res.status(500).json({ error: 'No hay tenant. Reinicia el server para crear el default.' });
    }

    const hash = await bcrypt.hash(pin, 12);
    await query(
      'INSERT INTO admin_users (tenant_id, username, password_hash, role) VALUES (?, ?, ?, ?)',
      [tenants[0].id, 'owner', hash, 'owner']
    );

    res.json({ success: true, message: 'PIN configurado.' });
  } catch (err) {
    console.error('[auth/setup]', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

module.exports = router;
