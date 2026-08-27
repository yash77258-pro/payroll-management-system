import React, { useState } from 'react';
import { NavLink } from 'react-router-dom';

const Sidebar = () => {
  const [isHovered, setIsHovered] = useState(false);
  const navLinkClass = ({ isActive }) => 
    `nav-link ${isActive ? 'active' : ''}`;

  return (
    <nav 
      className={`sidebar ${isHovered ? 'open' : ''}`} 
      id="sidebar"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <ul>
        <li>
          <NavLink to="/" className={navLinkClass}>
            <i className="fas fa-tachometer-alt"></i>
            <span>Dashboard</span>
          </NavLink>
        </li>
        <li>
          <NavLink to="/employees" className={navLinkClass}>
            <i className="fas fa-users"></i>
            <span>Employee Management</span>
          </NavLink>
        </li>
        <li>
          <NavLink to="/payroll" className={navLinkClass}>
            <i className="fas fa-calculator"></i>
            <span>Payroll Calculation</span>
          </NavLink>
        </li>
        <li>
          <NavLink to="/reports" className={navLinkClass}>
            <i className="fas fa-chart-bar"></i>
            <span>Reports</span>
          </NavLink>
        </li>
      </ul>
    </nav>
  );
};

export default Sidebar;
