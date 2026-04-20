const express = require("express");
const router = express.Router();
const pool = require("../db/db");

// GET all
router.get("/", async (req, res) => {
  const result = await pool.query("SELECT * FROM video_types ORDER BY id DESC");
  res.json(result.rows);
});

// CREATE
router.post("/", async (req, res) => {
  const { name } = req.body;
  const result = await pool.query(
    "INSERT INTO video_types (name) VALUES ($1) RETURNING *",
    [name]
  );
  res.json(result.rows[0]);
});

// UPDATE
router.put("/:id", async (req, res) => {
  const { name } = req.body;
  await pool.query(
    "UPDATE video_types SET name=$1 WHERE id=$2",
    [name, req.params.id]
  );
  res.json({ success: true });
});

// DELETE
router.delete("/:id", async (req, res) => {
  await pool.query("DELETE FROM video_types WHERE id=$1", [req.params.id]);
  res.json({ success: true });
});

module.exports = router;