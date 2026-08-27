import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import * as XLSX from 'xlsx';
const API_BASE_URL = `${process.env.REACT_APP_API_BASE_URL || 'http://localhost:5000'}/api`;

const getLoggedInUser = () => {
  try {
    const raw = localStorage.getItem('user');
    if (!raw) return { name: 'Unknown', role: 'admin', email: '' };
    const user = JSON.parse(raw);
    return {
      name: user.name || user.username || user.email || 'Unknown',
      role: (user.role || 'admin').toLowerCase(),
      email: user.email || '',
    };
  } catch { return { name: 'Unknown', role: 'admin', email: '' }; }
};

const getUserRole = () => getLoggedInUser().role;

const ROLE_CATEGORIES = {
  admin: ['Operations', 'Engineering', 'Apprentice', 'Finance'],
  plant: ['Operations', 'Engineering', 'Apprentice'],
  school: ['Finance'],
};

const allowedCategories = () => ROLE_CATEGORIES[getUserRole()] ?? ROLE_CATEGORIES.admin;
const isSchoolUser = () => getUserRole() === 'school';
const isPlantUser = () => getUserRole() === 'plant';

const extractEmployees = (responseData) => {
  if (Array.isArray(responseData)) return responseData;
  if (Array.isArray(responseData?.data)) return responseData.data;
  if (Array.isArray(responseData?.employees)) return responseData.employees;
  if (Array.isArray(responseData?.result)) return responseData.result;
  return [];
};

const MONTH_LIST = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december'
];

const getDaysInMonth = (month, year) => {
  const idx = MONTH_LIST.indexOf((month || '').toLowerCase());
  if (idx === -1) return 30;
  return new Date(year, idx + 1, 0).getDate();
};

const calculateSalary = (attendance, rate, month, year) => {
  if (!attendance || !rate) return 0;
  const daysInMonth = getDaysInMonth(month, year);
  return attendance * (rate / daysInMonth);
};

const calculateDailyRate = (monthlyRate, month, year) => {
  if (!monthlyRate) return 0;
  return monthlyRate / getDaysInMonth(month, year);
};

const formatPeriod = (month, year) => {
  const idx = MONTH_LIST.indexOf((month || '').toLowerCase());
  if (idx === -1) return '';
  return `${String(idx + 1).padStart(2, '0')}${String(year).slice(-2)}`;
};

const CATEGORY_TABLE_SUFFIX = {
  'Operations': 'hf',
  'Engineering': 'sks',
  'Apprentice': 'apprentice',
  'Finance': 'opjsk',
};

// Helper: get max allowed attendance days considering LWD
const getLwdMaxDays = (emp, selectedMonth, selectedYear) => {
  const maxDays = getDaysInMonth(selectedMonth, selectedYear);
  if (!emp || !emp.lwd) return maxDays;
  const lwd = new Date(emp.lwd);
  lwd.setHours(0, 0, 0, 0);
  const monthIdx = MONTH_LIST.indexOf((selectedMonth || '').toLowerCase());
  const selYear = parseInt(selectedYear);
  if (selYear === lwd.getFullYear() && monthIdx === lwd.getMonth()) {
    return lwd.getDate(); // cap at LWD day
  }
  if (selYear > lwd.getFullYear() || (selYear === lwd.getFullYear() && monthIdx > lwd.getMonth())) {
    return 0; // past LWD month
  }
  return maxDays;
};

const saveAttendanceToDB = async (attendanceList, month, year) => {
  if (!attendanceList || attendanceList.length === 0) return;
  try {
    const response = await axios.post(`${API_BASE_URL}/attendance/save`, {
      month, year,
      data: attendanceList.map(({ empCode, attendance }) => ({
        empCode, attendance: attendance || 0, month, year,
      })),
    });
    return response.data;
  } catch (err) {
    console.error('Error saving attendance to DB:', err);
    throw err;
  }
};

const fetchAttendanceFromDB = async (month, year) => {
  try {
    const response = await axios.get(`${API_BASE_URL}/attendance`, { params: { month, year } });
    return response.data || [];
  } catch (err) {
    console.error('Error fetching attendance:', err);
    return [];
  }
};

const saveDeductionsToDB = async (empList, month, year) => {
  if (!empList || empList.length === 0) return;
  try {
    await axios.post(`${API_BASE_URL}/deductions/save`, {
      month, year,
      data: empList.map(emp => ({
        empCode: emp.empCode, month, year,
        othallow: parseFloat(emp.othallow) || 0,
        club: parseFloat(emp.club) || 0,
        cutieClubDed: parseFloat(emp.cutieClubDed) || 0,
        dish: parseFloat(emp.dish) || 0,
        electricity: parseFloat(emp.electricity) || 0,
        empCopSalary: parseFloat(emp.empCopSalary) || 0,
        fuelDed: parseFloat(emp.fuelDed) || 0,
        jpocSalon: parseFloat(emp.jpocSalon) || 0,
        medicalRecovery: parseFloat(emp.medicalRecovery) || 0,
        milkDed: parseFloat(emp.milkDed) || 0,
        otherDed1: parseFloat(emp.otherDed1) || 0,
        otherDed2: parseFloat(emp.otherDed2) || 0,
        schoolFee: parseFloat(emp.schoolFee) || 0,
        tds: parseFloat(emp.tds) || 0,
        transportDed: parseFloat(emp.transportDed) || 0,
      })),
    });
  } catch (err) {
    console.error('Error saving deductions to DB:', err);
  }
};

