const pool = require('./db/db');

async function main() {
  try {
    const tables = ['users', 'applications', 'guardians', 'payments'];
    for (const table of tables) {
      const colRes = await pool.query(
        "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = $1",
        [table]
      );
      console.log(`=== ${table} Columns ===`);
      console.log(colRes.rows.map(r => `${r.column_name} (${r.data_type})`));
    }
  } catch (err) {
    console.error("Error executing query:", err);
  } finally {
    await pool.end();
  }
}

main();
