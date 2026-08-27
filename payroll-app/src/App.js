import React from 'react';
import { Routes, Route, useLocation, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import './App.css';
import './styles/main.css';
import Header from './components/layout/Header';
import Sidebar from './components/layout/Sidebar';
import Dashboard from './components/pages/Dashboard';
import Employees from './components/pages/Employees';
import Payroll from './components/pages/Payroll';
import Reports from './components/pages/Reports';
import Login from './components/auth/Login';
import ProtectedRoute from './components/auth/ProtectedRoute';
import PayrollChatbot from './components/pages/PayrollChatbot';

const AppContent = () => {
  const { user } = useAuth();
  const location = useLocation();

  // If on login page and already logged in, redirect to dashboard
  if (location.pathname === '/login' && user) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="App">
      {user && <Header />}
      <div className="container">
        {user && <Sidebar />}
        <main className={`main-content ${!user ? 'auth-content' : ''}`} id="main-content">
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route element={<ProtectedRoute />}>
              <Route path="/" element={<Dashboard />} />
              <Route path="/employees" element={<Employees />} />
              <Route path="/payroll" element={<Payroll />} />
              <Route path="/reports" element={<Reports />} />
            </Route>
            <Route path="*" element={<Navigate to={user ? "/" : "/login"} replace />} />
          </Routes>
        </main>
      </div>

      {/* PayBot — floats over all pages, only visible when logged in */}
      <PayrollChatbot />
    </div>
  );
};

function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}

export default App;