const fetchDeductionsFromDB = async (month, year) => {
  try {
    const response = await axios.get(`${API_BASE_URL}/deductions`, { params: { month, year } });
    return response.data || [];
  } catch (err) {
    console.error('Error fetching deductions:', err);
    return [];
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// AttendanceTab
// ─────────────────────────────────────────────────────────────────────────────
const AttendanceTab = ({ attendanceData = [], onAttendanceUpdate, selectedMonth, selectedYear, lockedCategories = {} }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [uploadStatus, setUploadStatus] = useState({ type: '', message: '' });
  const fileInputRef = useRef(null);
  const saveTimeoutRef = useRef(null);

  const isAllLocked = Object.keys(lockedCategories).length > 0 &&
    attendanceData.every(emp => lockedCategories[emp.category]);

  const filteredData = attendanceData.filter(emp => {
    if (!emp) return false;
    const s = (searchTerm || '').toLowerCase();
    return (
      String(emp.empCode || '').toLowerCase().includes(s) ||
      String(emp.name || '').toLowerCase().includes(s) ||
      String(emp.department || '').toLowerCase().includes(s)
    );
  });

  const debouncedSave = useCallback(async (empId, days, updatedData) => {
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(async () => {
      setIsSaving(true);
      try {
        const changedEmp = updatedData.find(e => e.id === empId);
        if (changedEmp) {
          await saveAttendanceToDB([changedEmp], selectedMonth, selectedYear);
          setUploadStatus({ type: 'success', message: 'Attendance saved successfully!' });
          setTimeout(() => setUploadStatus({ type: '', message: '' }), 3000);
        }
      } catch (err) {
        setUploadStatus({ type: 'error', message: 'Failed to save attendance.' });
      } finally {
        setIsSaving(false);
      }
    }, 500);
  }, [selectedMonth, selectedYear]);

  const handleAttendanceChange = async (empId, days, empCategory) => {
    if (lockedCategories[empCategory]) return;
    const parsedDays = parseInt(days) || 0;

    // Find employee to check LWD
    const emp = attendanceData.find(e => e.id === empId || e.empCode === empId);
    const lwdMax = getLwdMaxDays(emp, selectedMonth, selectedYear);
    const validDays = Math.min(parsedDays, lwdMax);

    const newData = attendanceData.map(item =>
      item.id === empId
        ? { ...item, attendance: validDays, basicSalary: calculateSalary(validDays, item.rate || 0, selectedMonth, selectedYear) }
        : item
    );
    onAttendanceUpdate(newData);
    debouncedSave(empId, validDays, newData);
  };

  const handleDownloadTemplate = () => {
    const wb = XLSX.utils.book_new();
    const templateData = attendanceData.map(emp => ({ 'Employee Code': emp.empCode, 'Name': emp.name, 'Days Present': emp.attendance || 0 }));
    const ws = XLSX.utils.json_to_sheet(templateData);
    XLSX.utils.book_append_sheet(wb, ws, 'Attendance Template');
    XLSX.writeFile(wb, `Attendance_Template_${selectedMonth}_${selectedYear}.xlsx`);
  };

  const handleFileUpload = (e) => {
    if (isAllLocked) return;
    const file = e.target.files[0];
    if (!file) return;
    setIsUploading(true);
    setUploadStatus({ type: '', message: '' });
    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        const data = new Uint8Array(ev.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const worksheet = workbook.Sheets[workbook.SheetNames[0]];
        const jsonData = XLSX.utils.sheet_to_json(worksheet);
        if (jsonData.length === 0) throw new Error('The file is empty or could not be read.');
        await processAttendanceData(jsonData, file.name);
      } catch (error) {
        setUploadStatus({ type: 'error', message: error.message || 'Error processing file.' });
        setIsUploading(false);
      } finally {
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    };
    reader.onerror = () => { setUploadStatus({ type: 'error', message: 'Error reading file.' }); setIsUploading(false); };
    reader.readAsArrayBuffer(file);
  };

  const processAttendanceData = async (uploadedData, fileName) => {
    try {
      const attendanceMap = new Map();
      let foundColumns = { empCode: null, days: null };
      if (uploadedData.length > 0) {
        const columnMap = {};
        Object.keys(uploadedData[0]).filter(k => k !== '__rowNum__').forEach(col => { columnMap[col.toLowerCase().replace(/\s+/g, '')] = col; });
        for (const col of ['empcode', 'employeecode', 'employeeid', 'empid', 'id']) { if (columnMap[col]) { foundColumns.empCode = columnMap[col]; break; } }
        for (const col of ['dayspresent', 'days', 'presentdays', 'attendance', 'daysworked']) { if (columnMap[col]) { foundColumns.days = columnMap[col]; break; } }
      }
      if (!foundColumns.empCode || !foundColumns.days) throw new Error('Could not detect required columns (Employee Code, Days Present).');
      uploadedData.forEach(row => {
        const empCode = row[foundColumns.empCode];
        const days = row[foundColumns.days];
        if (empCode && !isNaN(parseFloat(days))) attendanceMap.set(String(empCode).trim(), parseFloat(days));
      });
      const updatedData = attendanceData.map(emp => {
        if (lockedCategories[emp.category]) return emp;
        const empCode = String(emp.empCode).trim();
        if (attendanceMap.has(empCode)) {
          // Cap at LWD
          const lwdMax = getLwdMaxDays(emp, selectedMonth, selectedYear);
          const days = Math.min(attendanceMap.get(empCode), lwdMax);
          return { ...emp, attendance: days, basicSalary: calculateSalary(days, emp.rate || 0, selectedMonth, selectedYear) };
        }
        return emp;
      });
      onAttendanceUpdate(updatedData);
      const toSave = updatedData.filter(emp => !lockedCategories[emp.category] && attendanceMap.has(String(emp.empCode).trim()));
      await saveAttendanceToDB(toSave, selectedMonth, selectedYear);
      setUploadStatus({ type: 'success', message: `Updated attendance for ${toSave.length} employee(s).` });
      setTimeout(() => setUploadStatus({ type: '', message: '' }), 3000);
    } catch (error) {
      setUploadStatus({ type: 'error', message: error.message || 'Error processing attendance data.' });
    } finally {
      setIsUploading(false);
    }
  };

  const totalSalary = filteredData.reduce((sum, emp) => sum + (emp.basicSalary || 0), 0);

  return (
    <div className="tab-content">
      {Object.keys(lockedCategories).length > 0 && (
        <div style={{ marginBottom: 16, padding: '10px 14px', borderRadius: 6, background: '#fef3c7', border: '1px solid #fbbf24', fontSize: 13, color: '#92400e', display: 'flex', alignItems: 'center', gap: 8 }}>
          <i className="fas fa-lock"></i>
          <span>Salary has been generated for <strong>{Object.keys(lockedCategories).join(', ')}</strong> — {selectedMonth} {selectedYear}. Attendance is locked for these categories.</span>
        </div>
      )}
      <div className="tab-header">
        <h3>Attendance Management</h3>
        <div className="header-actions">
          <div className="file-upload-container" style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
            <label className="btn btn-secondary" style={isAllLocked ? { opacity: 0.5, cursor: 'not-allowed', pointerEvents: 'none' } : {}}>
              <i className="fas fa-upload"></i> Upload Attendance
              <input type="file" ref={fileInputRef} accept=".xlsx,.xls,.csv" onChange={handleFileUpload} style={{ display: 'none' }} disabled={isUploading || isAllLocked} />
            </label>
            <button className="btn btn-primary" style={{ height: '2.5rem' }} onClick={handleDownloadTemplate} disabled={isUploading}>
              <i className="fas fa-download"></i> Download Template
            </button>
            {(isUploading || isSaving) && <span className="upload-status"><i className="fas fa-spinner fa-spin"></i> {isUploading ? 'Processing...' : 'Saving...'}</span>}
            {uploadStatus.message && <span className={`status-message ${uploadStatus.type}`}>{uploadStatus.message}</span>}
          </div>
          <div className="search-box" style={{ maxWidth: '300px' }}>
            <i className="fas fa-search"></i>
            <input type="text" placeholder="Search employees..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} style={{ width: '100%' }} />
          </div>
        </div>
      </div>
      <div className="table-container" style={{ overflowX: 'auto', overflowY: 'auto', maxHeight: '500px' }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>Emp Code</th><th>Name</th><th>Department</th><th>Category</th>
              <th>Monthly Pay (₹)</th><th>Daily Pay (₹)</th><th>Attendance (days)</th><th>Basic Salary (₹)</th>
            </tr>
          </thead>
          <tbody>
            {filteredData.length > 0 ? filteredData.map(emp => {
              const isLocked = !!lockedCategories[emp.category];
              const lwdMax = getLwdMaxDays(emp, selectedMonth, selectedYear);
              const isPastLwd = emp.lwd && lwdMax === 0;
              const isLwdMonth = emp.lwd && lwdMax > 0 && lwdMax < getDaysInMonth(selectedMonth, selectedYear);
              return (
                <tr key={emp.id || emp.empCode} style={isLocked ? { background: '#fffbeb' } : {}}>
                  <td>{emp.empCode || 'N/A'}</td>
                  <td>{emp.name || 'N/A'}</td>
                  <td>{emp.department || 'N/A'}</td>
                  <td>
                    {emp.category || 'N/A'}
                    {isLocked && <i className="fas fa-lock" style={{ marginLeft: 5, fontSize: 10, color: '#d97706' }} title="Salary generated — locked"></i>}
                  </td>
                  <td className="text-right">₹{(emp.rate || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                  <td className="text-right">{emp.rate && selectedMonth && selectedYear ? `₹${calculateDailyRate(emp.rate, selectedMonth, selectedYear).toFixed(2)}` : '₹0.00'}</td>
                  <td>
                    <div className="attendance-cell">
                      <input
                        type="number" min="0" max={lwdMax}
                        value={emp.attendance || 0}
                        onChange={e => handleAttendanceChange(emp.id || emp.empCode, e.target.value, emp.category)}
                        className="attendance-input"
                        readOnly={isLocked || isPastLwd}
                        style={
                          isLocked || isPastLwd
                            ? { backgroundColor: '#f3f4f6', color: '#9ca3af', cursor: 'not-allowed', border: '1px solid #e5e7eb' }
                            : isLwdMonth
                              ? { border: '1px solid #f59e0b' }
                              : {}
                        }
                      />
                      <span style={{ fontSize: '11px', color: isPastLwd ? '#dc2626' : isLwdMonth ? '#d97706' : 'inherit' }}>
                        {isPastLwd
                          ? '/ 0 days (past LWD)'
                          : isLwdMonth
                            ? `/ max ${lwdMax} days (LWD: ${emp.lwd})`
                            : `/ ${getDaysInMonth(selectedMonth, selectedYear)} days`}
                      </span>
                    </div>
                  </td>
                  <td className="text-right">₹{(emp.basicSalary || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                </tr>
              );
            }) : (
              <tr><td colSpan="8" className="text-center">{searchTerm ? 'No matching employees found' : 'No employee data available'}</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="tab-footer">
        <div className="summary">
          <div className="summary-item"><span>Total Employees:</span><span className="value">{filteredData.length}</span></div>
          <div className="summary-item"><span>Total Basic Salary:</span><span className="value">₹{totalSalary.toLocaleString('en-IN')}</span></div>
        </div>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// AllowanceTab
// ─────────────────────────────────────────────────────────────────────────────
const AllowanceTab = ({ attendanceData = [], onAllowanceUpdate, lockedCategories = {}, selectedMonth = '', selectedYear = '' }) => {
  const [isUploading, setIsUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState({ type: '', message: '' });
  const [employees, setEmployees] = useState([]);
  const fileInputRef = useRef(null);

  const isAllLocked = Object.keys(lockedCategories).length > 0 &&
    attendanceData.every(emp => lockedCategories[emp.category]);

  useEffect(() => {
    axios.get(`${API_BASE_URL}/employees`)
      .then(r => setEmployees(extractEmployees(r.data)))
      .catch(() => { });
  }, []);

  const getEmployeeAllowance = (empCode) => {
    if (!empCode) return { cea: 0, cha: 0, hra: 0, spa: 0, uma: 0 };
    const employee = employees.find(emp => String(emp.empCode) === String(empCode));
    if (!employee) return { cea: 0, cha: 0, hra: 0, spa: 0, uma: 0 };
    return { cea: Number(employee.cea) || 0, cha: Number(employee.cha) || 0, hra: Number(employee.hra) || 0, spa: Number(employee.spa) || 0, uma: Number(employee.uma) || 0 };
  };

  const handleAllowanceChange = (empId, field, value, empCategory) => {
    if (lockedCategories[empCategory]) return;
    if (onAllowanceUpdate) onAllowanceUpdate(empId, field, parseInt(value) || 0);
  };

  const handleFileUpload = (e) => {
    if (isAllLocked) return;
    const file = e.target.files[0];
    if (!file) return;
    setIsUploading(true);
    setUploadStatus({ type: '', message: '' });
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = new Uint8Array(ev.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const jsonData = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);
        if (jsonData.length === 0) throw new Error('File is empty.');
        processAllowanceData(jsonData);
      } catch (error) {
        setUploadStatus({ type: 'error', message: error.message || 'Error processing file.' });
      } finally {
        setIsUploading(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    };
    reader.onerror = () => { setUploadStatus({ type: 'error', message: 'Error reading file.' }); setIsUploading(false); };
    reader.readAsArrayBuffer(file);
  };

  const processAllowanceData = (uploadedData) => {
    try {
      const allowanceMap = new Map();
      let foundColumns = { empCode: null, cea: null, cha: null, hra: null, othallow: null, spa: null, uma: null };
      if (uploadedData.length > 0) {
        const columnMap = {};
        Object.keys(uploadedData[0]).filter(k => k !== '__rowNum__').forEach(col => { columnMap[col.toLowerCase().replace(/[^a-z0-9]/g, '')] = col; });
        const mappings = {
          empCode: ['empcode', 'employeecode', 'employeeid', 'empid', 'id', 'emp'],
          cea: ['cea'], cha: ['cha'], hra: ['hra'],
          othallow: ['othallow', 'oth', 'otherallowance', 'other'],
          spa: ['spa'], uma: ['uma'],
        };
        Object.entries(mappings).forEach(([field, names]) => {
          for (const n of names) { if (columnMap[n]) { foundColumns[field] = columnMap[n]; break; } }
        });
      }
      if (!foundColumns.empCode) throw new Error('Could not detect employee code column.');
      uploadedData.forEach(row => {
        const empCode = String(row[foundColumns.empCode] || '').trim();
        if (!empCode) return;
        allowanceMap.set(empCode, {
          empCode,
          cea: parseFloat(row[foundColumns.cea] || 0) || 0, cha: parseFloat(row[foundColumns.cha] || 0) || 0,
          hra: parseFloat(row[foundColumns.hra] || 0) || 0, othallow: parseFloat(row[foundColumns.othallow] || 0) || 0,
          spa: parseFloat(row[foundColumns.spa] || 0) || 0, uma: parseFloat(row[foundColumns.uma] || 0) || 0,
        });
      });
      let updatedCount = 0;
      const toSave = [];
      attendanceData.forEach(emp => {
        if (lockedCategories[emp.category]) return;
        const empCode = String(emp.empCode).trim();
        if (allowanceMap.has(empCode)) {
          const allowances = allowanceMap.get(empCode);
          Object.entries(allowances).forEach(([field, value]) => {
            if (field !== 'empCode' && value !== undefined && !isNaN(value) && onAllowanceUpdate)
              onAllowanceUpdate(emp.id, field, value);
          });
          toSave.push({ ...emp, ...allowances });
          updatedCount++;
        }
      });
      if (toSave.length) {
        saveDeductionsToDB(toSave, selectedMonth, selectedYear).catch(() => { });
      }
      setUploadStatus({ type: 'success', message: `Updated allowances for ${updatedCount} employee(s).` });
      setTimeout(() => setUploadStatus({ type: '', message: '' }), 3000);
    } catch (error) {
      setUploadStatus({ type: 'error', message: error.message || 'Error processing allowance data.' });
    }
  };

  const handleDownloadTemplate = () => {
    const wb = XLSX.utils.book_new();
    const templateData = attendanceData.map(emp => ({ 'Employee Code': emp.empCode, 'OTHALLOW': emp.othallow || 0 }));
    const ws = XLSX.utils.json_to_sheet(templateData);
    XLSX.utils.book_append_sheet(wb, ws, 'Allowance Template');
    XLSX.writeFile(wb, `Allowance_Template_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  const calculateTotalAllowance = (emp) => {
    if (!emp) return 0;
    const ea = getEmployeeAllowance(emp.empCode);
    return Math.round((ea.cea + ea.cha + ea.hra + ea.spa + ea.uma + (Number(emp.othallow) || 0) + Number.EPSILON) * 100) / 100;
  };

  return (
    <div className="tab-content">
      {Object.keys(lockedCategories).length > 0 && (
        <div style={{ marginBottom: 16, padding: '10px 14px', borderRadius: 6, background: '#fef3c7', border: '1px solid #fbbf24', fontSize: 13, color: '#92400e', display: 'flex', alignItems: 'center', gap: 8 }}>
          <i className="fas fa-lock"></i>
          <span>Salary generated for <strong>{Object.keys(lockedCategories).join(', ')}</strong>. Allowances are locked for these categories.</span>
        </div>
      )}
      <div className="tab-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '15px' }}>
        <h3>Allowance Management</h3>
        <div className="file-upload-container" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <label className="btn btn-secondary" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '5px', ...(isAllLocked ? { opacity: 0.5, cursor: 'not-allowed', pointerEvents: 'none' } : {}) }}>
            <i className="fas fa-upload"></i> Upload Allowance Data
            <input type="file" ref={fileInputRef} accept=".xlsx,.xls,.csv" onChange={handleFileUpload} style={{ display: 'none' }} disabled={isUploading || isAllLocked} />
          </label>
          <button className="btn btn-primary" style={{ height: '2.5rem' }} onClick={handleDownloadTemplate} disabled={isUploading || attendanceData.length === 0}>
            <i className="fas fa-download"></i> Download Template
          </button>
          {isUploading && <span className="upload-status"><i className="fas fa-spinner fa-spin"></i> Processing...</span>}
          {uploadStatus.message && <span className={`status-message ${uploadStatus.type}`}>{uploadStatus.message}</span>}
        </div>
      </div>
      <div className="table-responsive" style={{ overflowX: 'auto', overflowY: 'auto', maxHeight: '500px' }}>
        {attendanceData.length > 0 ? (
          <table className="data-table">
            <thead>
              <tr>
                <th>Emp Code</th><th>Name</th><th>Department</th><th>Basic (₹)</th>
                <th>CEA (₹)</th><th>CHA (₹)</th><th>HRA (₹)</th><th>OTHALLOW (₹)</th>
                <th>SPA (₹)</th><th>UMA (₹)</th><th>Total Allowance (₹)</th><th>Gross (₹)</th>
              </tr>
            </thead>
            <tbody>
              {attendanceData.map(emp => {
                if (!emp) return null;
                const isLocked = !!lockedCategories[emp.category];
                const basicSalary = Math.round((Number(emp.basicSalary) || 0) * 100) / 100;
                const totalAllowance = calculateTotalAllowance(emp);
                const grossSalary = Math.round((basicSalary + totalAllowance) * 100) / 100;
                const ea = getEmployeeAllowance(emp.empCode);
                return (
                  <tr key={emp.id} style={isLocked ? { background: '#fffbeb' } : {}}>
                    <td>{emp.empCode}</td><td>{emp.name}</td><td>{emp.department}</td>
                    <td>₹{emp.basicSalary?.toLocaleString('en-IN') || '0'}</td>
                    <td><div style={{ padding: '5px', minWidth: '80px', textAlign: 'right' }}>₹{ea.cea.toLocaleString('en-IN')}</div></td>
                    <td><div style={{ padding: '5px', minWidth: '80px', textAlign: 'right' }}>₹{ea.cha.toLocaleString('en-IN')}</div></td>
                    <td><div style={{ padding: '5px', minWidth: '80px', textAlign: 'right' }}>₹{ea.hra.toLocaleString('en-IN')}</div></td>
                    <td>
                      <input type="number" min="0" value={emp.othallow || 0}
                        onChange={e => handleAllowanceChange(emp.id, 'othallow', e.target.value, emp.category)}
                        className="allowance-input" readOnly={isLocked}
                        style={{ width: '80px', ...(isLocked ? { backgroundColor: '#f3f4f6', color: '#9ca3af', cursor: 'not-allowed', border: '1px solid #e5e7eb' } : {}) }}
                      />
                    </td>
                    <td><div style={{ padding: '5px', minWidth: '80px', textAlign: 'right' }}>₹{ea.spa.toLocaleString('en-IN')}</div></td>
                    <td><div style={{ padding: '5px', minWidth: '80px', textAlign: 'right' }}>₹{ea.uma.toLocaleString('en-IN')}</div></td>
                    <td>₹{totalAllowance.toLocaleString('en-IN')}</td>
                    <td>₹{grossSalary.toLocaleString('en-IN')}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <div className="text-center">No attendance data available. Please fill attendance first.</div>
        )}
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// DeductionTab
// ─────────────────────────────────────────────────────────────────────────────
const DeductionTab = ({ attendanceData = [], onDeductionUpdate, lockedCategories = {}, selectedMonth = '', selectedYear = '' }) => {
  const [isUploading, setIsUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState({ type: '', message: '' });
  const [employees, setEmployees] = useState([]);
  const fileInputRef = useRef(null);

  const isAllLocked = Object.keys(lockedCategories).length > 0 &&
    attendanceData.every(emp => lockedCategories[emp.category]);

  useEffect(() => {
    axios.get(`${API_BASE_URL}/employees`)
      .then(r => setEmployees(extractEmployees(r.data)))
      .catch(() => { });
  }, []);

  const getEmployeeAllowance = (empCode) => {
    if (!empCode) return { cea: 0, cha: 0, hra: 0, spa: 0, uma: 0 };
    const employee = employees.find(emp => String(emp.empCode) === String(empCode));
    if (!employee) return { cea: 0, cha: 0, hra: 0, spa: 0, uma: 0 };
    return { cea: Number(employee.cea) || 0, cha: Number(employee.cha) || 0, hra: Number(employee.hra) || 0, spa: Number(employee.spa) || 0, uma: Number(employee.uma) || 0 };
  };

  const calculateTotalAllowance = (emp) => {
    if (!emp) return 0;
    const ea = getEmployeeAllowance(emp.empCode);
    return Math.round((ea.cea + ea.cha + ea.hra + ea.spa + ea.uma + (Number(emp.othallow) || 0) + Number.EPSILON) * 100) / 100;
  };

  const handleDeductionChange = (empId, field, value, empCategory) => {
    if (lockedCategories[empCategory]) return;
    if (onDeductionUpdate) onDeductionUpdate(empId, field, parseInt(value) || 0);
  };

  const handleFileUpload = (e) => {
    if (isAllLocked) return;
    const file = e.target.files[0];
    if (!file) return;
    setIsUploading(true);
    setUploadStatus({ type: '', message: '' });
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = new Uint8Array(ev.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const jsonData = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);
        if (jsonData.length === 0) throw new Error('File is empty.');
        processDeductionData(jsonData);
      } catch (error) {
        setUploadStatus({ type: 'error', message: error.message || 'Error processing file.' });
      } finally {
        setIsUploading(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    };
    reader.onerror = () => { setUploadStatus({ type: 'error', message: 'Error reading file.' }); setIsUploading(false); };
    reader.readAsArrayBuffer(file);
  };

  const processDeductionData = (uploadedData) => {
    try {
      const deductionMap = new Map();
      let foundColumns = { empCode: null, club: null, cutieClubDed: null, dish: null, electricity: null, empCopSalary: null, fuelDed: null, jpocSalon: null, medicalRecovery: null, milkDed: null, otherDed1: null, otherDed2: null, schoolFee: null, tds: null, transportDed: null };
      if (uploadedData.length > 0) {
        const columnMap = {};
        Object.keys(uploadedData[0]).filter(k => k !== '__rowNum__').forEach(col => { columnMap[col.toLowerCase().replace(/[^a-z0-9]/g, '')] = col; });
        const mappings = {
          empCode: ['empcode', 'employeecode', 'employeeid', 'empid', 'id', 'emp'],
          club: ['club'], cutieClubDed: ['cutieclubded', 'cutieclub', 'cuteded', 'cutie'],
          dish: ['dish'], electricity: ['electricity', 'elec'],
          empCopSalary: ['empcorpsalary', 'empcopsalary', 'empcop', 'corpsalary', 'empsalary'],
          fuelDed: ['fuelded', 'fuel'], jpocSalon: ['jpocsalon', 'jpoc', 'salon'],
          medicalRecovery: ['medicalrecovery', 'medical', 'medrecovery', 'medrec'],
          milkDed: ['milkded', 'milk'], otherDed1: ['otherded1', 'other1', 'deduction1'],
          otherDed2: ['otherded2', 'other2', 'deduction2'], schoolFee: ['schoolfee', 'school', 'fees'],
          tds: ['tds'], transportDed: ['transportded', 'transport', 'transportation'],
        };
        Object.entries(mappings).forEach(([field, names]) => {
          for (const n of names) { if (columnMap[n]) { foundColumns[field] = columnMap[n]; break; } }
        });
      }
      if (!foundColumns.empCode) throw new Error('Could not detect employee code column.');
      uploadedData.forEach(row => {
        const empCode = String(row[foundColumns.empCode] || '').trim();
        if (!empCode) return;
        const d = { empCode };
        ['club', 'cutieClubDed', 'dish', 'electricity', 'empCopSalary', 'fuelDed', 'jpocSalon', 'medicalRecovery', 'milkDed', 'otherDed1', 'otherDed2', 'schoolFee', 'tds', 'transportDed'].forEach(f => {
          d[f] = parseFloat(row[foundColumns[f]] || 0) || 0;
        });
        deductionMap.set(empCode, d);
      });
      let updatedCount = 0;
      const toSave = [];
      attendanceData.forEach(emp => {
        if (lockedCategories[emp.category]) return;
        const empCode = String(emp.empCode).trim();
        if (deductionMap.has(empCode)) {
          const deductions = deductionMap.get(empCode);
          Object.entries(deductions).forEach(([field, value]) => {
            if (field !== 'empCode' && value !== undefined && !isNaN(value) && onDeductionUpdate)
              onDeductionUpdate(emp.id, field, value);
          });
          toSave.push({ ...emp, ...deductions });
          updatedCount++;
        }
      });
      if (toSave.length) {
        saveDeductionsToDB(toSave, selectedMonth, selectedYear).catch(() => { });
      }
      setUploadStatus({ type: 'success', message: `Updated deductions for ${updatedCount} employee(s).` });
      setTimeout(() => setUploadStatus({ type: '', message: '' }), 3000);
    } catch (error) {
      setUploadStatus({ type: 'error', message: error.message || 'Error processing deduction data.' });
    }
  };

  const handleDownloadTemplate = () => {
    const wb = XLSX.utils.book_new();
    const templateData = attendanceData.map(emp => ({
      'Employee Code': emp.empCode, 'CLUB': emp.club || 0, 'CUTIE CLUB DED': emp.cutieClubDed || 0,
      'DISH': emp.dish || 0, 'ELECTRICITY': emp.electricity || 0, 'EMP COP SALARY': emp.empCopSalary || 0,
      'FUEL DED': emp.fuelDed || 0, 'JPOC SALON': emp.jpocSalon || 0, 'MEDICAL RECOVERY': emp.medicalRecovery || 0,
      'MILK DED': emp.milkDed || 0, 'OTHER DED1': emp.otherDed1 || 0, 'OTHER DED2': emp.otherDed2 || 0,
      'SCHOOL FEE': emp.schoolFee || 0, 'TDS': emp.tds || 0, 'TRANSPORT DED': emp.transportDed || 0,
    }));
    const ws = XLSX.utils.json_to_sheet(templateData);
    XLSX.utils.book_append_sheet(wb, ws, 'Deduction Template');
    XLSX.writeFile(wb, `Deduction_Template_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  const calculateTotalDeductions = (emp) => {
    const pf = emp.category === 'Apprentice' ? 0 : Math.round((emp.basicSalary || 0) * 0.12);
    const esic = emp.category === 'Apprentice' ? 0 : Math.round(((emp.basicSalary || 0) + calculateTotalAllowance(emp)) * 0.0075);
    const wf = emp.category === 'Apprentice' ? 0 : Math.round((emp.basicSalary || 0) * 0.015);
    const fields = ['club', 'cutieClubDed', 'dish', 'electricity', 'empCopSalary', 'fuelDed', 'jpocSalon', 'medicalRecovery', 'milkDed', 'otherDed1', 'otherDed2', 'schoolFee', 'tds', 'transportDed'];
    return fields.reduce((t, f) => t + (emp[f] || 0), 0) + pf + esic + wf;
  };

  const calculateGrossSalary = (emp) => Math.max(0, (emp.basicSalary || 0) + calculateTotalAllowance(emp) - calculateTotalDeductions(emp));

  const renderDeductionInput = (emp, field) => {
    const isLocked = !!lockedCategories[emp.category];
    return (
      <input type="number" min="0" value={emp[field] || 0}
        onChange={e => handleDeductionChange(emp.id, field, e.target.value, emp.category)}
        className="deduction-input" readOnly={isLocked}
        style={{ width: '70px', ...(isLocked ? { backgroundColor: '#f3f4f6', color: '#9ca3af', cursor: 'not-allowed', border: '1px solid #e5e7eb' } : {}) }}
      />
    );
  };

  return (
    <div className="tab-content">
      {Object.keys(lockedCategories).length > 0 && (
        <div style={{ marginBottom: 16, padding: '10px 14px', borderRadius: 6, background: '#fef3c7', border: '1px solid #fbbf24', fontSize: 13, color: '#92400e', display: 'flex', alignItems: 'center', gap: 8 }}>
          <i className="fas fa-lock"></i>
          <span>Salary generated for <strong>{Object.keys(lockedCategories).join(', ')}</strong>. Deductions are locked for these categories.</span>
        </div>
      )}
      <div className="tab-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '15px' }}>
        <h3>Deduction Management</h3>
        <div className="file-upload-container" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <label className="btn btn-secondary" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '5px', ...(isAllLocked ? { opacity: 0.5, cursor: 'not-allowed', pointerEvents: 'none' } : {}) }}>
            <i className="fas fa-upload"></i> Upload Deduction Data
            <input type="file" ref={fileInputRef} accept=".xlsx,.xls,.csv" onChange={handleFileUpload} style={{ display: 'none' }} disabled={isUploading || isAllLocked} />
          </label>
          <button className="btn btn-primary" style={{ height: '2.5rem' }} onClick={handleDownloadTemplate} disabled={isUploading || attendanceData.length === 0}>
            <i className="fas fa-download"></i> Download Template
          </button>
          {isUploading && <span className="upload-status"><i className="fas fa-spinner fa-spin"></i> Processing...</span>}
          {uploadStatus.message && <span className={`status-message ${uploadStatus.type}`}>{uploadStatus.message}</span>}
        </div>
      </div>
      <div className="table-responsive" style={{ overflowX: 'auto', overflowY: 'auto', maxHeight: '500px' }}>
        {attendanceData.length > 0 ? (
          <table className="data-table">
            <colgroup>
              <col style={{ width: '100px' }} /><col style={{ width: '150px' }} /><col style={{ width: '120px' }} />
              <col style={{ width: '100px' }} /><col style={{ width: '100px' }} />
              {Array(17).fill(null).map((_, i) => <col key={i} style={{ width: '80px' }} />)}
              <col style={{ width: '120px' }} /><col style={{ width: '120px' }} />
            </colgroup>
            <thead>
              <tr>
                <th>Emp Code</th><th>Name</th><th>Department</th><th>Basic (₹)</th><th>Total Allow. (₹)</th>
                <th>CLUB</th><th>CUTIE CLUB DED.</th><th>DISH</th><th>ELECTRICITY</th><th>EMP COP. SAL.</th>
                <th>ESIC</th><th>FUELDED</th><th>JPOCSALON</th><th>MEDICAL-REC.</th><th>MILKDED</th>
                <th>OTHERDED1</th><th>OTHERDED2</th><th>PF</th><th>SCHOOLFEE</th><th>TDS</th>
                <th>TRANSPORT-DED</th><th>WF</th><th>Total Ded. (₹)</th><th>Net Salary (₹)</th>
              </tr>
            </thead>
            <tbody>
              {attendanceData.map(emp => {
                const isLocked = !!lockedCategories[emp.category];
                const totalAllowance = calculateTotalAllowance(emp);
                const totalDeductions = calculateTotalDeductions(emp);
                const grossSalary = calculateGrossSalary(emp);
                const pf = emp.category === 'Apprentice' ? 0 : Math.round((emp.basicSalary || 0) * 0.12);
                const esic = emp.category === 'Apprentice' ? 0 : Math.round(((emp.basicSalary || 0) + totalAllowance) * 0.0075);
                const wf = emp.category === 'Apprentice' ? 0 : Math.round((emp.basicSalary || 0) * 0.015);
                return (
                  <tr key={emp.id} style={isLocked ? { background: '#fffbeb' } : {}}>
                    <td>{emp.empCode}</td><td>{emp.name}</td><td>{emp.department}</td>
                    <td>₹{emp.basicSalary?.toLocaleString('en-IN') || '0'}</td>
                    <td>₹{totalAllowance.toLocaleString('en-IN')}</td>
                    <td>{renderDeductionInput(emp, 'club')}</td>
                    <td>{renderDeductionInput(emp, 'cutieClubDed')}</td>
                    <td>{renderDeductionInput(emp, 'dish')}</td>
                    <td>{renderDeductionInput(emp, 'electricity')}</td>
                    <td>{renderDeductionInput(emp, 'empCopSalary')}</td>
                    <td>
                      <input type="number" value={esic} readOnly className="deduction-input"
                        style={{ width: '70px', backgroundColor: '#f5f5f5', border: '1px solid #ddd', color: emp.category === 'Apprentice' ? '#999' : '#666' }}
                        title={emp.category === 'Apprentice' ? 'Not eligible for ESIC' : 'ESIC (0.75% of gross)'} />
                    </td>
                    <td>{renderDeductionInput(emp, 'fuelDed')}</td>
                    <td>{renderDeductionInput(emp, 'jpocSalon')}</td>
                    <td>{renderDeductionInput(emp, 'medicalRecovery')}</td>
                    <td>{renderDeductionInput(emp, 'milkDed')}</td>
                    <td>{renderDeductionInput(emp, 'otherDed1')}</td>
                    <td>{renderDeductionInput(emp, 'otherDed2')}</td>
                    <td>
                      <input type="number" value={pf} readOnly className="deduction-input"
                        style={{ width: '70px', backgroundColor: '#f5f5f5', border: '1px solid #ddd', color: emp.category === 'Apprentice' ? '#999' : 'inherit' }}
                        title={emp.category === 'Apprentice' ? 'Not eligible for PF' : 'PF (12% of basic)'} />
                    </td>
                    <td>{renderDeductionInput(emp, 'schoolFee')}</td>
                    <td>{renderDeductionInput(emp, 'tds')}</td>
                    <td>{renderDeductionInput(emp, 'transportDed')}</td>
                    <td>
                      <input type="number" value={wf} readOnly className="deduction-input"
                        style={{ width: '70px', backgroundColor: '#f5f5f5', border: '1px solid #ddd', color: emp.category === 'Apprentice' ? '#999' : '#666' }}
                        title={emp.category === 'Apprentice' ? 'Not eligible for WF' : 'WF (1.5% of basic)'} />
                    </td>
                    <td>₹{totalDeductions.toLocaleString('en-IN')}</td>
                    <td>₹{grossSalary.toLocaleString('en-IN')}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <div className="text-center">No employee data available. Please fill attendance and allowance first.</div>
        )}
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// SalaryTab
// ─────────────────────────────────────────────────────────────────────────────
const SalaryTab = ({ attendanceData = [], selectedMonth, selectedYear, status, setStatus, isGenerating, setIsGenerating, onSalaryGenerated, lockedCategories = {} }) => {
  const navigate = useNavigate();
  const [searchTerm, setSearchTerm] = useState('');
  const [employees, setEmployees] = useState([]);
  const [existingSalaryData, setExistingSalaryData] = useState({});

  useEffect(() => {
    axios.get(`${API_BASE_URL}/employees`)
      .then(r => setEmployees(extractEmployees(r.data)))
      .catch(() => { });
    checkExistingSalaryData();
  }, [selectedMonth, selectedYear]); // eslint-disable-line

  const checkExistingSalaryData = async () => {
    const period = formatPeriod(selectedMonth, selectedYear);
    if (!period) return;
    try {
      const response = await axios.get(`${API_BASE_URL}/salaries/period/${period}`);
      if (response.data && response.data.data) {
        const existingMap = {};
        response.data.data.forEach(emp => { existingMap[emp.emp_code] = emp; });
        setExistingSalaryData(existingMap);
      }
    } catch (err) { console.log('No existing salary data found'); }
  };

  const getEmployeeAllowance = (empCode) => {
    if (!empCode) return { cea: 0, cha: 0, hra: 0, spa: 0, uma: 0 };
    const employee = employees.find(emp => String(emp.empCode) === String(empCode));
    if (!employee) return { cea: 0, cha: 0, hra: 0, spa: 0, uma: 0 };
    return { cea: Number(employee.cea) || 0, cha: Number(employee.cha) || 0, hra: Number(employee.hra) || 0, spa: Number(employee.spa) || 0, uma: Number(employee.uma) || 0 };
  };

  const calculateTotalAllowance = (emp) => {
    if (!emp) return 0;
    const ea = getEmployeeAllowance(emp.empCode);
    return Math.round((ea.cea + ea.cha + ea.hra + ea.spa + ea.uma + (Number(emp.othallow) || 0) + Number.EPSILON) * 100) / 100;
  };

  const calculateTotalDeduction = (emp) => {
    const pf = emp.category === 'Apprentice' ? 0 : Math.round((emp.basicSalary || 0) * 0.12);
    const esic = emp.category === 'Apprentice' ? 0 : Math.round(((emp.basicSalary || 0) + calculateTotalAllowance(emp)) * 0.0075);
    const wf = emp.category === 'Apprentice' ? 0 : Math.round((emp.basicSalary || 0) * 0.015);
    const fields = ['club', 'cutieClubDed', 'dish', 'electricity', 'empCopSalary', 'fuelDed', 'jpocSalon', 'medicalRecovery', 'milkDed', 'otherDed1', 'otherDed2', 'schoolFee', 'tds', 'transportDed'];
    return fields.reduce((t, f) => t + (emp[f] || 0), 0) + pf + esic + wf;
  };

  const calculateNetSalary = (emp) => Math.max(0, (parseFloat(emp.basicSalary) || 0) + calculateTotalAllowance(emp) - calculateTotalDeduction(emp));

  const handleGenerateSalary = async () => {
    if (!selectedMonth || !selectedYear) { setStatus({ type: 'error', message: 'Please select both month and year', show: true }); return; }
    if (attendanceData.length === 0) { setStatus({ type: 'error', message: 'No employee data to generate salary for.', show: true }); return; }
    const allowed = allowedCategories();
    const safeData = attendanceData.filter(emp => allowed.includes(emp.category));
    if (safeData.length === 0) { setStatus({ type: 'error', message: 'No eligible employees for your role.', show: true }); return; }
    const unlockedData = safeData.filter(emp => !lockedCategories[emp.category]);
    if (unlockedData.length === 0) {
      const alreadyDone = [...new Set(safeData.map(e => e.category))].filter(c => lockedCategories[c]);
      setStatus({ type: 'error', message: `Salary for ${alreadyDone.join(', ')} — ${selectedMonth} ${selectedYear} has already been generated and cannot be regenerated.`, show: true });
      return;
    }
    const lockedOnes = safeData.filter(emp => lockedCategories[emp.category]);
    if (lockedOnes.length > 0) {
      const alreadyDone = [...new Set(lockedOnes.map(e => e.category))];
      setStatus({ type: 'warning', message: `Note: ${alreadyDone.join(', ')} already generated this month — skipping those. Proceeding with unlocked categories.`, show: true });
    }
    setIsGenerating(true);
    if (!lockedOnes.length) setStatus({ type: 'info', message: 'Generating salary data...', show: true });
    try {
      const period = formatPeriod(selectedMonth, selectedYear);
      const categoryGroups = {};
      unlockedData.forEach(emp => { const cat = emp.category; if (!categoryGroups[cat]) categoryGroups[cat] = []; categoryGroups[cat].push(emp); });
      let successCount = 0;
      const errorList = [];
      for (const [category, empList] of Object.entries(categoryGroups)) {
        const tableSuffix = CATEGORY_TABLE_SUFFIX[category];
        if (!tableSuffix) { errorList.push(`Unknown category: ${category}`); continue; }
        const salaryData = empList.map(emp => {
          // Re-cap attendance at LWD before generating salary
          const lwdMax = getLwdMaxDays(emp, selectedMonth, selectedYear);
          const cappedAttendance = Math.min(emp.attendance || 0, lwdMax);
          const cappedBasicSalary = calculateSalary(cappedAttendance, emp.rate || 0, selectedMonth, selectedYear);
          const empWithCapped = { ...emp, basicSalary: cappedBasicSalary };

          const ea = getEmployeeAllowance(emp.empCode);
          const totalAllowance = calculateTotalAllowance(empWithCapped);
          const totalDeduction = calculateTotalDeduction(empWithCapped);
          const netSalary = Math.max(0, cappedBasicSalary + totalAllowance - totalDeduction);
          const pf = emp.category === 'Apprentice' ? 0 : Math.round(cappedBasicSalary * 0.12);
          const esic = emp.category === 'Apprentice' ? 0 : Math.round((cappedBasicSalary + totalAllowance) * 0.0075);
          const wf = emp.category === 'Apprentice' ? 0 : Math.round(cappedBasicSalary * 0.015);
          return {
            empCode: emp.empCode, name: emp.name, bankAccount: emp.bankAccount || '',
            department: emp.department, category: emp.category, rate: emp.rate || 0,
            attendance: cappedAttendance, basicSalary: cappedBasicSalary,
            month: selectedMonth, year: selectedYear, period,
            CEA: ea.cea, CHA: ea.cha, HRA: ea.hra, SPA: ea.spa, UMA: ea.uma,
            OTHALLOW: parseFloat(emp.othallow) || 0, CLUB: parseFloat(emp.club) || 0,
            CUTIE_CLUB_DED: parseFloat(emp.cutieClubDed) || 0, DISH: parseFloat(emp.dish) || 0,
            ELECTRICITY: parseFloat(emp.electricity) || 0, EMP_COP_SALARY: parseFloat(emp.empCopSalary) || 0,
            FUELDED: parseFloat(emp.fuelDed) || 0, JPOCSALON: parseFloat(emp.jpocSalon) || 0,
            MEDICAL_RECOVERY: parseFloat(emp.medicalRecovery) || 0, MILKDED: parseFloat(emp.milkDed) || 0,
            OTHERDED1: parseFloat(emp.otherDed1) || 0, OTHERDED2: parseFloat(emp.otherDed2) || 0,
            SCHOOLFEE: parseFloat(emp.schoolFee) || 0, TDS: parseFloat(emp.tds) || 0,
            TRANSPORT_DED: parseFloat(emp.transportDed) || 0, PF: pf, ESIC: esic, WF: wf,
            totalAllowance, totalDeduction, netSalary,
          };
        });
        try {
          const response = await axios.post(`${API_BASE_URL}/salaries/generate`, {
            period, month: selectedMonth, year: selectedYear,
            category, tableSuffix, data: salaryData,
          });
          if (response.data.success) { successCount++; }
        } catch (err) {
          if (err.response?.status === 409) {
            errorList.push(`${category}: already generated on server (skipped)`);
          } else {
            errorList.push(`${category}: ${err.response?.data?.message || err.message}`);
          }
        }
      }

      if (errorList.length > 0 && successCount === 0) {
        setStatus({ type: 'warning', message: `Skipped: ${errorList.join(', ')}`, show: true });
      } else if (errorList.length > 0) {
        setStatus({ type: 'warning', message: `Partial success. Skipped: ${errorList.join(', ')}`, show: true });
      } else {
        setStatus({ type: 'success', message: `Salary generated and saved for ${Object.keys(categoryGroups).join(', ')} — ${selectedMonth} ${selectedYear}. Redirecting to Reports...`, show: true });
        if (onSalaryGenerated) onSalaryGenerated();
        await checkExistingSalaryData();
        setTimeout(() => {
          navigate('/reports', { state: { defaultMonth: selectedMonth, defaultYear: selectedYear } });
        }, 1500);
      }
      setTimeout(() => setStatus(prev => ({ ...prev, show: false })), 6000);
    } catch (error) {
      console.error('Salary generation error:', error);
      setStatus({ type: 'error', message: error.response?.data?.message || `Failed to generate salary: ${error.message}`, show: true });
    } finally {
      setIsGenerating(false);
    }
  };

  const filteredData = attendanceData.filter(emp =>
    String(emp.empCode).toLowerCase().includes(searchTerm.toLowerCase()) ||
    (emp.name && emp.name.toLowerCase().includes(searchTerm.toLowerCase())) ||
    (emp.department && emp.department.toLowerCase().includes(searchTerm.toLowerCase())) ||
    (emp.category && emp.category.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  const totalNetSalary = filteredData.reduce((sum, emp) => sum + calculateNetSalary(emp), 0);
  const allLocked = attendanceData.length > 0 &&
    allowedCategories().filter(cat => attendanceData.some(e => e.category === cat)).every(cat => lockedCategories[cat]);

  return (
    <div className="tab-content">
      <div className="tab-header" style={{ marginBottom: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
        <h3>Salary Summary</h3>
        <div style={{ display: 'flex', gap: '15px', alignItems: 'center', flexWrap: 'wrap' }}>
          <div className="search-box" style={{ maxWidth: '300px' }}>
            <i className="fas fa-search"></i>
            <input type="text" placeholder="Search employees..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} style={{ width: '100%' }} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              onClick={handleGenerateSalary}
              disabled={isGenerating || attendanceData.length === 0 || allLocked}
              className="btn btn-primary"
              style={{ whiteSpace: 'nowrap', opacity: allLocked ? 0.6 : 1, cursor: allLocked ? 'not-allowed' : 'pointer' }}
              title={allLocked ? `Salary for ${selectedMonth} ${selectedYear} has already been generated.` : ''}
            >
              {isGenerating
                ? <><i className="fas fa-spinner fa-spin"></i> Generating...</>
                : allLocked
                  ? <><i className="fas fa-lock"></i> Already Generated</>
                  : <><i className="fas fa-save"></i> Generate &amp; Save Salary</>}
            </button>
            {allLocked && (
              <span style={{ background: '#fef3c7', color: '#92400e', fontSize: 12, border: '1px solid #fbbf24', borderRadius: 6, padding: '4px 10px', display: 'flex', alignItems: 'center', gap: 5 }}>
                <i className="fas fa-lock" style={{ fontSize: 11 }}></i> Locked for {selectedMonth} {selectedYear}
              </span>
            )}
          </div>
        </div>
      </div>
      {!allLocked && Object.keys(lockedCategories).length > 0 && (
        <div style={{ marginBottom: 16, padding: '10px 14px', borderRadius: 6, background: '#fef3c7', border: '1px solid #fbbf24', fontSize: 13, color: '#92400e', display: 'flex', alignItems: 'center', gap: 8 }}>
          <i className="fas fa-exclamation-triangle"></i>
          <span><strong>{Object.keys(lockedCategories).join(', ')}</strong> — salary already generated for {selectedMonth} {selectedYear}. These categories will be skipped on next generation.</span>
        </div>
      )}
      <div style={{ display: 'flex', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
        {[
          { label: 'Total Employees', value: filteredData.length },
          { label: 'Total Basic', value: `₹${filteredData.reduce((s, e) => s + (parseFloat(e.basicSalary) || 0), 0).toLocaleString('en-IN')}` },
          { label: 'Total Net Pay', value: `₹${totalNetSalary.toLocaleString('en-IN')}` },
        ].map(({ label, value }) => (
          <div key={label} style={{ padding: '10px 16px', borderRadius: 8, background: '#f5f5f5', minWidth: 160 }}>
            <div style={{ fontSize: 11, color: '#888' }}>{label}</div>
            <div style={{ fontSize: 18, fontWeight: 600 }}>{value}</div>
          </div>
        ))}
      </div>
      <div className="table-responsive" style={{ overflowX: 'auto', overflowY: 'auto', maxHeight: '500px' }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>Emp Code</th><th>Name</th><th>Bank Account</th><th>Department</th><th>Category</th>
              <th>Daily Rate (₹)</th><th>Attendance</th><th>Basic Salary (₹)</th>
              <th>Total Allowance (₹)</th><th>Total Deduction (₹)</th><th>Net Salary (₹)</th><th>Status</th>
            </tr>
          </thead>
          <tbody>
            {filteredData.length > 0 ? filteredData.map((emp, index) => {
              const totalAllowance = calculateTotalAllowance(emp);
              const totalDeduction = calculateTotalDeduction(emp);
              const netSalary = calculateNetSalary(emp);
              const isSaved = existingSalaryData[emp.empCode];
              const isCatLocked = lockedCategories[emp.category];
              return (
                <tr key={index} style={{ background: isCatLocked ? '#fffbeb' : undefined }}>
                  <td>{emp.empCode || '-'}</td><td>{emp.name || '-'}</td><td>{emp.bankAccount || '-'}</td>
                  <td>{emp.department || 'N/A'}</td>
                  <td>
                    {emp.category || 'N/A'}
                    {isCatLocked && <i className="fas fa-lock" title="Already generated this month" style={{ marginLeft: 5, fontSize: 10, color: '#d97706' }}></i>}
                  </td>
                  <td className="text-right">{emp.rate && selectedMonth && selectedYear ? calculateDailyRate(emp.rate, selectedMonth, selectedYear).toFixed(2) : '0.00'}</td>
                  <td className="text-center">{emp.attendance || '0'}</td>
                  <td className="text-right">{(emp.basicSalary || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                  <td className="text-right">{totalAllowance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                  <td className="text-right">{totalDeduction.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                  <td className="text-right" style={{ fontWeight: 'bold', color: netSalary > 0 ? '#2e7d32' : 'inherit' }}>{netSalary.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                  <td>{isSaved ? <span style={{ color: '#2e7d32', fontSize: '11px' }}><i className="fas fa-check-circle"></i> Saved</span> : <span style={{ color: '#ff9800', fontSize: '11px' }}><i className="fas fa-clock"></i> Not Saved</span>}</td>
                </tr>
              );
            }) : <tr><td colSpan="12" className="text-center">No matching records found</td></tr>}
          </tbody>
          {filteredData.length > 0 && (
            <tfoot>
              <tr>
                <th colSpan="6" className="text-right">Total:</th>
                <th className="text-center">{filteredData.reduce((sum, emp) => sum + (parseInt(emp.attendance) || 0), 0)}</th>
                <th className="text-right">{filteredData.reduce((sum, emp) => sum + (parseFloat(emp.basicSalary) || 0), 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</th>
                <th className="text-right">{filteredData.reduce((sum, emp) => sum + calculateTotalAllowance(emp), 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</th>
                <th className="text-right">{filteredData.reduce((sum, emp) => sum + calculateTotalDeduction(emp), 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</th>
                <th className="text-right">{filteredData.reduce((sum, emp) => sum + calculateNetSalary(emp), 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</th>
                <th></th>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Main Payroll Component
// ─────────────────────────────────────────────────────────────────────────────
const Payroll = () => {
  const role = getUserRole();
  const allowed = allowedCategories();
  const schoolRestricted = isSchoolUser();
  const plantRestricted = isPlantUser();

  const [activeTab, setActiveTab] = useState('attendance');
  const _now = new Date();
  const [selectedMonth, setSelectedMonth] = useState(['January','February','March','April','May','June','July','August','September','October','November','December'][_now.getMonth()]);
  const [selectedYear, setSelectedYear] = useState(_now.getFullYear());
  const [selectedCategory, setSelectedCategory] = useState(schoolRestricted ? 'Finance' : 'all');
  const [attendanceData, setAttendanceData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [status, setStatus] = useState({ type: '', message: '', show: false });
  const [isGenerating, setIsGenerating] = useState(false);
  const [isPayrollStarted, setIsPayrollStarted] = useState(false);
  const [serverLockedCategories, setServerLockedCategories] = useState({});

  const lockedCategories = React.useMemo(() => {
    const myCategories = allowedCategories();
    const locked = {};
    Object.keys(serverLockedCategories).forEach(cat => {
      if (myCategories.includes(cat)) locked[cat] = true;
    });
    return locked;
  }, [serverLockedCategories]);

  const filteredAttendanceData = selectedCategory === 'all'
    ? attendanceData
    : attendanceData.filter(emp => emp.category === selectedCategory);

  const fetchEmployees = useCallback(async (month, year) => {
    if (!month || !year) return;
    try {
      setLoading(true);
      setError('');
      const response = await axios.get(`${API_BASE_URL}/employees`);
      let employees = extractEmployees(response.data);
      employees = employees.filter(emp => String(emp.status).toLowerCase() === 'active');
      employees = employees.filter(emp => allowed.includes(emp.category));
      if (employees.length === 0) { setAttendanceData([]); setLoading(false); return; }

      const [savedAttendance, savedDeductions] = await Promise.all([
        fetchAttendanceFromDB(month, year),
        fetchDeductionsFromDB(month, year),
      ]);

      const attendanceMap = new Map();
      savedAttendance.forEach(item => { attendanceMap.set(String(item.empCode), item); });

      const deductionMap = new Map();
      savedDeductions.forEach(item => { deductionMap.set(String(item.empCode), item); });

      const mergedData = employees.map(emp => {
        const savedAtt = attendanceMap.get(String(emp.empCode));
        const savedDed = deductionMap.get(String(emp.empCode));
        let days = savedAtt ? (savedAtt.attendance || 0) : 0;

        // Cap days at LWD if set
        const lwdMax = getLwdMaxDays({ lwd: emp.lwd }, month, year);
        if (days > lwdMax) days = lwdMax;

        return {
          id: emp.empCode, empCode: emp.empCode,
          name: `${emp.firstName || ''} ${emp.lastName || ''}`.trim() || emp.name || 'N/A',
          bankAccount: emp.bankAccount || '', department: emp.department || 'N/A',
          category: emp.category || 'N/A', rate: emp.basic || 0,
          lwd: emp.lwd || null,
          attendance: days, basicSalary: calculateSalary(days, emp.basic || 0, month, year),
          month, year,
          othallow: savedDed ? (parseFloat(savedDed.othallow) || 0) : 0,
          club: savedDed ? (parseFloat(savedDed.club) || 0) : 0,
          cutieClubDed: savedDed ? (parseFloat(savedDed.cutieClubDed) || 0) : 0,
          dish: savedDed ? (parseFloat(savedDed.dish) || 0) : 0,
          electricity: savedDed ? (parseFloat(savedDed.electricity) || 0) : 0,
          empCopSalary: savedDed ? (parseFloat(savedDed.empCopSalary) || 0) : 0,
          fuelDed: savedDed ? (parseFloat(savedDed.fuelDed) || 0) : 0,
          jpocSalon: savedDed ? (parseFloat(savedDed.jpocSalon) || 0) : 0,
          medicalRecovery: savedDed ? (parseFloat(savedDed.medicalRecovery) || 0) : 0,
          milkDed: savedDed ? (parseFloat(savedDed.milkDed) || 0) : 0,
          otherDed1: savedDed ? (parseFloat(savedDed.otherDed1) || 0) : 0,
          otherDed2: savedDed ? (parseFloat(savedDed.otherDed2) || 0) : 0,
          schoolFee: savedDed ? (parseFloat(savedDed.schoolFee) || 0) : 0,
          tds: savedDed ? (parseFloat(savedDed.tds) || 0) : 0,
          transportDed: savedDed ? (parseFloat(savedDed.transportDed) || 0) : 0,
        };
      });
      setAttendanceData(mergedData);
      setIsPayrollStarted(false);
    } catch (err) {
      console.error('fetchEmployees error:', err);
      setError('Failed to load employee data. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [allowed]);

  const fetchServerLocks = useCallback(async (month, year) => {
    if (!month || !year) return;
    const period = formatPeriod(month, year);
    if (!period) return;
    const myCategories = allowedCategories();
    try {
      const res = await axios.get(`${API_BASE_URL}/salaries/generated-categories`, { params: { period } });
      if (res.data?.success && Array.isArray(res.data.categories)) {
        const locked = {};
        res.data.categories.forEach(cat => {
          if (myCategories.includes(cat)) locked[cat] = true;
        });
        setServerLockedCategories(locked);
      }
    } catch {
      // Non-critical
    }
  }, []);

  useEffect(() => {
    if (selectedMonth && selectedYear) {
      fetchEmployees(selectedMonth, selectedYear);
      fetchServerLocks(selectedMonth, selectedYear);
    }
  }, [selectedMonth, selectedYear, fetchEmployees, fetchServerLocks]);

  const deductionSaveTimeout = useRef(null);

  const handleAllowanceUpdate = (empId, field, value) => {
    if (!isPayrollStarted) setIsPayrollStarted(true);
    setAttendanceData(prev => {
      const updated = prev.map(emp =>
        emp.id === empId || emp.empCode === empId
          ? { ...emp, [field]: typeof value === 'number' ? value : parseFloat(value) || 0 }
          : emp
      );
      if (deductionSaveTimeout.current) clearTimeout(deductionSaveTimeout.current);
      deductionSaveTimeout.current = setTimeout(() => {
        const changed = updated.filter(e => e.id === empId || e.empCode === empId);
        if (changed.length) saveDeductionsToDB(changed, selectedMonth, selectedYear);
      }, 600);
      return updated;
    });
  };

  const handleDeductionUpdate = (empId, field, value) => {
    if (!isPayrollStarted) setIsPayrollStarted(true);
    if (field === 'pf') return;
    setAttendanceData(prev => {
      const updated = prev.map(emp => emp.id === empId ? { ...emp, [field]: value } : emp);
      if (deductionSaveTimeout.current) clearTimeout(deductionSaveTimeout.current);
      deductionSaveTimeout.current = setTimeout(() => {
        const changed = updated.filter(e => e.id === empId);
        if (changed.length) saveDeductionsToDB(changed, selectedMonth, selectedYear);
      }, 600);
      return updated;
    });
  };

  const handleAttendanceUpdate = (newFilteredData) => {
    if (!isPayrollStarted) setIsPayrollStarted(true);
    setAttendanceData(prev => {
      const updatedMap = new Map(newFilteredData.map(emp => [emp.id, emp]));
      return prev.map(emp => updatedMap.has(emp.id) ? updatedMap.get(emp.id) : emp);
    });
  };

  const handleSalaryGenerated = () => {
    if (selectedMonth && selectedYear) {
      fetchEmployees(selectedMonth, selectedYear);
      fetchServerLocks(selectedMonth, selectedYear);
    }
  };

  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 7 }, (_, i) => currentYear - 3 + i);

  const categoryOptions = [
    ...(allowed.length > 1 ? [{ value: 'all', label: 'All Categories' }] : []),
    ...allowed.map(c => ({ value: c, label: c })),
  ];

  const handleMonthChange = (e) => {
    if (isPayrollStarted) { alert('Cannot change month after payroll has started. Click Reset to start over.'); return; }
    setSelectedMonth(e.target.value);
  };

  const handleYearChange = (e) => {
    if (isPayrollStarted) { alert('Cannot change year after payroll has started. Click Reset to start over.'); return; }
    setSelectedYear(parseInt(e.target.value));
  };

  const handleCategoryChange = (e) => {
    if (isPayrollStarted) { alert('Cannot change category after payroll has started. Click Reset to start over.'); return; }
    if (schoolRestricted) return;
    setSelectedCategory(e.target.value);
  };

  return (
    <section className="section payroll-section" id="payroll">
      <div className="section-header">
        <div className="header-content">
          <h2 style={{ fontWeight: 'bold', color: 'var(--primary-color)' }}>Payroll Management</h2>
          {schoolRestricted && (
            <div style={{ background: '#f3e8ff', border: '1px solid #d8b4fe', borderRadius: 8, padding: '8px 14px', marginTop: 8, fontSize: 13, color: '#6b21a8', display: 'flex', alignItems: 'center', gap: 8 }}>
              <i className="fas fa-lock" style={{ color: '#9333ea' }}></i>
              <span>You are processing payroll for <strong>Finance</strong> employees only.</span>
            </div>
          )}
          {plantRestricted && (
            <div style={{ background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 8, padding: '8px 14px', marginTop: 8, fontSize: 13, color: '#166534', display: 'flex', alignItems: 'center', gap: 8 }}>
              <i className="fas fa-filter" style={{ color: '#16a34a' }}></i>
              <span>You are processing payroll for <strong>Operations, Engineering, Apprentice</strong> employees.</span>
            </div>
          )}
          <div className="month-year-selector">
            <div className="form-group">
              <label htmlFor="month">Month:</label>
              <select id="month" value={selectedMonth} onChange={handleMonthChange} className="form-control" disabled={isPayrollStarted}>
                {months.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label htmlFor="year">Year:</label>
              <select id="year" value={selectedYear} onChange={handleYearChange} className="form-control" disabled={isPayrollStarted}>
                {years.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label htmlFor="category">Category:</label>
              <select
                id="category"
                value={schoolRestricted ? 'Finance' : selectedCategory}
                onChange={handleCategoryChange}
                className="form-control"
                disabled={isPayrollStarted || schoolRestricted || categoryOptions.length === 1}
              >
                {categoryOptions.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>
            <div className="current-period">
              <i className="fas fa-calendar-alt"></i>
              <span>Payroll for: <strong>{selectedMonth} {selectedYear}</strong></span>
            </div>
            {isPayrollStarted && (
              <button
                className="btn btn-secondary"
                style={{ marginLeft: 8 }}
                onClick={() => {
                  if (window.confirm('Reset payroll? This will reload employee data and clear unsaved changes.')) {
                    setIsPayrollStarted(false);
                    fetchEmployees(selectedMonth, selectedYear);
                    fetchServerLocks(selectedMonth, selectedYear);
                  }
                }}
              >
                <i className="fas fa-redo"></i> Reset
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="tabs-container">
        {['attendance', 'allowance', 'deduction', 'salary'].map(tab => (
          <button key={tab} className={`tab-btn ${activeTab === tab ? 'active' : ''}`} onClick={() => setActiveTab(tab)}>
            <i className={`fas fa-${tab === 'attendance' ? 'calendar-check' : tab === 'allowance' ? 'hand-holding-usd' : tab === 'deduction' ? 'file-invoice-dollar' : 'calculator'}`}></i>
            {' '}{tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      <div className="tab-content">
        {loading ? (
          <div className="loading-container"><div className="spinner"></div><p>Loading employee data...</p></div>
        ) : error ? (
          <div className="error-container">
            <div className="error-icon">⚠️</div><p>{error}</p>
            <button className="btn btn-primary" onClick={() => fetchEmployees(selectedMonth, selectedYear)}>Retry</button>
          </div>
        ) : (
          <>
            {activeTab === 'attendance' && (
              <AttendanceTab
                attendanceData={filteredAttendanceData}
                onAttendanceUpdate={handleAttendanceUpdate}
                selectedMonth={selectedMonth}
                selectedYear={selectedYear}
                lockedCategories={lockedCategories}
              />
            )}
            {activeTab === 'allowance' && (
              <AllowanceTab
                attendanceData={filteredAttendanceData}
                onAllowanceUpdate={handleAllowanceUpdate}
                lockedCategories={lockedCategories}
                selectedMonth={selectedMonth}
                selectedYear={selectedYear}
              />
            )}
            {activeTab === 'deduction' && (
              <DeductionTab
                attendanceData={filteredAttendanceData}
                onDeductionUpdate={handleDeductionUpdate}
                lockedCategories={lockedCategories}
                selectedMonth={selectedMonth}
                selectedYear={selectedYear}
              />
            )}
            {activeTab === 'salary' && (
              <>
                {status.show && (
                  <div style={{
                    marginBottom: '20px', padding: '10px 15px', borderRadius: '4px',
                    backgroundColor: status.type === 'success' ? '#d4edda' : status.type === 'info' ? '#d1ecf1' : status.type === 'warning' ? '#fff3cd' : '#f8d7da',
                    color: status.type === 'success' ? '#155724' : status.type === 'info' ? '#0c5460' : status.type === 'warning' ? '#856404' : '#721c24',
                    border: `1px solid ${status.type === 'success' ? '#c3e6cb' : status.type === 'info' ? '#bee5eb' : status.type === 'warning' ? '#ffeeba' : '#f5c6cb'}`,
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center'
                  }}>
                    <span>{status.message}</span>
                    <button onClick={() => setStatus(p => ({ ...p, show: false }))} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '16px', color: 'inherit', padding: '0 5px' }}>&times;</button>
                  </div>
                )}
                <SalaryTab
                  attendanceData={filteredAttendanceData}
                  selectedMonth={selectedMonth}
                  selectedYear={selectedYear}
                  status={status}
                  setStatus={setStatus}
                  isGenerating={isGenerating}
                  setIsGenerating={setIsGenerating}
                  onSalaryGenerated={handleSalaryGenerated}
                  lockedCategories={lockedCategories}
                />
              </>
            )}
          </>
        )}
      </div>
    </section>
  );
};

export default Payroll;