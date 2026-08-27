import React, { useState, useRef, useEffect } from 'react';
import axios from 'axios';
import Logo from '../Logo';

const BASE_URL = process.env.REACT_APP_API_BASE_URL || 'http://localhost:5000';

// ── Same auth pattern used in Reports.jsx, kept consistent ──────────────────
const getLoggedInUser = () => {
  try {
    const raw = localStorage.getItem('user');
    if (!raw) return null;
    const user = JSON.parse(raw);
    return {
      name: user.name || user.username || user.email || 'User',
      role: user.role || 'admin',
      email: user.email || '',
    };
  } catch {
    return null;
  }
};

const ROLE_LABELS = {
  admin: 'Administrator',
  plant: 'Plant User',
  school: 'School User',
};

const Header = () => {
  const [menuOpen, setMenuOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const menuRef = useRef(null);
  const user = getLoggedInUser();

  // Close the dropdown when clicking outside it
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      // Best-effort server-side logout (invalidate token/session if your API supports it)
      const token = localStorage.getItem('token');
      await axios.post(
        `${BASE_URL}/api/auth/logout`,
        {},
        token ? { headers: { Authorization: `Bearer ${token}` } } : undefined
      );
    } catch (err) {
      // Non-fatal — still clear local session and redirect even if the API call fails
      console.warn('Logout API call failed, continuing with local logout:', err.message);
    } finally {
      localStorage.removeItem('user');
      localStorage.removeItem('token');
      window.location.href = '/login';
    }
  };

  return (
    <header className="app-header">
      <div className="app-header-left">
        <Logo width={34} height={34} />
        <span className="app-header-title">Payroll Management System</span>
      </div>

      {user && (
        <div className="app-header-right" ref={menuRef}>
          <button
            className="app-header-user-btn"
            onClick={() => setMenuOpen(o => !o)}
            aria-haspopup="true"
            aria-expanded={menuOpen}
          >
            <span className="app-header-avatar">{user.name.charAt(0).toUpperCase()}</span>
            <span className="app-header-username">{user.name}</span>
            <span className={`app-header-chevron ${menuOpen ? 'open' : ''}`}>▾</span>
          </button>

          {menuOpen && (
            <div className="app-header-dropdown">
              <div className="app-header-dropdown-info">
                <div className="app-header-dropdown-name">{user.name}</div>
                {user.email && <div className="app-header-dropdown-email">{user.email}</div>}
                <div className="app-header-dropdown-role">{ROLE_LABELS[user.role] || user.role}</div>
              </div>
              <button className="app-header-logout-btn" onClick={handleLogout} disabled={loggingOut}>
                {loggingOut ? 'Logging out…' : 'Log out'}
              </button>
            </div>
          )}
        </div>
      )}

      <style jsx="true">{`
        .app-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 10px 24px;
          background: #1e3a5f;
          color: #ffffff;
          box-shadow: 0 2px 8px rgba(0,0,0,0.12);
          position: sticky;
          top: 0;
          z-index: 1000;
        }
        .app-header-left {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .app-header-title {
          font-size: 16px;
          font-weight: 600;
          letter-spacing: 0.2px;
        }
        .app-header-right {
          position: relative;
        }
        .app-header-user-btn {
          display: flex;
          align-items: center;
          gap: 8px;
          background: rgba(255,255,255,0.08);
          border: none;
          color: #ffffff;
          padding: 6px 12px;
          border-radius: 20px;
          cursor: pointer;
          font-size: 13px;
          transition: background 0.15s;
        }
        .app-header-user-btn:hover {
          background: rgba(255,255,255,0.16);
        }
        .app-header-avatar {
          width: 26px;
          height: 26px;
          border-radius: 50%;
          background: #ffffff;
          color: #1e3a5f;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          font-weight: 700;
          font-size: 12px;
          flex-shrink: 0;
        }
        .app-header-username {
          max-width: 140px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .app-header-chevron {
          font-size: 11px;
          transition: transform 0.15s;
        }
        .app-header-chevron.open {
          transform: rotate(180deg);
        }
        .app-header-dropdown {
          position: absolute;
          right: 0;
          top: calc(100% + 8px);
          background: #ffffff;
          color: #1a1a2e;
          border-radius: 10px;
          box-shadow: 0 8px 24px rgba(0,0,0,0.18);
          width: 220px;
          overflow: hidden;
          animation: dropdownEnter 0.15s ease-out;
        }
        @keyframes dropdownEnter {
          from { opacity: 0; transform: translateY(-4px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .app-header-dropdown-info {
          padding: 14px 16px;
          border-bottom: 1px solid #f0f0f0;
        }
        .app-header-dropdown-name {
          font-weight: 600;
          font-size: 14px;
        }
        .app-header-dropdown-email {
          font-size: 12px;
          color: #888;
          margin-top: 2px;
          word-break: break-all;
        }
        .app-header-dropdown-role {
          font-size: 11px;
          color: #1971c2;
          margin-top: 6px;
          font-weight: 500;
          text-transform: uppercase;
          letter-spacing: 0.4px;
        }
        .app-header-logout-btn {
          width: 100%;
          padding: 11px 16px;
          background: none;
          border: none;
          text-align: left;
          font-size: 13px;
          color: #c62828;
          cursor: pointer;
          font-weight: 500;
          transition: background 0.15s;
        }
        .app-header-logout-btn:hover:not(:disabled) {
          background: #fff5f5;
        }
        .app-header-logout-btn:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
      `}</style>
    </header>
  );
};

export default Header;