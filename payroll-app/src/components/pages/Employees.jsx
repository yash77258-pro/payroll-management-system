import React, { useState, useEffect, useMemo, useRef } from 'react';
import axios from 'axios';
import * as XLSX from 'xlsx';
import { useLocation } from 'react-router-dom';

// --- Salary History Helpers (localStorage) ---
const SALARY_FIELDS = ['gross', 'basic', 'cea', 'cha', 'hra', 'spa', 'uma'];
const SALARY_COMPONENTS = ['basic', 'cea', 'cha', 'hra', 'spa', 'uma'];

const BASE_URL = process.env.REACT_APP_API_BASE_URL || 'http://localhost:5000';

const getSalaryHistory = (empCode) => {
  try {
    const raw = localStorage.getItem(`salary_history_${empCode}`);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
};

// ── Role-based access helpers ────────────────────────────────────────────────
const getLoggedInUser = () => {
  try {
    const raw = localStorage.getItem('user');
    if (!raw) return { name: 'Unknown', role: 'admin', email: '' };
    const user = JSON.parse(raw);
    return {
      name: user.name || user.username || user.email || 'Unknown',
      role: user.role || 'admin',
      email: user.email || '',
    };
  } catch { return { name: 'Unknown', role: 'admin', email: '' }; }
};

const normalizeCategory = (raw) => {
  if (!raw || raw.trim() === '') return 'Operations';
  const val = raw.trim().toLowerCase();
  if (val === 'sks') return 'Engineering';
  if (val === 'apprentice') return 'Apprentice';
  if (val === 'opjsk') return 'Finance';
  return 'Operations';
};

const getLoggedInUserName = () => getLoggedInUser().name;
const getUserRole = () => getLoggedInUser().role;

const ROLE_CATEGORIES = {
  admin: ['Operations', 'Engineering', 'Apprentice', 'Finance'],
  plant: ['Operations', 'Engineering', 'Apprentice'],
  school: ['Finance'],
};

const allowedCategories = () => ROLE_CATEGORIES[getUserRole()] ?? ROLE_CATEGORIES.admin;
const isSchoolUser = () => getUserRole() === 'school';
const isPlantUser = () => getUserRole() === 'plant';

const saveSalaryHistory = (empCode, oldSalary, changedBy) => {
  try {
    const history = getSalaryHistory(empCode);
    history.unshift({ ...oldSalary, changedAt: new Date().toISOString(), changedBy });
    localStorage.setItem(`salary_history_${empCode}`, JSON.stringify(history));
  } catch (e) { console.error('Failed to save salary history', e); }
};

const fmt = (val) => val ? `₹${parseFloat(val).toFixed(2)}` : '₹0.00';

const validateEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
const validateIFSC = (v) => /^[A-Z]{4}0[A-Z0-9]{6}$/.test(v.toUpperCase());
const validatePAN = (v) => /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(v);
const validateAadhar = (v) => /^\d{12}$/.test(v);
const validatePhone = (v) => /^\d{10}$/.test(v);

const calcGross = (data) =>
  SALARY_COMPONENTS.reduce((sum, f) => sum + (parseFloat(data[f]) || 0), 0).toFixed(2);

// Converts any date value (ISO string, Date object, or yyyy-MM-dd) to "yyyy-MM-dd" or null
const toDateString = (val) => {
  if (!val) return null;
  if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(val)) return val;
  const d = new Date(val);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
};

const EMPTY_EMPLOYEE = {
  empCode: '', name: '', department: '', bankAccount: '', ifsc: '', pan: '',
  aadhar: '', branch: '', phone: '', email: '', designation: '', category: '',
  joiningDate: '', status: 'Active', lwd: null,
  gross: 0, basic: 0, cea: 0, cha: 0, hra: 0, spa: 0, uma: 0,
};

const ALL_CATEGORIES = ['Operations', 'Apprentice', 'Engineering', 'Finance'];

const DEFAULT_DESIGNATIONS = [
  'Apprentice Trainee', 'Assistant', 'Assistant Associate', 'Assistant Manager',
  'Associate', 'Diploma Trg.', 'Dy General Manager', 'Graduate Trainee',
  'Junior Executive', 'Junior Officer', 'Manager', 'Officer',
  'Senior Assistant', 'Technician Trainee', 'Technician Trg.',
];

