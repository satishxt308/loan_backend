// backend/routes/studentCardRoutes.js
const express = require("express");
const router = express.Router();
const pool = require("../db/db");

const generateApplicationId = () => {
  return `APP-${Date.now()}`;
};

router.post("/save-info", async (req, res) => {
  try {
    const data = req.body;

    if (!data.userId) {
      return res.status(400).json({ success: false, message: "userId is required" });
    }

    // Check existing
    const existing = await pool.query(
      "SELECT id FROM applications WHERE user_id = $1 LIMIT 1",
      [data.userId]
    );

    let applicationId;

    // --------------------------------------
    // UPDATE EXISTING APPLICATION
    // --------------------------------------
    if (existing.rows.length > 0) {
      applicationId = existing.rows[0].id;

      const updateQuery = `
        UPDATE applications SET
          category=$2, aadhaar_number=$3, full_address=$4, pan_number=$5,

          class=$6, board=$7, school_name=$8, stream=$9,
          previous_class=$10, previous_class_result=$11,
          tenth_marks=$12, tenth_board=$13, tenth_school_name=$14,

          year=$15, semester=$16, degree=$17, college_name=$18,
          university_name=$19, previous_sem_result=$20,
          twelfth_marks=$21, twelfth_board=$22, twelfth_school_name=$23,

          employment_status=$24, loan_reason=$25,

          guardian_name=$26, guardian_number=$27,
          guardian_relation=$28, guardian_aadhaar=$29, guardian_pan=$30,

          last_updated = NOW()
        WHERE user_id = $1
      `;

      const values = [
        data.userId,                // $1 WHERE user_id
        data.category,              // $2
        data.aadhaarNumber,         // $3
        data.fullAddress,           // $4
        data.panNumber,             // $5

        data.class,                 // $6
        data.board,                 // $7
        data.schoolName,            // $8
        data.stream,                // $9
        data.previousClass,         // $10
        data.previousClassResult,   // $11
        data.tenthMarks,            // $12
        data.tenthBoard,            // $13
        data.tenthSchoolName,       // $14

        data.year,                  // $15
        data.semester,              // $16
        data.degree,                // $17
        data.collegeName,           // $18
        data.universityName,        // $19
        data.previousSemResult,     // $20
        data.twelfthMarks,          // $21
        data.twelfthBoard,          // $22
        data.twelfthSchoolName,     // $23

        data.employmentStatus,      // $24
        data.loanReason,            // $25

        data.guardianName,          // $26
        data.guardianNumber,        // $27
        data.guardianRelation,      // $28
        data.guardianAadhaar,       // $29
        data.guardianPAN            // $30
      ];

      await pool.query(updateQuery, values);

      return res.json({
        success: true,
        message: "Application updated successfully",
        formId: applicationId,
      });
    }

    // --------------------------------------
    // INSERT NEW APPLICATION
    // --------------------------------------
    applicationId = "APP-" + Date.now();

    const insertQuery = `
      INSERT INTO applications (
        id, user_id, category,

        aadhaar_number, full_address, pan_number,

        class, board, school_name, stream,
        previous_class, previous_class_result,
        tenth_marks, tenth_board, tenth_school_name,

        year, semester, degree, college_name, university_name,
        previous_sem_result, twelfth_marks, twelfth_board, twelfth_school_name,

        employment_status, loan_reason,

        guardian_name, guardian_number, guardian_relation,
        guardian_aadhaar, guardian_pan
      )
      VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,
        $16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31
      )
    `;

    const values = [
      applicationId,           // $1
      data.userId,             // $2
      data.category,           // $3

      data.aadhaarNumber,      // $4
      data.fullAddress,        // $5
      data.panNumber,          // $6

      data.class,              // $7
      data.board,              // $8
      data.schoolName,         // $9
      data.stream,             // $10
      data.previousClass,      // $11
      data.previousClassResult,// $12
      data.tenthMarks,         // $13
      data.tenthBoard,         // $14
      data.tenthSchoolName,    // $15

      data.year,               // $16
      data.semester,           // $17
      data.degree,             // $18
      data.collegeName,        // $19
      data.universityName,     // $20
      data.previousSemResult,  // $21
      data.twelfthMarks,       // $22
      data.twelfthBoard,       // $23
      data.twelfthSchoolName,  // $24

      data.employmentStatus,   // $25
      data.loanReason,         // $26

      data.guardianName,       // $27
      data.guardianNumber,     // $28
      data.guardianRelation,   // $29
      data.guardianAadhaar,    // $30
      data.guardianPAN         // $31
    ];

    await pool.query(insertQuery, values);

    return res.json({
      success: true,
      message: "Application created successfully",
      formId: applicationId,
    });

  } catch (err) {
    console.error("Save Error:", err);
    res.status(500).json({ success: false, message: "DB error" });
  }
});
 
