const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host:     process.env.DB_HOST     || 'localhost',
  user:     process.env.DB_USER     || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME     || 'payroll_managemnet',
  port:     process.env.DB_PORT     || 3306,
  waitForConnections: true,
  connectionLimit:    10,
  queueLimit:         0,
});

// Test connection on startup
pool.getConnection()
  .then(conn => {
    console.log('✅ MySQL Connected...');
    conn.release();
  })
  .catch(err => {
    console.error('❌ Database connection failed:', err);
  });

module.exports = pool;