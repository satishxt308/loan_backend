const express = require("express");
const router = express.Router();
const db = require("../db/db");

// ✅ GET APPLICATION BY STUDENT ID
router.get("/get-application-by-student/:studentId", async (req, res) => {
  try {
    const { studentId } = req.params;

    const result = await db.query(
      `SELECT * FROM applications WHERE user_id = $1`,
      [studentId]
    );

    if (result.rows.length === 0) {
      return res.json({
        success: true,
        exists: false,
        data: null,
      });
    }

    res.json({
      success: true,
      exists: true,
      data: result.rows[0],
    });
  } catch (error) {
    console.error("Fetch application error:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
});

module.exports = router;