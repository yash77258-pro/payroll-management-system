const express = require('express');
const router = express.Router();
const db = require('../config/db');

const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 
                    'July', 'August', 'September', 'October', 'November', 'December'];

// Get all reports with filters
router.get('/', async (req, res) => {
    try {
        const { month, year, category, report_type } = req.query;
        
        let query = 'SELECT * FROM reports WHERE 1=1';
        const params = [];
        
        if (month) {
            query += ' AND month = ?';
            params.push(parseInt(month));
        }
        if (year) {
            query += ' AND year = ?';
            params.push(parseInt(year));
        }
        if (category && category !== 'all') {
            query += ' AND category = ?';
            params.push(category);
        }
        if (report_type) {
            query += ' AND report_type = ?';
            params.push(report_type);
        }
        
        query += ' ORDER BY created_at DESC';
        
        const [rows] = await db.query(query, params);
        
        // Parse JSON report_data for each row
        const reports = rows.map(row => ({
            ...row,
            report_data: typeof row.report_data === 'string' ? JSON.parse(row.report_data) : row.report_data
        }));
        
        res.json({ success: true, data: reports });
    } catch (error) {
        console.error('Error fetching reports:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch reports' });
    }
});

// Get single report by ID
router.get('/:id', async (req, res) => {
    try {
        const [rows] = await db.query('SELECT * FROM reports WHERE id = ?', [req.params.id]);
        
        if (rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Report not found' });
        }
        
        const report = {
            ...rows[0],
            report_data: typeof rows[0].report_data === 'string' ? JSON.parse(rows[0].report_data) : rows[0].report_data
        };
        
        res.json({ success: true, data: report });
    } catch (error) {
        console.error('Error fetching report:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch report' });
    }
});

// Create attendance report manually
router.post('/attendance', async (req, res) => {
    try {
        const { month, year, category, userId } = req.body;
        
        // Fetch attendance data
        const [attendanceData] = await db.query(
            'SELECT * FROM attendance WHERE month = ? AND year = ? AND category = ?',
            [month, year, category]
        );

        if (attendanceData.length === 0) {
            return res.status(400).json({ success: false, error: 'No attendance data found for the selected period' });
        }

        const reportTitle = `${category.toUpperCase()} Attendance Report - ${monthNames[month - 1]} ${year}`;
        
        // Delete existing report
        await db.query(
            'DELETE FROM reports WHERE month = ? AND year = ? AND category = ? AND report_type = ?',
            [month, year, category, 'attendance']
        );

        // Insert new report
        await db.query(
            `INSERT INTO reports 
            (report_type, month, year, category, title, total_employees, total_amount, report_data, generated_by)
            VALUES ('attendance', ?, ?, ?, ?, ?, 0, ?, ?)`,
            [month, year, category, reportTitle, attendanceData.length, JSON.stringify(attendanceData), userId || null]
        );

        res.json({ success: true, message: 'Attendance report created successfully' });
    } catch (error) {
        console.error('Error creating attendance report:', error);
        res.status(500).json({ success: false, error: 'Failed to create report' });
    }
});

// Delete a report
router.delete('/:id', async (req, res) => {
    try {
        const [result] = await db.query('DELETE FROM reports WHERE id = ?', [req.params.id]);
        
        if (result.affectedRows === 0) {
            return res.status(404).json({ success: false, error: 'Report not found' });
        }
        
        res.json({ success: true, message: 'Report deleted successfully' });
    } catch (error) {
        console.error('Error deleting report:', error);
        res.status(500).json({ success: false, error: 'Failed to delete report' });
    }
});

// Get summary statistics
router.get('/stats/summary', async (req, res) => {
    try {
        const { year } = req.query;
        const currentYear = year || new Date().getFullYear();

        const [salaryStats] = await db.query(
            `SELECT 
                category,
                COUNT(DISTINCT CONCAT(month, '-', employee_id)) as total_records,
                SUM(net_salary) as total_paid
            FROM salary_records 
            WHERE year = ?
            GROUP BY category`,
            [currentYear]
        );

        const [reportStats] = await db.query(
            `SELECT 
                report_type,
                COUNT(*) as count
            FROM reports 
            WHERE year = ?
            GROUP BY report_type`,
            [currentYear]
        );

        res.json({ 
            success: true, 
            data: {
                salaryStats,
                reportStats,
                year: currentYear
            }
        });
    } catch (error) {
        console.error('Error fetching stats:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch statistics' });
    }
});

module.exports = router;