const Employees = () => {
  const location = useLocation();

  const role = getUserRole();
  const allowed = allowedCategories();
  const schoolRestricted = isSchoolUser();
  const plantRestricted = isPlantUser();

  const [employeeType, setEmployeeType] = useState(schoolRestricted ? 'Finance' : 'ALL');
  const [searchTerm, setSearchTerm] = useState('');
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState(null);
  const [salaryHistory, setSalaryHistory] = useState([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);
  const [uploadStatus, setUploadStatus] = useState({ loading: false, message: '', error: '' });
  const [empCodeError, setEmpCodeError] = useState('');
  const fileInputRef = useRef(null);

  const [newEmployee, setNewEmployee] = useState({ ...EMPTY_EMPLOYEE });

  const [categories, setCategories] = useState([]);

  const [designations, setDesignations] = useState([]);
  const [showAddDesgForm, setShowAddDesgForm] = useState(false);
  const [newDesgName, setNewDesgName] = useState('');

  useEffect(() => {
    if (schoolRestricted) { setEmployeeType('Finance'); return; }
    const params = new URLSearchParams(location.search);
    const cat = params.get('category');
    if (cat && (cat === 'ALL' || allowed.includes(cat))) setEmployeeType(cat);
  }, [location.search, schoolRestricted]);

  useEffect(() => {
    const fetchEmployees = async () => {
      try {
        const response = await axios.get(`${BASE_URL}/api/employees`);
        let data = Array.isArray(response.data.data)
          ? response.data.data.map(emp => ({ ...emp, category: normalizeCategory(emp.category) }))
          : [];
        setEmployees(data);
        setLoading(false);
      } catch (err) {
        console.error(err);
        setError('Failed to fetch employees. Please try again later.');
        setLoading(false);
      }
    };
    fetchEmployees();
  }, [role]);

  // Categories are static — no API endpoint needed
  useEffect(() => {
    setCategories(ALL_CATEGORIES);
  }, []);

  // Designations are static — no API endpoint needed
  useEffect(() => {
    setDesignations(DEFAULT_DESIGNATIONS);
  }, []);

  const filteredEmployees = useMemo(() => {
    return employees.filter(emp => {
      const searchTermLower = searchTerm.toLowerCase();
      const category = normalizeCategory(emp.category);
      if (!allowed.includes(category)) return false;
      const matchesType = employeeType === 'ALL' || category === employeeType;
      const matchesSearch =
        (emp.name && emp.name.toLowerCase().includes(searchTermLower)) ||
        (emp.firstName && emp.firstName.toLowerCase().includes(searchTermLower)) ||
        (emp.lastName && emp.lastName.toLowerCase().includes(searchTermLower)) ||
        (emp.empCode && emp.empCode.toString().toLowerCase().includes(searchTermLower)) ||
        (emp.department && emp.department.toLowerCase().includes(searchTermLower)) ||
        (emp.designation && emp.designation.toLowerCase().includes(searchTermLower));
      return matchesType && (searchTerm === '' || matchesSearch);
    });
  }, [employeeType, searchTerm, employees, role]);

  const handleEmployeeTypeChange = (e) => { setEmployeeType(e.target.value); setCurrentPage(1); };
  const handleSearchChange = (e) => { setSearchTerm(e.target.value); setCurrentPage(1); };

  const checkEmpCodeUnique = async (empCode) => {
    if (!empCode || empCode.trim() === '') return;
    try {
      const response = await axios.get(`${BASE_URL}/api/employees`);
      const allEmployees = Array.isArray(response.data.data) ? response.data.data : [];
      const exists = allEmployees.some(
        emp => emp.empCode &&
          emp.empCode.toString().toLowerCase() === empCode.toString().trim().toLowerCase()
      );
      setEmpCodeError(exists
        ? `Employee code "${empCode}" is already taken. Please use a unique code.`
        : ''
      );
    } catch {
      setEmpCodeError('');
    }
  };

  const validatePayload = (emp) => {
    const required = [
      'empCode', 'name', 'department', 'bankAccount', 'ifsc', 'pan',
      'aadhar', 'branch', 'phone', 'email', 'designation', 'category', 'joiningDate',
    ];
    for (const f of required) {
      if (!emp[f] || emp[f].toString().trim() === '') {
        alert(`Field "${f}" is required.`);
        return false;
      }
    }
    if (!allowed.includes(emp.category)) {
      alert(`You do not have permission to add/edit employees in the "${emp.category}" category.`);
      return false;
    }
    if (!validateAadhar(emp.aadhar)) {
      alert('Aadhar number must be exactly 12 digits (numbers only).');
      return false;
    }
    if (!validatePhone(emp.phone)) {
      alert('Mobile number must be exactly 10 digits (numbers only).');
      return false;
    }
    if (!validatePAN(emp.pan.toUpperCase())) {
      alert('PAN number must be valid format: ABCDE1234F (5 letters, 4 digits, 1 letter).');
      return false;
    }
    if (!validateEmail(emp.email)) {
      alert('Please enter a valid email address (e.g. name@domain.com).');
      return false;
    }
    if (!validateIFSC(emp.ifsc)) {
      alert('IFSC code must be valid format: 4 letters, then 0, then 6 alphanumeric characters (e.g. SBIN0012142).');
      return false;
    }
    return true;
  };

  const refreshEmployees = async () => {
    const response = await axios.get(`${BASE_URL}/api/employees`);
    let data = Array.isArray(response.data.data) ? response.data.data : [];
    data = data.filter(emp => allowed.includes(emp.category));
    setEmployees(data);
  };

  const handleAddEmployee = async (e) => {
    e.preventDefault();
    if (empCodeError) { alert(empCodeError); return; }
    const payload = schoolRestricted
      ? { ...newEmployee, category: 'Finance' }
      : newEmployee;
    if (!validatePayload(payload)) return;

    try {
      const response = await axios.get(`${BASE_URL}/api/employees`);
      const allEmps = Array.isArray(response.data.data) ? response.data.data : [];
      const exists = allEmps.some(
        emp => emp.empCode &&
          emp.empCode.toString().toLowerCase() === newEmployee.empCode.toString().trim().toLowerCase()
      );
      if (exists) {
        setEmpCodeError(`Employee code "${newEmployee.empCode}" is already taken.`);
        alert(`Employee code "${newEmployee.empCode}" is already taken. Please use a unique code.`);
        return;
      }
    } catch { /* proceed if network check fails */ }

    try {
      await axios.post(`${BASE_URL}/api/employees`, {
        ...payload,
        pan: payload.pan.toUpperCase(),
      });
      setShowAddModal(false);
      setNewEmployee({ ...EMPTY_EMPLOYEE, category: schoolRestricted ? 'Finance' : '' });
      setEmpCodeError('');
      setShowAddDesgForm(false);
      await refreshEmployees();
      alert('Employee added successfully');
    } catch (err) {
      const serverMsg = err.response?.data?.message || '';
      if (serverMsg.toLowerCase().includes('duplicate') || serverMsg.toLowerCase().includes('unique')) {
        setEmpCodeError(`Employee code "${newEmployee.empCode}" is already taken.`);
        alert(`Employee code "${newEmployee.empCode}" is already taken. Please use a unique code.`);
      } else {
        alert('Failed to add employee. Please try again.');
      }
    }
  };

  const handleDeleteEmployee = async (id) => {
    if (window.confirm('Are you sure you want to delete this employee?')) {
      try {
        await axios.delete(`${BASE_URL}/api/employees/${id}`);
        await refreshEmployees();
        alert('Employee deleted successfully');
      } catch (err) {
        alert('Failed to delete employee. Please try again.');
      }
    }
  };

  const handleEditEmployee = (employee) => {
    if (!allowed.includes(employee.category)) return;
    // Normalize date fields to yyyy-MM-dd so date inputs render correctly
    setSelectedEmployee({
      ...employee,
      joiningDate: toDateString(employee.joiningDate) || '',
      lwd: toDateString(employee.lwd) || '',
    });
    setSalaryHistory(getSalaryHistory(employee.empCode));
    setShowEditModal(true);
  };

  const calculateProratedSalary = (employee) => {
    if (!employee.lwd || !employee.joiningDate) return null;
    const lwd = new Date(employee.lwd);
    const today = new Date();
    const refDate = lwd < today ? lwd : today;
    const year = refDate.getFullYear();
    const month = refDate.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const daysWorked = refDate.getDate();
    const ratio = daysWorked / daysInMonth;
    return {
      gross: ((parseFloat(employee.gross) || 0) * ratio).toFixed(2),
      basic: ((parseFloat(employee.basic) || 0) * ratio).toFixed(2),
    };
  };

  const handleUpdateEmployee = async (e) => {
    e.preventDefault();
    try {
      const payload = {
        ...selectedEmployee,
        joiningDate: toDateString(selectedEmployee.joiningDate),
        lwd: toDateString(selectedEmployee.lwd) || null,
      };

      // Auto-set Inactive if LWD has passed
      if (payload.lwd) {
        const lwd = new Date(payload.lwd);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        if (lwd < today) payload.status = 'Inactive';
      }

      const currentEmp = employees.find(emp => emp.empCode === selectedEmployee.empCode);
      if (currentEmp) {
        const oldSalary = {};
        SALARY_FIELDS.forEach(f => { oldSalary[f] = currentEmp[f] || 0; });
        const salaryChanged = SALARY_FIELDS.some(
          f => String(currentEmp[f] || 0) !== String(selectedEmployee[f] || 0)
        );
        if (salaryChanged) {
          saveSalaryHistory(selectedEmployee.empCode, oldSalary, getLoggedInUserName());
          setSalaryHistory(getSalaryHistory(selectedEmployee.empCode));
        }
      }
      await axios.put(`${BASE_URL}/api/employees/${selectedEmployee.empCode}`, payload);
      setShowEditModal(false);
      await refreshEmployees();
      alert('Employee updated successfully');
    } catch (err) {
      alert('Failed to update employee. Please try again.');
    }
  };

  // ── Auto-calculate gross in Edit modal ──────────────────────────────────────
  const handleEditChange = (e) => {
    const { name, value } = e.target;
    setSelectedEmployee(prev => {
      const updated = { ...prev, [name]: value };
      if (SALARY_COMPONENTS.includes(name)) {
        updated.gross = calcGross(updated);
      }
      return updated;
    });
  };

  // ── Auto-calculate gross in Add modal ───────────────────────────────────────
  const handleNewEmployeeChange = (e) => {
    const { name, value } = e.target;
    if (name === 'category' && schoolRestricted) return;
    if (name === 'aadhar' || name === 'phone') {
      if (value !== '' && !/^\d*$/.test(value)) return;
    }
    if (['basic', 'cea', 'cha', 'hra', 'spa', 'uma'].includes(name)) {
      if (parseFloat(value) < 0) return;
    }
    if (name === 'empCode') setEmpCodeError('');
    if (name === 'ifsc') {
      setNewEmployee(prev => ({ ...prev, ifsc: value.toUpperCase() }));
      return;
    }
    setNewEmployee(prev => {
      const updated = { ...prev, [name]: value };
      if (SALARY_COMPONENTS.includes(name)) {
        updated.gross = calcGross(updated);
      }
      return updated;
    });
  };

  const handleEmpCodeBlur = () => {
    if (newEmployee.empCode && newEmployee.empCode.trim() !== '') {
      checkEmpCodeUnique(newEmployee.empCode.trim());
    }
  };

  const handleAddDesignation = () => {
    const name = newDesgName.trim();
    if (!name) return;
    if (designations.includes(name)) {
      setNewEmployee(prev => ({ ...prev, designation: name }));
      setNewDesgName('');
      setShowAddDesgForm(false);
      return;
    }
    setDesignations(prev => [...prev, name].sort());
    setNewEmployee(prev => ({ ...prev, designation: name }));
    setNewDesgName('');
    setShowAddDesgForm(false);
  };

  const allDesignations = useMemo(() => {
    return [...new Set([...DEFAULT_DESIGNATIONS, ...designations])].sort();
  }, [designations]);

  const downloadTemplate = () => {
    const wb = XLSX.utils.book_new();
    const headers = [
      'Emp Code', 'Name', 'Department', 'Bank Acc. No.', 'IFSC', 'PAN', 'Aadhar',
      'Bank Name', 'Phone', 'Email', 'Designation', 'Category', 'Joining Date',
      'Status', 'Gross', 'Basic', 'CEA', 'CHA', 'HRA', 'SPA', 'UMA',
    ];
    const ws = XLSX.utils.aoa_to_sheet([headers, [], Array(headers.length).fill('')]);
    XLSX.utils.book_append_sheet(wb, ws, 'Employees');
    XLSX.writeFile(wb, 'Employee_Bulk_Upload_Template.xlsx');
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setUploadStatus({ loading: true, message: '', error: '' });
    try {
      const data = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (ev) => {
          try {
            const raw = new Uint8Array(ev.target.result);
            const wb = XLSX.read(raw, { type: 'array' });
            const ws = wb.Sheets[wb.SheetNames[0]];
            resolve(XLSX.utils.sheet_to_json(ws));
          } catch (error) { reject(error); }
        };
        reader.onerror = reject;
        reader.readAsArrayBuffer(file);
      });

      const processedData = data.map((emp, index) => {
        try {
          const ed = {};
          ed.empCode = emp['Emp Code'] || emp.empCode || emp['Employee Code'];
          if (!ed.empCode) throw new Error(`Row ${index + 2}: Employee Code is required`);
          const name = emp.Name || emp.name || '';
          const [firstName, ...rest] = name.split(' ');
          ed.firstName = firstName;
          ed.lastName = rest.join(' ') || ' ';
          ed.name = name;
          const fieldsToCheck = [
            { field: 'department', sources: ['Department', 'department'] },
            { field: 'bankAccount', sources: ['Bank Acc. No.', 'bankAccount', 'accountNumber'] },
            { field: 'ifsc', sources: ['IFSC', 'ifsc'] },
            { field: 'pan', sources: ['PAN', 'pan'] },
            { field: 'aadhar', sources: ['Aadhar', 'aadhar'] },
            { field: 'branch', sources: ['Bank Name', 'branch', 'bankName'] },
            { field: 'phone', sources: ['Phone', 'phone', 'mobile'] },
            { field: 'email', sources: ['Email', 'email'] },
            { field: 'designation', sources: ['Designation', 'designation'] },
            { field: 'category', sources: ['Category', 'category'] },
            { field: 'joiningDate', sources: ['Joining Date', 'joiningDate'] },
            { field: 'status', sources: ['Status', 'status'] },
            { field: 'gross', sources: ['Gross', 'gross'] },
            { field: 'basic', sources: ['Basic', 'basic'] },
            { field: 'cea', sources: ['CEA', 'cea'] },
            { field: 'cha', sources: ['CHA', 'cha'] },
            { field: 'hra', sources: ['HRA', 'hra'] },
            { field: 'spa', sources: ['SPA', 'spa'] },
            { field: 'uma', sources: ['UMA', 'uma'] },
          ];
          fieldsToCheck.forEach(({ field, sources }) => {
            for (const src of sources) {
              if (emp[src] !== undefined && emp[src] !== '' && emp[src] !== null) { ed[field] = emp[src]; break; }
            }
          });
          return ed;
        } catch (error) { return { error: error.message, row: index + 2 }; }
      }).filter(emp => {
        if (emp.error) {
          setUploadStatus(prev => ({
            loading: false, message: '',
            error: `${prev.error ? prev.error + '\n' : ''}${emp.error}`,
          }));
          return false;
        }
        if (!allowed.includes(emp.category)) return false;
        return true;
      });

      const existing = await axios.get(`${BASE_URL}/api/employees`);
      const existingCodes = new Set(existing.data.map(e => e.empCode.toString()));
      let successCount = 0, errorCount = 0;
      const errors = [];

      for (const emp of processedData) {
        try {
          if (existingCodes.has(emp.empCode.toString())) {
            const updateData = {};
            Object.keys(emp).forEach(k => {
              if (k !== 'empCode' && emp[k] !== undefined && emp[k] !== '') updateData[k] = emp[k];
            });
            delete updateData.firstName; delete updateData.lastName;
            if (Object.keys(updateData).length > 0)
              await axios.put(`${BASE_URL}/api/employees/${emp.empCode}`, updateData);
          } else {
            await axios.post(`${BASE_URL}/api/employees`, {
              ...emp, status: emp.status || 'Active',
              gross: emp.gross || 0, basic: emp.basic || 0,
              cea: emp.cea || 0, cha: emp.cha || 0,
              hra: emp.hra || 0, spa: emp.spa || 0, uma: emp.uma || 0,
            });
            existingCodes.add(emp.empCode.toString());
          }
          successCount++;
        } catch (error) {
          errors.push(`Employee ${emp.empCode || 'unknown'}: ${error.response?.data?.message || error.message}`);
          errorCount++;
        }
      }

      await refreshEmployees();
      setUploadStatus({
        loading: false,
        message: `Successfully processed ${successCount} employees.${errorCount > 0 ? ` ${errorCount} failed.` : ''}`,
        error: errors.length > 0 ? errors.join('\n') : '',
      });
      setTimeout(() => setUploadStatus(prev => ({ ...prev, message: '' })), 5000);
    } catch (error) {
      setUploadStatus({
        loading: false, message: '',
        error: error.response?.data?.message || error.message || 'Error processing file.',
      });
    }
  };

  const indexOfLastItem = currentPage * itemsPerPage;
  const indexOfFirstItem = indexOfLastItem - itemsPerPage;
  const currentItems = filteredEmployees.slice(indexOfFirstItem, indexOfLastItem);
  const totalPages = Math.ceil(filteredEmployees.length / itemsPerPage);

  const handleItemsPerPageChange = (e) => { setItemsPerPage(Number(e.target.value)); setCurrentPage(1); };
  const paginate = (n) => setCurrentPage(n);
  const nextPage = () => { if (currentPage < totalPages) setCurrentPage(currentPage + 1); };
  const prevPage = () => { if (currentPage > 1) setCurrentPage(currentPage - 1); };

  const getDisplayName = (emp) => {
    if (emp.firstName || emp.lastName) return `${emp.firstName || ''} ${emp.lastName || ''}`.trim();
    return emp.name || '-';
  };

  if (loading) return <div className="loading">Loading employees...</div>;
  if (error) return <div className="error">{error}</div>;

  const filterCategories = [
    ...(allowed.length > 1 ? [{ value: 'ALL', label: 'ALL' }] : []),
    ...allowed.map(c => ({ value: c, label: c })),
  ];
  const addableCategories = ALL_CATEGORIES.filter(c => allowed.includes(c));

  const inlineFormStyle = {
    marginTop: '8px', background: '#f8fafc',
    border: '1px solid #e2e8f0', borderRadius: '6px', padding: '10px',
  };
  const inlineLabelStyle = { fontSize: '11px', color: '#64748b', marginBottom: '6px' };
  const inlineRowStyle = { display: 'flex', gap: '6px' };
  const inlineInputStyle = {
    flex: 1, padding: '5px 8px', border: '1px solid #cbd5e1',
    borderRadius: '4px', fontSize: '12px',
  };
  const inlineSaveBtnStyle = {
    background: '#1e3a5f', color: '#fff', border: 'none',
    borderRadius: '4px', padding: '5px 10px', fontSize: '12px', cursor: 'pointer',
  };
  const inlineCancelBtnStyle = {
    background: 'none', border: '1px solid #cbd5e1', borderRadius: '4px',
    padding: '5px 8px', fontSize: '12px', cursor: 'pointer', color: '#64748b',
  };
  const addLinkStyle = {
    background: 'none', border: 'none', color: '#185FA5', fontSize: '15px',
    fontWeight: '500', cursor: 'pointer', marginTop: '4px', padding: 0,
    display: 'flex', alignItems: 'center', gap: '4px',
  };

  // Salary field config — gross is read-only (auto-calculated)
  const salaryFields = [
    { label: 'Gross Salary', name: 'gross', readOnly: true },
    { label: 'Basic', name: 'basic' },
    { label: 'CEA', name: 'cea' },
    { label: 'CHA', name: 'cha' },
    { label: 'HRA', name: 'hra' },
    { label: 'SPA', name: 'spa' },
    { label: 'UMA', name: 'uma' },
  ];

  return (
    <section className="section" id="employees">

      {schoolRestricted && (
        <div style={{
          background: '#f3e8ff', border: '1px solid #d8b4fe', borderRadius: 8,
          padding: '8px 14px', marginBottom: 12, fontSize: 13, color: '#6b21a8',
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <i className="fas fa-lock" style={{ color: '#9333ea' }}></i>
          <span>You are viewing <strong>Finance</strong> employees only. Access to other categories is restricted.</span>
        </div>
      )}
      {plantRestricted && (
        <div style={{
          background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 8,
          padding: '8px 14px', marginBottom: 12, fontSize: 13, color: '#166534',
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <i className="fas fa-filter" style={{ color: '#16a34a' }}></i>
          <span>You are viewing <strong>Operations, Engineering, Apprentice</strong> employees.</span>
        </div>
      )}

      <div className="section-header">
        <h2>Employee Management</h2>
        <div className="employee-actions" style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <button className="btn-primary" onClick={() => {
            setNewEmployee({ ...EMPTY_EMPLOYEE, category: schoolRestricted ? 'Finance' : '' });
            setEmpCodeError('');
            setShowAddDesgForm(false);
            setShowAddModal(true);
          }}>
            <i className="fas fa-plus"></i> Add Employee
          </button>
          <div style={{ display: 'flex', gap: '10px' }}>
            <div style={{ position: 'relative' }}>
              <button
                className="btn-primary"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadStatus.loading}
                style={uploadStatus.loading ? { opacity: 0.7, cursor: 'not-allowed' } : {}}
              >
                {uploadStatus.loading
                  ? <><i className="fas fa-spinner fa-spin"></i> Uploading...</>
                  : <><i className="fas fa-file-upload"></i> Update from File</>}
              </button>
            </div>
            <button
              className="btn-primary"
              onClick={downloadTemplate}
              title="Download Excel template for bulk upload"
              style={{ backgroundColor: '#4CAF50' }}
            >
              <i className="fas fa-file-excel"></i> Download Template
            </button>
            <input type="file" ref={fileInputRef} onChange={handleFileUpload} accept=".xlsx,.xls,.csv" style={{ display: 'none' }} />
            {uploadStatus.message && (
              <div style={{
                position: 'absolute', top: '100%', left: 0, marginTop: '5px',
                padding: '5px 10px', backgroundColor: '#4CAF50', color: 'white',
                borderRadius: '4px', fontSize: '12px', whiteSpace: 'nowrap', zIndex: 10,
              }}>
                {uploadStatus.message}
              </div>
            )}
            {uploadStatus.error && (
              <div style={{
                position: 'absolute', top: '100%', left: 0, marginTop: '5px',
                padding: '5px 10px', backgroundColor: '#f44336', color: 'white',
                borderRadius: '4px', fontSize: '12px', whiteSpace: 'nowrap', zIndex: 10,
              }}>
                {uploadStatus.error}
              </div>
            )}
          </div>

          <div className="search-box">
            <input type="text" placeholder="Search employees..." value={searchTerm} onChange={handleSearchChange} className="search-input" />
            <i className="fas fa-search search-icon"></i>
          </div>

          <div className="employee-filter">
            <label htmlFor="employee-type" className="filter-label">Filter by Type:</label>
            <select
              id="employee-type"
              value={employeeType}
              onChange={handleEmployeeTypeChange}
              className="filter-select"
              disabled={schoolRestricted}
            >
              {filterCategories.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </div>
        </div>
      </div>

      {employeeType !== 'ALL' && !schoolRestricted && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          background: '#eff6ff', border: '1px solid #bfdbfe',
          borderRadius: 8, padding: '8px 14px', marginBottom: 12, fontSize: 13, color: '#1e40af',
        }}>
          <span>Showing employees filtered by category: <strong>{employeeType}</strong></span>
          <button
            onClick={() => { setEmployeeType('ALL'); setCurrentPage(1); }}
            style={{
              marginLeft: 'auto', background: 'none', border: '1px solid #93c5fd',
              borderRadius: 6, padding: '2px 10px', fontSize: 12, color: '#1e40af', cursor: 'pointer',
            }}
          >
            Clear filter
          </button>
        </div>
      )}

      <div className="employee-table-container">
        <div className="table-responsive" style={{ overflowX: 'auto', overflowY: 'auto', maxHeight: '500px' }}>
          <table className="employee-table">
            <thead>
              <tr>
                <th>Emp Code</th><th>Name</th><th>Department</th><th>Bank Acc. No.</th>
                <th>IFSC</th><th>PAN</th><th>Aadhar</th><th>Bank Name</th><th>Phone</th>
                <th>Email</th><th>Designation</th><th>Category</th><th>Gross</th><th>Basic</th>
                <th>CEA</th><th>CHA</th><th>HRA</th><th>SPA</th><th>UMA</th>
                <th>Joining Date</th><th>LWD</th><th>Status</th><th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {currentItems.length > 0 ? (
                currentItems.map(emp => (
                  <tr key={emp.empCode} className={emp.status?.toLowerCase()}>
                    <td>
                      <span
                        onClick={() => handleEditEmployee(emp)}
                        style={{ color: '#1e3a5f', fontWeight: '600', cursor: 'pointer', textDecoration: 'underline' }}
                        title="Click to edit"
                      >
                        {emp.empCode}
                      </span>
                    </td>
                    <td>{getDisplayName(emp)}</td>
                    <td>{emp.department || '-'}</td>
                    <td>{emp.bankAccount || '-'}</td>
                    <td>{emp.ifsc || '-'}</td>
                    <td>{emp.pan || '-'}</td>
                    <td>{emp.aadhar || '-'}</td>
                    <td>{emp.branch || '-'}</td>
                    <td>{emp.phone || '-'}</td>
                    <td>{emp.email || '-'}</td>
                    <td>{emp.designation || '-'}</td>
                    <td>{emp.category || '-'}</td>
                    <td>{emp.gross ? `₹${parseFloat(emp.gross).toFixed(2)}` : '-'}</td>
                    <td>{emp.basic ? `₹${parseFloat(emp.basic).toFixed(2)}` : '-'}</td>
                    <td>{emp.cea ? `₹${parseFloat(emp.cea).toFixed(2)}` : '-'}</td>
                    <td>{emp.cha ? `₹${parseFloat(emp.cha).toFixed(2)}` : '-'}</td>
                    <td>{emp.hra ? `₹${parseFloat(emp.hra).toFixed(2)}` : '-'}</td>
                    <td>{emp.spa ? `₹${parseFloat(emp.spa).toFixed(2)}` : '-'}</td>
                    <td>{emp.uma ? `₹${parseFloat(emp.uma).toFixed(2)}` : '-'}</td>
                    <td>{emp.joiningDate || '-'}</td>
                    <td>{emp.lwd || '-'}</td>
                    <td>
                      <span className={`status-badge ${emp.status === 'Active' ? 'active' : 'inactive'}`}>
                        {emp.status || 'Inactive'}
                      </span>
                    </td>
                    <td className="actions">
                      <button
                        className="btn-icon"
                        title="Edit"
                        onClick={() => handleEditEmployee(emp)}
                        style={{
                          backgroundColor: '#1e3a5f', color: 'white', border: 'none',
                          borderRadius: '4px', padding: '5px 10px', cursor: 'pointer',
                          fontSize: '12px', display: 'inline-flex', alignItems: 'center', gap: '4px',
                        }}
                      >
                        <i className="fas fa-edit"></i> Edit
                      </button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr><td colSpan="23" className="no-data">No employees found matching your criteria.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="table-footer">
          <div className="table-info">
            <div className="items-per-page">
              <label>Show </label>
              <select value={itemsPerPage} onChange={handleItemsPerPageChange} className="items-per-page-select">
                {[5, 10, 20, 50, 100].map(n => <option key={n} value={n}>{n}</option>)}
              </select>
              <span> entries</span>
            </div>
            <div className="showing-entries">
              Showing {indexOfFirstItem + 1} to {Math.min(indexOfLastItem, filteredEmployees.length)} of {filteredEmployees.length} employees (Total: {employees.length})
            </div>
          </div>
          <div className="pagination">
            <button onClick={prevPage} disabled={currentPage === 1} className="pagination-btn">&laquo;</button>
            {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
              if (i === 0 || i === totalPages - 1 || (i >= currentPage - 2 && i <= currentPage + 2)) {
                return (
                  <button key={i} onClick={() => paginate(i + 1)} className={`pagination-btn ${currentPage === i + 1 ? 'active' : ''}`}>
                    {i + 1}
                  </button>
                );
              }
              if (i === 1 && currentPage > 3) return <span key={i} className="pagination-ellipsis">...</span>;
              if (i === totalPages - 2 && currentPage < totalPages - 2) return <span key={i} className="pagination-ellipsis">...</span>;
              return null;
            })}
            <button onClick={nextPage} disabled={currentPage === totalPages} className="pagination-btn">&raquo;</button>
          </div>
        </div>
      </div>

      {/* ── Add Employee Modal ─────────────────────────────────────────────────── */}
      {showAddModal && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <h3>Add New Employee</h3>
              <button className="close-btn" onClick={() => {
                setShowAddModal(false);
                setEmpCodeError('');
                setShowAddDesgForm(false);
              }}>&times;</button>
            </div>
            <form onSubmit={handleAddEmployee} className="modal-form">
              <div className="form-grid">
                <div className="form-column">
                  <div className="form-group">
                    <label>Employee Code *</label>
                    <input
                      type="text"
                      name="empCode"
                      value={newEmployee.empCode}
                      onChange={handleNewEmployeeChange}
                      onBlur={handleEmpCodeBlur}
                      required
                      style={empCodeError ? { borderColor: '#ef4444', backgroundColor: '#fef2f2' } : {}}
                    />
                    {empCodeError && (
                      <div style={{
                        color: '#dc2626', fontSize: '11px', marginTop: '4px',
                        display: 'flex', alignItems: 'center', gap: '4px',
                        background: '#fef2f2', border: '1px solid #fecaca',
                        borderRadius: '4px', padding: '4px 8px',
                      }}>
                        <i className="fas fa-exclamation-circle"></i>
                        {empCodeError}
                      </div>
                    )}
                  </div>

                  <div className="form-group">
                    <label>Full Name *</label>
                    <input type="text" name="name" value={newEmployee.name} onChange={handleNewEmployeeChange} placeholder="First Last" required />
                  </div>

                  <div className="form-group">
                    <label>Department *</label>
                    <input type="text" name="department" value={newEmployee.department} onChange={handleNewEmployeeChange} required />
                  </div>

                  <div className="form-group">
                    <label>Designation *</label>
                    <select name="designation" value={newEmployee.designation} onChange={handleNewEmployeeChange} required>
                      <option value="">-- Select Designation --</option>
                      {allDesignations.map(d => <option key={d} value={d}>{d}</option>)}
                    </select>
                    <button
                      type="button"
                      onClick={() => { setShowAddDesgForm(v => !v); setNewDesgName(''); }}
                      style={addLinkStyle}
                    >
                      + New designation
                    </button>
                    {showAddDesgForm && (
                      <div style={inlineFormStyle}>
                        <div style={inlineLabelStyle}>New designation name</div>
                        <div style={inlineRowStyle}>
                          <input
                            type="text"
                            value={newDesgName}
                            onChange={e => setNewDesgName(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && handleAddDesignation()}
                            placeholder="e.g. Senior Manager, Trainee…"
                            style={inlineInputStyle}
                          />
                          <button
                            type="button"
                            onClick={handleAddDesignation}
                            disabled={!newDesgName.trim()}
                            style={inlineSaveBtnStyle}
                          >
                            Save & select
                          </button>
                          <button
                            type="button"
                            onClick={() => { setShowAddDesgForm(false); setNewDesgName(''); }}
                            style={inlineCancelBtnStyle}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <div className="form-column">
                  <div className="form-group">
                    <label>Email *</label>
                    <input type="email" name="email" value={newEmployee.email} onChange={handleNewEmployeeChange} required />
                  </div>

                  <div className="form-group">
                    <label>Phone (10 digits) *</label>
                    <input type="tel" name="phone" value={newEmployee.phone} onChange={handleNewEmployeeChange} maxLength={10} pattern="\d{10}" title="Enter exactly 10 digit mobile number" required />
                  </div>

                  <div className="form-group">
                    <label>Category *</label>
                    <select
                      name="category"
                      value={schoolRestricted ? 'Finance' : newEmployee.category}
                      onChange={handleNewEmployeeChange}
                      disabled={schoolRestricted || addableCategories.length === 1}
                      required
                    >
                      <option value="">-- Select Category --</option>
                      {[...new Set([...addableCategories, ...categories])].map(c => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                  </div>

                  <div className="form-group">
                    <label>Status *</label>
                    <select name="status" value={newEmployee.status} onChange={handleNewEmployeeChange}>
                      <option value="Active">Active</option>
                      <option value="Inactive">Inactive</option>
                    </select>
                  </div>
                </div>

                <div className="form-column">
                  <div className="form-group">
                    <label>Bank Account Number *</label>
                    <input type="text" name="bankAccount" value={newEmployee.bankAccount} onChange={handleNewEmployeeChange} required />
                  </div>
                  <div className="form-group">
                    <label>IFSC Code *</label>
                    <input type="text" name="ifsc" value={newEmployee.ifsc} onChange={handleNewEmployeeChange} required />
                  </div>
                  <div className="form-group">
                    <label>Bank Branch *</label>
                    <input type="text" name="branch" value={newEmployee.branch} onChange={handleNewEmployeeChange} required />
                  </div>
                </div>

                <div className="form-column">
                  <div className="form-group">
                    <label>PAN Number (e.g. ABCDE1234F) *</label>
                    <input type="text" name="pan" value={newEmployee.pan} onChange={handleNewEmployeeChange} maxLength={10} title="PAN format: ABCDE1234F" style={{ textTransform: 'uppercase' }} required />
                  </div>
                  <div className="form-group">
                    <label>Aadhar Number (12 digits) *</label>
                    <input type="text" name="aadhar" value={newEmployee.aadhar} onChange={handleNewEmployeeChange} maxLength={12} pattern="\d{12}" title="Enter exactly 12 digit Aadhar number" required />
                  </div>
                  <div className="form-group">
                    <label>Joining Date *</label>
                    <input type="date" name="joiningDate" value={newEmployee.joiningDate} onChange={handleNewEmployeeChange} required />
                  </div>
                </div>
              </div>

              {/* Salary Row — Gross is auto-calculated */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '8px', width: '100%', marginTop: '16px' }}>
                {salaryFields.map(({ label, name, readOnly }) => (
                  <div className="form-group" key={name}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      {label}
                      {readOnly && (
                        <span style={{
                          fontSize: '9px', background: '#dbeafe', color: '#1d4ed8',
                          borderRadius: 3, padding: '1px 4px', fontWeight: 600, letterSpacing: '0.03em',
                        }}>AUTO</span>
                      )}
                    </label>
                    <input
                      type="number"
                      name={name}
                      value={newEmployee[name]}
                      onChange={handleNewEmployeeChange}
                      readOnly={readOnly}
                      placeholder={label}
                      style={{
                        width: '100%',
                        ...(readOnly ? {
                          backgroundColor: '#f1f5f9', fontWeight: 700,
                          color: '#1e3a5f', cursor: 'not-allowed', border: '1px solid #cbd5e1',
                        } : {}),
                      }}
                      min="0"
                      onKeyDown={e => (e.key === '-' || (readOnly && e.preventDefault()))}
                    />
                  </div>
                ))}
              </div>

              <div className="form-actions">
                <button type="button" className="btn-secondary" onClick={() => {
                  setShowAddModal(false);
                  setEmpCodeError('');
                  setShowAddDesgForm(false);
                }}>Cancel</button>
                <button type="submit" className="btn-primary" disabled={!!empCodeError}>Save Employee</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Edit Employee Modal ────────────────────────────────────────────────── */}
      {showEditModal && selectedEmployee && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <h3>Edit Employee</h3>
              <button className="close-btn" onClick={() => setShowEditModal(false)}>&times;</button>
            </div>
            <form onSubmit={handleUpdateEmployee} className="modal-form">
              <div className="form-grid">
                <div className="form-column">
                  <div className="form-group">
                    <label>Employee Code</label>
                    <input type="text" value={selectedEmployee.empCode || ''} readOnly />
                  </div>
                  <div className="form-group">
                    <label>Full Name</label>
                    <input type="text" value={getDisplayName(selectedEmployee)} readOnly />
                  </div>
                  <div className="form-group">
                    <label>Department</label>
                    <input type="text" value={selectedEmployee.department || ''} readOnly />
                  </div>
                  <div className="form-group">
                    <label>Designation</label>
                    <input type="text" value={selectedEmployee.designation || ''} readOnly />
                  </div>
                </div>

                <div className="form-column">
                  <div className="form-group">
                    <label>Email</label>
                    <input type="email" value={selectedEmployee.email || ''} readOnly />
                  </div>
                  <div className="form-group">
                    <label>Phone</label>
                    <input type="tel" value={selectedEmployee.phone || ''} readOnly />
                  </div>
                  <div className="form-group">
                    <label>Category</label>
                    <input type="text" value={selectedEmployee.category || ''} readOnly />
                  </div>
                  <div className="form-group">
                    <label>Status</label>
                    <select name="status" value={selectedEmployee.status || 'Active'} onChange={handleEditChange}>
                      <option value="Active">Active</option>
                      <option value="Inactive">Inactive</option>
                    </select>
                  </div>
                </div>

                <div className="form-column">
                  <div className="form-group">
                    <label>Bank Account Number</label>
                    <input type="text" value={selectedEmployee.bankAccount || ''} readOnly />
                  </div>
                  <div className="form-group">
                    <label>IFSC Code</label>
                    <input type="text" value={selectedEmployee.ifsc || ''} readOnly />
                  </div>
                  <div className="form-group">
                    <label>Bank Branch</label>
                    <input type="text" value={selectedEmployee.branch || ''} readOnly />
                  </div>
                </div>

                <div className="form-column">
                  <div className="form-group">
                    <label>PAN Number</label>
                    <input type="text" value={selectedEmployee.pan || ''} readOnly />
                  </div>
                  <div className="form-group">
                    <label>Aadhar Number</label>
                    <input type="text" value={selectedEmployee.aadhar || ''} readOnly />
                  </div>
                  <div className="form-group">
                    <label>Joining Date</label>
                    <input type="date" value={selectedEmployee.joiningDate || ''} readOnly />
                  </div>
                  <div className="form-group">
                    <label>Last Working Day (LWD)</label>
                    <input
                      type="date"
                      name="lwd"
                      value={selectedEmployee.lwd || ''}
                      onChange={handleEditChange}
                      style={{ width: '100%' }}
                    />
                    {selectedEmployee.lwd && (
                      <div style={{ fontSize: '11px', color: '#d97706', marginTop: 4 }}>
                        ⚠ Employee will be marked Inactive after this date.
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Editable Salary Row — Gross is auto-calculated */}
              <div style={{ marginTop: '16px' }}>
                <div style={{ fontSize: '13px', fontWeight: '600', color: '#374151', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Current Salary
                  {selectedEmployee.lwd && (() => {
                    const prorated = calculateProratedSalary(selectedEmployee);
                    return prorated ? (
                      <span style={{ fontSize: '11px', fontWeight: 400, color: '#d97706', marginLeft: 10, textTransform: 'none' }}>
                        ⚠ Prorated — Gross: ₹{prorated.gross}, Basic: ₹{prorated.basic} (based on LWD)
                      </span>
                    ) : null;
                  })()}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '8px', width: '100%' }}>
                  {salaryFields.map(({ label, name, readOnly }) => (
                    <div className="form-group" key={name}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        {label}
                        {readOnly && (
                          <span style={{
                            fontSize: '9px', background: '#dbeafe', color: '#1d4ed8',
                            borderRadius: 3, padding: '1px 4px', fontWeight: 600, letterSpacing: '0.03em',
                          }}>AUTO</span>
                        )}
                      </label>
                      <input
                        type="number"
                        name={name}
                        value={selectedEmployee[name] || 0}
                        onChange={handleEditChange}
                        readOnly={readOnly}
                        style={{
                          width: '100%',
                          ...(readOnly ? {
                            backgroundColor: '#f1f5f9', fontWeight: 700,
                            color: '#1e3a5f', cursor: 'not-allowed', border: '1px solid #cbd5e1',
                          } : {}),
                        }}
                        min="0"
                        onKeyDown={e => (e.key === '-' || (readOnly && e.preventDefault()))}
                      />
                    </div>
                  ))}
                </div>
              </div>

              {/* Salary History Log */}
              {salaryHistory.length > 0 && (
                <div style={{ marginTop: '20px' }}>
                  <div style={{ fontSize: '13px', fontWeight: '600', color: '#374151', marginBottom: '10px', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <i className="fas fa-history" style={{ color: '#6366f1' }}></i>
                    Salary Change History
                  </div>
                  <div style={{ maxHeight: '220px', overflowY: 'auto', border: '1px solid #e5e7eb', borderRadius: '8px' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                      <thead>
                        <tr style={{ backgroundColor: '#f3f4f6', position: 'sticky', top: 0 }}>
                          {['Changed On', 'Changed By', 'Gross', 'Basic', 'CEA', 'CHA', 'HRA', 'SPA', 'UMA'].map((h, i) => (
                            <th key={h} style={{ padding: '8px 12px', textAlign: i > 1 ? 'right' : 'left', fontWeight: '600', color: '#6b7280', borderBottom: '1px solid #e5e7eb' }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {salaryHistory.map((entry, idx) => (
                          <tr key={idx} style={{ backgroundColor: idx % 2 === 0 ? '#ffffff' : '#f9fafb' }}>
                            <td style={{ padding: '8px 12px', color: '#374151', borderBottom: '1px solid #f3f4f6', whiteSpace: 'nowrap' }}>
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                                <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#6366f1', display: 'inline-block', flexShrink: 0 }}></span>
                                {new Date(entry.changedAt).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true })}
                              </span>
                            </td>
                            <td style={{ padding: '8px 12px', color: '#374151', borderBottom: '1px solid #f3f4f6', whiteSpace: 'nowrap' }}>
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                                <i className="fas fa-user-circle" style={{ color: '#6366f1', fontSize: '13px' }}></i>
                                {entry.changedBy || 'Unknown'}
                              </span>
                            </td>
                            {['gross', 'basic', 'cea', 'cha', 'hra', 'spa', 'uma'].map(f => (
                              <td key={f} style={{ padding: '8px 12px', textAlign: 'right', color: '#374151', borderBottom: '1px solid #f3f4f6' }}>
                                {fmt(entry[f])}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div style={{ fontSize: '11px', color: '#9ca3af', marginTop: '4px' }}>
                    Showing previous salary values before each update. Most recent change is at the top.
                  </div>
                </div>
              )}

              <div className="form-actions">
                <button type="button" className="btn-secondary" onClick={() => setShowEditModal(false)}>Cancel</button>
                <button type="submit" className="btn-primary">Update Employee</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
};

export default Employees;