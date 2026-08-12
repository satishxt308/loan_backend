const express = require("express");
const router = express.Router();
const pool = require("../db/db");
const bcrypt = require("bcryptjs");
const { Resend } = require("resend");
const emailTemplates = require("../utils/emailTemplates");

const resend = new Resend(process.env.RESEND_API_KEY);
const multer = require("multer");

// Store image in memory (since you're using BYTEA)
const upload = multer({ storage: multer.memoryStorage() });

const normalizeDob = (dob) => {
  if (!dob) return null;
  const str = dob.toString().trim();
  if (str.includes("/")) {
    const parts = str.split("/");
    if (parts.length === 3) {
      const [day, month, year] = parts;
      return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    }
  }
  return str;
};

router.put("/update/:id", upload.single("profile_image"), async (req, res) => {
  const { id } = req.params;
  const { full_name, phone_number, date_of_birth, gender } = req.body;

  try {
    let query;
    let values;

    // ✅ If image uploaded
    if (req.file) {
      query = `
        UPDATE users
        SET full_name=$1,
            phone_number=$2,
            date_of_birth=$3,
            gender=$4,
            profile_image=$5
        WHERE id=$6
        RETURNING *;
      `;

      values = [
        full_name,
        phone_number,
        normalizeDob(date_of_birth),
        gender,
        req.file.buffer, // 🔥 binary image
        id,
      ];
    } else {
      // ✅ Without image
      query = `
        UPDATE users
        SET full_name=$1,
            phone_number=$2,
            date_of_birth=$3,
            gender=$4
        WHERE id=$5
        RETURNING *;
      `;

      values = [
        full_name,
        phone_number,
        normalizeDob(date_of_birth),
        gender,
        id,
      ];
    }

    const result = await pool.query(query, values);

    res.json({
      success: true,
      user: result.rows[0],
    });

  } catch (error) {
    console.error("UPDATE ERROR:", error);
    res.status(500).json({
      success: false,
      message: "Update failed",
    });
  }
});

