// backend/routes/userRoutes.js
const express = require("express");
const router = express.Router();
const pool = require("../db/db");

const { Resend } = require("resend");
const multer = require("multer");
const upload = multer({ storage: multer.memoryStorage() });
const bcrypt = require("bcryptjs");

const resend = new Resend(process.env.RESEND_API_KEY);

// Import professional email templates
const emailTemplates = require("../utils/emailTemplates");

// ===========================
// SEND OTP VIA EMAIL (WITH TEMPLATE)
// ===========================
router.post("/send-otp", async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ success: false, message: "Email is required" });
  }

  const emailNormalized = email.trim().toLowerCase();

  try {
    const existingUser = await pool.query(
      `SELECT id FROM users WHERE LOWER(email) = $1`,
      [emailNormalized]
    );

    if (existingUser.rows.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Email already registered. Please login."
      });
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    global.otpStore = global.otpStore || {};

    global.otpStore[emailNormalized] = {
      otp,
      expiry: Date.now() + 5 * 60 * 1000,
      lastSent: Date.now(),
      verified: false
    };

    // ✅ Send professional email template
    const emailResponse = await resend.emails.send({
      from: process.env.FROM_EMAIL,
      to: emailNormalized,
      subject: "🎓 Verify Your Email - PSWB Registration",
      html: emailTemplates.getWelcomeEmailTemplate(emailNormalized, otp)
    });

    console.log("SEND OTP RESPONSE:", emailResponse);

    if (emailResponse?.error) {
      console.error("EMAIL SEND FAILED:", emailResponse.error);
      return res.status(500).json({
        success: false,
        message: "Failed to send OTP email"
      });
    }

    res.json({
      success: true,
      message: "OTP sent successfully"
    });

  } catch (err) {
    console.error("SEND OTP ERROR:", err);
    res.status(500).json({ success: false, message: "Error sending OTP" });
  }
});

// ===========================
// VERIFY OTP
// ===========================
router.post("/verify-otp", async (req, res) => {
  const { email, otp } = req.body;

  const emailNormalized = email.trim().toLowerCase();
  const record = global.otpStore?.[emailNormalized];

  if (!record) {
    return res.json({ success: false, verified: false, message: "OTP not found" });
  }

  if (Date.now() > record.expiry) {
    return res.json({ success: false, verified: false, message: "OTP expired" });
  }

  if (record.otp !== otp) {
    return res.json({ success: false, verified: false, message: "Invalid OTP" });
  }

  global.otpStore[emailNormalized].verified = true;

  res.json({ success: true, verified: true });
});

// ===========================
// CHECK EMAIL EXISTS
// ===========================
router.get("/check-email/:email", async (req, res) => {
  try {
    const { email } = req.params;

    const result = await pool.query(
      "SELECT id FROM users WHERE LOWER(email) = $1",
      [email.toLowerCase()]
    );

    res.json({
      exists: result.rows.length > 0
    });
  } catch (err) {
    console.error("Check Email Error:", err);
    res.status(500).json({ exists: false });
  }
});

