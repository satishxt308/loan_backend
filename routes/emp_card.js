// backend/routes/emp_card.js
const express = require("express");
const router = express.Router();
const pool = require("../db/db");
const multer = require("multer");

const storage = multer.memoryStorage();

const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
  },
});


router.post("/save", async (req, res) => {
  try {
    const { user_id, aadhaarNumber, fullAddress, panNumber, referralSource } = req.body;

    if (!user_id || !aadhaarNumber || !fullAddress || !referralSource) {
      return res.json({ success: false, message: "Missing required fields" });
    }

    // Check existing
    const check = await pool.query("SELECT * FROM emp_cards WHERE user_id = $1", [user_id]);

    if (check.rows.length > 0) {
      // UPDATE
      await pool.query(
        `UPDATE emp_cards 
         SET aadhaar_number=$1, full_address=$2, pan_number=$3, referral_source=$4 
         WHERE user_id=$5`,
        [aadhaarNumber, fullAddress, panNumber, referralSource, user_id]
      );

      return res.json({ success: true, message: "Updated successfully" });
    }

    // INSERT
    await pool.query(
      `INSERT INTO emp_cards(user_id, aadhaar_number, full_address, pan_number, referral_source)
       VALUES($1, $2, $3, $4, $5)`,
      [user_id, aadhaarNumber, fullAddress, panNumber, referralSource]
    );

    return res.json({ success: true, message: "Saved successfully" });

  } catch (err) {
    console.log("Emp-card save error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

router.get("/get/:user_id", async (req, res) => {
  try {
    const { user_id } = req.params;

    const result = await pool.query("SELECT * FROM emp_cards WHERE user_id = $1", [user_id]);

    if (result.rows.length === 0) {
      return res.json({ success: true, exists: false, data: null });
    }

    res.json({ success: true, exists: true, data: result.rows[0] });

  } catch (err) {
    console.log("Fetch employee card error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

router.post(
  "/submit-employee-documents",

  upload.fields([
    { name: "aadhaar_card", maxCount: 1 },
    { name: "pan_card", maxCount: 1 },
    { name: "employee_photo", maxCount: 1 },
  ]),

  async (req, res) => {
    try {

      console.log("REQ BODY:", req.body);
      console.log("REQ FILES:", req.files);

      const { user_id } = req.body;

      if (!user_id) {
        return res.json({
          success: false,
          message: "User ID is required",
        });
      }

      const files = req.files || {};

      const documents = [
        "aadhaar_card",
        "pan_card",
        "employee_photo",
      ];

      for (const docType of documents) {

        const fileArray = files[docType];

        // no new upload
        if (!fileArray || fileArray.length === 0) {

          const existingId = req.body[`${docType}_id`];

          if (existingId) {
            console.log(`${docType} unchanged`);
          }

          continue;
        }

        const file = fileArray[0];

        console.log("Saving:", docType);

        const base64Data = file.buffer.toString("base64");

        const check = await pool.query(
          `SELECT id FROM emp_documents
           WHERE user_id = $1
           AND document_type = $2`,
          [user_id, docType]
        );

        if (check.rows.length > 0) {

          // UPDATE
          await pool.query(
            `UPDATE emp_documents
             SET base64_data = $1,
                 status = 'pending',
                 reason = NULL,
                 updated_at = NOW()
             WHERE user_id = $2
             AND document_type = $3`,
            [base64Data, user_id, docType]
          );

        } else {

          // INSERT
          await pool.query(
            `INSERT INTO emp_documents
            (user_id, document_type, base64_data)
             VALUES ($1, $2, $3)`,
            [user_id, docType, base64Data]
          );

        }
      }

      // Update user
      await pool.query(
        `UPDATE users
         SET emp_card = true,
             emp_card_verified = false,
             updated_at = NOW()
         WHERE id = $1`,
        [user_id]
      );

      return res.json({
        success: true,
        message: "Employee documents submitted successfully",
      });

    } catch (err) {

      console.log("Submit employee documents error:", err);

      return res.status(500).json({
        success: false,
        message: "Server error",
        error: err.message,
      });
    }
  }
);

module.exports = router;
