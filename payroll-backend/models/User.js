const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../db');  // your promise pool (mysql2/promise)
const { jwt: jwtConfig } = require('../config/auth');

class User {
  // Find user by email
  static async findByEmail(email) {
    try {
      console.log('Searching for user with email:', email);
      const [rows] = await pool.query('SELECT * FROM users WHERE email = ?', [email]);
      console.log('User found:', rows[0] ? 'Yes' : 'No');
      return rows[0] || null;
    } catch (err) {
      console.error('Database error in findByEmail:', err);
      throw err;
    }
  }

  // Create new user
  static async create({ name, email, password, role = 'user' }) {
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    try {
      const [result] = await pool.query(
        'INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)',
        [name, email, passwordHash, role]
      );
      return { id: result.insertId, name, email, role };
    } catch (err) {
      console.error('Create user error:', err);
      throw err;
    }
  }

  // Validate password
  static async validatePassword(candidatePassword, hashedPassword) {
    console.log('Validating password...');
    if (!candidatePassword || !hashedPassword) {
      console.error('Missing password or hash for validation');
      return false;
    }
    const isMatch = await bcrypt.compare(candidatePassword, hashedPassword);
    console.log('Password validation result:', isMatch ? 'Match' : 'No match');
    return isMatch;
  }

  // Generate JWT token
  static generateToken(user) {
    const payload = {
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        name: user.name,
      },
    };
    return jwt.sign(payload, jwtConfig.secret, { expiresIn: jwtConfig.expiresIn });
  }
}

module.exports = User;