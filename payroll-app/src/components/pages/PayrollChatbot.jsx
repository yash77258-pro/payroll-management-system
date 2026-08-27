import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';

const BASE_URL = process.env.REACT_APP_API_BASE_URL || 'http://localhost:5000';

const CAT_COLORS = {
  SKS: '#4C6EF5',
  'H&F': '#F76707',
  Apprentice: '#2F9E44',
  OPJSK: '#9B59B6',
};

const CAT_TAG_STYLE = {
  SKS:        { background: '#dbe4ff', color: '#3b5bdb' },
  'H&F':      { background: '#fff3e0', color: '#e65100' },
  Apprentice: { background: '#e8f5e9', color: '#2e7d32' },
  OPJSK:      { background: '#f3e8ff', color: '#7c3aed' },
};

const fmt = (n) => '₹' + Math.round(parseFloat(n) || 0).toLocaleString('en-IN');

const getName = (e) => {
  if (e.firstName || e.lastName) return `${e.firstName || ''} ${e.lastName || ''}`.trim();
  return e.name || e.empCode || '—';
};

const groupBy = (arr, key) => {
  const m = {};
  arr.forEach(e => { const k = e[key] || 'Unknown'; m[k] = (m[k] || 0) + 1; });
  return m;
};

const avgBy = (arr, groupKey, valKey) => {
  const sums = {}, counts = {};
  arr.forEach(e => {
    const k = e[groupKey] || 'Unknown';
    sums[k]   = (sums[k]   || 0) + (parseFloat(e[valKey]) || 0);
    counts[k] = (counts[k] || 0) + 1;
  });
  const res = {};
  Object.keys(sums).forEach(k => { res[k] = sums[k] / counts[k]; });
  return res;
};

// ── Smart query engine ────────────────────────────────────────────────────────

const FIELDS = {
  name:        ['name', 'called', 'named'],
  empCode:     ['code', 'emp code', 'employee code', 'id'],
  category:    ['category', 'cat', 'type'],
  department:  ['department', 'dept', 'division', 'team', 'section'],
  designation: ['designation', 'role', 'position', 'title', 'post', 'job title'],
  status:      ['status', 'active', 'inactive', 'working'],
  basic:       ['basic', 'basic salary', 'base salary', 'base pay'],
  gross:       ['gross', 'gross salary', 'total salary', 'ctc', 'salary', 'pay', 'earning'],
  joiningDate: ['joining date', 'joined', 'joining', 'doj', 'date of joining', 'start date', 'hire date'],
  bankAccount: ['bank', 'account', 'bank account'],
};

const detectField = (q) => {
  const ql = q.toLowerCase();
  for (const [field, aliases] of Object.entries(FIELDS)) {
    if (aliases.some(a => ql.includes(a))) return field;
  }
  return null;
};

const extractFilters = (q, emp) => {
  const ql = q.toLowerCase();
  const filters = [];

  const allCats = [...new Set(emp.map(e => (e.category || '').toLowerCase()))];
  for (const cat of allCats) {
    if (ql.includes(cat)) {
      filters.push(e => (e.category || '').toLowerCase() === cat);
    }
  }

  const allDepts = [...new Set(emp.map(e => (e.department || '').toLowerCase()).filter(Boolean))];
  for (const dept of allDepts) {
    if (dept.length > 2 && ql.includes(dept)) {
      filters.push(e => (e.department || '').toLowerCase() === dept);
    }
  }

  const allDesig = [...new Set(emp.map(e => (e.designation || '').toLowerCase()).filter(Boolean))];
  for (const d of allDesig) {
    if (d.length > 2 && ql.includes(d)) {
      filters.push(e => (e.designation || '').toLowerCase() === d);
    }
  }

  if (/\bactive\b/.test(ql) && !/inactive/.test(ql)) {
    filters.push(e => (e.status || '').toLowerCase() === 'active');
  } else if (/inactive/.test(ql)) {
    filters.push(e => (e.status || '').toLowerCase() !== 'active');
  }

  const aboveMatch   = ql.match(/(?:above|more than|greater than|over|exceeds?)\s*[₹rs.]?\s*([\d,]+)/i);
  const belowMatch   = ql.match(/(?:below|less than|under|within)\s*[₹rs.]?\s*([\d,]+)/i);
  const betweenMatch = ql.match(/between\s*[₹rs.]?\s*([\d,]+)\s*(?:and|to|-)\s*[₹rs.]?\s*([\d,]+)/i);
  const salaryField  = /basic/.test(ql) ? 'basic' : 'gross';

  if (betweenMatch) {
    const lo = parseFloat(betweenMatch[1].replace(/,/g, ''));
    const hi = parseFloat(betweenMatch[2].replace(/,/g, ''));
    filters.push(e => parseFloat(e[salaryField]) >= lo && parseFloat(e[salaryField]) <= hi);
  } else {
    if (aboveMatch) {
      const val = parseFloat(aboveMatch[1].replace(/,/g, ''));
      filters.push(e => parseFloat(e[salaryField] || 0) > val);
    }
    if (belowMatch) {
      const val = parseFloat(belowMatch[1].replace(/,/g, ''));
      filters.push(e => parseFloat(e[salaryField] || 0) < val);
    }
  }

  return filters;
};

const applyFilters = (emp, filters) => {
  if (!filters.length) return emp;
  return emp.filter(e => filters.every(f => f(e)));
};

const detectAggregate = (q) => {
  const ql = q.toLowerCase();
  if (/\bhow many\b|\bcount\b|\bnumber of\b|\btotal.*employee\b|\bemployee.*total\b/.test(ql)) return 'count';
  if (/\blist\b|\bshow\b|\bwho\b|\bwhich employee\b|\ball.*employee\b|\bemployee.*all\b|\bnames?\b/.test(ql)) return 'list';
  if (/\baverage?\b|\bavg\b/.test(ql)) return 'avg';
  if (/\btotal\b|\bsum\b/.test(ql)) return 'total';
  if (/\bhighest\b|\bmaximum\b|\bmax\b|\bmost\b|\btop\b/.test(ql)) return 'max';
  if (/\blowest\b|\bminimum\b|\bmin\b|\blast\b|\bbottom\b/.test(ql)) return 'min';
  if (/\bgroup\b|\bbreakdown\b|\bby\b|\bdistribution\b|\bsplit\b/.test(ql)) return 'group';
  return null;
};

