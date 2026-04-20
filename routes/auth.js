const express = require("express");
const router = express.Router();
const pool = require("../db/db");
const bcrypt = require("bcryptjs");
const { Resend } = require("resend");

const resend = new Resend(process.env.RESEND_API_KEY);
const multer = require("multer");

// Store image in memory (since you're using BYTEA)
const upload = multer({ storage: multer.memoryStorage() });

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
        date_of_birth,
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
        date_of_birth,
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

router.post("/login", async (req, res) => {
  const { email, password } = req.body;

  const emailNormalized = email.trim().toLowerCase();

  try {
    // Check if user exists
    const user = await pool.query(
      `SELECT 
        u.*,
        creator.full_name as created_by_name,
        creator.email as created_by_email,
        creator.phone_number as created_by_number
      FROM users u
      LEFT JOIN users creator ON u.created_by = creator.id
      WHERE u.email = $1`,
      [emailNormalized]
    );

    if (user.rows.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Email is not registered."
      });
    }

    const userData = user.rows[0];

    // Check if user is active
    if (!userData.is_active) {
      let contactMessage = "Please contact with admin 8789786789 or admin@PSWB.com";
      
      if (userData.created_by) {
        if (userData.created_by_name) {
          contactMessage = `Account disabled. Please contact your supervisor ${userData.created_by_name} (${userData.created_by_number || 'No number'} / ${userData.created_by_email || 'No email'})`;
        } else {
          contactMessage = "Account disabled. Please contact system administrator.";
        }
      }
      
      return res.status(403).json({
        success: false,
        message: contactMessage
      });
    }

    // Check if email is verified
    if (!userData.otp_verified) {
      return res.status(400).json({
        success: false,
        message: "Email not verified. Please complete registration."
      });
    }

    // Check password
    const isPasswordValid = await bcrypt.compare(password, userData.password);
    
    if (!isPasswordValid) {
      return res.status(400).json({
        success: false,
       message: "Invalid email or password."
      });
    }

    // Login successful
    res.json({
      success: true,
      message: "Login successful",
      user: {
        id: userData.id,
        email: userData.email,
        role: userData.role,
        full_name: userData.full_name,
        phone_number: userData.phone_number,  // Using phone_number
        is_active: userData.is_active,
        created_by: userData.created_by
      }
    });

  } catch (error) {
    console.error("Login Error:", error);
    res.status(500).json({
      success: false,
      message: "Server error during login"
    });
  }
});

router.post("/forgot-password", async (req, res) => {
  const { email } = req.body;
  const emailNormalized = email.toLowerCase();

  const user = await pool.query(
    "SELECT id, otp_verified FROM users WHERE LOWER(email) = $1",
    [emailNormalized]
  );

  // ❌ NOT REGISTERED OR NOT VERIFIED
  if (user.rows.length === 0 || !user.rows[0].otp_verified) {
    return res.status(400).json({
      success: false,
      message: "Mail not registered yet"
    });
  }

  const otp = Math.floor(100000 + Math.random() * 900000);

  global.forgotOtpStore = global.forgotOtpStore || {};

  global.forgotOtpStore[emailNormalized] = {
    otp,
    expires: Date.now() + 5 * 60 * 1000
  };

  console.log("OTP IS:", otp);

  try {
    const emailResponse = await resend.emails.send({
      from: process.env.FROM_EMAIL,
      to: emailNormalized,
      subject: "Reset Password OTP",
      html: `<h2>${otp}</h2>`
    });

    if (emailResponse?.error) {
      return res.status(500).json({
        success: false,
        message: "Failed to send OTP"
      });
    }

    // ✅ IMPORTANT (YOU FORGOT THIS)
    return res.json({
      success: true,
      message: "OTP sent successfully"
    });

  } catch (err) {
    return res.status(500).json({
      success: false,
      message: "Email sending failed"
    });
  }
});

router.post("/reset-password", async (req, res) => {
  const { email, otp, newPassword, confirmPassword } = req.body;
  const emailNormalized = email.toLowerCase();

  if (newPassword !== confirmPassword) {
    return res.status(400).json({ message: "Passwords do not match" });
  }

  const data = global.forgotOtpStore?.[emailNormalized];

  if (!data || data.otp != otp) {
    return res.status(400).json({ message: "Invalid OTP" });
  }

  if (Date.now() > data.expires) {
    return res.status(400).json({ message: "OTP expired" });
  }

  const hashed = await bcrypt.hash(newPassword, 10);

  await pool.query(
    "UPDATE users SET password = $1 WHERE LOWER(email) = $2",
    [hashed, emailNormalized]
  );

  delete global.forgotOtpStore[emailNormalized];

  res.json({ success: true });
});
 
module.exports = router;