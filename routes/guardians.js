// backend/routes/guardians.js
const express = require("express");
const router = express.Router();
const pool = require("../db/db");

router.get("/available-students/:employeeId", async (req, res) => {
  const { employeeId } = req.params;

  try {
    const result = await pool.query(
      `SELECT u.id, u.full_name, u.student_id 
       FROM users u
       WHERE u.role = 'student'
       AND u.is_active = true
       AND u.student_id IS NOT NULL
       AND u.emp_stu_id = $1
       AND u.guard_card = false
       AND u.id NOT IN (
         SELECT g.student_id 
         FROM guardians g 
         WHERE g.employee_id = $1
       )`,
      [employeeId]
    );

    res.json({ success: true, students: result.rows });
  } catch (err) {
    console.error("Error fetching available students:", err);
    res.status(500).json({ error: "Failed to fetch students" });
  }
});

// =====================
// ADD GUARDIAN
// =====================
router.post("/add", async (req, res) => {
  const {
    name,
    email,
    phone,
    relation,
    customRelation,
    occupation,
    aadhaarNumber,
    panNumber,
    address,
    studentId,
    employeeId,
  } = req.body;

  // Validation
  if (!phone || phone.length < 10) {
    return res.status(400).json({ message: "Phone number must be minimum 10 digits" });
  }

  if (!aadhaarNumber || aadhaarNumber.length !== 12) {
    return res.status(400).json({ message: "Aadhaar number must be exactly 12 digits" });
  }

  try {
    // Get student details
    const studentRes = await pool.query(
      "SELECT * FROM users WHERE id = $1 AND role = 'student'",
      [studentId]
    );

    if (studentRes.rows.length === 0) {
      return res.status(400).json({ message: "Student not found" });
    }

    const student = studentRes.rows[0];

    // Check if student already has a guardian
    const existingGuardian = await pool.query(
      "SELECT * FROM guardians WHERE student_id = $1 AND employee_id = $2",
      [studentId, employeeId]
    );

    if (existingGuardian.rows.length > 0) {
      return res.status(400).json({ message: "Guardian already exists for this student" });
    }

    // Use custom relation if relation is "others"
    const finalRelation = relation === "others" ? customRelation : relation;

    // Insert guardian
    await pool.query(
      `INSERT INTO guardians 
       (name, email, phone, relation, occupation, aadhaar_number, pan_number, address, student_id, employee_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        name,
        email || null,
        phone,
        finalRelation,
        occupation,
        aadhaarNumber,
        panNumber,
        address,
        studentId,
        employeeId,
      ]
    );

    // Update student's emp_stu_id if not already set
    if (!student.emp_stu_id) {
      await pool.query(
        "UPDATE users SET emp_stu_id = $1 WHERE id = $2",
        [employeeId, studentId]
      );
    }

    res.json({ success: true, message: "Guardian added successfully" });
  } catch (err) {
    console.error("Add Guardian Error:", err);
    res.status(500).json({ message: "Failed to add guardian" });
  }
});

// =====================
// CHECK STUDENT BY EMAIL
// =====================
router.post("/check-student-email", async (req, res) => {
  try {
    const { email, employeeId } = req.body;

    if (!email) {
      return res.status(400).json({ message: "Email required" });
    }

    const result = await pool.query(
      `SELECT id, is_active, emp_stu_id, student_id 
       FROM users 
       WHERE LOWER(email) = $1`,
      [email.toLowerCase()]
    );

    // ❌ not registered
    if (result.rows.length === 0) {
      return res.status(400).json({
        message: "Add student mail first"
      });
    }

    const student = result.rows[0];

    // ❌ inactive
    if (!student.is_active) {
      return res.status(400).json({
        message: "Student account inactive"
      });
    }

    // ❌ already linked to another employee
    if (student.emp_stu_id && student.emp_stu_id !== employeeId) {
      return res.status(400).json({
        message:
          "Employee already existed , for changing contact admin from support page."
      });
    }

    // ❌ no student card
    if (!student.student_id) {
      return res.status(400).json({
        message: "Create Student_card first"
      });
    }

    // ✅ OK
    res.json({
      success: true,
      studentId: student.id
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

// =====================
// GET GUARDIANS BY EMPLOYEE
// =====================
router.get("/employee/:id", async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query(
      `SELECT 
  g.*, 
  u.id AS student_user_id,   -- ✅ IMPORTANT
  u.full_name AS student_name, 
  u.student_id, 
  u.guard_card
       FROM guardians g
       LEFT JOIN users u ON g.student_id = u.id
       WHERE g.employee_id = $1
       ORDER BY g.created_at DESC`,
      [id]
    );

    res.json({ success: true, guardians: result.rows });
  } catch (err) {
    console.error("Error fetching guardians:", err);
    res.status(500).json({ error: "Failed to fetch guardians" });
  }
});

// ✅ KEEP THIS FIRST
router.get("/data", async (req, res) => {
  try {
    const result = await pool.query(`
     SELECT 
  g.id AS guardian_id,
  g.name AS guardian_name,
  g.email,
  g.phone,
  g.relation,
  g.occupation,
  g.aadhaar_number,
  g.pan_number,
  g.address,
  g.created_at,
  g.updated_at,
  g.status,

  s.id AS student_user_id,
  s.full_name AS student_name,
  s.student_id,

  e.id AS employee_user_id,
  e.full_name AS employee_name

FROM guardians g
LEFT JOIN users s ON g.student_id = s.id
LEFT JOIN users e ON g.employee_id = e.id
ORDER BY g.created_at DESC
    `);

    res.json({
      success: true,
      count: result.rows.length,
      data: result.rows
    });

  } catch (err) {
    console.error("Fetch All Guardians Error:", err);
    res.status(500).json({ error: "Failed to fetch guardians" });
  }
});

// =====================
// GET GUARDIAN BY ID
// =====================
router.get("/:id", async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query(
      `SELECT g.*, u.full_name AS student_name, u.student_id
       FROM guardians g
       LEFT JOIN users u ON g.student_id = u.id
       WHERE g.id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Guardian not found" });
    }

    res.json({ success: true, guardian: result.rows[0] });
  } catch (err) {
    console.error("Error fetching guardian:", err);
    res.status(500).json({ error: "Failed to fetch guardian" });
  }
});

