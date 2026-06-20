const pool = require('./db/db');

async function main() {
  try {
    const colRes = await pool.query(
      "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'date_of_birth'"
    );
    console.log("=== Column Data Type ===");
    console.log(colRes.rows);

    const userRes = await pool.query(
      "SELECT id, full_name, date_of_birth FROM users ORDER BY id ASC LIMIT 5"
    );
    console.log("\n=== Users Sample Data ===");
    console.log(userRes.rows);

  } catch (err) {
    console.error("Error executing query:", err);
  } finally {
    await pool.end();
  }
}

main();
