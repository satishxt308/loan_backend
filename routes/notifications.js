// backend/routes/notifications.js
const express = require("express");
const router = express.Router();
const pool = require("../db/db");

router.get("/:userId", async (req, res) => {
  const { userId } = req.params;

  try {
    const result = await pool.query(
      `
      SELECT 
        id,
        title,
        message,
        is_read,
        created_at
      FROM notifications
      WHERE user_id = $1
      ORDER BY created_at DESC
      `,
      [userId]
    );

    res.json({
      success: true,
      notifications: result.rows,
    });
  } catch (error) {
    console.error("Fetch notifications error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to fetch notifications",
    });
  }
});


// PUT /api/notifications/read-all/:userId
router.put("/read-all/:userId", async (req, res) => {
  const { userId } = req.params;

  await pool.query(
    "UPDATE notifications SET is_read = true WHERE user_id = $1",
    [userId]
  );

  res.json({ success: true });
});

// GET /api/notifications/unread-count/:userId
router.get("/unread-count/:userId", async (req, res) => {
  const { userId } = req.params;

  const result = await pool.query(
    "SELECT COUNT(*) FROM notifications WHERE user_id = $1 AND is_read = false",
    [userId]
  );

  res.json({
    success: true,
    count: parseInt(result.rows[0].count),
  });
});


module.exports = router;
