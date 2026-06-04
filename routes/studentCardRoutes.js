// backend/routes/studentCardRoutes.js
const express = require("express");
const router = express.Router();
const pool = require("../db/db");
const { v4: uuidv4 } = require("uuid");
const Joi = require("joi");

const generateApplicationId = () => {
  return `APP-${uuidv4().slice(0, 8).toUpperCase()}`;
};

const syncGuardian = async (validatedData) => {
  if (!validatedData.guardianName) return;
  try {
    const studentUser = await pool.query(
      "SELECT emp_stu_id FROM users WHERE id = $1",
      [validatedData.userId]
    );
    const employeeId = studentUser.rows.length > 0 ? studentUser.rows[0].emp_stu_id : null;

    const existingGuard = await pool.query(
      "SELECT id FROM guardians WHERE student_id = $1",
      [validatedData.userId]
    );

    const clean = (val) => (val ? val.replace(/-/g, "") : null);

    if (existingGuard.rows.length > 0) {
      await pool.query(
        `UPDATE guardians SET
          name = $2,
          phone = $3,
          relation = $4,
          aadhaar_number = $5,
          pan_number = $6,
          address = $7,
          employee_id = COALESCE(employee_id, $8),
          updated_at = NOW()
        WHERE student_id = $1`,
        [
          validatedData.userId,
          validatedData.guardianName,
          validatedData.guardianNumber,
          validatedData.guardianRelation,
          clean(validatedData.guardianAadhaar),
          validatedData.guardianPAN,
          validatedData.fullAddress,
          employeeId
        ]
      );
    } else {
      await pool.query(
        `INSERT INTO guardians (
          student_id, name, phone, relation, aadhaar_number, pan_number, address, employee_id, status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending')`,
        [
          validatedData.userId,
          validatedData.guardianName,
          validatedData.guardianNumber,
          validatedData.guardianRelation,
          clean(validatedData.guardianAadhaar),
          validatedData.guardianPAN,
          validatedData.fullAddress,
          employeeId
        ]
      );
    }
  } catch (err) {
    console.error("Error syncing guardian inside studentCardRoutes:", err);
  }
};

const applicationSchema = Joi.object({
  userId: Joi.alternatives().try(Joi.string(), Joi.number()).required(),
  category: Joi.string().valid("school", "college", "others").required(),
  aadhaarNumber: Joi.string().pattern(/^\d{4}-\d{4}-\d{4}$/).required().messages({
    "string.pattern.base": "Aadhaar must be in format XXXX-XXXX-XXXX"
  }),
  fullAddress: Joi.string().min(5).max(500).required(),
  panNumber: Joi.string().allow("", null).max(20),
  class: Joi.string().allow("", null).max(50),
  board: Joi.string().allow("", null).max(100),
  schoolName: Joi.string().allow("", null).max(200),
  stream: Joi.string().allow("", null).max(100),
  previousClass: Joi.string().allow("", null).max(50),
  previousClassResult: Joi.string().allow("", null).max(50),
  tenthMarks: Joi.string().allow("", null).max(50),
  tenthBoard: Joi.string().allow("", null).max(100),
  tenthSchoolName: Joi.string().allow("", null).max(200),
  year: Joi.string().allow("", null).max(50),
  semester: Joi.string().allow("", null).max(50),
  degree: Joi.string().allow("", null).max(100),
  collegeName: Joi.string().allow("", null).max(200),
  universityName: Joi.string().allow("", null).max(200),
  previousSemResult: Joi.string().allow("", null).max(50),
  twelfthMarks: Joi.string().allow("", null).max(50),
  twelfthBoard: Joi.string().allow("", null).max(100),
  twelfthSchoolName: Joi.string().allow("", null).max(200),
  employmentStatus: Joi.string().allow("", null).max(100),
  loanReason: Joi.string().allow("", null).max(500),
  guardianName: Joi.string().allow("", null).max(150),
  guardianNumber: Joi.string().allow("", null).pattern(/^\d{10}$/).messages({
    "string.pattern.base": "Guardian Number must be exactly 10 digits"
  }),
  guardianRelation: Joi.string().allow("", null).max(100),
  guardianAadhaar: Joi.string().allow("", null).pattern(/^\d{4}-\d{4}-\d{4}$/),
  guardianPAN: Joi.string().allow("", null).max(20),
});