router.put("/upload-image/:id", async (req, res) => {
  const { profile_image } = req.body;
  const { id } = req.params;

  try {
    await pool.query(
      "UPDATE users SET profile_image = $1 WHERE id = $2",
      [profile_image, id]
    );

    res.json({ success: true, message: "Profile image updated" });
  } catch (err) {
    console.error("Upload Error:", err);
    res.status(500).json({ error: "DB error" });
  }
});


router.post("/save-info-by-employee", async (req, res) => {
  try {
    const {
      studentId,
      employeeId,
      category,
      ...data
    } = req.body;

    if (!studentId || !category) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields",
      });
    }

    const applicationId = generateApplicationId(); // ✅ NEW

    const result = await pool.query(
      `INSERT INTO applications (
        id,
        user_id,
        category,
        aadhaar_number,
        full_address,
        pan_number,
        class,
        board,
        school_name,
        stream,
        previous_class,
        previous_class_result,
        tenth_marks,
        tenth_board,
        tenth_school_name,
        year,
        semester,
        degree,
        college_name,
        university_name,
        previous_sem_result,
        twelfth_marks,
        twelfth_board,
        twelfth_school_name,
        employment_status,
        loan_reason,
        guardian_name,
        guardian_number,
        guardian_relation,
        guardian_aadhaar,
        guardian_pan
      )
      VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,
        $16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31
      )
      RETURNING id`,
      [
        applicationId,     // ✅ id
        studentId,         // ✅ user_id (correct now)
        category,
        data.aadhaarNumber,
        data.fullAddress,
        data.panNumber,
        data.class,
        data.board,
        data.schoolName,
        data.stream,
        data.previousClass,
        data.previousClassResult,
        data.tenthMarks,
        data.tenthBoard,
        data.tenthSchoolName,
        data.year,
        data.semester,
        data.degree,
        data.collegeName,
        data.universityName,
        data.previousSemResult,
        data.twelfthMarks,
        data.twelfthBoard,
        data.twelfthSchoolName,
        data.employmentStatus,
        data.loanReason,
        data.guardianName,
        data.guardianNumber,
        data.guardianRelation,
        data.guardianAadhaar,
        data.guardianPAN
      ]
    );

    res.json({
      success: true,
      formId: result.rows[0].id,
    });

  } catch (error) {
    console.error("SAVE ERROR:", error);

    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// router.get("/user/:id", async (req, res) => {
//   try {
//     const { id } = req.params;

//     const user = await pool.query(`
//       SELECT 
//         u.id,
//         u.full_name,
//         u.email,
//         u.phone_number,
//         u.date_of_birth,
//         u.gender,
//         u.profile_image,
//         a.id AS student_id
//       FROM users u
//       LEFT JOIN applications a ON a.user_id = u.id
//       WHERE u.id = $1
//       LIMIT 1
//     `, [id]);

//     res.json(user.rows[0]);
//   } catch (err) {
//     console.log("User fetch error:", err);
//     res.status(500).json({ error: "DB error" });
//   }
// });

module.exports = router;
