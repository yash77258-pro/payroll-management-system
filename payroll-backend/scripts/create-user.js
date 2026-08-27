const path = require('path');
const dotenv = require('dotenv');

// Load environment variables from the parent directory
const envPath = path.resolve(__dirname, '..', '.env');
console.log(`Loading .env from: ${envPath}`);
dotenv.config({ path: envPath });

// Debug: Log the database configuration
console.log('Database Configuration:', {
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  database: process.env.DB_NAME,
  hasPassword: !!process.env.DB_PASSWORD
});

const readline = require('readline');
const User = require('../models/User');
const db = require('../db');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const prompt = (query) => new Promise((resolve) => rl.question(query, resolve));

async function createUser() {
  try {
    console.log('\n=== Create New User ===');
    
    // Get user input
    const name = await prompt('Name: ');
    const email = await prompt('Email: ');
    const password = await prompt('Password (min 8 characters): ');
    const role = (await prompt('Role (admin/user) [user]: ')).toLowerCase() || 'user';

    // Validate role
    if (!['admin', 'user'].includes(role)) {
      throw new Error('Role must be either "admin" or "user"');
    }

    // Validate password length
    if (password.length < 8) {
      throw new Error('Password must be at least 8 characters long');
    }

    // Check if user already exists
    const existingUser = await User.findByEmail(email);
    if (existingUser) {
      throw new Error('User with this email already exists');
    }

    // Create the user
    const user = await User.create({
      name,
      email,
      password,
      role
    });

    console.log('\n✅ User created successfully!');
    console.log('ID:', user.id);
    console.log('Name:', user.name);
    console.log('Email:', user.email);
    console.log('Role:', user.role);

  } catch (error) {
    console.error('\n❌ Error:', error.message);
  } finally {
    rl.close();
    // Close the database connection
    db.end((err) => {
      if (err) console.error('Error closing database connection:', err);
      process.exit(0);
    });
  }
}

// Start the script
createUser();
