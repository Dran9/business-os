const express = require('express');
const authMiddleware = require('../middleware/auth');
const { tenantMiddleware } = require('../middleware/tenant');
const { query, queryPaginated } = require('../db');

const router = express.Router();

const VALID_TYPES = new Set(['income', 'expense']);
const VALID_CATEGORIES = new Set(['taller', 'publicidad', 'venue', 'materiales', 'herramientas', 'transporte', 'otros']);

function getMonthRange(month) {
  const value = /^\d{4}-\d{2}$/.test(String(month || '')) ? String(month) : new Date().toLocaleDateString('en-CA', { timeZone: 'America/La_Paz' }).slice(0, 7);
  const [year, monthNumber] = value.split('-').map(Number);
  const start = `${value}-01`;
  const endDate = new Date(Date.UTC(year, monthNumber, 0));
  const end = `${value}-${String(endDate.getUTCDate()).padStart(2, '0')}`;
  return { month: value, start, end };
}

function sanitizeCategory(category) {
  return VALID_CATEGORIES.has(category) ? category : 'otros';
}

router.get('/summary', authMiddleware, tenantMiddleware, async (req, res) => {
  try {
    const { month, start, end } = getMonthRange(req.query.month);

    const [income] = await query(
      `SELECT COALESCE(SUM(amount), 0) AS total
       FROM transactions
       WHERE tenant_id = ? AND type = 'income' AND date BETWEEN ? AND ?`,
      [req.tenantId, start, end]
    );

    const [expense] = await query(
      `SELECT COALESCE(SUM(amount), 0) AS total
       FROM transactions
       WHERE tenant_id = ? AND type = 'expense' AND date BETWEEN ? AND ?`,
      [req.tenantId, start, end]
    );

    const [goal] = await query(
      `SELECT *
       FROM financial_goals
       WHERE tenant_id = ? AND period_type = 'monthly' AND period_start = ?
       ORDER BY id DESC
       LIMIT 1`,
      [req.tenantId, start]
    );

    const incomeTotal = Number(income?.total || 0);
    const expenseTotal = Number(expense?.total || 0);
    const targetIncome = Number(goal?.target_income || 0);

    res.json({
      month,
      income: incomeTotal,
      expense: expenseTotal,
      net: incomeTotal - expenseTotal,
      target_income: targetIncome,
      target_delta: targetIncome ? incomeTotal - targetIncome : null,
      progress_pct: targetIncome > 0 ? Math.round((incomeTotal / targetIncome) * 100) : null,
    });
  } catch (err) {
    console.error('[finance summary]', err);
    res.status(500).json({ error: 'Error cargando resumen financiero' });
  }
});

router.get('/transactions', authMiddleware, tenantMiddleware, async (req, res) => {
  try {
    const { type, category, month, page = 1, limit = 50 } = req.query;
    const { start, end } = getMonthRange(month);
    let sql = `SELECT t.*, l.name AS lead_name, w.name AS workshop_name
               FROM transactions t
               LEFT JOIN leads l ON l.id = t.lead_id
               LEFT JOIN workshops w ON w.id = t.workshop_id
               WHERE t.tenant_id = ? AND t.date BETWEEN ? AND ?`;
    const params = [req.tenantId, start, end];

    if (type && VALID_TYPES.has(type)) {
      sql += ' AND t.type = ?';
      params.push(type);
    }

    if (category && VALID_CATEGORIES.has(category)) {
      sql += ' AND t.category = ?';
      params.push(category);
    }

    sql += ' ORDER BY t.date DESC, t.id DESC';
    const result = await queryPaginated(sql, params, { page: Number(page), limit: Number(limit) });
    res.json(result);
  } catch (err) {
    console.error('[finance transactions GET]', err);
    res.status(500).json({ error: 'Error cargando transacciones' });
  }
});

