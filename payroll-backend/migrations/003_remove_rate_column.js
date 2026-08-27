const connection = require('../db');

// First, check if the column exists
const checkColumnExists = `
  SELECT COUNT(*) as column_exists 
  FROM INFORMATION_SCHEMA.COLUMNS 
  WHERE TABLE_SCHEMA = DATABASE() 
  AND TABLE_NAME = 'employee_details' 
  AND COLUMN_NAME = 'Rates';
`;

// Remove rate column from employee_details table
const removeRateColumn = `
  ALTER TABLE employee_details
  DROP COLUMN \`Rates\`;
`;

// Run the migration
connection.query(checkColumnExists, (err, results) => {
  if (err) {
    console.error('Error checking if column exists:', err);
    return connection.end();
  }

  const columnExists = results[0].column_exists > 0;
  
  if (!columnExists) {
    console.log('Rates column does not exist, nothing to remove');
    return connection.end();
  }

  // If we get here, the column exists and we can drop it
  connection.query(removeRateColumn, (err) => {
    if (err) {
      console.error('Error removing rate column:', err);
      return connection.end();
    }
    
    console.log('Rate column removed successfully');
    connection.end();
  });
});