// ===========================
// COMPLETE REGISTRATION
// ===========================
router.post("/complete-registration", async (req, res) => {
  try {
    const { fullName, dateOfBirth, gender, role, phoneNumber, email, password } = req.body;

    const emailNormalized = email.trim().toLowerCase();
    const record = global.otpStore?.[emailNormalized];

    if (!record || !record.verified) {
      return res.status(400).json({
        success: false,
        message: "OTP not verified"
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const result = await pool.query(
      `INSERT INTO users 
      (full_name, date_of_birth, gender, role, phone_number, email, password, otp_verified)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      RETURNING id, full_name, email, role`,
      [fullName, dateOfBirth, gender, role, phoneNumber, emailNormalized, hashedPassword, true]
    );

    delete global.otpStore[emailNormalized];

    res.json({
      success: true,
      user: result.rows[0]
    });

  } catch (err) {
    console.error("Registration Error:", err);
    res.status(500).json({ success: false, message: "Registration failed" });
  }
});

// ===========================
// EMPLOYEE ADD STUDENT
// ===========================
router.post("/employee/add-student", async (req, res) => {
  try {
    const {
      name,
      dateOfBirth,
      gender,
      phone,
      email,
      password,
      emp_id
    } = req.body;

    if (!emp_id) {
      return res.status(400).json({
        success: false,
        message: "Employee ID missing"
      });
    }

    const emailNormalized = email.trim().toLowerCase();

    const record = global.otpStore?.[emailNormalized];

    if (!record || !record.verified) {
      return res.status(400).json({
        success: false,
        message: "OTP not verified"
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const result = await pool.query(
      `INSERT INTO users 
      (full_name, date_of_birth, gender, role, phone_number, email, password, otp_verified, emp_stu_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      RETURNING id, full_name, email, role, emp_stu_id`,
      [
        name,
        dateOfBirth,
        gender,
        "student",
        phone,
        emailNormalized,
        hashedPassword,
        true,
        emp_id
      ]
    );

    delete global.otpStore[emailNormalized];

    res.json({
      success: true,
      user: result.rows[0]
    });

  } catch (err) {
    console.error("EMP ADD STUDENT ERROR:", err);
    res.status(500).json({
      success: false,
      message: "Failed to add student"
    });
  }
});

// ===========================
// RESEND OTP
// ===========================
router.post("/resend-otp", async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({
      success: false,
      message: "Email is required",
    });
  }

  try {
    global.otpStore = global.otpStore || {};

    const emailNormalized = email.trim().toLowerCase();
    const existing = global.otpStore[emailNormalized];

    if (!existing) {
      return res.status(400).json({
        success: false,
        message: "Please request OTP first",
      });
    }

    const now = Date.now();
    const lastSent = existing.lastSent || 0;

    if (now - lastSent < 60 * 1000) {
      const secondsLeft = Math.ceil((60 * 1000 - (now - lastSent)) / 1000);
      return res.status(400).json({
        success: false,
        message: `Wait ${secondsLeft}s before resend`,
      });
    }

    const newOtp = Math.floor(100000 + Math.random() * 900000).toString();

    global.otpStore[emailNormalized] = {
      otp: newOtp,
      expiry: Date.now() + 5 * 60 * 1000,
      lastSent: Date.now(),
      verified: false,
    };

    // ✅ Send OTP email with template
    const emailResponse = await resend.emails.send({
      from: process.env.FROM_EMAIL,
      to: emailNormalized,
      subject: "🔄 New OTP Request - PSWB",
      html: emailTemplates.getOtpTemplate(newOtp, emailNormalized)
    });

    console.log("RESEND RESPONSE:", emailResponse);

    if (emailResponse?.error) {
      console.error("RESEND FAILED:", emailResponse.error);
      return res.status(500).json({
        success: false,
        message: "Failed to resend OTP",
      });
    }

    res.json({
      success: true,
      message: "New OTP sent",
    });

  } catch (err) {
    console.error("Resend OTP Error:", err);
    res.status(500).json({
      success: false,
      message: "Error resending OTP",
    });
  }
});

// ===========================
// TOGGLE CARD STATUS
// ===========================
router.post("/toggle-card-status", async (req, res) => {
  try {
    const { user_id, field } = req.body;

    const userCheck = await pool.query(
      `SELECT stu_card, reg_pay FROM users WHERE id = $1`,
      [user_id]
    );

    if (userCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }

    const user = userCheck.rows[0];

    if (field === "reg_pay" && !user.stu_card) {
      return res.status(400).json({
        success: false,
        message: "Student card must be submitted before registration payment"
      });
    }

    if (field === "stu_card_verified" && !user.reg_pay) {
      return res.status(400).json({
        success: false,
        message: "Registration payment must be completed before card verification"
      });
    }

    const allowedFields = ["stu_card_verified", "stu_card", "reg_pay"];

    if (!allowedFields.includes(field)) {
      return res.status(400).json({
        success: false,
        message: "Invalid field"
      });
    }

    const result = await pool.query(
      `UPDATE users 
       SET ${field} = NOT ${field}, updated_at = NOW()
       WHERE id = $1
       RETURNING ${field};`,
      [user_id]
    );

    res.json({
      success: true,
      new_value: result.rows[0][field]
    });

  } catch (error) {
    console.error("Toggle Card Verified Error:", error);
    res.status(500).json({
      success: false,
      message: "Server error while toggling"
    });
  }
});

// ===========================
// DELETE USER
// ===========================
router.delete("/delete/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `DELETE FROM users WHERE id = $1 RETURNING id, full_name`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }

    res.json({
      success: true,
      message: "User deleted successfully",
      deleted_user: result.rows[0]
    });

  } catch (error) {
    console.error("Delete User Error:", error);
    res.status(500).json({
      success: false,
      message: "Server error while deleting user"
    });
  }
});

// ===========================
// UPDATE ALL STATUSES
// ===========================
router.put("/update-all-status", async (req, res) => {
  try {
    const { user_id, stu_card, reg_pay, stu_card_verified } = req.body;

    const result = await pool.query(
      `UPDATE users 
       SET stu_card = $1, 
           reg_pay = $2, 
           stu_card_verified = $3,
           updated_at = NOW()
       WHERE id = $4
       RETURNING id, full_name, stu_card, reg_pay, stu_card_verified`,
      [stu_card, reg_pay, stu_card_verified, user_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }

    res.json({
      success: true,
      message: "All statuses updated successfully",
      user: result.rows[0]
    });

  } catch (error) {
    console.error("Update All Status Error:", error);
    res.status(500).json({
      success: false,
      message: "Server error while updating statuses"
    });
  }
});

// ===========================
// GET ALL USERS
// ===========================
router.get("/all-users", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        id,
        full_name,
        email,
        phone_number,
        date_of_birth,
        gender,
        role,
        otp_verified,
        stu_card,
        stu_card_verified,
        emp_card,
        emp_card_verified,
        reg_pay,
        is_active,
        created_at
      FROM users
      ORDER BY id ASC;
    `);

    res.json({
      success: true,
      users: result.rows
    });

  } catch (error) {
    console.error("Fetch Users Error:", error);
    res.status(500).json({
      success: false,
      message: "Server error while fetching users"
    });
  }
});

// ===========================
// TOGGLE ACTIVE STATUS
// ===========================
router.put("/toggle-active/:id", async (req, res) => {
  const { id } = req.params;

  try {
    const userResult = await pool.query(
      "SELECT is_active FROM users WHERE id = $1",
      [id]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const currentStatus = userResult.rows[0].is_active ?? true;
    const newStatus = !currentStatus;

    await pool.query(
      "UPDATE users SET is_active = $1, updated_at = NOW() WHERE id = $2",
      [newStatus, id]
    );

    res.json({
      success: true,
      message: newStatus
        ? "User activated successfully"
        : "User deactivated successfully",
      is_active: newStatus,
    });
  } catch (error) {
    console.error("Toggle active error:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
});

// ===========================
// GET EMPLOYEE STUDENTS
// ===========================
router.get("/employee/students/:emp_id", async (req, res) => {
  try {
    const { emp_id } = req.params;

    const result = await pool.query(
      `SELECT 
        id, 
        full_name, 
        email, 
        phone_number,
        stu_card,
        student_id,
        is_active,
        created_at 
       FROM users
       WHERE emp_stu_id = $1
       ORDER BY id DESC`,
      [emp_id]
    );

    res.json({
      success: true,
      students: result.rows
    });

  } catch (err) {
    console.error("Fetch employee students error:", err);
    res.status(500).json({
      success: false,
      message: "Server error"
    });
  }
});

// ===========================
// UPDATE USER ROLE
// ===========================
router.put("/update-role/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { role } = req.body;

    const allowed = ["student", "employee"];
    if (!allowed.includes(role.toLowerCase())) {
      return res.status(400).json({ success: false, message: "Invalid role" });
    }

    await pool.query(
      `UPDATE users SET role=$1 WHERE id=$2`,
      [role.toLowerCase(), id]
    );

    res.json({ success: true, message: "Role updated successfully" });

  } catch (error) {
    console.error("Role update error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// ===========================
// GET STUDENT BY ID
// ===========================
router.get("/student/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `SELECT 
        id,
        full_name,
        phone_number,
        email,
        date_of_birth,
        gender
      FROM users
      WHERE id = $1 AND role = 'student'`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Student not found",
      });
    }

    res.json({
      success: true,
      student: result.rows[0],
    });
  } catch (error) {
    console.error("Get student error:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
});

// ===========================
// GET USER BASIC INFO
// ===========================
router.get("/user/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `SELECT 
         id, 
         full_name, 
         student_id,
         stu_card, 
         stu_card_verified 
       FROM users 
       WHERE id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json(result.rows[0]);

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

// ===========================
// GET USER DATA
// ===========================
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `SELECT 
        id,
        full_name,
        stu_card,
        stu_card_verified,
        emp_card,
        wallet_balance,
        emp_card_verified
       FROM users
       WHERE id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.json({ success: false, message: "User not found" });
    }

    res.json({
      success: true,
      user: result.rows[0],
    });

  } catch (err) {
    console.error("User fetch error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// ===========================
// GET USER PROFILE
// ===========================
router.get("/profile/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const user = await pool.query(
      `SELECT 
        id,
        student_id,
        full_name,
        email,
        phone_number,
        date_of_birth,
        gender,
        role,
        otp_verified,
        stu_card,
        stu_card_verified,
        emp_card,
        emp_card_verified,
        profile_image,
        created_at
      FROM users
      WHERE id = $1`,
      [id]
    );

    if (user.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const userData = user.rows[0];

    if (userData.profile_image) {
      userData.profile_image = userData.profile_image.toString("base64");
    }

    res.json({
      success: true,
      user: userData,
    });
  } catch (error) {
    console.error("Profile Fetch Error:", error);
    res.status(500).json({
      success: false,
      message: "Server error while fetching profile",
    });
  }
});

// ===========================
// UPDATE STATUS
// ===========================
router.patch("/update-status/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { is_active } = req.body;

    const result = await pool.query(
      `UPDATE users 
       SET is_active = $1, updated_at = NOW() 
       WHERE id = $2 
       RETURNING *`,
      [is_active, id]
    );

    res.json({
      success: true,
      message: "Status updated",
      user: result.rows[0]
    });
  } catch (err) {
    console.error("Status update error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// ===========================
// UPDATE USER PROFILE
// ===========================
router.put("/update/:id", upload.single("profile_image"), async (req, res) => {
  try {
    const { id } = req.params;
    const { full_name, date_of_birth, gender, phone_number, role } = req.body;

    if (!full_name || !date_of_birth || !gender || !phone_number || !role) {
      return res.status(400).json({
        success: false,
        message: "All fields are required"
      });
    }

    let updateQuery;
    let values;

    if (req.file) {
      updateQuery = `
        UPDATE users 
        SET 
          full_name = $1,
          date_of_birth = $2,
          gender = $3,
          phone_number = $4,
          role = $5,
          profile_image = $6,
          updated_at = NOW()
        WHERE id = $7
        RETURNING *;
      `;
      values = [full_name, date_of_birth, gender, phone_number, role, req.file.buffer, id];
    } else {
      updateQuery = `
        UPDATE users 
        SET 
          full_name = $1,
          date_of_birth = $2,
          gender = $3,
          phone_number = $4,
          role = $5,
          updated_at = NOW()
        WHERE id = $6
        RETURNING *;
      `;
      values = [full_name, date_of_birth, gender, phone_number, role, id];
    }

    const result = await pool.query(updateQuery, values);

    res.json({
      success: true,
      message: "User updated successfully",
      user: result.rows[0]
    });

  } catch (err) {
    console.error("Update Error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// ===========================
// UPDATE STUDENT CARD STATUS
// ===========================
router.put("/update-stu-card/:id", async (req, res) => {
  try {
    const { id } = req.params;

    await pool.query(
      "UPDATE users SET stu_card = true WHERE id = $1",
      [id]
    );

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;