// =====================
// UPDATE GUARDIAN
// =====================
router.put("/:id", async (req, res) => {
  const { id } = req.params;
  const {
    name,
    email,
    phone,
    relation,
    customRelation,
    occupation,
    aadhaarNumber,
    panNumber,
    address,
  } = req.body;

  // Validation
  if (!phone || phone.length < 10) {
    return res.status(400).json({ message: "Phone number must be minimum 10 digits" });
  }

  if (!aadhaarNumber || aadhaarNumber.length !== 12) {
    return res.status(400).json({ message: "Aadhaar number must be exactly 12 digits" });
  }

  try {
    // Check if guardian exists
    const guardianCheck = await pool.query(
      "SELECT * FROM guardians WHERE id = $1",
      [id]
    );

    if (guardianCheck.rows.length === 0) {
      return res.status(404).json({ message: "Guardian not found" });
    }

    const finalRelation = relation === "others" ? customRelation : relation;

    await pool.query(
      `UPDATE guardians 
       SET name = $1, email = $2, phone = $3, relation = $4, 
           occupation = $5, aadhaar_number = $6, pan_number = $7, 
           address = $8, updated_at = CURRENT_TIMESTAMP
       WHERE id = $9`,
      [
        name,
        email || null,
        phone,
        finalRelation,
        occupation,
        aadhaarNumber,
        panNumber,
        address,
        id,
      ]
    );

    res.json({ success: true, message: "Guardian updated successfully" });
  } catch (err) {
    console.error("Update Guardian Error:", err);
    res.status(500).json({ message: "Failed to update guardian" });
  }
});

