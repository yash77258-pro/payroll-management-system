const express = require('express');
const pool = require('../config/db');

const router = express.Router();

// ─── POST /api/attendance/save ────────────────────────────────────────────────
router.post('/save', async (req, res) => {
  const { data, month, year } = req.body;

  if (!data || !Array.isArray(data)) {
    return res.status(400).json({ success: false, error: 'Invalid attendance data' });
  }
  if (!month || !year) {
    return res.status(400).json({ success: false, error: 'Month and year are required' });
  }

  try {
    for (const record of data) {
      await pool.execute(
        `INSERT INTO attendance (empCode, attendance, month, year)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE attendance = VALUES(attendance), updated_at = NOW()`,
        [String(record.empCode), parseInt(record.attendance) || 0, month, parseInt(year)]
      );
    }
    res.json({ success: true, message: 'Attendance saved successfully', count: data.length });
  } catch (error) {
    console.error('Error saving attendance:', error);
    res.status(500).json({ success: false, error: 'Failed to save attendance: ' + error.message });
  }
});

// ─── GET /api/attendance?month=June&year=2026 ─────────────────────────────────
router.get('/', async (req, res) => {
  const { month, year } = req.query;

  if (!month || !year) {
    return res.status(400).json({ success: false, error: 'Month and year are required' });
  }

  try {
    const [rows] = await pool.query(
      'SELECT empCode, attendance, month, year FROM attendance WHERE month = ? AND year = ?',
      [month, parseInt(year)]
    );
    res.json(rows);
  } catch (error) {
    console.error('Error fetching attendance:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch attendance: ' + error.message });
  }
});

// ─── DELETE /api/attendance?month=June&year=2026 ──────────────────────────────
router.delete('/', async (req, res) => {
  const { month, year } = req.query;

  if (!month || !year) {
    return res.status(400).json({ success: false, error: 'Month and year are required' });
  }

  try {
    const [result] = await pool.query(
      'DELETE FROM attendance WHERE month = ? AND year = ?',
      [month, parseInt(year)]
    );
    res.json({ success: true, message: 'Attendance deleted', affectedRows: result.affectedRows });
  } catch (error) {
    console.error('Error deleting attendance:', error);
    res.status(500).json({ success: false, error: 'Failed to delete attendance: ' + error.message });
  }
});

module.exports = router;