const express = require('express');
const router = express.Router();
const pool = require('../config/db');

// ─── ATTENDANCE ───────────────────────────────────────────────────────────────

// POST /api/attendance/save
router.post('/attendance/save', async (req, res) => {
  const { month, year, data } = req.body;
  if (!month || !year || !data || !Array.isArray(data)) {
    return res.status(400).json({ error: 'Invalid request data' });
  }
  try {
    for (const item of data) {
      await pool.execute(
        `INSERT INTO attendance (empCode, attendance, month, year)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE attendance = VALUES(attendance), updated_at = NOW()`,
        [String(item.empCode), parseInt(item.attendance) || 0, month, parseInt(year)]
      );
    }
    res.json({ success: true, message: 'Attendance saved successfully' });
  } catch (error) {
    console.error('Error saving attendance:', error);
    res.status(500).json({ error: 'Failed to save attendance: ' + error.message });
  }
});

// GET /api/attendance?month=June&year=2026
router.get('/attendance', async (req, res) => {
  const { month, year } = req.query;
  if (!month || !year) {
    return res.status(400).json({ error: 'Month and year are required' });
  }
  try {
    const [rows] = await pool.query(
      'SELECT empCode, attendance, month, year FROM attendance WHERE month = ? AND year = ?',
      [month, parseInt(year)]
    );
    res.json(rows);
  } catch (error) {
    console.error('Error fetching attendance:', error);
    res.status(500).json({ error: 'Failed to fetch attendance: ' + error.message });
  }
});

// ─── DEDUCTIONS ───────────────────────────────────────────────────────────────

// GET /api/deductions?month=June&year=2026
router.get('/deductions', async (req, res) => {
  const { month, year } = req.query;
  if (!month || !year) return res.status(400).json({ error: 'month and year are required' });
  try {
    const [rows] = await pool.query(
      'SELECT * FROM deductions WHERE month = ? AND year = ?',
      [month, parseInt(year)]
    );
    const mapped = rows.map(r => ({
      empCode:         r.empCode,
      month:           r.month,
      year:            r.year,
      othallow:        parseFloat(r.othallow)        || 0,
      club:            parseFloat(r.club)            || 0,
      cutieClubDed:    parseFloat(r.cutieClubDed)    || 0,
      dish:            parseFloat(r.dish)            || 0,
      electricity:     parseFloat(r.electricity)     || 0,
      empCopSalary:    parseFloat(r.empCopSalary)    || 0,
      fuelDed:         parseFloat(r.fuelDed)         || 0,
      jpocSalon:       parseFloat(r.jpocSalon)       || 0,
      medicalRecovery: parseFloat(r.medicalRecovery) || 0,
      milkDed:         parseFloat(r.milkDed)         || 0,
      otherDed1:       parseFloat(r.otherDed1)       || 0,
      otherDed2:       parseFloat(r.otherDed2)       || 0,
      schoolFee:       parseFloat(r.schoolFee)       || 0,
      tds:             parseFloat(r.tds)             || 0,
      transportDed:    parseFloat(r.transportDed)    || 0,
    }));
    res.json(mapped);
  } catch (error) {
    console.error('Error fetching deductions:', error);
    res.status(500).json({ error: 'Failed to fetch deductions: ' + error.message });
  }
});

// POST /api/deductions/save
router.post('/deductions/save', async (req, res) => {
  const { month, year, data } = req.body;
  if (!month || !year || !Array.isArray(data) || data.length === 0) {
    return res.status(400).json({ error: 'month, year and data array are required' });
  }
  try {
    for (const emp of data) {
      await pool.execute(
        `INSERT INTO deductions
          (empCode, month, year, othallow, club, cutieClubDed, dish, electricity,
           empCopSalary, fuelDed, jpocSalon, medicalRecovery, milkDed,
           otherDed1, otherDed2, schoolFee, tds, transportDed)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
         ON DUPLICATE KEY UPDATE
          othallow=VALUES(othallow), club=VALUES(club), cutieClubDed=VALUES(cutieClubDed),
          dish=VALUES(dish), electricity=VALUES(electricity), empCopSalary=VALUES(empCopSalary),
          fuelDed=VALUES(fuelDed), jpocSalon=VALUES(jpocSalon), medicalRecovery=VALUES(medicalRecovery),
          milkDed=VALUES(milkDed), otherDed1=VALUES(otherDed1), otherDed2=VALUES(otherDed2),
          schoolFee=VALUES(schoolFee), tds=VALUES(tds), transportDed=VALUES(transportDed),
          updated_at=NOW()`,
        [
          String(emp.empCode), month, parseInt(year),
          parseFloat(emp.othallow)        || 0,
          parseFloat(emp.club)            || 0,
          parseFloat(emp.cutieClubDed)    || 0,
          parseFloat(emp.dish)            || 0,
          parseFloat(emp.electricity)     || 0,
          parseFloat(emp.empCopSalary)    || 0,
          parseFloat(emp.fuelDed)         || 0,
          parseFloat(emp.jpocSalon)       || 0,
          parseFloat(emp.medicalRecovery) || 0,
          parseFloat(emp.milkDed)         || 0,
          parseFloat(emp.otherDed1)       || 0,
          parseFloat(emp.otherDed2)       || 0,
          parseFloat(emp.schoolFee)       || 0,
          parseFloat(emp.tds)             || 0,
          parseFloat(emp.transportDed)    || 0,
        ]
      );
    }
    res.json({ success: true, message: `Saved deductions for ${data.length} employee(s)` });
  } catch (error) {
    console.error('Error saving deductions:', error);
    res.status(500).json({ error: 'Failed to save deductions: ' + error.message });
  }
});