router.post("/apply-guard-card/:studentId", async (req, res) => {
  const { studentId } = req.params;
  const { employeeId } = req.body;

  // ✅ 0. VALIDATION (VERY IMPORTANT)
  if (!studentId || isNaN(studentId)) {
    return res.status(400).json({ message: "Invalid student ID" });
  }

  if (!employeeId || isNaN(employeeId)) {
    return res.status(400).json({ message: "Invalid employee ID" });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // ✅ 1. CHECK EMPLOYEE EXISTS
    const empCheck = await client.query(
      `SELECT id FROM users WHERE id = $1 AND role = 'employee'`,
      [employeeId]
    );

    if (empCheck.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ message: "Invalid employee" });
    }

    // ✅ 2. CHECK STUDENT EXISTS + LINKED TO EMPLOYEE
    const studentRes = await client.query(
      `SELECT * FROM users 
       WHERE id = $1 AND role = 'student' AND emp_stu_id = $2`,
      [studentId, employeeId]
    );

    if (studentRes.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ message: "Student not linked to this employee" });
    }

    const student = studentRes.rows[0];

    // ✅ 3. CHECK GUARDIAN EXISTS
    const guardianRes = await client.query(
      `SELECT id FROM guardians 
       WHERE student_id = $1 AND employee_id = $2`,
      [studentId, employeeId]
    );

    if (guardianRes.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ message: "Please add guardian first" });
    }

    // ✅ 4. CHECK IF ALREADY APPLIED
    if (student.guard_card) {
      await client.query("ROLLBACK");
      return res.status(400).json({ message: "Guard card already applied" });
    }

    // ✅ 5. APPLY GUARD CARD
    await client.query(
      `UPDATE users 
       SET guard_card = true, updated_at = CURRENT_TIMESTAMP 
       WHERE id = $1`,
      [studentId]
    );

    // ✅ 6. ADD NOTIFICATION (only if table exists)
    await client.query(
      `INSERT INTO notifications (user_id, title, message)
       VALUES ($1, $2, $3)`,
      [
        studentId,
        "Guard Card Applied",
        "Your guardian card has been successfully applied."
      ]
    );

    await client.query("COMMIT");

    res.json({
      success: true,
      message: "Guard card applied successfully"
    });

  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Apply Guard Card Error:", err);

    res.status(500).json({
      message: "Failed to apply for guard card"
    });
  } finally {
    client.release();
  }
});




router.put("/status/:id", async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  if (!["approved", "rejected"].includes(status)) {
    return res.status(400).json({ message: "Invalid status" });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // 1️⃣ Get guardian
    const guardianRes = await client.query(
      `SELECT * FROM guardians WHERE id = $1`,
      [id]
    );

    if (guardianRes.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Guardian not found" });
    }

    const guardian = guardianRes.rows[0];

    // 2️⃣ Update guardian status
    await client.query(
      `UPDATE guardians 
       SET status = $1, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2`,
      [status, id]
    );

    // 3️⃣ Update user.guard_card
    const guardCardValue = status === "approved";

    await client.query(
      `UPDATE users 
       SET guard_card = $1 
       WHERE id = $2`,
      [guardCardValue, guardian.student_id]
    );

    // 4️⃣ Notification
    await client.query(
      `INSERT INTO notifications (user_id, title, message)
       VALUES ($1, $2, $3)`,
      [
        guardian.student_id,
        "Guardian Status Update",
        `Your guardian request has been ${status}`
      ]
    );

    await client.query("COMMIT");

    res.json({
      success: true,
      message: `Guardian ${status} successfully`
    });

  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Status Update Error:", err);

    res.status(500).json({
      message: "Failed to update status"
    });
  } finally {
    client.release();
  }
});

module.exports = router;