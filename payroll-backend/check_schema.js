const connection = require('./db');

connection.query('DESCRIBE employee_details', (err, results) => {
  if (err) {
    console.error('Error:', err);
  } else {
    console.log('Table schema:');
    console.log(results);
  }
  connection.end();
});
