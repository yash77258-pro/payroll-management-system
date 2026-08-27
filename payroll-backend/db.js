const mysql = require('mysql2/promise');
require('dotenv').config();

// Create MySQL Connection Pool
const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// Test Database Connection
(async () => {
    try {
        const connection = await pool.getConnection();

        console.log('✅ MySQL Connected Successfully');

        connection.release();
    } catch (error) {
        console.error('❌ Database Connection Failed:', error.message);
    }
})();

module.exports = pool;