const express = require('express');
const pool = require('../config/db');

const router = express.Router();

// ─── POST /api/salaries/generate ─────────────────────────────────────────────
router.post('/generate', async (req, res) => {
  const { period, month, year, category, data } = req.body;

  if (!period || !month || !year || !category || !Array.isArray(data) || data.length === 0) {
    return res.status(400).json({
      success: false,
      message: 'period, month, year, category and a non-empty data array are required',
    });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // ── Duplicate guard: if rows already exist for this period+category, reject ──
    const [[{ cnt }]] = await conn.query(
      'SELECT COUNT(*) AS cnt FROM salary_data WHERE period = ? AND category = ?',
      [period, category]
    );
    if (parseInt(cnt) > 0) {
      await conn.rollback();
      conn.release();
      return res.status(409).json({
        success: false,
        alreadyGenerated: true,
        message: `Salary for ${category} — ${month} ${year} has already been generated.`,
      });
    }

    // ── Bulk INSERT ───────────────────────────────────────────────────────────
    const columns = [
      'emp_code','name','bank_account','department','category','rate','attendance',
      'basic_salary','CEA','CHA','HRA','OTHALLOW','SPA','UMA','total_allowance',
      'CLUB','CUTIE_CLUB_DED','DISH','ELECTRICITY','EMP_COP_SALARY','ESIC',
      'FUELDED','JPOCSALON','MEDICAL_RECOVERY','MILKDED','OTHERDED1','OTHERDED2',
      'PF','SCHOOLFEE','TDS','TRANSPORT_DED','WF','total_deduction','net_salary',
      'month','year','period',
    ];

    const rowPlaceholder = `(${columns.map(() => '?').join(',')})`;
    const allValues = [];

    for (const emp of data) {
      allValues.push(
        String(emp.empCode || ''),
        String(emp.name || ''),
        String(emp.bankAccount || ''),
        String(emp.department || ''),
        String(emp.category || category),
        parseFloat(emp.rate)           || 0,
        parseInt(emp.attendance)       || 0,
        parseFloat(emp.basicSalary)    || 0,
        parseFloat(emp.CEA)            || 0,
        parseFloat(emp.CHA)            || 0,
        parseFloat(emp.HRA)            || 0,
        parseFloat(emp.OTHALLOW)       || 0,
        parseFloat(emp.SPA)            || 0,
        parseFloat(emp.UMA)            || 0,
        parseFloat(emp.totalAllowance) || 0,
        parseFloat(emp.CLUB)           || 0,
        parseFloat(emp.CUTIE_CLUB_DED) || 0,
        parseFloat(emp.DISH)           || 0,
        parseFloat(emp.ELECTRICITY)    || 0,
        parseFloat(emp.EMP_COP_SALARY) || 0,
        parseFloat(emp.ESIC)           || 0,
        parseFloat(emp.FUELDED)        || 0,
        parseFloat(emp.JPOCSALON)      || 0,
        parseFloat(emp.MEDICAL_RECOVERY) || 0,
        parseFloat(emp.MILKDED)        || 0,
        parseFloat(emp.OTHERDED1)      || 0,
        parseFloat(emp.OTHERDED2)      || 0,
        parseFloat(emp.PF)             || 0,
        parseFloat(emp.SCHOOLFEE)      || 0,
        parseFloat(emp.TDS)            || 0,
        parseFloat(emp.TRANSPORT_DED)  || 0,
        parseFloat(emp.WF)             || 0,
        parseFloat(emp.totalDeduction) || 0,
        parseFloat(emp.netSalary)      || 0,
        String(month),
        parseInt(year),
        String(period)
      );
    }

    const sql = `INSERT INTO salary_data (${columns.join(',')}) VALUES ${data.map(() => rowPlaceholder).join(',')}`;
    await conn.query(sql, allValues);

    await conn.commit();
    conn.release();

    console.log(`[generate] success: ${category} ${period} — ${data.length} records`);
    res.json({
      success: true,
      message: `Salary generated for ${category} — ${month} ${year}`,
      details: { period, month, year, category, recordsInserted: data.length },
    });

  } catch (error) {
    await conn.rollback();
    conn.release();
    console.error('[generate] DB error:', error.message);
    res.status(500).json({ success: false, message: `Failed to generate salary: ${error.message}` });
  }
});

// ─── GET /api/salaries/generated-categories?period=0626 ──────────────────────
router.get('/generated-categories', async (req, res) => {
  const { period } = req.query;
  if (!period) return res.status(400).json({ success: false, message: 'period is required' });
  try {
    const [rows] = await pool.query(
      'SELECT DISTINCT category FROM salary_data WHERE period = ?',
      [period]
    );
    const categories = rows.map(r => r.category);
    res.json({ success: true, period, categories });
  } catch (error) {
    console.error('[generated-categories] Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// ─── GET /api/salaries/period/:period ────────────────────────────────────────
router.get('/period/:period', async (req, res) => {
  const { period } = req.params;
  const { category } = req.query;
  console.log('[GET /period]', period, '| category:', category);
  try {
    let query = 'SELECT * FROM salary_data WHERE period = ?';
    const params = [period];

    if (category && category !== 'all') {
      query += ' AND category = ?';
      params.push(category);
    }
    query += ' ORDER BY name';

    const [rows] = await pool.query(query, params);

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: `No salary data found for period ${period}${category ? ` (${category})` : ''}`,
      });
    }

    // Derive month/year from first row for response metadata
    const { month, year } = rows[0];
    res.json({ success: true, period, month, year, category: category || 'all', data: rows });

  } catch (error) {
    console.error('[GET /period] Error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch salary data', error: error.message });
  }
});

// ─── GET /api/salaries/periods ───────────────────────────────────────────────
router.get('/periods', async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT DISTINCT period, month, year FROM salary_data ORDER BY year DESC, period DESC'
    );
    res.json(rows);
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch periods', error: error.message });
  }
});

// ─── DELETE /api/salaries/period/:period ─────────────────────────────────────
router.delete('/period/:period', async (req, res) => {
  const { period } = req.params;
  const { category } = req.query;
  try {
    let query = 'DELETE FROM salary_data WHERE period = ?';
    const params = [period];

    if (category && category !== 'all') {
      query += ' AND category = ?';
      params.push(category);
    }

    const [result] = await pool.query(query, params);

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'No salary data found to delete' });
    }

    res.json({
      success: true,
      message: `Deleted salary data for period ${period}${category ? ` (${category})` : ''}`,
      affectedRows: result.affectedRows,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to delete salary data', error: error.message });
  }
});

module.exports = router;