// ─── SALARIES ─────────────────────────────────────────────────────────────────

// POST /api/salaries/generate
router.post('/salaries/generate', async (req, res) => {
  const { period, month, year, category, data } = req.body;
  if (!period || !month || !year || !category || !Array.isArray(data) || data.length === 0) {
    return res.status(400).json({ error: 'Invalid request data' });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

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
        String(emp.empCode || ''),       String(emp.name || ''),
        String(emp.bankAccount || ''),   String(emp.department || ''),
        String(emp.category || category),parseFloat(emp.rate)           || 0,
        parseInt(emp.attendance)         || 0,
        parseFloat(emp.basicSalary)      || 0,
        parseFloat(emp.CEA)              || 0,  parseFloat(emp.CHA)            || 0,
        parseFloat(emp.HRA)              || 0,  parseFloat(emp.OTHALLOW)       || 0,
        parseFloat(emp.SPA)              || 0,  parseFloat(emp.UMA)            || 0,
        parseFloat(emp.totalAllowance)   || 0,
        parseFloat(emp.CLUB)             || 0,  parseFloat(emp.CUTIE_CLUB_DED) || 0,
        parseFloat(emp.DISH)             || 0,  parseFloat(emp.ELECTRICITY)    || 0,
        parseFloat(emp.EMP_COP_SALARY)   || 0,  parseFloat(emp.ESIC)           || 0,
        parseFloat(emp.FUELDED)          || 0,  parseFloat(emp.JPOCSALON)      || 0,
        parseFloat(emp.MEDICAL_RECOVERY) || 0,  parseFloat(emp.MILKDED)        || 0,
        parseFloat(emp.OTHERDED1)        || 0,  parseFloat(emp.OTHERDED2)      || 0,
        parseFloat(emp.PF)               || 0,  parseFloat(emp.SCHOOLFEE)      || 0,
        parseFloat(emp.TDS)              || 0,  parseFloat(emp.TRANSPORT_DED)  || 0,
        parseFloat(emp.WF)               || 0,
        parseFloat(emp.totalDeduction)   || 0,  parseFloat(emp.netSalary)      || 0,
        String(month), parseInt(year),   String(period)
      );
    }

    const sql = `INSERT INTO salary_data (${columns.join(',')}) VALUES ${data.map(() => rowPlaceholder).join(',')}`;
    await conn.query(sql, allValues);
    await conn.commit();
    conn.release();

    res.json({ success: true, message: `Salary data saved for ${category} - ${month} ${year}` });
  } catch (error) {
    await conn.rollback();
    conn.release();
    console.error('Error saving salary:', error);
    res.status(500).json({ error: 'Failed to save salary data: ' + error.message });
  }
});

// GET /api/salaries/generated-categories?period=0626
router.get('/salaries/generated-categories', async (req, res) => {
  const { period } = req.query;
  if (!period) return res.status(400).json({ success: false, message: 'period is required' });
  try {
    const [rows] = await pool.query(
      'SELECT DISTINCT category FROM salary_data WHERE period = ?',
      [period]
    );
    res.json({ success: true, period, categories: rows.map(r => r.category) });
  } catch (error) {
    console.error('Error fetching generated categories:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/salaries/period/:period
router.get('/salaries/period/:period', async (req, res) => {
  const { period } = req.params;
  const { category } = req.query;
  try {
    let query = 'SELECT * FROM salary_data WHERE period = ?';
    const params = [period];
    if (category && category !== 'all') { query += ' AND category = ?'; params.push(category); }
    query += ' ORDER BY name';

    const [rows] = await pool.query(query, params);
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: `No salary data found for period ${period}` });
    }
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('Error fetching salary data:', error);
    res.status(500).json({ error: 'Failed to fetch salary data: ' + error.message });
  }
});

// DELETE /api/salaries/period/:period
router.delete('/salaries/period/:period', async (req, res) => {
  const { period } = req.params;
  const { category } = req.query;
  try {
    let query = 'DELETE FROM salary_data WHERE period = ?';
    const params = [period];
    if (category && category !== 'all') { query += ' AND category = ?'; params.push(category); }

    const [result] = await pool.query(query, params);
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'No salary data found to delete' });
    }
    res.json({ success: true, message: 'Salary data deleted successfully', affectedRows: result.affectedRows });
  } catch (error) {
    console.error('Error deleting salary data:', error);
    res.status(500).json({ error: 'Failed to delete salary data: ' + error.message });
  }
});

module.exports = router;