const express = require('express');
const pool = require('../db');

const router = express.Router();

// GET /api/employees
router.get('/', async (req, res) => {
  try {
    const query = `
      SELECT
        \`Emp Code\`      AS empCode,
        SUBSTRING_INDEX(\`Name\`, ' ', 1) AS firstName,
        CASE WHEN LOCATE(' ', \`Name\`) > 0
             THEN SUBSTRING_INDEX(\`Name\`, ' ', -1)
             ELSE ''
        END               AS lastName,
        \`Department\`    AS department,
        \`Bank Acc. No.\` AS bankAccount,
        \`IFSC\`          AS ifsc,
        \`PAN\`           AS pan,
        \`Aadhar\`        AS aadhar,
        \`Bank Name\`     AS branch,
        \`Phone\`         AS phone,
        \`Email\`         AS email,
        \`Designation\`   AS designation,
        \`Category\`      AS category,
        \`Joining date\`  AS joiningDate,
        \`Status\`        AS status,
        \`Gross\`         AS gross,
        \`Basic\`         AS basic,
        \`CEA\`           AS cea,
        \`CHA\`           AS cha,
        \`HRA\`           AS hra,
        \`SPA\`           AS spa,
        \`UMA\`           AS uma,
        \`LWD\`           AS lwd
      FROM employee_details
    `;
    const [results] = await pool.query(query);
    res.json({ success: true, data: results });
  } catch (err) {
    console.error('GET /api/employees error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/employees
router.post('/', async (req, res) => {
  try {
    const { empCode, name, firstName, lastName, department, bankAccount, ifsc, pan,
      aadhar, branch, phone, email, designation, category, joiningDate,
      status, gross, basic, cea, cha, hra, spa, uma, lwd } = req.body;

    let fullName = '';
    if (name && name.trim()) {
      fullName = name.trim();
    } else {
      fullName = ((firstName || '') + ' ' + (lastName || '')).trim();
    }

    const sql = `INSERT INTO employee_details 
      (\`Emp Code\`, \`Name\`, \`Department\`, \`Bank Acc. No.\`, \`IFSC\`, \`PAN\`, \`Aadhar\`, 
       \`Bank Name\`, \`Phone\`, \`Email\`, \`Designation\`, \`Category\`, \`Joining date\`, 
       \`Status\`, \`Gross\`, \`Basic\`, \`CEA\`, \`CHA\`, \`HRA\`, \`SPA\`, \`UMA\`, \`LWD\`) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

    const values = [
      empCode, fullName, department, bankAccount, ifsc, pan, aadhar,
      branch, phone, email, designation, category, joiningDate,
      status || 'Active', gross || 0, basic || 0, cea || 0, cha || 0,
      hra || 0, spa || 0, uma || 0, lwd || null
    ];

    const [result] = await pool.query(sql, values);
    res.status(201).json({ success: true, message: 'Employee added', id: result.insertId });
  } catch (err) {
    console.error('POST /api/employees error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/employees/designations
router.get('/designations', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT id, name FROM designations ORDER BY name ASC');
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('GET /api/designations error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/employees/designations
router.post('/designations', async (req, res) => {
  try {
    const { name } = req.body;
    if (!name || name.trim() === '') {
      return res.status(400).json({ success: false, error: 'Designation name is required' });
    }
    const [existing] = await pool.query('SELECT id FROM designations WHERE name = ?', [name.trim()]);
    if (existing.length > 0) {
      return res.status(409).json({ success: false, error: 'Designation already exists' });
    }
    const [result] = await pool.query('INSERT INTO designations (name) VALUES (?)', [name.trim()]);
    res.status(201).json({ success: true, id: result.insertId, name: name.trim() });
  } catch (err) {
    console.error('POST /api/designations error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/employees/:empCode
router.delete('/:empCode', async (req, res) => {
  try {
    const { empCode } = req.params;
    const [result] = await pool.query('DELETE FROM employee_details WHERE `Emp Code` = ?', [empCode]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, error: 'Employee not found' });
    }
    res.json({ success: true, message: 'Deleted successfully' });
  } catch (err) {
    console.error('DELETE /api/employees/:empCode error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT /api/employees/:empCode
router.put('/:empCode', async (req, res) => {
  try {
    const { empCode } = req.params;
    const data = req.body;

    // Auto-set Inactive if LWD has passed
    if (data.lwd) {
      const lwd = new Date(data.lwd);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (lwd < today) {
        data.status = 'Inactive';
      }
    }

    const updates = [];
    const values = [];

    // Name
    if (data.firstName !== undefined || data.lastName !== undefined) {
      updates.push('`Name` = ?');
      values.push(((data.firstName || '') + ' ' + (data.lastName || '')).trim());
    } else if (data.name !== undefined) {
      updates.push('`Name` = ?');
      values.push(data.name);
    }

    const fieldMap = [
      ['department', 'Department'], ['bankAccount', 'Bank Acc. No.'],
      ['ifsc', 'IFSC'], ['pan', 'PAN'], ['aadhar', 'Aadhar'],
      ['branch', 'Bank Name'], ['phone', 'Phone'], ['email', 'Email'],
      ['designation', 'Designation'], ['category', 'Category'],
      ['joiningDate', 'Joining date'], ['status', 'Status'],
      ['gross', 'Gross'], ['basic', 'Basic'], ['cea', 'CEA'],
      ['cha', 'CHA'], ['hra', 'HRA'], ['spa', 'SPA'], ['uma', 'UMA'],
      ['lwd', 'LWD']
    ];

    fieldMap.forEach(([jsKey, dbCol]) => {
      if (data[jsKey] !== undefined) {
        updates.push(`\`${dbCol}\` = ?`);
        values.push(data[jsKey] === '' ? null : data[jsKey]);
      }
    });

    if (updates.length === 0) {
      return res.status(400).json({ success: false, error: 'No fields to update' });
    }

    values.push(empCode);
    const sql = `UPDATE employee_details SET ${updates.join(', ')} WHERE \`Emp Code\` = ?`;
    const [result] = await pool.query(sql, values);

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, error: 'Employee not found' });
    }
    res.json({ success: true, message: 'Updated successfully' });
  } catch (err) {
    console.error('PUT /api/employees/:empCode error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;