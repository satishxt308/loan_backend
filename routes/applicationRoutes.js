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

// ✅ SAVE / UPDATE APPLICATION BY EMPLOYEE FOR STUDENT
router.post("/student-card/save-info-by-employee", async (req, res) => {
  try {
    const {
      studentId,
      employeeId,
      category,

      aadhaarNumber,
      fullAddress,
      panNumber,

      class: cls,
      board,
      schoolName,
      stream,
      previousClass,
      previousClassResult,

      tenthMarks,
      tenthBoard,
      tenthSchoolName,

      year,
      semester,
      degree,
      collegeName,
      universityName,
      previousSemResult,

      twelfthMarks,
      twelfthBoard,
      twelfthSchoolName,

      employmentStatus,
      loanReason,

      guardianName,
      guardianNumber,
      guardianRelation,
      guardianAadhaar,
      guardianPAN
    } = req.body;

    if (!studentId) {
      return res.status(400).json({
        success: false,
        message: "studentId is required"
      });
    }

    // 🔍 check existing application
    const existing = await db.query(
      `SELECT id FROM applications WHERE user_id = $1`,
      [studentId]
    );

    let result;

    if (existing.rows.length > 0) {
      // ✅ UPDATE
      result = await db.query(
        `UPDATE applications SET
          category=$1,
          aadhaar_number=$2,
          full_address=$3,
          pan_number=$4,

          class=$5,
          board=$6,
          school_name=$7,
          stream=$8,
          previous_class=$9,
          previous_class_result=$10,

          tenth_marks=$11,
          tenth_board=$12,
          tenth_school_name=$13,

          year=$14,
          semester=$15,
          degree=$16,
          college_name=$17,
          university_name=$18,
          previous_sem_result=$19,

          twelfth_marks=$20,
          twelfth_board=$21,
          twelfth_school_name=$22,

          employment_status=$23,
          loan_reason=$24,

          guardian_name=$25,
          guardian_number=$26,
          guardian_relation=$27,
          guardian_aadhaar=$28,
          guardian_pan=$29,

          updated_by_employee=$30,
          last_updated=NOW()

        WHERE user_id=$31
        RETURNING id`,
        [
          category,
          aadhaarNumber.replace(/-/g, ""),
          fullAddress,
          panNumber,

          cls,
          board,
          schoolName,
          stream,
          previousClass,
          previousClassResult,

          tenthMarks,
          tenthBoard,
          tenthSchoolName,

          year,
          semester,
          degree,
          collegeName,
          universityName,
          previousSemResult,

          twelfthMarks,
          twelfthBoard,
          twelfthSchoolName,

          employmentStatus,
          loanReason,

          guardianName,
          guardianNumber,
          guardianRelation,
          guardianAadhaar.replace(/-/g, ""),
          guardianPAN,

          employeeId,
          studentId
        ]
      );
    } else {
      // ✅ INSERT
      result = await db.query(
        `INSERT INTO applications (
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
          guardian_pan,

          created_by_employee
        )
        VALUES (
          $1,$2,$3,$4,$5,
          $6,$7,$8,$9,$10,$11,
          $12,$13,$14,
          $15,$16,$17,$18,$19,$20,
          $21,$22,$23,
          $24,$25,
          $26,$27,$28,$29,$30,
          $31
        )
        RETURNING id`,
        [
          studentId,
          category,
          aadhaarNumber.replace(/-/g, ""),
          fullAddress,
          panNumber,

          cls,
          board,
          schoolName,
          stream,
          previousClass,
          previousClassResult,

          tenthMarks,
          tenthBoard,
          tenthSchoolName,

          year,
          semester,
          degree,
          collegeName,
          universityName,
          previousSemResult,

          twelfthMarks,
          twelfthBoard,
          twelfthSchoolName,

          employmentStatus,
          loanReason,

          guardianName,
          guardianNumber,
          guardianRelation,
          guardianAadhaar.replace(/-/g, ""),
          guardianPAN,

          employeeId
        ]
      );
    }

    res.json({
      success: true,
      formId: result.rows[0].id
    });

  } catch (err) {
    console.error("❌ Employee Save Error:", err);
    res.status(500).json({
      success: false,
      message: "Server error"
    });
  }
});

