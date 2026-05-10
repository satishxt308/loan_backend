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
  u.id AS user_id,
  u.full_name,
  u.student_id,
  u.gender,
  u.email,
  u.phone_number,
  u.profile_image,
  u.guard_card,
  u.is_active,

  a.category,
  a.aadhaar_number,
  a.full_address AS address,   -- ✅ FIXED (from applications)
  a.guardian_name,
  a.guardian_aadhaar,
  a.guardian_pan,
  a.college_name,
  a.degree,
  a.year,

  g.id AS guardian_id,
  g.name AS guardian_name_full,
  g.phone AS guardian_phone,
  g.relation,
  g.occupation,
  g.aadhaar_number AS guardian_aadhaar_number,
  g.pan_number AS guardian_pan_number,
  g.address AS guardian_address,
  g.status AS guardian_status,

  p.created_at AS payment_date,  -- ✅ PAYMENT DATE
  p.created_at + INTERVAL '1 year' AS valid_until  -- ✅ EXPIRY

FROM users u

-- ✅ ONLY APPROVED APPLICATION (important)
LEFT JOIN LATERAL (
  SELECT *
  FROM applications
  WHERE user_id = u.id
    AND status = 'approved'
  ORDER BY submitted_date DESC
  LIMIT 1
) a ON true

LEFT JOIN guardians g 
  ON g.student_id = u.id
AND g.status = 'active'
-- ✅ LATEST APPROVED PAYMENT
LEFT JOIN LATERAL (
  SELECT created_at
  FROM payments
  WHERE user_id = u.id
    AND status = 'approved'
  ORDER BY created_at DESC
  LIMIT 1
) p ON true

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

router.get("/guardian/:studentId", async (req, res) => {
  const { studentId } = req.params;

  try {
    const result = await pool.query(
      `
      SELECT 
        g.name,
        g.email,
        g.phone,
        g.relation,
        g.aadhaar_number,
        g.pan_number,
        g.address,
        g.created_at,

        u.full_name AS student_name,

        -- ✅ use student_id as guardian ID
        g.student_id AS guardian_id,

        -- ✅ valid for 1 year
        g.created_at + INTERVAL '1 year' AS valid_until

      FROM guardians g
      LEFT JOIN users u ON u.id = g.student_id
      WHERE g.student_id = $1
      ORDER BY g.created_at DESC
      LIMIT 1
      `,
      [studentId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        message: "Guardian not found",
      });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error("Guardian fetch error:", error);
    res.status(500).json({
      message: "Server error",
    });
  }
});



module.exports = router;
