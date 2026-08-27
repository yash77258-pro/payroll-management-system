const connection = require('../db');

// Add salary-related columns to employee_details table
const addSalaryColumns = `
  ALTER TABLE employee_details
  ADD COLUMN \`Gross\` DECIMAL(12, 2) DEFAULT 0.00,
  ADD COLUMN \`Basic\` DECIMAL(12, 2) DEFAULT 0.00,
  ADD COLUMN \`CEA\` DECIMAL(12, 2) DEFAULT 0.00,
  ADD COLUMN \`CHA\` DECIMAL(12, 2) DEFAULT 0.00,
  ADD COLUMN \`HRA\` DECIMAL(12, 2) DEFAULT 0.00,
  ADD COLUMN \`SPA\` DECIMAL(12, 2) DEFAULT 0.00,
  ADD COLUMN \`UMA\` DECIMAL(12, 2) DEFAULT 0.00;
`;

// Run the migration
connection.query(addSalaryColumns, (err) => {
  if (err) {
    console.error('Error adding salary columns:', err);
    process.exit(1);
  }
  
  console.log('Salary columns added successfully');
  connection.end();
});
