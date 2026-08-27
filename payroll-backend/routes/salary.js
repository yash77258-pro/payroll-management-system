const express = require('express');
const router = express.Router();
const db = require('../config/db');

const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 
                    'July', 'August', 'September', 'October', 'November', 'December'];

// Generate salary and auto-create report
router.post('/generate', async (req, res) => {
    try {
        const { salaryData, month, year, category, userId } = req.body;
        
        console.log('Generating salary:', { month, year, category, recordCount: salaryData?.length });
        
        if (!salaryData || !Array.isArray(salaryData) || salaryData.length === 0) {
            return res.status(400).json({ success: false, error: 'Invalid or empty salary data' });
        }

        if (!month || !year || !category) {
            return res.status(400).json({ success: false, error: 'Month, year, and category are required' });
        }

        // Delete existing salary records for this month/year/category
        await db.query(
            'DELETE FROM salary_records WHERE month = ? AND year = ? AND category = ?',
            [month, year, category]
        );

        let totalAmount = 0;
        let insertedCount = 0;

        // Insert salary records
        for (const record of salaryData) {
            const netSalary = parseFloat(record.netSalary || record.net_salary || record.netPay || 0);
            totalAmount += netSalary;
            
            await db.query(
                `INSERT INTO salary_records 
                (employee_id, employee_name, month, year, category, basic_salary, hra, da, ta, 
                other_allowances, overtime_pay, gross_salary, pf_deduction, esi_deduction, 
                tax_deduction, other_deductions, total_deductions, net_salary, present_days, absent_days, status)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'generated')`,
                [
                    record.employeeId || record.employee_id || record.id || '',
                    record.employeeName || record.employee_name || record.name || '',
                    month,
                    year,
                    category,
                    parseFloat(record.basicSalary || record.basic_salary || record.basic || 0),
                    parseFloat(record.hra || 0),
                    parseFloat(record.da || 0),
                    parseFloat(record.ta || 0),
                    parseFloat(record.otherAllowances || record.other_allowances || record.allowances || 0),
                    parseFloat(record.overtimePay || record.overtime_pay || record.overtime || 0),
                    parseFloat(record.grossSalary || record.gross_salary || record.gross || 0),
                    parseFloat(record.pfDeduction || record.pf_deduction || record.pf || 0),
                    parseFloat(record.esiDeduction || record.esi_deduction || record.esi || 0),
                    parseFloat(record.taxDeduction || record.tax_deduction || record.tax || 0),
                    parseFloat(record.otherDeductions || record.other_deductions || 0),
                    parseFloat(record.totalDeductions || record.total_deductions || record.deductions || 0),
                    netSalary,
                    parseInt(record.presentDays || record.present_days || record.present || 0),
                    parseInt(record.absentDays || record.absent_days || record.absent || 0)
                ]
            );
            insertedCount++;
        }

        // Auto-generate report when salary is generated
        const reportTitle = `${category.toUpperCase()} Salary Report - ${monthNames[month - 1]} ${year}`;
        
        // Delete existing report for this month/year/category
        await db.query(
            'DELETE FROM reports WHERE month = ? AND year = ? AND category = ? AND report_type = ?',
            [month, year, category, 'salary']
        );

        // Insert new report
        await db.query(
            `INSERT INTO reports 
            (report_type, month, year, category, title, total_employees, total_amount, report_data, generated_by)
            VALUES ('salary', ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                month,
                year,
                category,
                reportTitle,
                salaryData.length,
                totalAmount,
                JSON.stringify(salaryData),
                userId || null
            ]
        );

        console.log('Salary generated successfully:', { insertedCount, totalAmount });
        
        res.json({ 
            success: true, 
            message: 'Salary generated and report created successfully',
            totalEmployees: salaryData.length,
            totalAmount: totalAmount.toFixed(2)
        });
    } catch (error) {
        console.error('Error generating salary:', error);
        res.status(500).json({ success: false, error: 'Failed to generate salary: ' + error.message });
    }
});

// Get salary records
router.get('/', async (req, res) => {
    try {
        const { month, year, category } = req.query;
        
        let query = 'SELECT * FROM salary_records WHERE 1=1';
        const params = [];
        
        if (month) {
            query += ' AND month = ?';
            params.push(parseInt(month));
        }
        if (year) {
            query += ' AND year = ?';
            params.push(parseInt(year));
        }
        if (category) {
            query += ' AND category = ?';
            params.push(category);
        }
        
        query += ' ORDER BY employee_name ASC';
        
        const [rows] = await db.query(query, params);
        res.json({ success: true, data: rows });
    } catch (error) {
        console.error('Error fetching salary records:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch salary records' });
    }
});

// Update salary status (approve, mark as paid, etc.)
router.put('/status', async (req, res) => {
    try {
        const { month, year, category, status } = req.body;
        
        if (!['pending', 'generated', 'approved', 'paid'].includes(status)) {
            return res.status(400).json({ success: false, error: 'Invalid status' });
        }

        const [result] = await db.query(
            'UPDATE salary_records SET status = ? WHERE month = ? AND year = ? AND category = ?',
            [status, month, year, category]
        );

        res.json({ success: true, message: 'Status updated', affectedRows: result.affectedRows });
    } catch (error) {
        console.error('Error updating salary status:', error);
        res.status(500).json({ success: false, error: 'Failed to update status' });
    }
});

module.exports = router;