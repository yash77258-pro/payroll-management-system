import React, { useEffect, useState, useMemo, useCallback } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import {
  PieChart, Pie, Cell,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from 'recharts';

// ─── Constants ────────────────────────────────────────────────────────────────

const CATEGORY_COLORS = {
  Engineering:        '#4C6EF5',
  'Operations':      '#F76707',
  Apprentice: '#2F9E44',
  Finance:      '#9B59B6',
};

const DEPARTMENT_COLORS = [
  '#4C6EF5','#F76707','#2F9E44','#E64980','#7950F2',
  '#1098AD','#F59F00','#D9480F','#2F9E44','#862E9C',
  '#087F5B','#C92A2A','#1864AB','#5C940D','#E67700',
  '#495057','#A61E4D','#5F3DC4',
];

// ─── Role-based access helpers ────────────────────────────────────────────────

const getLoggedInUser = () => {
  try {
    const raw = localStorage.getItem('user');
    if (!raw) return { name: 'Unknown', role: 'admin', email: '' };
    const user = JSON.parse(raw);
    return {
      name:  user.name || user.username || 'Unknown',
      role:  (user.role || 'admin').toLowerCase(),
      email: user.email || '',
    };
  } catch { return { name: 'Unknown', role: 'admin', email: '' }; }
};

const getUserRole = () => getLoggedInUser().role;

const ROLE_CATEGORIES = {
  admin:  ['Operations', 'Engineering', 'Apprentice', 'Finance'],
  plant:  ['Operations', 'Engineering', 'Apprentice'],
  school: ['Finance'],
};

const allowedCategories = () => ROLE_CATEGORIES[getUserRole()] ?? ROLE_CATEGORIES.admin;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normalizeCategory(raw) {
  if (!raw || raw.trim() === '') return 'Operations';
  const val = raw.trim().toLowerCase();
  if (val === 'sks')        return 'Engineering';
  if (val === 'apprentice') return 'Apprentice';
  if (val === 'opjsk')      return 'Finance';
  return 'Operations';
}

// Extract the employees array from any API response shape
function extractEmployees(responseData) {
  if (Array.isArray(responseData))            return responseData;
  if (Array.isArray(responseData?.data))      return responseData.data;
  if (Array.isArray(responseData?.employees)) return responseData.employees;
  if (Array.isArray(responseData?.result))    return responseData.result;
  return [];
}

function groupByCategory(employees) {
  const counts = { Engineering: 0, 'Operations': 0, Apprentice: 0, Finance: 0 };
  const designationsByCategory = { Engineering: {}, 'Operations': {}, Apprentice: {}, Finance: {} };
  employees.forEach((emp) => {
    const category = normalizeCategory(emp.category);
    counts[category] = (counts[category] || 0) + 1;
    const designation =
      emp.designation && emp.designation.trim() !== '' && emp.designation.toLowerCase() !== 'unknown'
        ? emp.designation.trim() : 'Others';
    if (!designationsByCategory[category]) designationsByCategory[category] = {};
    designationsByCategory[category][designation] =
      (designationsByCategory[category][designation] || 0) + 1;
  });
  return { counts, designationsByCategory };
}

function buildGroupedData(designationsByCategory, visibleCategories) {
  const allDesignations = new Set();
  Object.values(designationsByCategory).forEach((map) =>
    Object.keys(map).forEach((d) => allDesignations.add(d))
  );
  return Array.from(allDesignations).map((designation) => {
    const entry = { designation };
    visibleCategories.forEach(cat => {
      entry[cat] = designationsByCategory[cat]?.[designation] || 0;
    });
    return entry;
  });
}

// Renames specific real-world department names to generic demo labels.
// Add more entries here if other real department names surface in the data.
const DEPARTMENT_NAME_OVERRIDES = {
  'JPL, Tamnar': 'Regional Office',
};

function normalizeDepartmentName(raw) {
  const trimmed = raw.trim();
  return DEPARTMENT_NAME_OVERRIDES[trimmed] || trimmed;
}

function buildDepartmentData(employees) {
  const deptCounts = {};
  employees.forEach((emp) => {
    const dept =
      emp.department && emp.department.trim() !== '' && emp.department.trim() !== '(blank)'
        ? normalizeDepartmentName(emp.department) : 'Others';
    deptCounts[dept] = (deptCounts[dept] || 0) + 1;
  });
  return Object.entries(deptCounts)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);
}