router.post("/citizen-login", async (req, res) => {
  try {
    const { phone_number } = req.body;

    // console.log("PHONE:", phone_number);

    const result = await pool.query(
      `SELECT *
       FROM users
       WHERE phone_number = $1
       LIMIT 1`,
      [phone_number]
    );

    // console.log(result.rows);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const user = result.rows[0];

    if (user.role !== "citizen") {
      return res.status(403).json({
        success: false,
        message: "Only citizen accounts can use this login.",
      });
    }

    return res.json({
      success: true,
      user,
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
});

router.post("/login", async (req, res) => {
  console.log("BODY:", req.body);

  const { email, password } = req.body;

  const loginValue = (email || "").trim();
  const isPhone = /^\d{10}$/.test(loginValue);

  try {
    let result;

    if (isPhone) {
      result = await pool.query(
        `SELECT
            u.*,
            creator.full_name AS created_by_name,
            creator.email AS created_by_email,
            creator.phone_number AS created_by_number
         FROM users u
         LEFT JOIN users creator
           ON COALESCE(u.created_by, u.emp_stu_id) = creator.id
         WHERE u.phone_number = $1`,
        [loginValue]
      );
    } else {
      result = await pool.query(
        `SELECT
            u.*,
            creator.full_name AS created_by_name,
            creator.email AS created_by_email,
            creator.phone_number AS created_by_number
         FROM users u
         LEFT JOIN users creator
           ON COALESCE(u.created_by, u.emp_stu_id) = creator.id
         WHERE LOWER(u.email)=LOWER($1)`,
        [loginValue]
      );
    }

    if (result.rows.length === 0) {
      return res.status(400).json({
        success: false,
        message: "User not found."
      });
    }

    const userData = result.rows[0];

    if (userData.role === "employee" && isPhone) {
      return res.status(400).json({
        success: false,
        message: "Employees must login using email."
      });
    }

    if (userData.role === "student" && !isPhone) {
      return res.status(400).json({
        success: false,
        message: "Students must login using phone number."
      });
    }

    if (!userData.is_active) {
      return res.status(403).json({
        success: false,
        message: "Account disabled."
      });
    }

    if (!userData.otp_verified) {
      return res.status(400).json({
        success: false,
        message: "Email not verified."
      });
    }

    const validPassword = await bcrypt.compare(password, userData.password);

    if (!validPassword) {
      return res.status(400).json({
        success: false,
        message: "Invalid password."
      });
    }

    return res.json({
      success: true,
      message: "Login successful",
      user: {
        id: userData.id,
        role: userData.role,
        full_name: userData.full_name,
        email: userData.email,
        phone_number: userData.phone_number,
        is_active: userData.is_active,
      }
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({
      success: false,
      message: "Server error."
    });
  }
});
router.post("/forgot-password", async (req, res) => {
  const { email } = req.body;
  const emailNormalized = email.toLowerCase().trim();

  try {
    const user = await pool.query(
      `
      SELECT 
        id,
        full_name,
        otp_verified,
        is_active
      FROM users 
      WHERE LOWER(email) = $1
      `,
      [emailNormalized]
    );

    // ❌ EMAIL NOT FOUND
    if (user.rows.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Mail not registered"
      });
    }

    const userData = user.rows[0];

    // ❌ EMAIL NOT VERIFIED
    if (!userData.otp_verified) {
      return res.status(400).json({
        success: false,
        message: "Email not verified yet"
      });
    }

    // ❌ USER BLOCKED / INACTIVE
    if (!userData.is_active) {
      return res.status(403).json({
        success: false,
        message:
          "Please contact with admin 9876543210 or pswinners2025@gmail.com"
      });
    }

    // ✅ GENERATE OTP
    const otp = Math.floor(100000 + Math.random() * 900000);
    const userName = userData.full_name || "";

    global.forgotOtpStore = global.forgotOtpStore || {};

    global.forgotOtpStore[emailNormalized] = {
      otp,
      expires: Date.now() + 5 * 60 * 1000
    };

    console.log("OTP IS:", otp);

    // ✅ SEND EMAIL
    const emailResponse = await resend.emails.send({
      from: process.env.FROM_EMAIL,
      to: emailNormalized,
      subject: "🔐 Password Reset Request - PSWB",
      html: emailTemplates.getPasswordResetTemplate(otp, userName)
    });

    if (emailResponse?.error) {
      console.error("Email Error:", emailResponse.error);

      return res.status(500).json({
        success: false,
        message: "Failed to send OTP"
      });
    }

    // ✅ SUCCESS
    return res.json({
      success: true,
      message: "OTP sent successfully"
    });

  } catch (error) {
    console.error("Forgot Password Error:", error);

    return res.status(500).json({
      success: false,
      message: "Server error. Please try again later."
    });
  }
});
 
// ===========================
// RESET PASSWORD WITH OTP
// ===========================
router.post("/reset-password", async (req, res) => {
  try {
    const { email, otp, newPassword, confirmPassword } = req.body;

    const emailNormalized = email?.trim().toLowerCase();
    const otpInput = otp?.trim();

    // Validate input
    if (!emailNormalized || !otpInput || !newPassword || !confirmPassword) {
      return res.status(400).json({
        success: false,
        message: "All fields are required"
      });
    }

    // Check password
    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 6 characters"
      });
    }

    if (newPassword !== confirmPassword) {
      return res.status(400).json({
        success: false,
        message: "Passwords do not match"
      });
    }

    // Get stored OTP
    const record = global.forgotOtpStore?.[emailNormalized];

    if (!record) {
      return res.status(400).json({
        success: false,
        message: "OTP not found. Please request a new OTP."
      });
    }

    // Check expiry
    if (Date.now() > record.expires) {
      delete global.forgotOtpStore[emailNormalized];

      return res.status(400).json({
        success: false,
        message: "OTP expired. Please request a new OTP."
      });
    }

    // IMPORTANT:
    // forgot-password generates OTP as Number,
    // while React Native sends it as String.
    if (String(record.otp) !== String(otpInput)) {
      return res.status(400).json({
        success: false,
        message: "Invalid OTP"
      });
    }

    // Check user
    const user = await pool.query(
      `SELECT id
       FROM users
       WHERE LOWER(email) = $1`,
      [emailNormalized]
    );

    if (user.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Update password
    await pool.query(
      `UPDATE users
       SET password = $1,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $2`,
      [hashedPassword, user.rows[0].id]
    );

    // OTP can only be used once
    delete global.forgotOtpStore[emailNormalized];

    return res.json({
      success: true,
      message: "Password reset successfully"
    });

  } catch (error) {
    console.error("RESET PASSWORD ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Server error. Please try again later."
    });
  }
});

module.exports = router;