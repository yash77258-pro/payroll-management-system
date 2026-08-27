const connection = require('../db');

// Create users table
const createUsersTable = `
  CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role ENUM('admin', 'user') DEFAULT 'user',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`;

// Create an admin user (you should change this password in production)
const createAdminUser = `
  INSERT IGNORE INTO users (name, email, password_hash, role) 
  VALUES (
    'Admin User', 
    'admin@jindalpower.com', 
    '$2a$10$XFD9Q1z5NQ9Cqk3vL5mX7u9X9X9X9X9X9X9X9X9X9X9X9X9X9X9X9', -- hashed '1111111111'
    'admin'
  );
`;

// Run the migration
connection.query(createUsersTable, (err) => {
  if (err) {
    console.error('Error creating users table:', err);
    process.exit(1);
  }
  
  console.log('Users table created successfully');
  
  // Create admin user
  connection.query(createAdminUser, (err) => {
    if (err) {
      console.error('Error creating admin user:', err);
      process.exit(1);
    }
    
    console.log('Admin user created successfully');
    connection.end();
  });
});