// ─── Custom Tooltips ──────────────────────────────────────────────────────────

const PieTooltip = ({ active, payload, total }) => {
  if (active && payload && payload.length) {
    const { name, value } = payload[0];
    const pct = total ? Math.round((value / total) * 100) : 0;
    return (
      <div style={s.tooltip}>
        <p style={{ fontWeight: 600, marginBottom: 2, color: '#1a1a2e' }}>{name}</p>
        <p style={{ color: '#6b6b6b' }}>{value} employees ({pct}%)</p>
      </div>
    );
  }
  return null;
};

const BarTooltip = ({ active, payload, label }) => {
  if (active && payload && payload.length) {
    return (
      <div style={s.tooltip}>
        <p style={{ fontWeight: 600, marginBottom: 4, color: '#1a1a2e' }}>{label}</p>
        {payload.map((p) => (
          <p key={p.name} style={{ color: p.fill || p.color, marginBottom: 2 }}>
            {p.name}: <strong>{p.value}</strong>
          </p>
        ))}
      </div>
    );
  }
  return null;
};

// ─── Custom Pie Label ─────────────────────────────────────────────────────────

const renderCustomLabel = ({ cx, cy, midAngle, outerRadius, percent }) => {
  if (percent < 0.08) return null;
  const R   = Math.PI / 180;
  const sin = Math.sin(-midAngle * R);
  const cos = Math.cos(-midAngle * R);
  const sx  = cx + (outerRadius + 4)  * cos;
  const sy  = cy + (outerRadius + 4)  * sin;
  const mx  = cx + (outerRadius + 18) * cos;
  const my  = cy + (outerRadius + 18) * sin;
  const ex  = mx + (cos >= 0 ? 1 : -1) * 10;
  const ey  = my;
  return (
    <g>
      <path d={`M${sx},${sy}L${mx},${my}L${ex},${ey}`} stroke="#bbb" fill="none" strokeWidth={1} />
      <text x={ex + (cos >= 0 ? 3 : -3)} y={ey} textAnchor={cos >= 0 ? 'start' : 'end'}
        dominantBaseline="central" fontSize={10} fill="#555">
        {`${(percent * 100).toFixed(0)}%`}
      </text>
    </g>
  );
};

// ─── Card sub-components ──────────────────────────────────────────────────────

function TotalCard({ total, onClick }) {
  return (
    <div style={{ ...s.totalCard, cursor: 'pointer' }} onClick={onClick} title="Click to view all employees">
      <div style={s.totalIcon}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
          stroke="#1971c2" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
      </div>
      <div>
        <div style={s.totalNum}>{total}</div>
        <div style={s.totalLabel}>Total employees across all categories</div>
      </div>
      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={s.totalBadge}>Active</div>
        <div style={s.viewBtn}>View all →</div>
      </div>
    </div>
  );
}

function MetricCard({ label, value, color, onClick }) {
  return (
    <div style={{ ...s.metricCard, cursor: 'pointer' }} onClick={onClick} title={`Click to view ${label} employees`}>
      <div style={{ ...s.metricStripe, background: color }} />
      <div style={{ padding: '1rem 1.25rem' }}>
        <div style={{ fontSize: 28, fontWeight: 600, color: '#1a1a2e', lineHeight: 1 }}>{value}</div>
        <div style={{ fontSize: 13, color: '#6b6b6b', marginTop: 4 }}>{label}</div>
        <div style={{ fontSize: 11, color, marginTop: 6, fontWeight: 500 }}>View employees →</div>
      </div>
    </div>
  );
}

function ChartCard({ title, meta, children, fullWidth }) {
  return (
    <div style={{ ...s.chartCard, ...(fullWidth ? { gridColumn: '1 / -1' } : {}) }}>
      <div style={s.chartHeader}>
        <div style={s.chartTitle}>{title}</div>
        <div style={s.chartMeta}>{meta}</div>
      </div>
      {children}
    </div>
  );
}

