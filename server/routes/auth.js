const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { query } = require('../db');

const router = express.Router();

// POST /api/auth/login — solo PIN de 4 dígitos
router.post('/login', async (req, res) => {
  try {
    const { pin } = req.body;

    if (!pin || pin.length !== 4) {
      return res.status(400).json({ error: 'PIN de 4 dígitos requerido' });
    }

    const users = await query(
      'SELECT au.*, t.name as tenant_name FROM admin_users au JOIN tenants t ON t.id = au.tenant_id LIMIT 1'
    );

    if (users.length === 0) {
      return res.status(401).json({ error: 'No hay admin configurado' });
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
      },
      process.env.JWT_SECRET,
      { expiresIn: '90d' }
    );

    res.json({ token });
  } catch (err) {
    console.error('[auth/login]', err);
    res.status(500).json({ error: 'Error interno' });
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