const detectGroupKey = (q) => {
  const ql = q.toLowerCase();
  if (/by category|per category|each category|category.?wise/.test(ql)) return 'category';
  if (/by department|per department|each department|department.?wise/.test(ql)) return 'department';
  if (/by designation|per designation|each designation|designation.?wise/.test(ql)) return 'designation';
  if (/by status|per status/.test(ql)) return 'status';
  if (/by gender|per gender/.test(ql)) return 'gender';
  return null;
};

const detectNumericField = (q) => {
  const ql = q.toLowerCase();
  if (/\bbasic\b/.test(ql)) return 'basic';
  if (/\bgross\b|\bsalary\b|\bpay\b|\bearning\b/.test(ql)) return 'gross';
  return 'gross';
};

function extractNumber(q) {
  const m = q.match(/\b(\d+)\b/);
  return m ? parseInt(m[1]) : null;
}

// ── Main respond function ─────────────────────────────────────────────────────
function respond(q, emp) {
  const ql = q.toLowerCase().trim();

  if (!emp || emp.length === 0)
    return [{ type: 'text', text: "I don't have any employee data loaded right now." }];

  if (/^(hi|hello|hey|sup|good\s*(morning|evening|afternoon))[\s!?]*$/.test(ql)) {
    return [{ type: 'text', text: "Hi! I'm your Payroll Assistant. Ask me anything about employees — counts, salaries, departments, designations, categories, joining dates, and more. Type **help** to see example questions." }];
  }

  if (/\bhelp\b|\bwhat can you\b|\bwhat do you know\b/.test(ql)) {
    return [{
      type: 'text', text:
        "Here are things you can ask me:\n\n" +
        "**Counts & Lists**\n• How many employees are there?\n• List all Category A employees\n• Show active employees in HR department\n• Who are the apprentices?\n\n" +
        "**Employee Details**\n• Tell me details of employee code 6001\n• What is the salary of employee code 1001?\n• Tell me employee code of employee code 1001\n• Department of employee code 1002\n\n" +
        "**Salary**\n• What is the average salary?\n• Show average salary by category\n• Who has the highest salary?\n• List employees with salary above 50000\n\n" +
        "**Breakdown**\n• Show breakdown by department\n• Show breakdown by designation\n• Group employees by category\n\n" +
        "**Status & Dates**\n• How many active employees?\n• Who joined most recently?\n• Show inactive employees\n\n" +
        "**Search**\n• Find employee named Rajesh\n• Search emp code 1023\n• Who works in Finance?\n",
    }];
  }

  if (/^(total|how many|count)[\s]*(employee|staff|people|workers?)?[\s!?]*$/.test(ql) ||
      /how many (employee|staff|people|workers?) (are there|do we have|in total|total)/i.test(ql) ||
      /total (employee|staff|people|workers?) count/i.test(ql)) {
    return [{ type: 'text', text: `There are **${emp.length}** employees in total across all categories.` }];
  }

  if (/\b(overview|snapshot|summary|dashboard|brief|report)\b/.test(ql) && !/salary|pay|earn/.test(ql)) {
    const catCounts  = groupBy(emp, 'category');
    const active     = emp.filter(e => (e.status || '').toLowerCase() === 'active').length;
    const deptCount  = Object.keys(groupBy(emp, 'department')).length;
    const desigCount = Object.keys(groupBy(emp, 'designation')).length;
    return [{ type: 'overview', total: emp.length, active, deptCount, desigCount, catCounts }];
  }

  if (/\b(active|inactive|status)\b/.test(ql) && !/salary|pay|earn/.test(ql) && !/list|show|who|name/.test(ql)) {
    const active   = emp.filter(e => (e.status || '').toLowerCase() === 'active').length;
    const inactive = emp.length - active;
    const rate     = Math.round((active / emp.length) * 100);
    return [{ type: 'status', active, inactive, rate }];
  }

  if (/recent.*join|join.*recent|latest.*join|newest|new employ|who.*join|last.*join|join.*last/i.test(ql)) {
    const sorted = emp.filter(e => e.joiningDate).sort((a, b) => new Date(b.joiningDate) - new Date(a.joiningDate));
    const n = extractNumber(ql) || 5;
    return [{ type: 'joiners', rows: sorted.slice(0, n) }];
  }

  if (/oldest|longest.*(serving|working|tenure)|earliest.*join|first.*join|senior.*employee/i.test(ql)) {
    const sorted = emp.filter(e => e.joiningDate).sort((a, b) => new Date(a.joiningDate) - new Date(b.joiningDate));
    const n = extractNumber(ql) || 5;
    return [{ type: 'joiners', rows: sorted.slice(0, n), label: 'Longest Serving' }];
  }

  if (/highest.*salary|top.*earn|most.*paid|maximum.*salary|best.*paid|who.*earn.*most|highest.*paid/i.test(ql)) {
    const n = extractNumber(ql) || 5;
    const field = detectNumericField(ql);
    const sorted = [...emp].filter(e => parseFloat(e[field]) > 0).sort((a, b) => parseFloat(b[field]) - parseFloat(a[field]));
    return [{ type: 'top-earners', rows: sorted.slice(0, n), field, label: `Top ${n} Earners` }];
  }

  if (/lowest.*salary|bottom.*earn|least.*paid|minimum.*salary|least.*earn|lowest.*paid/i.test(ql)) {
    const n = extractNumber(ql) || 5;
    const field = detectNumericField(ql);
    const sorted = [...emp].filter(e => parseFloat(e[field]) > 0).sort((a, b) => parseFloat(a[field]) - parseFloat(b[field]));
    return [{ type: 'top-earners', rows: sorted.slice(0, n), field, label: `Bottom ${n} Earners` }];
  }

  if (/avg.*salary|average.*salary|salary.*avg|salary.*average|mean.*salary/i.test(ql)) {
    const groupKey = detectGroupKey(ql);
    const field    = detectNumericField(ql);
    const filters  = extractFilters(ql, emp);
    const subset   = applyFilters(emp, filters);
    if (groupKey) {
      const grossAvgs = avgBy(subset, groupKey, 'gross');
      const basicAvgs = avgBy(subset, groupKey, 'basic');
      const rows = Object.entries(grossAvgs).sort((a, b) => b[1] - a[1]);
      return [{ type: 'salary-avg', rows, basicAvgs, groupKey }];
    }
    const vals = subset.map(e => parseFloat(e[field]) || 0).filter(v => v > 0);
    const avg  = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
    return [{ type: 'text', text: `The average **${field} salary** is **${fmt(avg)}** across ${vals.length} employees${filters.length ? ' (filtered)' : ''}.` }];
  }

  if (/total.*salary|total.*payroll|payroll.*total|total.*pay|sum.*salary|salary.*sum/i.test(ql)) {
    const filters = extractFilters(ql, emp);
    const subset  = applyFilters(emp, filters);
    const field   = detectNumericField(ql);
    const total   = subset.reduce((s, e) => s + (parseFloat(e[field]) || 0), 0);
    const avg     = total / (subset.length || 1);
    const maxEmp  = subset.reduce((m, e) => parseFloat(e[field] || 0) > parseFloat(m[field] || 0) ? e : m, subset[0] || {});
    const withSal = subset.filter(e => parseFloat(e[field]) > 0);
    const minEmp  = withSal.length ? withSal.reduce((m, e) => parseFloat(e[field]) < parseFloat(m[field]) ? e : m, withSal[0]) : null;
    return [{ type: 'salary-summary', totalGross: total, avgGross: avg, maxEmp, minEmp }];
  }

  if (/\bsalary\b|\bgross\b|\bpay\b|\bearning\b|\bctc\b/.test(ql) && !/list|show|who|name|above|below|between|average|total/.test(ql)) {
    const filters = extractFilters(ql, emp);
    const subset  = applyFilters(emp, filters);
    const field   = detectNumericField(ql);
    const totalGross = subset.reduce((s, e) => s + (parseFloat(e[field]) || 0), 0);
    const avgGross   = totalGross / (subset.length || 1);
    const maxEmp = subset.reduce((m, e) => (parseFloat(e[field] || 0) > parseFloat(m[field] || 0) ? e : m), subset[0] || {});
    const withSalary = subset.filter(e => parseFloat(e[field]) > 0);
    const minEmp = withSalary.length
      ? withSalary.reduce((m, e) => (parseFloat(e[field] || 0) < parseFloat(m[field] || 0) ? e : m), withSalary[0])
      : null;
    return [{ type: 'salary-summary', totalGross, avgGross, maxEmp, minEmp }];
  }

  if (/\b(breakdown|distribution|split|group|how many.*by|by.*how many)\b/.test(ql) ||
      /by (category|department|designation|status|gender)/i.test(ql)) {
    const groupKey = detectGroupKey(ql) || detectField(ql) || 'category';
    const filters  = extractFilters(ql, emp);
    const subset   = applyFilters(emp, filters);
    const counts   = groupBy(subset, groupKey);
    const rows     = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    const maxV     = rows[0]?.[1] || 1;
    if (groupKey === 'category') return [{ type: 'category-bars', rows, total: subset.length, maxV }];
    return [{ type: 'dept-table', rows, maxV, label: groupKey.charAt(0).toUpperCase() + groupKey.slice(1) }];
  }

  if (/\bcategor(y|ies|wise)\b/.test(ql) && !/department/i.test(ql)) {
    const filters = extractFilters(ql, emp);
    const subset  = applyFilters(emp, filters);
    const counts  = groupBy(subset, 'category');
    const rows    = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    const maxV    = rows[0]?.[1] || 1;
    return [{ type: 'category-bars', rows, total: subset.length, maxV }];
  }

  if (/\bdepartment\b|\bdept\b|\bdivision\b/.test(ql) && !/list|show|who|name/.test(ql)) {
    const filters = extractFilters(ql, emp);
    const subset  = applyFilters(emp, filters);
    const counts  = groupBy(subset, 'department');
    const rows    = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    const maxV    = rows[0]?.[1] || 1;
    return [{ type: 'dept-table', rows, maxV, label: 'Department' }];
  }

  if (/\bdesignation\b|\brole\b|\bposition\b|\btitle\b|\bpost\b/.test(ql) && !/list|show|who|name/.test(ql)) {
    const counts = groupBy(emp, 'designation');
    const rows   = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    return [{ type: 'simple-table', head: ['Designation', 'Count'], rows }];
  }

  if (/above|below|between|more than|less than|greater than|salary.*range/i.test(ql) &&
      /salary|pay|earn|basic|gross/i.test(ql)) {
    const filters = extractFilters(ql, emp);
    const subset  = applyFilters(emp, filters);
    const field   = detectNumericField(ql);
    if (!subset.length) return [{ type: 'text', text: 'No employees found matching that salary filter.' }];
    const sorted  = [...subset].sort((a, b) => parseFloat(b[field]) - parseFloat(a[field]));
    return [{ type: 'salary-list', rows: sorted, field, label: `${subset.length} employee(s) matching filter` }];
  }

  {
    const codeMatch = ql.match(/(?:emp(?:loyee)?\s*(?:code|id|no|number)?\s*[:#]?\s*)(\w+)\s*$/i);
    if (codeMatch && /detail|info|about|tell|show|get|find|search|who|what/i.test(ql)) {
      const code = codeMatch[1].trim();
      const found = emp.filter(e =>
        (e.empCode || '').toString().toLowerCase() === code.toLowerCase()
      );
      if (found.length) return [{ type: 'emp-detail', emp: found[0] }];
      return [{ type: 'text', text: `No employee found with code **${code}**.` }];
    }
  }

  {
    const tellMatch = ql.match(/(?:tell\s*me\s+)?(?:the\s+)?(.+?)\s+of\s+(.+)/i);
    if (tellMatch) {
      const fieldHint = tellMatch[1].toLowerCase().trim();
      const namePart  = tellMatch[2].toLowerCase().trim()
        .replace(/\b(employee|emp|the|a|an)\b/g, '').trim();
      const nameTerms = namePart.split(/\s+/).filter(t => t.length > 1);

      const isKnownField = /code|id|number|salary|gross|basic|pay|earn|dept|department|designation|role|status|joining|join|doj|category|bank|account/.test(fieldHint);

      if (isKnownField && nameTerms.length > 0) {
        const found = emp.filter(e => {
          const full = getName(e).toLowerCase();
          return nameTerms.every(t => full.includes(t));
        });

        if (found.length === 1) {
          const e = found[0];
          if (/code|id|number|no\b/.test(fieldHint))
            return [{ type: 'text', text: `Employee code of **${getName(e)}** is **${e.empCode || '—'}**.` }];
          if (/gross|salary|pay|earning|ctc/.test(fieldHint))
            return [{ type: 'text', text: `Gross salary of **${getName(e)}** is **${fmt(e.gross)}**.` }];
          if (/basic/.test(fieldHint))
            return [{ type: 'text', text: `Basic salary of **${getName(e)}** is **${fmt(e.basic)}**.` }];
          if (/dept|department|division/.test(fieldHint))
            return [{ type: 'text', text: `Department of **${getName(e)}** is **${e.department || '—'}**.` }];
          if (/designation|role|position|title/.test(fieldHint))
            return [{ type: 'text', text: `Designation of **${getName(e)}** is **${e.designation || '—'}**.` }];
          if (/status/.test(fieldHint))
            return [{ type: 'text', text: `Status of **${getName(e)}** is **${e.status || '—'}**.` }];
          if (/joining|join|doj|date/.test(fieldHint))
            return [{ type: 'text', text: `Joining date of **${getName(e)}** is **${e.joiningDate || '—'}**.` }];
          if (/category|cat/.test(fieldHint))
            return [{ type: 'text', text: `Category of **${getName(e)}** is **${e.category || '—'}**.` }];
          if (/bank|account/.test(fieldHint))
            return [{ type: 'text', text: `Bank account of **${getName(e)}** is **${e.bankAccount || '—'}**.` }];
          return [{ type: 'emp-detail', emp: e }];
        }

        if (found.length > 1)
          return [{ type: 'search-results', results: found.slice(0, 10) }];

        if (found.length === 0 && nameTerms.length > 0)
          return [{ type: 'text', text: `No employee found matching **"${namePart}"**.` }];
      }
    }
  }

  if (/\b(list|show|display|get|give me|tell me|who are|which)\b/.test(ql)) {
    const filters  = extractFilters(ql, emp);
    const subset   = applyFilters(emp, filters);
    const groupKey = detectGroupKey(ql);

    if (groupKey && filters.length) {
      const counts = groupBy(subset, groupKey);
      const rows   = Object.entries(counts).sort((a, b) => b[1] - a[1]);
      const maxV   = rows[0]?.[1] || 1;
      return [{ type: 'dept-table', rows, maxV, label: groupKey.charAt(0).toUpperCase() + groupKey.slice(1) }];
    }

    if (!filters.length && /\b(all|every|each)\b/.test(ql) && !/category|dept|department|designation/.test(ql)) {
      return [{ type: 'emp-list', list: emp.slice(0, 20), cat: 'All', total: emp.length }];
    }

    if (!subset.length) return [{ type: 'text', text: 'No employees found matching your query.' }];

    if (subset.length <= 20) {
      return [{ type: 'emp-list', list: subset, cat: '', total: subset.length }];
    }

    const catCounts = groupBy(subset, 'category');
    const rows = Object.entries(catCounts).sort((a, b) => b[1] - a[1]);
    const maxV = rows[0]?.[1] || 1;
    return [
      { type: 'text', text: `Found **${subset.length}** employees matching your filter:` },
      { type: 'category-bars', rows, total: subset.length, maxV },
    ];
  }

  if (/\b(search|find|look\s*up|lookup|locate|who\s*is|details?\s*of|info\s*(on|about)|about|tell\s*me)\b/.test(ql)) {
    const clean = ql
      .replace(/\b(search|find|look\s*up|locate|who\s*is|details?\s*of|info\s*(on|about)|about|tell\s*me|employee|emp|for|the)\b/g, '')
      .trim();
    const terms = clean.split(/\s+/).filter(t => t.length > 1);

    const codeHit = emp.find(e => terms.some(t => (e.empCode || '').toString().toLowerCase() === t));
    if (codeHit) return [{ type: 'emp-detail', emp: codeHit }];

    const results = emp.filter(e => {
      const haystack = [getName(e), e.empCode || '', e.department || '', e.designation || '', e.category || ''].join(' ').toLowerCase();
      return terms.some(t => haystack.includes(t));
    }).slice(0, 10);

    if (results.length === 1) return [{ type: 'emp-detail', emp: results[0] }];
    return [{ type: 'search-results', results }];
  }

  if (/\b(how many|count|number of|total)\b/.test(ql)) {
    const filters = extractFilters(ql, emp);
    const subset  = applyFilters(emp, filters);
    const groupKey = detectGroupKey(ql);
    if (groupKey) {
      const counts = groupBy(subset, groupKey);
      const rows   = Object.entries(counts).sort((a, b) => b[1] - a[1]);
      const maxV   = rows[0]?.[1] || 1;
      if (groupKey === 'category') return [{ type: 'category-bars', rows, total: subset.length, maxV }];
      return [{ type: 'dept-table', rows, maxV, label: groupKey }];
    }
    const ctx = filters.length ? ' matching your filter' : '';
    return [{ type: 'text', text: `There are **${subset.length}** employees${ctx}.` }];
  }

  for (const cat of ['opjsk', 'sks', 'apprentice', 'h&f']) {
    if (new RegExp(`\\b${cat.replace('&', '\\&')}\\b`, 'i').test(ql)) {
      const list = emp.filter(e => (e.category || '').toLowerCase() === cat);
      if (/list|show|who|name|display/.test(ql)) {
        return [{ type: 'emp-list', list, cat: cat.toUpperCase(), total: list.length }];
      }
      return [{ type: 'text', text: `There are **${list.length}** ${cat.toUpperCase()} employees.` }];
    }
  }

  {
    const allDepts = [...new Set(emp.map(e => (e.department || '')).filter(Boolean))];
    const matched  = allDepts.find(d => ql.includes(d.toLowerCase()));
    if (matched) {
      const list = emp.filter(e => (e.department || '').toLowerCase() === matched.toLowerCase());
      return [{ type: 'emp-list', list, cat: matched, total: list.length }];
    }
  }

  {
    const allDesig = [...new Set(emp.map(e => (e.designation || '')).filter(Boolean))];
    const matched  = allDesig.find(d => d.length > 3 && ql.includes(d.toLowerCase()));
    if (matched) {
      const list = emp.filter(e => (e.designation || '').toLowerCase() === matched.toLowerCase());
      return [{ type: 'emp-list', list, cat: matched, total: list.length }];
    }
  }

  {
    const filters = extractFilters(ql, emp);
    if (filters.length) {
      const subset = applyFilters(emp, filters);
      if (!subset.length) return [{ type: 'text', text: 'No employees found matching your query.' }];
      if (subset.length <= 15) return [{ type: 'emp-list', list: subset, cat: '', total: subset.length }];
      return [{ type: 'text', text: `Found **${subset.length}** employees matching your query.` }];
    }
  }

  return [{
    type: 'text',
    text: "I couldn't find a specific answer for that. Try rephrasing — for example:\n• \"How many employees are in HR?\"\n• \"List active Category A employees\"\n• \"Show salary breakdown by department\"\n• \"Who has the highest salary?\"\n• \"Tell me details of employee code 6001\"\n• \"Tell me salary of employee code 1001\"\n\nType **help** to see all supported queries.",
  }];
}

// ── UI Components ─────────────────────────────────────────────────────────────

function CatTag({ cat }) {
  const style = CAT_TAG_STYLE[cat] || { background: '#f0f0f0', color: '#555' };
  return (
    <span style={{ ...style, fontSize: 11, padding: '2px 7px', borderRadius: 20, display: 'inline-block', marginRight: 4 }}>
      {cat}
    </span>
  );
}

function ColorBar({ val, max, color }) {
  const pct = max > 0 ? Math.round((val / max) * 100) : 0;
  return (
    <div style={{ flex: 1, height: 8, borderRadius: 4, background: '#f0f0f0', overflow: 'hidden' }}>
      <div style={{ width: `${pct}%`, height: '100%', borderRadius: 4, background: color || '#aaa' }} />
    </div>
  );
}

function MsgContent({ blocks }) {
  return (
    <>
      {blocks.map((b, i) => {

        if (b.type === 'text') {
          const parts = b.text.split(/\*\*(.*?)\*\*/g);
          return (
            <p key={i} style={{ margin: '2px 0', whiteSpace: 'pre-line' }}>
              {parts.map((p, j) => j % 2 === 1 ? <strong key={j}>{p}</strong> : p)}
            </p>
          );
        }

        if (b.type === 'category-bars') {
          return (
            <div key={i}>
              {b.rows.map(([cat, cnt]) => (
                <div key={cat} style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '4px 0' }}>
                  <CatTag cat={cat} />
                  <span style={{ fontSize: 13, fontWeight: 500, minWidth: 24 }}>{cnt}</span>
                  <ColorBar val={cnt} max={b.maxV} color={CAT_COLORS[cat]} />
                  <span style={{ fontSize: 12, color: '#888', minWidth: 32 }}>{Math.round((cnt / b.total) * 100)}%</span>
                </div>
              ))}
              <p style={{ fontSize: 12, color: '#888', margin: '6px 0 0' }}>Total: {b.total}</p>
            </div>
          );
        }

        if (b.type === 'dept-table') {
          return (
            <div key={i} style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr>
                    {[b.label || 'Department', 'Count', ''].map(h => (
                      <th key={h} style={{ textAlign: 'left', padding: '3px 6px', color: '#888', fontWeight: 500, borderBottom: '0.5px solid #e0e0e0' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {b.rows.map(([dept, cnt]) => (
                    <tr key={dept}>
                      <td style={{ padding: '4px 6px', borderBottom: '0.5px solid #f0f0f0' }}>{dept}</td>
                      <td style={{ padding: '4px 6px', borderBottom: '0.5px solid #f0f0f0' }}>{cnt}</td>
                      <td style={{ padding: '4px 6px', borderBottom: '0.5px solid #f0f0f0', minWidth: 80 }}>
                        <ColorBar val={cnt} max={b.maxV} color="#4C6EF5" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }

        if (b.type === 'status') {
          return (
            <div key={i}>
              <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
                <div style={{ flex: 1, padding: 10, borderRadius: 8, background: '#e8f5e9', textAlign: 'center' }}>
                  <div style={{ fontSize: 22, fontWeight: 500, color: '#2e7d32' }}>{b.active}</div>
                  <div style={{ fontSize: 12, color: '#2e7d32' }}>Active</div>
                </div>
                <div style={{ flex: 1, padding: 10, borderRadius: 8, background: '#ffebee', textAlign: 'center' }}>
                  <div style={{ fontSize: 22, fontWeight: 500, color: '#c62828' }}>{b.inactive}</div>
                  <div style={{ fontSize: 12, color: '#c62828' }}>Inactive</div>
                </div>
              </div>
              <p style={{ fontSize: 12, color: '#888', margin: '6px 0 0' }}>Retention rate: {b.rate}%</p>
            </div>
          );
        }

        if (b.type === 'simple-table') {
          return (
            <div key={i} style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr>
                    {b.head.map(h => (
                      <th key={h} style={{ textAlign: 'left', padding: '3px 6px', color: '#888', fontWeight: 500, borderBottom: '0.5px solid #e0e0e0' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {b.rows.map(([label, cnt]) => (
                    <tr key={label}>
                      <td style={{ padding: '4px 6px', borderBottom: '0.5px solid #f0f0f0' }}>{label}</td>
                      <td style={{ padding: '4px 6px', borderBottom: '0.5px solid #f0f0f0' }}>{cnt}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }

        if (b.type === 'salary-avg') {
          return (
            <div key={i} style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr>
                    {[b.groupKey || 'Category', 'Avg Gross', 'Avg Basic'].map(h => (
                      <th key={h} style={{ padding: '3px 6px', color: '#888', fontWeight: 500, borderBottom: '0.5px solid #e0e0e0', textAlign: h === (b.groupKey || 'Category') ? 'left' : 'right', textTransform: 'capitalize' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {b.rows.map(([cat, avg]) => (
                    <tr key={cat}>
                      <td style={{ padding: '4px 6px', borderBottom: '0.5px solid #f0f0f0' }}>
                        {b.groupKey === 'category' || !b.groupKey ? <CatTag cat={cat} /> : cat}
                      </td>
                      <td style={{ padding: '4px 6px', borderBottom: '0.5px solid #f0f0f0', textAlign: 'right' }}>{fmt(avg)}</td>
                      <td style={{ padding: '4px 6px', borderBottom: '0.5px solid #f0f0f0', textAlign: 'right' }}>{fmt(b.basicAvgs[cat])}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }

        if (b.type === 'salary-summary') {
          return (
            <div key={i}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 4 }}>
                {[
                  { label: 'Total payroll', val: fmt(b.totalGross) },
                  { label: 'Average gross', val: fmt(b.avgGross)   },
                ].map(({ label, val }) => (
                  <div key={label} style={{ padding: 10, borderRadius: 8, background: '#f5f5f5' }}>
                    <div style={{ fontSize: 11, color: '#888' }}>{label}</div>
                    <div style={{ fontSize: 18, fontWeight: 500 }}>{val}</div>
                  </div>
                ))}
              </div>
              {b.maxEmp && b.maxEmp.empCode && (
                <p style={{ fontSize: 13, color: '#555', margin: '8px 0 0' }}>
                  Highest: <strong>{getName(b.maxEmp)}</strong> at {fmt(b.maxEmp.gross)}<br />
                  {b.minEmp && <>Lowest: <strong>{getName(b.minEmp)}</strong> at {fmt(b.minEmp.gross)}</>}
                </p>
              )}
            </div>
          );
        }

        if (b.type === 'salary-list') {
          return (
            <div key={i}>
              <p style={{ margin: '0 0 6px', fontSize: 13, color: '#555' }}>{b.label}</p>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr>
                      {['Code', 'Name', 'Category', b.field === 'basic' ? 'Basic' : 'Gross'].map(h => (
                        <th key={h} style={{ textAlign: 'left', padding: '3px 6px', color: '#888', fontWeight: 500, borderBottom: '0.5px solid #e0e0e0' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {b.rows.slice(0, 15).map(e => (
                      <tr key={e.empCode}>
                        <td style={{ padding: '4px 6px', fontSize: 12, borderBottom: '0.5px solid #f0f0f0' }}>{e.empCode}</td>
                        <td style={{ padding: '4px 6px', borderBottom: '0.5px solid #f0f0f0' }}>{getName(e)}</td>
                        <td style={{ padding: '4px 6px', borderBottom: '0.5px solid #f0f0f0' }}><CatTag cat={e.category} /></td>
                        <td style={{ padding: '4px 6px', borderBottom: '0.5px solid #f0f0f0', textAlign: 'right' }}>{fmt(e[b.field])}</td>
                      </tr>
                    ))}
                    {b.rows.length > 15 && (
                      <tr><td colSpan={4} style={{ padding: '4px 6px', color: '#888', fontSize: 12 }}>… and {b.rows.length - 15} more</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          );
        }

        if (b.type === 'top-earners') {
          return (
            <div key={i}>
              <p style={{ margin: '0 0 6px', fontSize: 13, color: '#555' }}>{b.label}</p>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr>
                      {['#', 'Name', 'Category', 'Dept', b.field === 'basic' ? 'Basic' : 'Gross'].map(h => (
                        <th key={h} style={{ textAlign: 'left', padding: '3px 6px', color: '#888', fontWeight: 500, borderBottom: '0.5px solid #e0e0e0' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {b.rows.map((e, idx) => (
                      <tr key={e.empCode}>
                        <td style={{ padding: '4px 6px', fontSize: 12, color: '#aaa', borderBottom: '0.5px solid #f0f0f0' }}>{idx + 1}</td>
                        <td style={{ padding: '4px 6px', borderBottom: '0.5px solid #f0f0f0' }}>{getName(e)}</td>
                        <td style={{ padding: '4px 6px', borderBottom: '0.5px solid #f0f0f0' }}><CatTag cat={e.category} /></td>
                        <td style={{ padding: '4px 6px', borderBottom: '0.5px solid #f0f0f0' }}>{e.department || '—'}</td>
                        <td style={{ padding: '4px 6px', borderBottom: '0.5px solid #f0f0f0', textAlign: 'right', fontWeight: 500 }}>{fmt(e[b.field])}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          );
        }

        if (b.type === 'joiners') {
          return (
            <div key={i}>
              {b.label && <p style={{ margin: '0 0 4px', fontSize: 13, color: '#555' }}>{b.label}</p>}
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr>
                      {['Name', 'Category', 'Dept', 'Joined'].map(h => (
                        <th key={h} style={{ textAlign: 'left', padding: '3px 6px', color: '#888', fontWeight: 500, borderBottom: '0.5px solid #e0e0e0' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {b.rows.map(e => (
                      <tr key={e.empCode}>
                        <td style={{ padding: '4px 6px', borderBottom: '0.5px solid #f0f0f0' }}>{getName(e)}</td>
                        <td style={{ padding: '4px 6px', borderBottom: '0.5px solid #f0f0f0' }}><CatTag cat={e.category} /></td>
                        <td style={{ padding: '4px 6px', borderBottom: '0.5px solid #f0f0f0' }}>{e.department || '—'}</td>
                        <td style={{ padding: '4px 6px', borderBottom: '0.5px solid #f0f0f0' }}>{e.joiningDate}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          );
        }

        if (b.type === 'emp-list') {
          const { list, cat, total } = b;
          return (
            <div key={i}>
              <p style={{ margin: '0 0 6px', fontSize: 13 }}>
                {total} {cat ? `${cat} ` : ''}employee{total !== 1 ? 's' : ''}
              </p>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr>
                      {['Code', 'Name', 'Dept', 'Category', 'Status'].map(h => (
                        <th key={h} style={{ textAlign: 'left', padding: '3px 6px', color: '#888', fontWeight: 500, borderBottom: '0.5px solid #e0e0e0' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {list.slice(0, 15).map(e => (
                      <tr key={e.empCode}>
                        <td style={{ padding: '4px 6px', fontSize: 12, borderBottom: '0.5px solid #f0f0f0' }}>{e.empCode}</td>
                        <td style={{ padding: '4px 6px', borderBottom: '0.5px solid #f0f0f0' }}>{getName(e)}</td>
                        <td style={{ padding: '4px 6px', borderBottom: '0.5px solid #f0f0f0' }}>{e.department || '—'}</td>
                        <td style={{ padding: '4px 6px', borderBottom: '0.5px solid #f0f0f0' }}><CatTag cat={e.category} /></td>
                        <td style={{ padding: '4px 6px', borderBottom: '0.5px solid #f0f0f0' }}>
                          <span style={{ color: (e.status || '').toLowerCase() === 'active' ? '#2e7d32' : '#c62828', fontWeight: 500 }}>
                            ● {e.status || '—'}
                          </span>
                        </td>
                      </tr>
                    ))}
                    {list.length > 15 && (
                      <tr>
                        <td colSpan={5} style={{ padding: '4px 6px', color: '#888', fontSize: 12 }}>… and {list.length - 15} more</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          );
        }

        if (b.type === 'search-results') {
          if (!b.results.length)
            return <p key={i} style={{ margin: 0, fontSize: 13 }}>No employees found matching that search.</p>;
          return (
            <div key={i} style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr>
                    {['Code', 'Name', 'Dept', 'Category', 'Designation'].map(h => (
                      <th key={h} style={{ textAlign: 'left', padding: '3px 6px', color: '#888', fontWeight: 500, borderBottom: '0.5px solid #e0e0e0' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {b.results.map(e => (
                    <tr key={e.empCode}>
                      <td style={{ padding: '4px 6px', fontSize: 12, borderBottom: '0.5px solid #f0f0f0' }}>{e.empCode}</td>
                      <td style={{ padding: '4px 6px', borderBottom: '0.5px solid #f0f0f0' }}>{getName(e)}</td>
                      <td style={{ padding: '4px 6px', borderBottom: '0.5px solid #f0f0f0' }}>{e.department || '—'}</td>
                      <td style={{ padding: '4px 6px', borderBottom: '0.5px solid #f0f0f0' }}><CatTag cat={e.category} /></td>
                      <td style={{ padding: '4px 6px', borderBottom: '0.5px solid #f0f0f0' }}>{e.designation || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }

        if (b.type === 'overview') {
          return (
            <div key={i}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                {[
                  { label: 'Total employees', val: b.total,      color: '#1e3a5f' },
                  { label: 'Active',          val: b.active,     color: '#2e7d32' },
                  { label: 'Departments',     val: b.deptCount,  color: '#1e3a5f' },
                  { label: 'Designations',    val: b.desigCount, color: '#1e3a5f' },
                ].map(({ label, val, color }) => (
                  <div key={label} style={{ padding: 10, borderRadius: 8, background: '#f5f5f5' }}>
                    <div style={{ fontSize: 11, color: '#888' }}>{label}</div>
                    <div style={{ fontSize: 20, fontWeight: 500, color }}>{val}</div>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 8 }}>
                {Object.entries(b.catCounts).map(([cat, cnt]) => (
                  <span key={cat} style={{ marginRight: 8, fontSize: 13 }}>
                    <CatTag cat={cat} /> <span style={{ color: '#555' }}>{cnt}</span>
                  </span>
                ))}
              </div>
            </div>
          );
        }

        if (b.type === 'emp-detail') {
          const e = b.emp;
          const fields = [
            ['Emp Code',     e.empCode],
            ['Name',         getName(e)],
            ['Department',   e.department],
            ['Designation',  e.designation],
            ['Category',     null],
            ['Status',       e.status],
            ['Joining Date', e.joiningDate],
            ['Basic',        e.basic  ? fmt(e.basic)  : null],
            ['Gross',        e.gross  ? fmt(e.gross)  : null],
            ['Bank Account', e.bankAccount],
          ];
          return (
            <div key={i} style={{ fontSize: 13 }}>
              <div style={{
                fontWeight: 600,
                fontSize: 14,
                marginBottom: 8,
                paddingBottom: 6,
                borderBottom: '0.5px solid #e0e0e0',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}>
                <span style={{
                  width: 32, height: 32, borderRadius: '50%',
                  background: '#1e3a5f', color: 'white',
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 13, fontWeight: 700, flexShrink: 0,
                }}>
                  {getName(e).charAt(0).toUpperCase()}
                </span>
                {getName(e)}
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <tbody>
                  {fields.map(([label, val]) => {
                    if (!val && label !== 'Category') return null;
                    return (
                      <tr key={label}>
                        <td style={{ padding: '4px 0', color: '#888', width: '45%', verticalAlign: 'top', fontSize: 12 }}>
                          {label}
                        </td>
                        <td style={{ padding: '4px 0', fontWeight: 500 }}>
                          {label === 'Category'
                            ? <CatTag cat={e.category} />
                            : label === 'Status'
                              ? <span style={{ color: (val || '').toLowerCase() === 'active' ? '#2e7d32' : '#c62828', fontWeight: 600 }}>● {val}</span>
                              : val}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          );
        }

        return null;
      })}
    </>
  );
}

// ── Suggestion chips ──────────────────────────────────────────────────────────
const CHIPS = [
  'Total employees',
  'Show count by category',
  'Show count by department',
  'Active vs inactive',
  'List all designations',
  'Show average salary by category',
  'Who has the highest salary?',
  'Show top 10 earners',
  'List employees with salary above 50000',
  'Who joined most recently?',
  'Show OPJSK employees',
  'Overview',
];

// ── Main chatbot component ────────────────────────────────────────────────────
const PayrollChatbot = () => {
  const [open, setOpen]         = useState(false);
  const [input, setInput]       = useState('');
  const [messages, setMessages] = useState([
    {
      from: 'bot',
      blocks: [{ type: 'text', text: "Hi! I'm your Payroll Assistant. Ask me anything about employees — counts, salaries, departments, designations, active status, joining dates, and more.\n\nTry typing something like:\n• \"How many active employees are in HR?\"\n• \"Who has the highest salary?\"\n• \"List all Category A employees\"\n• \"Tell me details of employee code 6001\"\n• \"Tell me salary of employee code 1001\"\n\nOr tap a suggestion below, or type **help**." }],
    },
  ]);
  const [empData, setEmpData]   = useState([]);
  const [status, setStatus]     = useState('loading');
  const messagesEndRef = useRef(null);

  useEffect(() => {
    axios.get(`${BASE_URL}/api/employees`)
      .then(res => {
        if (res.data.success === true) {
          const employees = res.data.data || res.data.employees || [];
          setEmpData(employees);
          setStatus('ok');
        } else {
          console.error('API error:', res.data.error);
          setStatus('error');
        }
      })
      .catch(err => {
        console.error('Request failed:', err);
        setStatus('error');
      });
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, open]);

  const send = (text) => {
    const q = (text || input).trim();
    if (!q) return;
    setInput('');
    setMessages(prev => [...prev, { from: 'user', blocks: [{ type: 'text', text: q }] }]);
    setTimeout(() => {
      const blocks = respond(q, empData);
      setMessages(prev => [...prev, { from: 'bot', blocks }]);
    }, 150);
  };

  const btnStyle = {
    position: 'fixed', bottom: 24, right: 24, zIndex: 9999,
    width: 52, height: 52, borderRadius: '50%',
    background: '#1e3a5f', color: 'white',
    border: 'none', cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 22, boxShadow: '0 4px 16px rgba(0,0,0,0.18)',
  };

  const windowStyle = {
    position: 'fixed', bottom: 88, right: 24, zIndex: 9998,
    width: 370, height: 520,
    background: '#fff', borderRadius: 14,
    border: '0.5px solid #e0e0e0',
    boxShadow: '0 8px 32px rgba(0,0,0,0.14)',
    display: open ? 'flex' : 'none',
    flexDirection: 'column', overflow: 'hidden',
    fontFamily: "'Segoe UI', system-ui, sans-serif",
  };

  return (
    <>
      <div style={windowStyle}>

        {/* ── Header with logo ── */}
        <div style={{
          padding: '12px 16px',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          background: '#1e3a5f',
          color: 'white',
          flexShrink: 0,
        }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600 }}>Payroll Assistant</div>
            <div style={{ fontSize: 11, opacity: 0.75 }}>
              {status === 'loading' && 'Loading data…'}
              {status === 'ok'      && `${empData.length} employees loaded`}
              {status === 'error'   && 'Could not load live data'}
            </div>
          </div>
          <button
            onClick={() => setOpen(false)}
            style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'white', fontSize: 20, cursor: 'pointer', lineHeight: 1 }}
            aria-label="Close chat"
          >
            ×
          </button>
        </div>

        {/* Messages */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {messages.map((msg, idx) => (
            <div key={idx} style={{
              alignSelf: msg.from === 'user' ? 'flex-end' : 'flex-start',
              maxWidth: '90%',
              padding: '9px 13px',
              borderRadius: msg.from === 'user' ? '14px 14px 4px 14px' : '14px 14px 14px 4px',
              background: msg.from === 'user' ? '#1e3a5f' : '#f5f6fa',
              color: msg.from === 'user' ? 'white' : '#1a1a2e',
              fontSize: 13, lineHeight: 1.55,
            }}>
              <MsgContent blocks={msg.blocks} />
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        {/* Chips */}
        <div style={{ padding: '6px 10px', display: 'flex', flexWrap: 'wrap', gap: 5, borderTop: '0.5px solid #e8e8e8', flexShrink: 0, overflowY: 'auto', maxHeight: 80 }}>
          {CHIPS.map(chip => (
            <button key={chip} onClick={() => send(chip)} style={{ fontSize: 11, padding: '3px 9px', borderRadius: 20, border: '0.5px solid #d0d0d0', background: 'white', color: '#555', cursor: 'pointer', whiteSpace: 'nowrap' }}>
              {chip}
            </button>
          ))}
        </div>

        {/* Input */}
        <div style={{ display: 'flex', gap: 8, padding: '10px 12px', borderTop: '0.5px solid #e8e8e8', flexShrink: 0 }}>
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && send()}
            placeholder="Ask anything about employees…"
            style={{ flex: 1, fontSize: 13, padding: '7px 11px', border: '0.5px solid #d0d0d0', borderRadius: 8, outline: 'none' }}
          />
          <button onClick={() => send()} style={{ padding: '7px 14px', background: '#1e3a5f', color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 14 }}>➤</button>
        </div>
      </div>

      {/* Floating button */}
      <button style={btnStyle} onClick={() => setOpen(o => !o)} aria-label="Toggle HR chatbot">
        {open ? '×' : '💬'}
      </button>
    </>
  );
};

export default PayrollChatbot;