// ✅ SAVE / UPDATE APPLICATION (BY EMPLOYEE BUT STORED USING STUDENT ID)

router.post("/student-card/save-info-by-employee", async (req, res) => {
  try {
    const {
      studentId,
      category,

      aadhaarNumber,
      fullAddress,
      panNumber,

      class: studentClass,
      board,
      schoolName,
      stream,
      previousClass,
      previousClassResult,

      tenthMarks,
      tenthBoard,
      tenthSchoolName,

      year,
      semester,
      degree,
      collegeName,
      universityName,
      previousSemResult,

      twelfthMarks,
      twelfthBoard,
      twelfthSchoolName,

      employmentStatus,
      loanReason,

      guardianName,
      guardianNumber,
      guardianRelation,
      guardianAadhaar,
      guardianPAN,
    } = req.body;

    if (!studentId || !category) {
      return res.status(400).json({
        success: false,
        message: "studentId and category required",
      });
    }

    const clean = (val) => (val ? val.replace(/-/g, "") : null);

    // ✅ CHECK IF ALREADY EXISTS
    const existing = await db.query(
      `SELECT id FROM applications WHERE user_id = $1`,
      [studentId]
    );

    let result;

    if (existing.rows.length > 0) {
      // 🔄 UPDATE
      result = await db.query(
        `UPDATE applications SET
          category = $1,
          aadhaar_number = $2,
          full_address = $3,
          pan_number = $4,
          class = $5,
          board = $6,
          school_name = $7,
          stream = $8,
          previous_class = $9,
          previous_class_result = $10,
          tenth_marks = $11,
          tenth_board = $12,
          tenth_school_name = $13,
          year = $14,
          semester = $15,
          degree = $16,
          college_name = $17,
          university_name = $18,
          previous_sem_result = $19,
          twelfth_marks = $20,
          twelfth_board = $21,
          twelfth_school_name = $22,
          employment_status = $23,
          loan_reason = $24,
          guardian_name = $25,
          guardian_number = $26,
          guardian_relation = $27,
          guardian_aadhaar = $28,
          guardian_pan = $29,
          updated_at = CURRENT_TIMESTAMP
        WHERE user_id = $30
        RETURNING id`,
        [
          category,
          clean(aadhaarNumber),
          fullAddress,
          panNumber,
          studentClass,
          board,
          schoolName,
          stream,
          previousClass,
          previousClassResult,
          tenthMarks,
          tenthBoard,
          tenthSchoolName,
          year,
          semester,
          degree,
          collegeName,
          universityName,
          previousSemResult,
          twelfthMarks,
          twelfthBoard,
          twelfthSchoolName,
          employmentStatus,
          loanReason,
          guardianName,
          guardianNumber,
          guardianRelation,
          clean(guardianAadhaar),
          guardianPAN,
          studentId,
        ]
      );
    } else {
      // 🆕 INSERT
      result = await db.query(
        `INSERT INTO applications (
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
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
          $11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
          $21,$22,$23,$24,$25,$26,$27,$28,$29,$30
        )
        RETURNING id`,
        [
          studentId,
          category,
          clean(aadhaarNumber),
          fullAddress,
          panNumber,
          studentClass,
          board,
          schoolName,
          stream,
          previousClass,
          previousClassResult,
          tenthMarks,
          tenthBoard,
          tenthSchoolName,
          year,
          semester,
          degree,
          collegeName,
          universityName,
          previousSemResult,
          twelfthMarks,
          twelfthBoard,
          twelfthSchoolName,
          employmentStatus,
          loanReason,
          guardianName,
          guardianNumber,
          guardianRelation,
          clean(guardianAadhaar),
          guardianPAN,
        ]
      );
    }

    res.json({
      success: true,
      formId: result.rows[0].id,
    });
  } catch (error) {
    console.error("SAVE APPLICATION ERROR:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
});

module.exports = router;