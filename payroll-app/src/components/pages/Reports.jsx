import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

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

const getUserRole = () => getLoggedInUser().role;

const ROLE_CATEGORIES = {
  admin: ['H&F', 'SKS', 'Apprentice', 'OPJSK'],
  plant: ['H&F', 'SKS', 'Apprentice'],
  school: ['OPJSK'],
};

const allowedCategories = () => ROLE_CATEGORIES[getUserRole()] ?? ROLE_CATEGORIES.admin;
const isSchoolUser = () => getUserRole() === 'school';
const isPlantUser = () => getUserRole() === 'plant';

const MONTH_LIST = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december'
];

const formatPeriod = (month, year) => {
  const idx = MONTH_LIST.indexOf((month || '').toLowerCase());
  if (idx === -1) return '';
  return `${String(idx + 1).padStart(2, '0')}${String(year).slice(-2)}`;
};

const Reports = () => {
  const allowed = allowedCategories();
  const schoolRestricted = isSchoolUser();
  const plantRestricted = isPlantUser();

  const [selectedMonth, setSelectedMonth] = useState('');
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear().toString());
  const [selectedCategory, setSelectedCategory] = useState(schoolRestricted ? 'OPJSK' : 'all');
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [reportData, setReportData] = useState(null);
  const [selectedEmployee, setSelectedEmployee] = useState(null);

  // Modal states
  const [showDetailsModal, setShowDetailsModal] = useState(false);  // view details
  const [showPayslipModal, setShowPayslipModal] = useState(false);  // payslip preview
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const logoImgRef = useRef(null);
  const logoDataUrlRef = useRef(null);
  const [logoReady, setLogoReady] = useState(false);

  useEffect(() => {
    // No logo image available; mark as ready immediately so report/payslip
    // generation isn't blocked. logoDataUrlRef stays null, and the logo
    // <img> and PDF logo drawing are already guarded against that.
    logoImgRef.current = null;
    logoDataUrlRef.current = null;
    setLogoReady(true);
    return () => { logoImgRef.current = null; logoDataUrlRef.current = null; };
  }, []);

  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];
  const currentYear = new Date().getFullYear();
  const yearOptions = Array.from({ length: 11 }, (_, i) => (currentYear + 5 - i).toString());

  const categoryOptions = [
    ...(allowed.length > 1 ? [{ value: 'all', label: 'All Categories' }] : []),
    ...allowed.map(c => ({ value: c, label: c })),
  ];

  const API_BASE_URL = process.env.REACT_APP_API_BASE_URL || 'http://localhost:5000';

  useEffect(() => {
    const fetchSalaries = async () => {
      if (!selectedMonth || !selectedYear) return;

      const period = formatPeriod(selectedMonth, selectedYear);
      if (!period) { setError('Invalid month selected'); return; }

      const effectiveCategory = schoolRestricted
        ? 'OPJSK'
        : (selectedCategory === 'all' ? '' : selectedCategory);

      try {
        setLoading(true);
        setError('');
        console.log('[Reports] fetching period:', period, '| category:', effectiveCategory || 'ALL');

        const response = await axios.get(`${API_BASE_URL}/api/salaries/period/${period}`, {
          params: effectiveCategory ? { category: effectiveCategory } : {},
        });

        if (response.data && response.data.data && response.data.data.length > 0) {
          const filtered = response.data.data.filter(emp => allowed.includes(emp.category));
          setReportData({ ...response.data, data: filtered });
          setEmployees(filtered);
        } else {
          const catDisplay = schoolRestricted ? 'OPJSK' : (selectedCategory === 'all' ? 'selected categories' : selectedCategory);
          setError(`No salary data found for ${catDisplay} in ${selectedMonth} ${selectedYear}. Please generate salary first in Payroll section.`);
          setReportData(null);
          setEmployees([]);
        }
      } catch (err) {
        console.error('[Reports] API error:', err.response?.status, err.message);
        if (err.response?.status === 404) {
          const catDisplay = schoolRestricted ? 'OPJSK' : (selectedCategory === 'all' ? 'selected categories' : selectedCategory);
          setError(`No salary data found for ${catDisplay} in ${selectedMonth} ${selectedYear}. Please generate salary first in Payroll section.`);
        } else {
          setError('Failed to load salary data. Please try again later.');
        }
        setEmployees([]);
        setReportData(null);
      } finally {
        setLoading(false);
      }
    };
    fetchSalaries();
  }, [selectedMonth, selectedYear, selectedCategory]);

  const handleMonthChange = (e) => { setError(''); setSelectedMonth(e.target.value); };
  const handleYearChange = (e) => { setError(''); setSelectedYear(e.target.value); };
  const handleCategoryChange = (e) => {
    if (schoolRestricted) return;
    setError('');
    setSelectedCategory(e.target.value);
  };

  const formatCurrency = (amount, includeSymbol = true) => {
    const num = typeof amount === 'string'
      ? parseFloat(amount.replace(/[^0-9.-]+/g, ''))
      : amount;
    return new Intl.NumberFormat('en-IN', {
      style: includeSymbol ? 'currency' : 'decimal',
      currency: 'INR',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(num || 0);
  };

  const calculateTotalAllowance = (emp) =>
    (emp.CEA || 0) + (emp.CHA || 0) + (emp.HRA || 0) +
    (emp.OTHALLOW || 0) + (emp.SPA || 0) + (emp.UMA || 0);

  // ── Open details modal ──────────────────────────────────────────────────────
  const handleViewDetails = (employee) => {
    setSelectedEmployee(employee);
    setShowDetailsModal(true);
  };

  // ── Open payslip PREVIEW modal (no immediate download) ─────────────────────
  const handlePreviewPayslip = (employee) => {
    setSelectedEmployee(employee);
    setShowPayslipModal(true);
  };

  // ── Build PDF doc and return it (shared by preview & download) ─────────────
  const buildPayslipDoc = (employee) => {
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 15;
    let yPos = margin;

    const logoWidth = 30;
    let logoHeight = 0;
    try {
      const logoSource = logoDataUrlRef.current || logoImgRef.current;
      if (logoSource) {
        let aspectRatio = 1;
        if (logoImgRef.current?.naturalWidth && logoImgRef.current?.naturalHeight) {
          aspectRatio = logoImgRef.current.naturalHeight / logoImgRef.current.naturalWidth;
        }
        logoHeight = logoWidth * aspectRatio;
        doc.addImage(logoSource, 'PNG', margin, yPos, logoWidth, logoHeight);
      }
    } catch (err) { console.warn('Logo add failed:', err); logoHeight = 0; }

    const categoryHeading = `Payslip for ${selectedMonth} ${selectedYear}`;
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    const headingWidth = doc.getTextWidth(categoryHeading);
    doc.text(categoryHeading, (pageWidth - headingWidth) / 2, yPos + (logoHeight ? 12 : 8));

    if (employee.category) {
      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      const catText = employee.category.toUpperCase();
      doc.text(catText, pageWidth - margin - doc.getTextWidth(catText), yPos + (logoHeight ? 12 : 8));
    }

    yPos += (logoHeight || 0) + 8;
    doc.setDrawColor(200, 200, 200);
    doc.line(margin, yPos, pageWidth - margin, yPos);

    yPos += 10;
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text('Employee Information', margin, yPos);
    yPos += 8;
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    const col1X = margin, col2X = pageWidth / 2, lineH = 6;
    doc.text(`Name: ${employee.name || 'N/A'}`, col1X, yPos);
    doc.text(`Employee Code: ${employee.emp_code || 'N/A'}`, col2X, yPos); yPos += lineH;
    doc.text(`Department: ${employee.department || 'N/A'}`, col1X, yPos);
    doc.text(`Category: ${employee.category || 'N/A'}`, col2X, yPos); yPos += lineH;
    doc.text(`Bank Account: ${employee.bank_account || 'N/A'}`, col1X, yPos); yPos += lineH;
    doc.text('Pay Mode: Bank Transfer', col1X, yPos);
    doc.text(`Paid Days: ${employee.attendance || 'N/A'}`, col2X, yPos); yPos += 12;

    const earningsData = [
      ['Basic Salary', formatCurrency(employee.basic_salary, false)],
      ['Children Education Allowance (CEA)', formatCurrency(employee.CEA, false)],
      ['City House Allowance (CHA)', formatCurrency(employee.CHA, false)],
      ['House Rent Allowance (HRA)', formatCurrency(employee.HRA, false)],
      ['Other Allowance', formatCurrency(employee.OTHALLOW, false)],
      ['Special Allowance (SPA)', formatCurrency(employee.SPA, false)],
      ['Uniform Allowance (UMA)', formatCurrency(employee.UMA, false)],
    ].filter(item => parseFloat(item[1].replace(/,/g, '')) !== 0);

    const deductionsData = [
      ['Club', formatCurrency(employee.CLUB, false)],
      ['Cutie Club Deduction', formatCurrency(employee.CUTIE_CLUB_DED, false)],
      ['Dish', formatCurrency(employee.DISH, false)],
      ['Electricity', formatCurrency(employee.ELECTRICITY, false)],
      ['Employee Cooperative Salary', formatCurrency(employee.EMP_COP_SALARY, false)],
      ['ESIC', formatCurrency(employee.ESIC, false)],
      ['Fuel Deduction', formatCurrency(employee.FUELDED, false)],
      ['JPOC Salon', formatCurrency(employee.JPOCSALON, false)],
      ['Medical Recovery', formatCurrency(employee.MEDICAL_RECOVERY, false)],
      ['Milk Deduction', formatCurrency(employee.MILKDED, false)],
      ['Other Deduction', formatCurrency(employee.OTHERDED1, false)],
      ['Provident Fund (PF)', formatCurrency(employee.PF, false)],
      ['School Fee', formatCurrency(employee.SCHOOLFEE, false)],
      ['TDS', formatCurrency(employee.TDS, false)],
      ['Transport Deduction', formatCurrency(employee.TRANSPORT_DED, false)],
      ['Welfare Fund (WF)', formatCurrency(employee.WF, false)],
    ].filter(item => parseFloat(item[1].replace(/,/g, '')) !== 0);

    autoTable(doc, {
      startY: yPos,
      head: [['Earnings', 'Amount (Rs.)']],
      body: earningsData,
      foot: [['Total Earnings', formatCurrency(employee.total_allowance, false)]],
      margin: { left: margin, right: pageWidth / 2 + 5 },
      theme: 'grid',
      headStyles: { fontStyle: 'bold', fontSize: 10 },
      footStyles: { fontStyle: 'bold', fontSize: 10 },
      styles: { fontSize: 9 },
      columnStyles: { 0: { cellWidth: 'auto' }, 1: { cellWidth: 35, halign: 'right' } },
    });

    autoTable(doc, {
      startY: yPos,
      head: [['Deductions', 'Amount (Rs.)']],
      body: deductionsData,
      foot: [['Total Deductions', formatCurrency(employee.total_deduction, false)]],
      margin: { left: pageWidth / 2 + 5, right: margin },
      theme: 'grid',
      headStyles: { fontStyle: 'bold', fontSize: 10 },
      footStyles: { fontStyle: 'bold', fontSize: 10 },
      styles: { fontSize: 9 },
      columnStyles: { 0: { cellWidth: 'auto' }, 1: { cellWidth: 35, halign: 'right' } },
    });

    const finalY = (doc.lastAutoTable?.finalY || yPos + 60) + 15;
    doc.setFillColor(240, 240, 240);
    doc.rect(margin, finalY, pageWidth - 2 * margin, 15, 'F');
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(0, 0, 0);
    doc.text('Net Payable:', margin + 5, finalY + 10);
    const netPayText = `Rs. ${formatCurrency(employee.net_salary, false)}`;
    doc.text(netPayText, pageWidth - margin - doc.getTextWidth(netPayText) - 5, finalY + 10);

    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.setDrawColor(200, 200, 200);
    doc.line(margin, finalY + 30, pageWidth - margin, finalY + 30);
    doc.setFontSize(8);
    doc.setTextColor(100, 100, 100);
    doc.text('This is a computer-generated payslip and does not require a signature.', margin, pageHeight - 15);

    return doc;
  };

  // ── Trigger actual download from preview modal ──────────────────────────────
  const handleDownloadFromPreview = () => {
    if (!logoReady) { alert('Logo is still loading. Please try again.'); return; }
    if (!selectedEmployee) return;
    const doc = buildPayslipDoc(selectedEmployee);
    const sanitizedName = (selectedEmployee.name || 'Employee').replace(/[^a-zA-Z0-9]/g, '_');
    const sanitizedCategory = (selectedEmployee.category || 'Category').replace(/[^a-zA-Z0-9]/g, '_');
    const periodDisplay = `${selectedYear}-${String(months.indexOf(selectedMonth) + 1).padStart(2, '0')}`;
    doc.save(`Payslip_${sanitizedName}_${sanitizedCategory}_${periodDisplay}.pdf`);
  };

  const closeDetailsModal = () => { setShowDetailsModal(false); setSelectedEmployee(null); };
  const closePayslipModal = () => { setShowPayslipModal(false); setSelectedEmployee(null); };

  const handleDeleteData = async () => {
    if (!selectedMonth || !selectedYear) return;
    try {
      setDeleteLoading(true);
      const period = formatPeriod(selectedMonth, selectedYear);
      if (!period) { alert('Invalid period'); return; }

      const effectiveCategory = schoolRestricted ? 'OPJSK' : selectedCategory;
      const deleteUrl = effectiveCategory === 'all'
        ? `${API_BASE_URL}/api/salaries/period/${period}`
        : `${API_BASE_URL}/api/salaries/period/${period}?category=${effectiveCategory}`;

      const response = await axios.delete(deleteUrl);
      if (response.data?.success) {
        setEmployees([]);
        setReportData(null);
        setShowDeleteModal(false);
        const catDisplay = schoolRestricted ? 'OPJSK' : (effectiveCategory === 'all' ? 'all categories' : effectiveCategory);
        alert(`Successfully deleted salary data for ${catDisplay} of ${selectedMonth} ${selectedYear}`);
        window.location.reload();
      } else {
        alert('Delete request did not return success.');
      }
    } catch (err) {
      if (err.response?.status === 404) {
        alert('No salary data found to delete for the selected period and category.');
      } else {
        alert('Failed to delete salary data. Please try again.');
      }
    } finally {
      setDeleteLoading(false);
    }
  };

  const handleExportReport = () => {
    if (!selectedMonth || employees.length === 0) return;
    const headers = [
      'Employee Code', 'Name', 'Department', 'Category', 'Rate', 'Attendance',
      'Basic Salary', 'CEA', 'CHA', 'HRA', 'OTHALLOW', 'SPA', 'UMA',
      'Total Allowance', 'CLUB', 'CUTIE CLUB DED', 'DISH', 'ELECTRICITY', 'EMP COP SALARY',
      'ESIC', 'FUEL DED', 'JPOC SALON', 'MEDICAL RECOVERY', 'MILK DED', 'OTHER DED 1',
      'PF', 'SCHOOL FEE', 'TDS', 'TRANSPORT DED', 'WF', 'Total Deduction', 'Net Salary',
      'Month', 'Year', 'Period', 'Created At', 'Updated At',
    ];
    const rows = employees.map(emp => [
      `"${emp.emp_code || ''}"`, `"${emp.name || ''}"`, `"${emp.department || ''}"`,
      `"${emp.category || ''}"`, `"${emp.rate || 0}"`, `"${emp.attendance || 0}"`,
      `"${formatCurrency(emp.basic_salary || 0, false)}"`,
      `"${formatCurrency(emp.CEA || 0, false)}"`, `"${formatCurrency(emp.CHA || 0, false)}"`,
      `"${formatCurrency(emp.HRA || 0, false)}"`, `"${formatCurrency(emp.OTHALLOW || 0, false)}"`,
      `"${formatCurrency(emp.SPA || 0, false)}"`, `"${formatCurrency(emp.UMA || 0, false)}"`,
      `"${formatCurrency(emp.total_allowance || 0, false)}"`,
      `"${formatCurrency(emp.CLUB || 0, false)}"`, `"${formatCurrency(emp.CUTIE_CLUB_DED || 0, false)}"`,
      `"${formatCurrency(emp.DISH || 0, false)}"`, `"${formatCurrency(emp.ELECTRICITY || 0, false)}"`,
      `"${formatCurrency(emp.EMP_COP_SALARY || 0, false)}"`, `"${formatCurrency(emp.ESIC || 0, false)}"`,
      `"${formatCurrency(emp.FUELDED || 0, false)}"`, `"${formatCurrency(emp.JPOCSALON || 0, false)}"`,
      `"${formatCurrency(emp.MEDICAL_RECOVERY || 0, false)}"`, `"${formatCurrency(emp.MILKDED || 0, false)}"`,
      `"${formatCurrency(emp.OTHERDED1 || 0, false)}"`, `"${formatCurrency(emp.PF || 0, false)}"`,
      `"${formatCurrency(emp.SCHOOLFEE || 0, false)}"`, `"${formatCurrency(emp.TDS || 0, false)}"`,
      `"${formatCurrency(emp.TRANSPORT_DED || 0, false)}"`, `"${formatCurrency(emp.WF || 0, false)}"`,
      `"${formatCurrency(emp.total_deduction || 0, false)}"`, `"${formatCurrency(emp.net_salary || 0, false)}"`,
      `"${emp.month || ''}"`, `"${emp.year || ''}"`, `"${emp.period || ''}"`,
      `"${emp.created_at || ''}"`, `"${emp.updated_at || ''}"`,
    ].join(','));

    const csvContent = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const periodDisplay = formatPeriod(selectedMonth, selectedYear);
    const categorySuffix = selectedCategory !== 'all' ? `_${selectedCategory.toLowerCase()}` : '';
    link.download = `salary_report_${periodDisplay}${categorySuffix}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const effectiveCategoryLabel = schoolRestricted
    ? 'OPJSK'
    : (selectedCategory === 'all' ? 'All Categories' : selectedCategory);

  // ── Payslip preview: build inline HTML from employee data ───────────────────
  const renderPayslipPreview = (emp) => {
    if (!emp) return null;
    const earningsRows = [
      ['Basic Salary', emp.basic_salary],
      ['Children Education Allowance (CEA)', emp.CEA],
      ['City House Allowance (CHA)', emp.CHA],
      ['House Rent Allowance (HRA)', emp.HRA],
      ['Other Allowance', emp.OTHALLOW],
      ['Special Allowance (SPA)', emp.SPA],
      ['Uniform Allowance (UMA)', emp.UMA],
    ].filter(([, v]) => parseFloat(v) !== 0);

    const deductionRows = [
      ['Club', emp.CLUB],
      ['Cutie Club Deduction', emp.CUTIE_CLUB_DED],
      ['Dish', emp.DISH],
      ['Electricity', emp.ELECTRICITY],
      ['Employee Cooperative Salary', emp.EMP_COP_SALARY],
      ['ESIC', emp.ESIC],
      ['Fuel Deduction', emp.FUELDED],
      ['JPOC Salon', emp.JPOCSALON],
      ['Medical Recovery', emp.MEDICAL_RECOVERY],
      ['Milk Deduction', emp.MILKDED],
      ['Other Deduction', emp.OTHERDED1],
      ['Provident Fund (PF)', emp.PF],
      ['School Fee', emp.SCHOOLFEE],
      ['TDS', emp.TDS],
      ['Transport Deduction', emp.TRANSPORT_DED],
      ['Welfare Fund (WF)', emp.WF],
    ].filter(([, v]) => parseFloat(v) !== 0);

    return (
      <div className="payslip-preview">
        {/* Header */}
        <div className="ps-header">
          <div className="ps-logo-area">
            {logoDataUrlRef.current && (
              <img src={logoDataUrlRef.current} alt="Logo" className="ps-logo" />
            )}
          </div>
          <div className="ps-title-area">
            <h2 className="ps-title">PAYSLIP</h2>
            <p className="ps-period">{selectedMonth} {selectedYear}</p>
          </div>
          <div className="ps-badge-area">
            <div className="ps-category-badge">{emp.category}</div>
          </div>
        </div>
        <div className="ps-divider" />

        {/* Employee Info */}
        <div className="ps-info-grid">
          <div className="ps-info-item"><span className="ps-info-label">Name</span><span className="ps-info-value">{emp.name || 'N/A'}</span></div>
          <div className="ps-info-item"><span className="ps-info-label">Employee Code</span><span className="ps-info-value">{emp.emp_code || 'N/A'}</span></div>
          <div className="ps-info-item"><span className="ps-info-label">Department</span><span className="ps-info-value">{emp.department || 'N/A'}</span></div>
          <div className="ps-info-item"><span className="ps-info-label">Category</span><span className="ps-info-value">{emp.category || 'N/A'}</span></div>
          <div className="ps-info-item"><span className="ps-info-label">Bank Account</span><span className="ps-info-value">{emp.bank_account || 'N/A'}</span></div>
          <div className="ps-info-item"><span className="ps-info-label">Pay Mode</span><span className="ps-info-value">Bank Transfer</span></div>
          <div className="ps-info-item"><span className="ps-info-label">Paid Days</span><span className="ps-info-value">{emp.attendance || 'N/A'}</span></div>
          <div className="ps-info-item"><span className="ps-info-label">Daily Rate</span><span className="ps-info-value">{formatCurrency(emp.rate)}</span></div>
        </div>

        {/* Earnings & Deductions side by side */}
        <div className="ps-tables-row">
          <div className="ps-table-wrap">
            <table className="ps-table">
              <thead><tr><th colSpan="2" className="ps-th-head earnings-head">Earnings</th></tr><tr><th>Description</th><th className="text-right">Amount (₹)</th></tr></thead>
              <tbody>
                {earningsRows.map(([label, val]) => (
                  <tr key={label}><td>{label}</td><td className="text-right">{formatCurrency(val, false)}</td></tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="ps-total-row"><td>Total Earnings</td><td className="text-right">{formatCurrency(emp.total_allowance, false)}</td></tr>
              </tfoot>
            </table>
          </div>

          <div className="ps-table-wrap">
            <table className="ps-table">
              <thead><tr><th colSpan="2" className="ps-th-head deductions-head">Deductions</th></tr><tr><th>Description</th><th className="text-right">Amount (₹)</th></tr></thead>
              <tbody>
                {deductionRows.map(([label, val]) => (
                  <tr key={label}><td>{label}</td><td className="text-right">{formatCurrency(val, false)}</td></tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="ps-total-row"><td>Total Deductions</td><td className="text-right">{formatCurrency(emp.total_deduction, false)}</td></tr>
              </tfoot>
            </table>
          </div>
        </div>

        {/* Net Pay */}
        <div className="ps-net-pay">
          <span className="ps-net-label">Net Payable</span>
          <span className="ps-net-amount">₹ {formatCurrency(emp.net_salary, false)}</span>
        </div>

        {/* Footer */}
        <div className="ps-footer">
          This is a computer-generated payslip and does not require a signature.
        </div>
      </div>
    );
  };

  return (
    <section className="section" id="reports">
      <div className="section-header">
        <h2>Payroll Reports</h2>

        {schoolRestricted && (
          <div style={{ background: '#f3e8ff', border: '1px solid #d8b4fe', borderRadius: 8, padding: '8px 14px', margin: '8px 0', fontSize: 13, color: '#6b21a8', display: 'flex', alignItems: 'center', gap: 8 }}>
            <i className="fas fa-lock" style={{ color: '#9333ea' }}></i>
            <span>You are viewing reports for <strong>OPJSK</strong> employees only. Access to other categories is restricted.</span>
          </div>
        )}
        {plantRestricted && (
          <div style={{ background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 8, padding: '8px 14px', margin: '8px 0', fontSize: 13, color: '#166534', display: 'flex', alignItems: 'center', gap: 8 }}>
            <i className="fas fa-filter" style={{ color: '#16a34a' }}></i>
            <span>You are viewing reports for <strong>H&amp;F, SKS, Apprentice</strong> employees.</span>
          </div>
        )}

        <div className="report-actions" style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
          <div style={{ flex: '1', minWidth: '150px', marginRight: '10px' }}>
            <div className="form-group">
              <label htmlFor="month-select">Month:</label>
              <select id="month-select" className="form-control" value={selectedMonth} onChange={handleMonthChange} style={{ width: '100%' }} disabled={loading}>
                <option value="">-- Select Month --</option>
                {months.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
          </div>
          <div style={{ flex: '1', minWidth: '120px', marginRight: '10px' }}>
            <div className="form-group">
              <label htmlFor="year-select">Year:</label>
              <select id="year-select" className="form-control" value={selectedYear} onChange={handleYearChange} style={{ width: '100%' }} disabled={loading}>
                {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
          </div>
          <div style={{ flex: '1', minWidth: '250px' }}>
            <div className="form-group">
              <label htmlFor="category-select">Select Category:</label>
              <select id="category-select" className="form-control" value={schoolRestricted ? 'OPJSK' : selectedCategory} onChange={handleCategoryChange}
                disabled={!selectedMonth || !selectedYear || loading || schoolRestricted || categoryOptions.length === 1}
                style={{ width: '100%' }} title={schoolRestricted ? 'OPJSK access only' : ''}>
                {categoryOptions.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>
          </div>

          <div style={{ flexBasis: '100%', marginTop: '10px', display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
            {selectedMonth && selectedYear && employees.length > 0 && (
              <>
                <button className="btn btn-primary" onClick={handleExportReport} disabled={loading}>
                  {loading ? <span><i className="fas fa-spinner fa-spin"></i> Loading...</span> : <span><i className="fas fa-download"></i> Export Report</span>}
                </button>
                {getUserRole() === 'admin' && (
                  <button className="btn btn-danger" onClick={() => setShowDeleteModal(true)} disabled={loading}
                    style={{ backgroundColor: '#dc3545', borderColor: '#dc3545', color: 'white' }}>
                    <span><i className="fas fa-trash"></i> Delete Data</span>
                  </button>
                )}
              </>
            )}
            {error && <div className="alert alert-danger" style={{ marginTop: '10px', marginBottom: 0 }}>{error}</div>}
          </div>
        </div>
      </div>

      {selectedMonth && (
        <div className="report-container">
          <div className="report-header">
            <h3>Payroll Report — {selectedMonth} {selectedYear} ({effectiveCategoryLabel})</h3>
            {loading ? (
              <div className="text-center py-4">
                <div className="spinner-border text-primary" role="status"></div>
                <p className="mt-2">Loading salary data...</p>
              </div>
            ) : error ? (
              <div className="alert alert-danger">{error}</div>
            ) : employees.length === 0 ? (
              <div className="alert alert-info">No salary data found for the selected period and category. Please generate salary first in Payroll section.</div>
            ) : (
              <div className="report-summary">
                <span className="summary-label">Total Employees: {employees.length}</span>
              </div>
            )}
          </div>

          {!loading && employees.length > 0 && (
            <div className="table-responsive">
              <table className="employee-table">
                <thead>
                  <tr>
                    <th>Emp Code</th><th>Name</th><th>Bank Account</th>
                    <th>Department</th><th>Category</th>
                    <th>Basic Salary</th><th>Allowances</th><th>Deductions</th>
                    <th>Net Pay</th><th>Status</th><th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {employees.map(employee => (
                    <tr key={employee.emp_code}>
                      <td>{employee.emp_code || 'N/A'}</td>
                      <td>{employee.name || 'N/A'}</td>
                      <td>{employee.bank_account || 'N/A'}</td>
                      <td>{employee.department || 'N/A'}</td>
                      <td>{employee.category || 'N/A'}</td>
                      <td>{formatCurrency(employee.basic_salary)}</td>
                      <td>{formatCurrency(employee.total_allowance)}</td>
                      <td>{formatCurrency(employee.total_deduction)}</td>
                      <td>{formatCurrency(employee.net_salary)}</td>
                      <td>
                        <span className={`status-badge ${(employee.status || 'paid').toLowerCase()}`}>
                          {employee.status || 'Paid'}
                        </span>
                      </td>
                      <td className="action-buttons">
                        <button className="btn-action btn-action-view" onClick={(e) => { e.stopPropagation(); handleViewDetails(employee); }} title="View Salary Details">
                          👁 View
                        </button>
                        <button className="btn-action btn-action-payslip" onClick={(e) => { e.stopPropagation(); handlePreviewPayslip(employee); }} title="Preview Payslip">
                          📄 Payslip
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Delete Modal ── */}
      {showDeleteModal && (
        <div className="modal-overlay" onClick={() => !deleteLoading && setShowDeleteModal(false)}>
          <div className="modal-content delete-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Confirm Delete</h3>
              <button className="close-btn" onClick={() => setShowDeleteModal(false)} disabled={deleteLoading}>&times;</button>
            </div>
            <div className="modal-body">
              <div className="delete-warning">
                <i className="fas fa-exclamation-triangle" style={{ fontSize: '3rem', color: '#dc3545', marginBottom: '15px' }}></i>
                <p style={{ fontSize: '1.1rem', marginBottom: '10px' }}>Are you sure you want to delete the salary data?</p>
                <p style={{ fontWeight: 'bold', color: '#dc3545' }}>
                  {schoolRestricted
                    ? `This will delete OPJSK salary data for ${selectedMonth} ${selectedYear}`
                    : selectedCategory === 'all'
                      ? `This will delete ALL salary data for ${selectedMonth} ${selectedYear}`
                      : `This will delete salary data for ${selectedCategory} category of ${selectedMonth} ${selectedYear}`}
                </p>
                <p style={{ fontSize: '0.9rem', color: '#6c757d', marginTop: '10px' }}>This action cannot be undone.</p>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowDeleteModal(false)} disabled={deleteLoading}>Cancel</button>
              <button className="btn btn-danger" onClick={handleDeleteData} disabled={deleteLoading} style={{ backgroundColor: '#dc3545', borderColor: '#dc3545', color: 'white' }}>
                {deleteLoading ? <span><i className="fas fa-spinner fa-spin"></i> Deleting...</span> : <span><i className="fas fa-trash"></i> Delete</span>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Details Modal ── */}
      {showDetailsModal && selectedEmployee && (
        <div className="modal-overlay" onClick={closeDetailsModal}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Employee Salary Details</h3>
              <button className="close-btn" onClick={closeDetailsModal}>&times;</button>
            </div>
            <div className="modal-body">
              <div className="employee-details-grid">
                {[['Employee Code', selectedEmployee.emp_code], ['Name', selectedEmployee.name], ['Department', selectedEmployee.department],
                ['Category', selectedEmployee.category], ['Rate', selectedEmployee.rate], ['Attendance', selectedEmployee.attendance],
                ].map(([label, val]) => (
                  <div className="detail-item" key={label}>
                    <span className="detail-label">{label}:</span>
                    <span className="detail-value">{val || 'N/A'}</span>
                  </div>
                ))}
                <div className="section-header">Earnings</div>
                {[['Basic Salary', selectedEmployee.basic_salary], ['CEA', selectedEmployee.CEA], ['CHA', selectedEmployee.CHA],
                ['HRA', selectedEmployee.HRA], ['OTHALLOW', selectedEmployee.OTHALLOW], ['SPA', selectedEmployee.SPA], ['UMA', selectedEmployee.UMA],
                ].map(([label, val]) => (
                  <div className="detail-item" key={label}><span className="detail-label">{label}:</span><span className="detail-value">{formatCurrency(val)}</span></div>
                ))}
                <div className="detail-item total"><span className="detail-label">Total Allowance:</span><span className="detail-value">{formatCurrency(selectedEmployee.total_allowance)}</span></div>
                <div className="section-header">Deductions</div>
                {[['CLUB', selectedEmployee.CLUB], ['CUTIE CLUB DED', selectedEmployee.CUTIE_CLUB_DED], ['DISH', selectedEmployee.DISH],
                ['ELECTRICITY', selectedEmployee.ELECTRICITY], ['EMP COP SALARY', selectedEmployee.EMP_COP_SALARY], ['ESIC', selectedEmployee.ESIC],
                ['FUEL DED', selectedEmployee.FUELDED], ['JPOC SALON', selectedEmployee.JPOCSALON], ['MEDICAL RECOVERY', selectedEmployee.MEDICAL_RECOVERY],
                ['MILK DED', selectedEmployee.MILKDED], ['OTHER DED 1', selectedEmployee.OTHERDED1], ['OTHER DED 2', selectedEmployee.OTHERDED2],
                ['PF', selectedEmployee.PF], ['SCHOOL FEE', selectedEmployee.SCHOOLFEE], ['TDS', selectedEmployee.TDS],
                ['TRANSPORT DED', selectedEmployee.TRANSPORT_DED], ['WF', selectedEmployee.WF],
                ].map(([label, val]) => (
                  <div className="detail-item" key={label}><span className="detail-label">{label}:</span><span className="detail-value">{formatCurrency(val)}</span></div>
                ))}
                <div className="detail-item total"><span className="detail-label">Total Deductions:</span><span className="detail-value">{formatCurrency(selectedEmployee.total_deduction)}</span></div>
                <div className="section-header">Summary</div>
                <div className="detail-item grand-total"><span className="detail-label">Net Salary:</span><span className="detail-value">{formatCurrency(selectedEmployee.net_salary)}</span></div>
                <div className="detail-item"><span className="detail-label">Period:</span><span className="detail-value">{selectedEmployee.period || 'N/A'}</span></div>
                <div className="detail-item"><span className="detail-label">Month/Year:</span><span className="detail-value">{selectedEmployee.month || 'N/A'} {selectedEmployee.year || ''}</span></div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={closeDetailsModal}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Payslip Preview Modal ── */}
      {showPayslipModal && selectedEmployee && (
        <div className="modal-overlay" onClick={closePayslipModal}>
          <div className="modal-content payslip-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3><i className="fas fa-file-alt" style={{ marginRight: 8, color: '#1a56db' }}></i>Payslip Preview</h3>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <button className="btn btn-primary btn-download-payslip" onClick={handleDownloadFromPreview} title="Download PDF">
                  <i className="fas fa-download"></i> Download PDF
                </button>
                <button className="close-btn" onClick={closePayslipModal}>&times;</button>
              </div>
            </div>
            <div className="modal-body payslip-modal-body">
              {renderPayslipPreview(selectedEmployee)}
            </div>
          </div>
        </div>
      )}

      <style jsx="true">{`
        /* ── Action button styles ── */
     .btn-action { display:inline-flex; align-items:center; gap:4px; padding:5px 10px; border-radius:6px; border:none; cursor:pointer; font-size:12px; font-weight:500; transition:all 0.18s; margin:0 3px; white-space:nowrap; }
.btn-action-view { background:#e0f2fe; color:#0284c7; }
.btn-action-view:hover { background:#bae6fd; color:#0369a1; transform:translateY(-1px); }
.btn-action-payslip { background:#f0fdf4; color:#16a34a; }
.btn-action-payslip:hover { background:#dcfce7; color:#15803d; transform:translateY(-1px); }

        /* ── Delete modal ── */
        .delete-modal { max-width:500px; }
        .delete-warning { text-align:center; padding:20px; }
        .btn-danger { background-color:#dc3545; border-color:#dc3545; color:white; padding:8px 16px; border-radius:6px; font-weight:500; cursor:pointer; transition:all 0.2s ease; }
        .btn-danger:hover:not(:disabled) { background-color:#c82333; }
        .btn-danger:disabled { opacity:0.6; cursor:not-allowed; }

        /* ── Modal base ── */
        .modal-overlay { position:fixed; top:0; left:0; right:0; bottom:0; background-color:rgba(0,0,0,0.6); display:flex; justify-content:center; align-items:center; z-index:1050; backdrop-filter:blur(3px); }
        .modal-content { background:#fff; padding:25px 30px; border-radius:12px; width:90%; max-width:900px; max-height:90vh; overflow-y:auto; box-shadow:0 10px 30px rgba(0,0,0,0.15); animation:modalEnter 0.3s ease-out forwards; }
        @keyframes modalEnter { from { transform:translateY(20px); opacity:0; } to { transform:translateY(0); opacity:1; } }
        .modal-header { display:flex; justify-content:space-between; align-items:center; margin-bottom:20px; padding-bottom:15px; border-bottom:1px solid #f0f0f0; }
        .modal-header h3 { margin:0; color:#2c3e50; font-size:1.3rem; font-weight:600; }
        .close-btn { background:#f8f9fa; border:none; width:32px; height:32px; border-radius:50%; display:flex; align-items:center; justify-content:center; cursor:pointer; color:#6c757d; font-size:1.2rem; flex-shrink:0; }
        .close-btn:hover { background:#e9ecef; }

        /* ── Details grid ── */
        .employee-details-grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(300px, 1fr)); gap:15px; }
        .section-header { grid-column:1/-1; font-weight:600; margin:20px 0 10px; padding:8px 0; border-bottom:2px solid #f0f0f0; color:#2c3e50; font-size:1rem; text-transform:uppercase; }
        .detail-item { display:flex; justify-content:space-between; padding:10px 12px; border-radius:6px; background:#fff; box-shadow:0 1px 3px rgba(0,0,0,0.03); border:1px solid #f0f0f0; }
        .detail-item:hover { box-shadow:0 2px 8px rgba(0,0,0,0.08); transform:translateY(-1px); }
        .detail-label { font-weight:500; color:#6c757d; font-size:0.9rem; }
        .detail-value { font-weight:500; color:#2c3e50; text-align:right; max-width:60%; word-break:break-word; }
        .total { background-color:#f8f9fa; border-left:3px solid #6c757d; }
        .grand-total { background:linear-gradient(135deg,#f8f9fa 0%,#e9ecef 100%); font-size:1.1em; border:1px solid #e9ecef; }

        /* ── Modal footer ── */
        .modal-footer { margin-top:25px; display:flex; justify-content:flex-end; padding-top:20px; border-top:1px solid #f0f0f0; gap:10px; }
        .modal-footer .btn { padding:8px 20px; border-radius:6px; font-weight:500; }
        .modal-footer .btn-secondary { background:#f8f9fa; border:1px solid #dee2e6; color:#495057; }
        .modal-footer .btn-secondary:hover { background:#e9ecef; }

        /* ── Payslip modal ── */
        .payslip-modal { max-width:800px; }
        .payslip-modal-body { padding:0; }
        .btn-download-payslip { padding:7px 16px; font-size:13px; border-radius:6px; border:none; cursor:pointer; background:#1a56db; color:#fff; font-weight:500; display:flex; align-items:center; gap:6px; transition:background 0.2s; }
        .btn-download-payslip:hover { background:#1e429f; }

        /* ── Payslip preview styles ── */
        .payslip-preview { font-family: 'Segoe UI', sans-serif; font-size:13px; color:#1e293b; padding:24px; background:#fff; }
        .ps-header { display:grid; grid-template-columns:1fr auto 1fr; align-items:center; gap:16px; margin-bottom:8px; }
        .ps-logo { height:48px; width:auto; object-fit:contain; }
       .ps-logo-area { width:60px; justify-self:start; }
.ps-title-area { text-align:center; }
.ps-badge-area { display:flex; justify-content:flex-end; }
        .ps-title { margin:0; font-size:1.4rem; font-weight:700; color:#1e3a5f; letter-spacing:2px; }
        .ps-period { margin:2px 0 0; font-size:0.9rem; color:#64748b; }
        .ps-category-badge { background:#e0f2fe; color:#0369a1; padding:4px 12px; border-radius:20px; font-size:12px; font-weight:600; text-transform:uppercase; letter-spacing:1px; }
        .ps-divider { height:2px; background:linear-gradient(90deg,#1a56db,#e2e8f0); border-radius:2px; margin:12px 0 16px; }
        .ps-info-grid { display:grid; grid-template-columns:repeat(4,1fr); gap:10px; margin-bottom:20px; background:#f8fafc; border-radius:8px; padding:14px; }
        .ps-info-item { display:flex; flex-direction:column; gap:2px; }
        .ps-info-label { font-size:10px; color:#94a3b8; text-transform:uppercase; letter-spacing:0.5px; font-weight:600; }
        .ps-info-value { font-size:13px; color:#1e293b; font-weight:500; }
        .ps-tables-row { display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-bottom:16px; }
        .ps-table-wrap { overflow:hidden; border-radius:8px; border:1px solid #e2e8f0; }
        .ps-table { width:100%; border-collapse:collapse; font-size:12px; }
        .ps-table th, .ps-table td { padding:7px 10px; border-bottom:1px solid #f1f5f9; }
        .ps-table thead tr:first-child th { padding:8px 10px; font-weight:700; font-size:12px; text-transform:uppercase; letter-spacing:0.5px; }
        .ps-table thead tr:last-child th { background:#f8fafc; color:#64748b; font-size:11px; font-weight:600; border-bottom:2px solid #e2e8f0; }
        .earnings-head { background:#f0fdf4; color:#15803d; }
        .deductions-head { background:#fef2f2; color:#dc2626; }
        .ps-total-row td { font-weight:700; background:#f8fafc; border-top:2px solid #e2e8f0; }
        .text-right { text-align:right; }
        .ps-net-pay { display:flex; justify-content:space-between; align-items:center; background:linear-gradient(135deg,#1a56db,#1e429f); color:#fff; border-radius:8px; padding:14px 20px; margin-bottom:16px; }
        .ps-net-label { font-size:14px; font-weight:600; letter-spacing:0.5px; }
        .ps-net-amount { font-size:20px; font-weight:700; }
        .ps-footer { text-align:center; font-size:11px; color:#94a3b8; border-top:1px solid #e2e8f0; padding-top:12px; }

        @media (max-width:768px) {
          .employee-details-grid { grid-template-columns:1fr; }
          .modal-content { width:95%; padding:20px 15px; }
          .ps-info-grid { grid-template-columns:repeat(2,1fr); }
          .ps-tables-row { grid-template-columns:1fr; }
        }
      `}</style>
    </section>
  );
};

export default Reports;