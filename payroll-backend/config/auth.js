require('dotenv').config();

module.exports = {
  jwt: {
    secret: process.env.JWT_SECRET || 'your_jwt_secret_key_here', // Change this to a strong secret in production
    expiresIn: '24h', // Token expiration time
  },
  bcrypt: {
    saltRounds: 10,
  },
};