router.post("/save-info", async (req, res) => {
  try {
    const data = req.body;

    // Validate request body
    const { error, value: validatedData } = applicationSchema.validate(data, { abortEarly: false });
    
    if (error) {
      return res.status(400).json({
        success: false,
        message: "Validation Error",
        errors: error.details.map((err) => err.message),
      });
    }

    // Check existing
    const existing = await pool.query(
      "SELECT id FROM applications WHERE user_id = $1 LIMIT 1",
      [validatedData.userId]
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
        validatedData.userId,
        validatedData.category,
        validatedData.aadhaarNumber,
        validatedData.fullAddress,
        validatedData.panNumber,
        validatedData.class,
        validatedData.board,
        validatedData.schoolName,
        validatedData.stream,
        validatedData.previousClass,
        validatedData.previousClassResult,
        validatedData.tenthMarks,
        validatedData.tenthBoard,
        validatedData.tenthSchoolName,
        validatedData.year,
        validatedData.semester,
        validatedData.degree,
        validatedData.collegeName,
        validatedData.universityName,
        validatedData.previousSemResult,
        validatedData.twelfthMarks,
        validatedData.twelfthBoard,
        validatedData.twelfthSchoolName,
        validatedData.employmentStatus,
        validatedData.loanReason,
        validatedData.guardianName,
        validatedData.guardianNumber,
        validatedData.guardianRelation,
        validatedData.guardianAadhaar,
        validatedData.guardianPAN
      ];

      await pool.query(updateQuery, values);

      // Sync guardian
      await syncGuardian(validatedData);

      return res.json({
        success: true,
        message: "Application updated successfully",
        formId: applicationId,
      });
    }

    // --------------------------------------
    // INSERT NEW APPLICATION
    // --------------------------------------
    applicationId = generateApplicationId();

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
      applicationId,
      validatedData.userId,
      validatedData.category,
      validatedData.aadhaarNumber,
      validatedData.fullAddress,
      validatedData.panNumber,
      validatedData.class,
      validatedData.board,
      validatedData.schoolName,
      validatedData.stream,
      validatedData.previousClass,
      validatedData.previousClassResult,
      validatedData.tenthMarks,
      validatedData.tenthBoard,
      validatedData.tenthSchoolName,
      validatedData.year,
      validatedData.semester,
      validatedData.degree,
      validatedData.collegeName,
      validatedData.universityName,
      validatedData.previousSemResult,
      validatedData.twelfthMarks,
      validatedData.twelfthBoard,
      validatedData.twelfthSchoolName,
      validatedData.employmentStatus,
      validatedData.loanReason,
      validatedData.guardianName,
      validatedData.guardianNumber,
      validatedData.guardianRelation,
      validatedData.guardianAadhaar,
      validatedData.guardianPAN
    ];

    await pool.query(insertQuery, values);

    // Sync guardian
    await syncGuardian(validatedData);

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
    const { studentId, category, ...data } = req.body;

    const { error, value: validatedData } = applicationSchema.validate({ userId: studentId, category, ...data }, { abortEarly: false });
    
    if (error) {
      return res.status(400).json({
        success: false,
        message: "Validation Error",
        errors: error.details.map((err) => err.message),
      });
    }

    // ✅ CHECK EXISTING
    const existing = await pool.query(
      "SELECT id FROM applications WHERE user_id = $1 LIMIT 1",
      [validatedData.userId]
    );

    let applicationId;

    // --------------------------------------
    // ✅ UPDATE
    // --------------------------------------
    if (existing.rows.length > 0) {
      applicationId = existing.rows[0].id;

      await pool.query(
        `UPDATE applications SET
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
        WHERE user_id = $1`,
        [
          validatedData.userId,
          validatedData.category,
          validatedData.aadhaarNumber,
          validatedData.fullAddress,
          validatedData.panNumber,
          validatedData.class,
          validatedData.board,
          validatedData.schoolName,
          validatedData.stream,
          validatedData.previousClass,
          validatedData.previousClassResult,
          validatedData.tenthMarks,
          validatedData.tenthBoard,
          validatedData.tenthSchoolName,
          validatedData.year,
          validatedData.semester,
          validatedData.degree,
          validatedData.collegeName,
          validatedData.universityName,
          validatedData.previousSemResult,
          validatedData.twelfthMarks,
          validatedData.twelfthBoard,
          validatedData.twelfthSchoolName,
          validatedData.employmentStatus,
          validatedData.loanReason,
          validatedData.guardianName,
          validatedData.guardianNumber,
          validatedData.guardianRelation,
          validatedData.guardianAadhaar,
          validatedData.guardianPAN
        ]
      );

      // Sync guardian
      await syncGuardian(validatedData);

      return res.json({
        success: true,
        message: "Updated successfully",
        formId: applicationId,
      });
    }

    // --------------------------------------
    // ✅ INSERT
    // --------------------------------------
    applicationId = generateApplicationId();

    const result = await pool.query(
      `INSERT INTO applications (
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
      RETURNING id`,
      [
        applicationId,
        validatedData.userId,
        validatedData.category,
        validatedData.aadhaarNumber,
        validatedData.fullAddress,
        validatedData.panNumber,
        validatedData.class,
        validatedData.board,
        validatedData.schoolName,
        validatedData.stream,
        validatedData.previousClass,
        validatedData.previousClassResult,
        validatedData.tenthMarks,
        validatedData.tenthBoard,
        validatedData.tenthSchoolName,
        validatedData.year,
        validatedData.semester,
        validatedData.degree,
        validatedData.collegeName,
        validatedData.universityName,
        validatedData.previousSemResult,
        validatedData.twelfthMarks,
        validatedData.twelfthBoard,
        validatedData.twelfthSchoolName,
        validatedData.employmentStatus,
        validatedData.loanReason,
        validatedData.guardianName,
        validatedData.guardianNumber,
        validatedData.guardianRelation,
        validatedData.guardianAadhaar,
        validatedData.guardianPAN
      ]
    );

    // Sync guardian
    await syncGuardian(validatedData);

    return res.json({
      success: true,
      message: "Created successfully",
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
