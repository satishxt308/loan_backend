const express = require("express");
const router = express.Router();
const multer = require("multer");
const pool = require("../db/db");

// routes/notify.js
router.post("/notify", async (req, res) => {
  try {
    const { user_id, schema_id } = req.body;

    const result = await pool.query(
      `
      INSERT INTO notify_requests (user_id, schema_id, created_at, updated_at)
      VALUES ($1, $2, NOW(), NOW())
      ON CONFLICT (user_id, schema_id)
      DO UPDATE SET updated_at = NOW()
      RETURNING *
      `,
      [user_id, schema_id]
    );

    res.json({
      success: true,
      message: "Notification request saved",
      data: result.rows[0]
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to save notify request" });
  }
});

// GET all notify requests with user + scheme info
router.get("/notify", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        nr.id,
        nr.user_id,
        u.full_name AS user_name,
        nr.schema_id,
        s.schema_name,
        nr.created_at,
        nr.updated_at
      FROM notify_requests nr
      JOIN users u ON u.id = nr.user_id
      JOIN schemes s ON s.id = nr.schema_id
      ORDER BY nr.id DESC
    `);

    res.json({
      success: true,
      count: result.rows.length,
      data: result.rows,
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch notify requests" });
  }
});

router.get("/notify/:user_id", async (req, res) => {
  const { user_id } = req.params;

  const result = await pool.query(`
    SELECT 
      nr.id,
      u.full_name,
      s.schema_name,
      nr.created_at,
      nr.updated_at
    FROM notify_requests nr
    JOIN users u ON u.id = nr.user_id
    JOIN schemes s ON s.id = nr.schema_id
    WHERE nr.user_id = $1
  `, [user_id]);

  res.json(result.rows);
});
module.exports = router;