// ─── Finance-only Dashboard ─────────────────────────────────────────────────────

function FinanceDashboard({ employees, onNavigate }) {
  const total = employees.length;
  const deptData = useMemo(() => buildDepartmentData(employees), [employees]);
  const { designationsByCategory } = useMemo(() => groupByCategory(employees), [employees]);

  const desgData = useMemo(() => {
    const map = designationsByCategory.Finance || {};
    return Object.entries(map)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [designationsByCategory]);

  return (
    <div style={s.page}>
      <div style={s.header}>
        <div>
          <h2 style={s.pageTitle}>Payroll & Workforce Dashboard</h2>
          <p style={s.pageSub}>Payroll Management System</p>
        </div>
        <div style={{ background: '#f3e8ff', border: '1px solid #d8b4fe', borderRadius: 8, padding: '6px 14px', fontSize: 12, color: '#7c3aed', display: 'flex', alignItems: 'center', gap: 6 }}>
          <i className="fas fa-lock" style={{ fontSize: 11 }}></i>
          Finance Access Only
        </div>
      </div>
      <div style={{ ...s.totalCard, cursor: 'pointer', marginBottom: '1.25rem' }} onClick={() => onNavigate('Finance')}>
        <div style={{ ...s.totalIcon, background: '#f3e8ff' }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#7c3aed" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
            <path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
          </svg>
        </div>
        <div>
          <div style={s.totalNum}>{total}</div>
          <div style={s.totalLabel}>Total Finance employees</div>
        </div>
        <div style={{ marginLeft: 'auto' }}>
          <div style={{ ...s.viewBtn, color: '#7c3aed', background: '#f3e8ff' }}>View all →</div>
        </div>
      </div>
      <div style={s.chartsGrid}>
        <ChartCard title="Finance employees by department" meta="Hover a slice for details">
          <ResponsiveContainer width="100%" height={240}>
            <PieChart margin={{ top: 10, right: 40, bottom: 10, left: 40 }}>
              <Pie data={deptData} cx="50%" cy="50%" innerRadius={65} outerRadius={100} paddingAngle={2} dataKey="value" label={renderCustomLabel} labelLine={false}>
                {deptData.map((entry, index) => <Cell key={entry.name} fill={DEPARTMENT_COLORS[index % DEPARTMENT_COLORS.length]} />)}
              </Pie>
              <Tooltip content={<PieTooltip total={total} />} />
            </PieChart>
          </ResponsiveContainer>
          <LegendGrid data={deptData} colors={DEPARTMENT_COLORS} />
        </ChartCard>
        <ChartCard title="Finance employees by designation" meta="Headcount per designation">
          <ResponsiveContainer width="100%" height={280}>
            <BarChart layout="vertical" data={desgData} margin={{ top: 5, right: 30, left: 10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="4 4" horizontal={false} stroke="#f0f0f0" />
              <XAxis type="number" tick={{ fontSize: 12, fill: '#6b6b6b' }} allowDecimals={false} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: '#6b6b6b' }} width={130} />
              <Tooltip content={<BarTooltip />} />
              <Bar dataKey="value" radius={[0, 6, 6, 0]} barSize={24} fill={CATEGORY_COLORS.Finance} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>
    </div>
  );
}

// ─── Shared legend grid ───────────────────────────────────────────────────────

function LegendGrid({ data, colors }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 16px', marginTop: 10, paddingTop: 10, borderTop: '0.5px solid #f0f0f0', maxHeight: 160, overflowY: 'auto' }}>
      {data.map((entry, index) => (
        <div key={entry.name} style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, padding: '2px 0' }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, background: colors[index % colors.length] }} />
          <span style={{ fontSize: 11, color: '#6b6b6b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1 }}>{entry.name}</span>
          <span style={{ fontSize: 11, color: '#1a1a2e', fontWeight: 600, marginLeft: 4, flexShrink: 0 }}>{entry.value}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Plant Dashboard ──────────────────────────────────────────────────────────

function PlantDashboard({ employees, categoryCounts, groupedBarData, departmentData, onNavigate }) {
  const total = employees.length;
  const visibleCategories = ['Operations', 'Engineering', 'Apprentice'];
  const categoryBarData = useMemo(
    () => visibleCategories.map(cat => ({ name: cat, value: categoryCounts[cat] || 0 })),
    [categoryCounts]
  );

  return (
    <div style={s.page}>
      <div style={s.header}>
        <div>
          <h2 style={s.pageTitle}>Payroll & Workforce Dashboard</h2>
          <p style={s.pageSub}>Payroll Management System</p>
        </div>
        <div style={{ background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 8, padding: '6px 14px', fontSize: 12, color: '#166534', display: 'flex', alignItems: 'center', gap: 6 }}>
          <i className="fas fa-filter" style={{ fontSize: 11 }}></i>
          Department Access: Operations · Engineering · Apprentice
        </div>
      </div>
      <TotalCard total={total} onClick={() => onNavigate('ALL')} />
      <div style={{ ...s.metricsRow, gridTemplateColumns: 'repeat(3, 1fr)' }}>
        {visibleCategories.map(cat => (
          <MetricCard key={cat} label={cat} value={categoryCounts[cat] || 0} color={CATEGORY_COLORS[cat] || '#888'} onClick={() => onNavigate(cat)} />
        ))}
      </div>
      <div style={s.chartsGrid}>
        <ChartCard title="Employee distribution by department" meta="Hover a slice for details">
          <ResponsiveContainer width="100%" height={240}>
            <PieChart margin={{ top: 10, right: 40, bottom: 10, left: 40 }}>
              <Pie data={departmentData} cx="50%" cy="50%" innerRadius={65} outerRadius={100} paddingAngle={2} dataKey="value" label={renderCustomLabel} labelLine={false}>
                {departmentData.map((entry, index) => <Cell key={entry.name} fill={DEPARTMENT_COLORS[index % DEPARTMENT_COLORS.length]} />)}
              </Pie>
              <Tooltip content={<PieTooltip total={total} />} />
            </PieChart>
          </ResponsiveContainer>
          <LegendGrid data={departmentData} colors={DEPARTMENT_COLORS} />
        </ChartCard>
        <ChartCard title="Headcount by category" meta="Operations · Engineering · Apprentice">
          <ResponsiveContainer width="100%" height={280}>
            <BarChart layout="vertical" data={categoryBarData} margin={{ top: 5, right: 30, left: 10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="4 4" horizontal={false} stroke="#f0f0f0" />
              <XAxis type="number" tick={{ fontSize: 12, fill: '#6b6b6b' }} allowDecimals={false} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 12, fill: '#6b6b6b' }} width={90} />
              <Tooltip content={<BarTooltip />} />
              <Bar dataKey="value" radius={[0, 6, 6, 0]} barSize={28}>
                {categoryBarData.map((entry) => <Cell key={entry.name} fill={CATEGORY_COLORS[entry.name] || '#4C6EF5'} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
        {groupedBarData.length > 0 && (
          <ChartCard title="Designation breakdown within categories" meta="Employee count per designation — Operations · Engineering · Apprentice" fullWidth>
            <ResponsiveContainer width="100%" height={360}>
              <BarChart data={groupedBarData} margin={{ top: 40, right: 20, left: 0, bottom: 90 }}>
                <CartesianGrid strokeDasharray="4 4" vertical={false} stroke="#f0f0f0" />
                <XAxis dataKey="designation" tick={{ fontSize: 11, fill: '#6b6b6b' }} angle={-40} textAnchor="end" interval={0} />
                <YAxis tick={{ fontSize: 12, fill: '#6b6b6b' }} allowDecimals={false} />
                <Tooltip content={<BarTooltip />} />
                <Legend verticalAlign="top" align="right" wrapperStyle={{ fontSize: 12, paddingBottom: 12 }} formatter={(value) => <span style={{ color: '#6b6b6b' }}>{value}</span>} />
                {visibleCategories.map(cat => <Bar key={cat} dataKey={cat} fill={CATEGORY_COLORS[cat]} radius={[4, 4, 0, 0]} barSize={12} />)}
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        )}
      </div>
    </div>
  );
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────

const Dashboard = () => {
  const [employees, setEmployees] = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState(null);

  const navigate = useNavigate();
  const role     = getUserRole();
  const allowed  = allowedCategories();

  const fetchEmployees = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await axios.get(
        `${process.env.REACT_APP_API_BASE_URL || 'http://localhost:5000'}/api/employees`
      );
      // Handle any response shape: array, { data: [] }, { employees: [] }, { result: [] }
      let raw = extractEmployees(response.data);
      // Normalize category on every record
      raw = raw.map(e => ({ ...e, category: normalizeCategory(e.category) }));
      // Filter to only categories this role can see
      const data = raw.filter(e => allowed.includes(e.category));
      setEmployees(data);
    } catch (err) {
      console.error('Dashboard fetch error:', err);
      setError('Failed to load employee data. Please try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchEmployees(); }, [fetchEmployees]);

  const openTotal    = useCallback(() => navigate('/employees?category=ALL'), [navigate]);
  const openCategory = useCallback((cat) => navigate(`/employees?category=${encodeURIComponent(cat)}`), [navigate]);

  const { counts: categoryCounts, designationsByCategory } = useMemo(() => groupByCategory(employees), [employees]);
  const groupedBarData = useMemo(() => buildGroupedData(designationsByCategory, allowed), [designationsByCategory]);
  const departmentData = useMemo(() => buildDepartmentData(employees), [employees]);
  const total          = employees.length;
  const categoryBarData = useMemo(
    () => allowed.map(cat => ({ name: cat, value: categoryCounts[cat] || 0 })),
    [categoryCounts]
  );

  if (loading) {
    return (
      <div style={s.stateBox}>
        <div style={s.spinner} />
        <p style={{ color: '#6b6b6b', marginTop: 12, fontSize: 14 }}>Loading dashboard…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div style={s.stateBox}>
        <p style={{ color: '#c92a2a', fontSize: 14 }}>{error}</p>
        <button onClick={fetchEmployees} style={s.retryBtn}>Retry</button>
      </div>
    );
  }

  if (role === 'school') {
    return <FinanceDashboard employees={employees} onNavigate={openCategory} />;
  }

  if (role === 'plant') {
    return (
      <PlantDashboard
        employees={employees}
        categoryCounts={categoryCounts}
        groupedBarData={groupedBarData}
        departmentData={departmentData}
        onNavigate={openCategory}
      />
    );
  }

  // ── Admin: full dashboard ────────────────────────────────────────────────────
  return (
    <div style={s.page}>
      <div style={s.header}>
        <div>
          <h2 style={s.pageTitle}>Payroll & Workforce Dashboard</h2>
          <p style={s.pageSub}>Payroll Management System</p>
        </div>
      </div>

      <TotalCard total={total} onClick={openTotal} />

      <div style={{ ...s.metricsRow, gridTemplateColumns: 'repeat(4, 1fr)' }}>
        {Object.entries(categoryCounts).map(([cat, val]) => (
          <MetricCard key={cat} label={cat} value={val} color={CATEGORY_COLORS[cat] || '#888'} onClick={() => openCategory(cat)} />
        ))}
      </div>

      <div style={s.chartsGrid}>
        <ChartCard title="Employee distribution by department" meta="Hover a slice for details">
          <ResponsiveContainer width="100%" height={240}>
            <PieChart margin={{ top: 10, right: 40, bottom: 10, left: 40 }}>
              <Pie data={departmentData} cx="50%" cy="50%" innerRadius={65} outerRadius={100} paddingAngle={2} dataKey="value" label={renderCustomLabel} labelLine={false}>
                {departmentData.map((entry, index) => <Cell key={entry.name} fill={DEPARTMENT_COLORS[index % DEPARTMENT_COLORS.length]} />)}
              </Pie>
              <Tooltip content={<PieTooltip total={total} />} />
            </PieChart>
          </ResponsiveContainer>
          <LegendGrid data={departmentData} colors={DEPARTMENT_COLORS} />
        </ChartCard>

        <ChartCard title="Headcount by category" meta="Engineering · Operations · Apprentice · Finance">
          <ResponsiveContainer width="100%" height={280}>
            <BarChart layout="vertical" data={categoryBarData} margin={{ top: 5, right: 30, left: 10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="4 4" horizontal={false} stroke="#f0f0f0" />
              <XAxis type="number" tick={{ fontSize: 12, fill: '#6b6b6b' }} allowDecimals={false} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 12, fill: '#6b6b6b' }} width={90} />
              <Tooltip content={<BarTooltip />} />
              <Bar dataKey="value" radius={[0, 6, 6, 0]} barSize={28}>
                {categoryBarData.map((entry) => <Cell key={entry.name} fill={CATEGORY_COLORS[entry.name] || '#4C6EF5'} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        {groupedBarData.length > 0 && (
          <ChartCard title="Designation breakdown within categories" meta="Employee count per designation, grouped by category" fullWidth>
            <ResponsiveContainer width="100%" height={360}>
              <BarChart data={groupedBarData} margin={{ top: 40, right: 20, left: 0, bottom: 90 }}>
                <CartesianGrid strokeDasharray="4 4" vertical={false} stroke="#f0f0f0" />
                <XAxis dataKey="designation" tick={{ fontSize: 11, fill: '#6b6b6b' }} angle={-40} textAnchor="end" interval={0} />
                <YAxis tick={{ fontSize: 12, fill: '#6b6b6b' }} allowDecimals={false} />
                <Tooltip content={<BarTooltip />} />
                <Legend verticalAlign="top" align="right" wrapperStyle={{ fontSize: 12, paddingBottom: 12 }} formatter={(value) => <span style={{ color: '#6b6b6b' }}>{value}</span>} />
                {Object.entries(CATEGORY_COLORS).map(([cat, color]) => (
                  <Bar key={cat} dataKey={cat} fill={color} radius={[4, 4, 0, 0]} barSize={12} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        )}
      </div>
    </div>
  );
};

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = {
  page: { padding: '2rem', fontFamily: "'Segoe UI', system-ui, sans-serif", background: '#f5f6fa', minHeight: '100vh' },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem' },
  pageTitle: { fontSize: 22, fontWeight: 600, color: '#1a1a2e', margin: 0 },
  pageSub: { fontSize: 13, color: '#6b6b6b', marginTop: 4, marginBottom: 0 },
  totalCard: { background: '#fff', border: '0.5px solid #e0e0e0', borderRadius: 14, padding: '1.25rem 1.5rem', display: 'flex', alignItems: 'center', gap: 20, marginBottom: '1.25rem', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' },
  totalIcon: { width: 48, height: 48, borderRadius: 12, background: '#dbe4ff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  totalNum: { fontSize: 38, fontWeight: 600, color: '#1a1a2e', lineHeight: 1 },
  totalLabel: { fontSize: 13, color: '#6b6b6b', marginTop: 4 },
  totalBadge: { background: '#d3f9d8', color: '#2b8a3e', fontSize: 12, padding: '4px 12px', borderRadius: 8, fontWeight: 500 },
  viewBtn: { fontSize: 12, color: '#1971c2', fontWeight: 500, background: '#dbe4ff', padding: '4px 10px', borderRadius: 8 },
  metricsRow: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: '1.25rem' },
  metricCard: { background: '#fff', border: '0.5px solid #e0e0e0', borderRadius: 14, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' },
  metricStripe: { height: 4, width: '100%' },
  chartsGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 },
  chartCard: { background: '#fff', border: '0.5px solid #e0e0e0', borderRadius: 14, padding: '1.25rem', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' },
  chartHeader: { marginBottom: 14 },
  chartTitle: { fontSize: 14, fontWeight: 600, color: '#1a1a2e' },
  chartMeta: { fontSize: 12, color: '#6b6b6b', marginTop: 2 },
  tooltip: { background: '#fff', border: '0.5px solid #e0e0e0', borderRadius: 8, padding: '8px 12px', fontSize: 12, boxShadow: '0 2px 8px rgba(0,0,0,0.08)' },
  stateBox: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 300, gap: 8 },
  spinner: { width: 32, height: 32, border: '3px solid #e0e0e0', borderTopColor: '#4C6EF5', borderRadius: '50%', animation: 'spin 0.8s linear infinite' },
  retryBtn: { marginTop: 8, padding: '6px 16px', fontSize: 13, border: '0.5px solid #c0c0c0', borderRadius: 8, background: '#fff', cursor: 'pointer' },
};

export default Dashboard;