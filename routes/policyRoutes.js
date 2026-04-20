// Your backend route (make sure it's not escaping HTML)
const express = require("express");
const pool = require("../db/db");

const router = express.Router();

// ✅ GET all policies
router.get("/", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM policies ORDER BY id ASC");
    // Send as-is without any escaping
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ✅ UPDATE policy
router.put("/:id", async (req, res) => {
  const { id } = req.params;
  const { title, content, updated_at } = req.body;

  try {
    // Store the HTML content exactly as received
    const result = await pool.query(
      `UPDATE policies 
       SET title=$1, content=$2, updated_at=NOW() 
       WHERE id=$3 RETURNING *`,
      [title, content, id]
    );

    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;