router.post('/transactions', authMiddleware, tenantMiddleware, async (req, res) => {
  try {
    const { type, category, amount, description, date } = req.body;
    if (!VALID_TYPES.has(type)) {
      return res.status(400).json({ error: 'Tipo inválido' });
    }
    if (!amount || Number(amount) <= 0) {
      return res.status(400).json({ error: 'Monto inválido' });
    }
    if (!date) {
      return res.status(400).json({ error: 'Fecha requerida' });
    }

    const result = await query(
      `INSERT INTO transactions (tenant_id, type, category, amount, description, date)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [req.tenantId, type, sanitizeCategory(category), Number(amount), description || null, date]
    );

    res.json({ id: result.insertId, message: 'Transacción creada' });
  } catch (err) {
    console.error('[finance transactions POST]', err);
    res.status(500).json({ error: 'Error creando transacción' });
  }
});

router.put('/transactions/:id', authMiddleware, tenantMiddleware, async (req, res) => {
  try {
    const fields = [];
    const params = [];

    if (req.body.type !== undefined) {
      if (!VALID_TYPES.has(req.body.type)) {
        return res.status(400).json({ error: 'Tipo inválido' });
      }
      fields.push('type = ?');
      params.push(req.body.type);
    }

    if (req.body.category !== undefined) {
      fields.push('category = ?');
      params.push(sanitizeCategory(req.body.category));
    }

    if (req.body.amount !== undefined) {
      if (Number(req.body.amount) <= 0) {
        return res.status(400).json({ error: 'Monto inválido' });
      }
      fields.push('amount = ?');
      params.push(Number(req.body.amount));
    }

    if (req.body.description !== undefined) {
      fields.push('description = ?');
      params.push(req.body.description || null);
    }

    if (req.body.date !== undefined) {
      fields.push('date = ?');
      params.push(req.body.date || null);
    }

    if (fields.length === 0) {
      return res.status(400).json({ error: 'Nada que actualizar' });
    }

    params.push(req.params.id, req.tenantId);
    await query(`UPDATE transactions SET ${fields.join(', ')} WHERE id = ? AND tenant_id = ?`, params);
    res.json({ message: 'Transacción actualizada' });
  } catch (err) {
    console.error('[finance transactions PUT]', err);
    res.status(500).json({ error: 'Error actualizando transacción' });
  }
});

router.delete('/transactions/:id', authMiddleware, tenantMiddleware, async (req, res) => {
  try {
    await query('DELETE FROM transactions WHERE id = ? AND tenant_id = ?', [req.params.id, req.tenantId]);
    res.json({ message: 'Transacción eliminada' });
  } catch (err) {
    console.error('[finance transactions DELETE]', err);
    res.status(500).json({ error: 'Error eliminando transacción' });
  }
});

router.put('/goals/current', authMiddleware, tenantMiddleware, async (req, res) => {
  try {
    const { month, target_income } = req.body;
    const { start } = getMonthRange(month);
    const target = target_income == null || target_income === '' ? null : Number(target_income);

    const existing = await query(
      `SELECT id
       FROM financial_goals
       WHERE tenant_id = ? AND period_type = 'monthly' AND period_start = ?
       ORDER BY id DESC
       LIMIT 1`,
      [req.tenantId, start]
    );

    if (existing.length > 0) {
      await query(
        'UPDATE financial_goals SET target_income = ?, notes = ? WHERE id = ?',
        [target, req.body.notes || null, existing[0].id]
      );
      return res.json({ id: existing[0].id, message: 'Meta actualizada' });
    }

    const result = await query(
      `INSERT INTO financial_goals (tenant_id, period_type, period_start, target_income, notes)
       VALUES (?, 'monthly', ?, ?, ?)`,
      [req.tenantId, start, target, req.body.notes || null]
    );

    res.json({ id: result.insertId, message: 'Meta creada' });
  } catch (err) {
    console.error('[finance goals PUT]', err);
    res.status(500).json({ error: 'Error guardando meta' });
  }
});

module.exports = router;
