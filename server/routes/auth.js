const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { query } = require('../db');

const router = express.Router();

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Usuario y contraseña requeridos' });
    }

    const users = await query(
      'SELECT au.*, t.name as tenant_name FROM admin_users au JOIN tenants t ON t.id = au.tenant_id WHERE au.username = ?',
      [username]
    );

    if (users.length === 0) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    const user = users[0];
    const valid = await bcrypt.compare(password, user.password_hash);

    if (!valid) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    const token = jwt.sign(
      {
        userId: user.id,
        tenantId: user.tenant_id,
        username: user.username,
        role: user.role,
      },
      process.env.JWT_SECRET,
      { expiresIn: '30d' }
    );

    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        tenantName: user.tenant_name,
      },
    });
  } catch (err) {
    console.error('[auth/login]', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

// POST /api/auth/setup — crea el primer admin (solo funciona si no hay ningún admin_user)
router.post('/setup', async (req, res) => {
  try {
    const existing = await query('SELECT id FROM admin_users LIMIT 1');
    if (existing.length > 0) {
      return res.status(403).json({ error: 'Ya existe un administrador' });
    }

    const { username, password } = req.body;
    if (!username || !password || password.length < 6) {
      return res.status(400).json({ error: 'Usuario y contraseña (mín. 6 chars) requeridos' });
    }

    // Use tenant 1 (Daniel's default tenant)
    const tenants = await query('SELECT id FROM tenants LIMIT 1');
    if (tenants.length === 0) {
      return res.status(500).json({ error: 'No hay tenant. Reinicia el server para crear el default.' });
    }

    const hash = await bcrypt.hash(password, 12);
    await query(
      'INSERT INTO admin_users (tenant_id, username, password_hash, role) VALUES (?, ?, ?, ?)',
      [tenants[0].id, username, hash, 'owner']
    );

    res.json({ success: true, message: 'Admin creado. Ahora puedes hacer login.' });
  } catch (err) {
    console.error('[auth/setup]', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

module.exports = router;
