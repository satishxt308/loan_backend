// routes/studentCard.js
const express = require("express");
const router = express.Router();
const pool = require("../db/db");

router.get("/student-card/:userId", async (req, res) => {
  const { userId } = req.params;

  try {
    const result = await pool.query(
      `
      SELECT
        u.id AS user_id,              -- ✅ REQUIRED
        u.full_name,
        u.student_id,
        u.gender,
        u.email,
        u.phone_number,
        u.profile_image,

        a.category,
        a.aadhaar_number,
        a.guardian_name,
        a.guardian_aadhaar,
        a.guardian_pan,
        a.college_name,
        a.degree,
        a.year

      FROM users u
      LEFT JOIN applications a ON a.user_id = u.id   -- ✅ FIXED

      WHERE u.id = $1
      `,
      [userId]
    );

    if (result.rows.length === 0 || !result.rows[0].student_id) {
      return res.status(404).json({ message: "Student data not found" });
    }

    const user = result.rows[0];

    // ✅ Convert image
    if (user.profile_image) {
      user.profile_image = `data:image/png;base64,${user.profile_image.toString("base64")}`;
    }

    res.json(user);

  } catch (err) {
    console.error("Student card error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;
