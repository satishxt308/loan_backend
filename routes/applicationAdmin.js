// backend/routes/applicationAdmin.js
const express = require("express");
const router = express.Router();
const pool = require("../db/db");

/* GET ALL USERS WITH APPLICATIONS & REG_PAY STATUS */
router.get("/users", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
  u.id,
  u.full_name,
  u.email,
  u.phone_number,
  u.created_at,
  u.stu_card_verified,
  u.student_id,

  COALESCE(
    json_agg(DISTINCT a.id) FILTER (WHERE a.id IS NOT NULL),
    '[]'
  ) AS app_ids,

  COUNT(DISTINCT CASE WHEN a.status = 'pending' THEN a.id END) AS pending_apps,

  EXISTS (
    SELECT 1 
    FROM registration_payments rp
    WHERE rp.user_id = u.id AND rp.status = 'success'
  ) AS reg_pay

FROM users u
LEFT JOIN applications a ON a.user_id = u.id
WHERE u.role = 'student'
GROUP BY u.id, u.full_name, u.email, u.phone_number, u.created_at
ORDER BY u.created_at DESC;
    `);

    res.json({ success: true, users: result.rows });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/* GET APPLICATION DETAILS WITH DOCUMENTS (When clicking app-id) */
router.get("/applications/:appId/details", async (req, res) => {
  const { appId } = req.params;

  try {
    // Get application details
    const appResult = await pool.query(`
      SELECT 
        a.*,
        u.full_name,
        u.email,
        u.phone_number
      FROM applications a
      JOIN users u ON u.id = a.user_id
      WHERE a.id = $1
    `, [appId]);

    if (appResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Application not found" });
    }

    // Get documents for this application
    const docsResult = await pool.query(`
      SELECT 
        id,
        document_type,
        document_key,
        file_name,
        status,
        rejection_reason,
        uploaded_at,
        mime_type
      FROM application_documents
      WHERE application_id = $1
      ORDER BY document_type, document_key
    `, [appId]);

   res.json({
  success: true,
  application: appResult.rows[0],
  documents: docsResult.rows
});


  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.put("/applications/:appId/status", async (req, res) => {
  const { appId } = req.params;
  const { status, reason } = req.body;

  if (!["approved", "rejected", "pending"].includes(status)) {
    return res.status(400).json({ success: false, message: "Invalid status" });
  }

  try {
    await pool.query("BEGIN");

    const appRes = await pool.query(`
      SELECT id, user_id, status AS old_status
      FROM applications
      WHERE id = $1
    `, [appId]);

    if (appRes.rows.length === 0) {
      await pool.query("ROLLBACK");
      return res.status(404).json({ success: false, message: "Application not found" });
    }

    const { user_id, old_status } = appRes.rows[0];

    // Update application
    await pool.query(`
      UPDATE applications
      SET 
        previous_status = status,
        status = $1,
        admin_reason = $2,
        last_updated = NOW()
      WHERE id = $3
    `, [status, reason || null, appId]);

    // 🔔 Notification
    await pool.query(`
      INSERT INTO notifications (user_id, title, message, application_id)
      VALUES ($1, $2, $3, $4)
    `, [
      user_id,
      "Application Status Updated",
      `Your application status changed from ${old_status} to ${status}`,
      appId
    ]);

    await pool.query("COMMIT");

    res.json({ success: true, message: "Application status updated" });

  } catch (err) {
    await pool.query("ROLLBACK");
    res.status(500).json({ success: false, message: err.message });
  }
});

router.put("/documents/:docId/status", async (req, res) => {
  const { docId } = req.params;
  const { status, reason } = req.body;

  if (!["approved", "rejected", "pending"].includes(status)) {
    return res.status(400).json({ success: false, message: "Invalid status" });
  }

  try {
    await pool.query("BEGIN");

    // Get document + user
    const docRes = await pool.query(`
      SELECT d.id, d.application_id, a.user_id, d.status AS old_status
      FROM application_documents d
      JOIN applications a ON a.id = d.application_id
      WHERE d.id = $1
    `, [docId]);

    if (docRes.rows.length === 0) {
      await pool.query("ROLLBACK");
      return res.status(404).json({ success: false, message: "Document not found" });
    }

    const { application_id, user_id, old_status } = docRes.rows[0];

    // Update document
    await pool.query(`
      UPDATE application_documents
      SET 
        previous_status = status,
        status = $1,
        rejection_reason = $2,
        updated_at = NOW()
      WHERE id = $3
    `, [status, reason || null, docId]);

    // 🔔 Notification
    const title =
      status === "approved" ? "Document Approved" :
      status === "rejected" ? "Document Rejected" :
      "Document Updated";

    const message =
      status === "rejected"
        ? `A document was rejected. Reason: ${reason}`
        : `Your document status is now ${status}`;

    await pool.query(`
      INSERT INTO notifications (user_id, title, message, application_id, document_id)
      VALUES ($1, $2, $3, $4, $5)
    `, [user_id, title, message, application_id, docId]);

    await pool.query("COMMIT");

    res.json({ success: true, message: "Document status updated & notification sent" });

  } catch (err) {
    await pool.query("ROLLBACK");
    res.status(500).json({ success: false, message: err.message });
  }
});

router.put("/users/:userId/verify-student-card", async (req, res) => {
  const { userId } = req.params;

  try {
    await pool.query("BEGIN");

    // 1️⃣ Check if user exists & payment is done & all applications approved
    const userCheck = await pool.query(
      `SELECT 
        u.stu_card_verified,
        u.full_name,
        EXISTS (
          SELECT 1 FROM registration_payments rp
          WHERE rp.user_id = u.id AND rp.status = 'success'
        ) AS has_reg_payment,
        COALESCE(
          (SELECT COUNT(*) FROM applications a WHERE a.user_id = u.id AND a.status != 'approved'),
          0
        ) AS pending_apps_count
      FROM users u
      WHERE u.id = $1`,
      [userId]
    );

    if (userCheck.rows.length === 0) {
      await pool.query("ROLLBACK");
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const { stu_card_verified, full_name, has_reg_payment, pending_apps_count } = userCheck.rows[0];

    // 2️⃣ Validation
    if (!has_reg_payment) {
      await pool.query("ROLLBACK");
      return res.status(400).json({ success: false, message: "Registration payment not completed" });
    }

    if (pending_apps_count > 0) {
      await pool.query("ROLLBACK");
      return res.status(400).json({ success: false, message: "Not all applications are approved" });
    }

    if (stu_card_verified) {
      await pool.query("ROLLBACK");
      return res.json({ success: true, message: "Student card already verified" });
    }

    // 3️⃣ Generate student ID
    const studentId = "STLS_" + Math.floor(10000000 + Math.random() * 90000000);

    // 4️⃣ Update user
    await pool.query(
      `UPDATE users
       SET stu_card_verified = true,
           student_id = $1,
           updated_at = NOW()
       WHERE id = $2`,
      [studentId, userId]
    );

    // 5️⃣ Create notification
    await pool.query(
      `INSERT INTO notifications (user_id, title, message)
       VALUES ($1, $2, $3)`,
      [userId, "Student Card Created", `Your Student ID card is created. Student ID: ${studentId}`]
    );

    await pool.query("COMMIT");

    res.json({
      success: true,
      message: "Student card verified successfully",
      student_id: studentId,
      user_name: full_name
    });

  } catch (error) {
    await pool.query("ROLLBACK");
    res.status(500).json({ success: false, message: error.message });
  }
});

/* GET REGISTRATION PAYMENTS FOR USER (with image) */
router.get("/users/:userId/registration-payments", async (req, res) => {
  const { userId } = req.params;

  try {
    const userCheck = await pool.query(
      `SELECT 
        EXISTS (
          SELECT 1 
          FROM registration_payments rp
          WHERE rp.user_id = u.id AND rp.status = 'success'
        ) AS reg_pay
      FROM users u
      WHERE u.id = $1`,
      [userId]
    );

    if (userCheck.rows.length === 0) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const result = await pool.query(`
      SELECT 
        rp.id,
        rp.amount,
        rp.currency,
        rp.status,
        rp.method,
        rp.utr_number,
        rp.raw_ocr_text,
        rp.created_at,

        -- BYTEA → Base64
        CASE 
          WHEN rp.payment_image IS NOT NULL 
          THEN encode(rp.payment_image, 'base64')
          ELSE NULL
        END AS payment_image_base64,

        u.full_name,
        u.email
      FROM registration_payments rp
      JOIN users u ON u.id = rp.user_id
      WHERE rp.user_id = $1
      ORDER BY rp.created_at DESC
    `, [userId]);

    res.json({
      success: true,
      user: {
        id: userId,
        reg_pay: userCheck.rows[0].reg_pay
      },
      payments: result.rows
    });

  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});


/* ACCEPT/REJECT REGISTRATION PAYMENT */
router.put("/registration-payments/:paymentId/review", async (req, res) => {
  const { paymentId } = req.params;
  const { action } = req.body;

  try {
    await pool.query("BEGIN");

    // Get payment details
    const paymentResult = await pool.query(`
      SELECT rp.*, u.id as user_id, u.email
      FROM registration_payments rp
      JOIN users u ON u.id = rp.user_id
      WHERE rp.id = $1
    `, [paymentId]);

    if (paymentResult.rows.length === 0) {
      await pool.query("ROLLBACK");
      return res.status(404).json({ success: false, message: "Payment not found" });
    }

    const payment = paymentResult.rows[0];
    const userId = payment.user_id;

    if (action === 'accept') {
      // Update payment status
      await pool.query(
        `UPDATE registration_payments 
         SET status = 'success', updated_at = NOW()
         WHERE id = $1`,
        [paymentId]
      );

      await pool.query("COMMIT");

      res.json({
        success: true,
        message: "Payment accepted and user registration updated"
      });

    } else if (action === 'reject') {
      // Update payment status
      await pool.query(
        `UPDATE registration_payments 
         SET status = 'failed', updated_at = NOW()
         WHERE id = $1`,
        [paymentId]
      );

      // Create notification
      await pool.query(
        `INSERT INTO notifications (user_id, title, message)
         VALUES ($1, $2, $3)`,
        [userId, "Payment Rejected", "Your registration payment has been rejected"]
      );

      await pool.query("COMMIT");

      res.json({
        success: true,
        message: "Payment rejected and notification sent"
      });
    } else {
      await pool.query("ROLLBACK");
      res.status(400).json({ success: false, message: "Invalid action" });
    }
  } catch (error) {
    await pool.query("ROLLBACK");
    res.status(500).json({ success: false, message: error.message });
  }
});


/* GET DOCUMENT IMAGE/BLOB */
router.get("/documents/:docId/file", async (req, res) => {
  const { docId } = req.params;

  try {
    const result = await pool.query(
      `SELECT document_file, file_name, mime_type
       FROM application_documents
       WHERE id = $1`,
      [docId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Document not found" });
    }

    const document = result.rows[0];

    if (!document.document_file) {
      return res.status(404).json({ success: false, message: "No file found" });
    }

    // Set appropriate headers
    res.setHeader('Content-Type', document.mime_type || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${document.file_name}"`);
    
    // Send the binary data
    res.send(document.document_file);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/* GET USER NOTIFICATIONS */
router.get("/users/:userId/notifications", async (req, res) => {
  const { userId } = req.params;

  try {
    const result = await pool.query(
      `SELECT * FROM notifications 
       WHERE user_id = $1 
       ORDER BY created_at DESC`,
      [userId]
    );

    res.json({ success: true, notifications: result.rows });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/* MARK NOTIFICATION AS READ */
router.put("/notifications/:notificationId/read", async (req, res) => {
  const { notificationId } = req.params;

  try {
    await pool.query(
      `UPDATE notifications SET is_read = true WHERE id = $1`,
      [notificationId]
    );

    res.json({ success: true, message: "Notification marked as read" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get("/users/:userId/student-card-info", async (req, res) => {
  const { userId } = req.params;

  try {
    // Check registration payment status
    const userResult = await pool.query(
      `SELECT 
        u.id,
        u.full_name,
        u.email,
        u.phone_number,
        u.stu_card_verified,
        u.student_id,
        u.aadhaar_number,
        u.full_address,
        EXISTS (
          SELECT 1 FROM registration_payments rp
          WHERE rp.user_id = u.id AND rp.status = 'success'
        ) AS has_reg_payment,
        COALESCE(
          (SELECT json_agg(DISTINCT a.*) 
           FROM applications a 
           WHERE a.user_id = u.id AND a.status = 'approved'
          ), '[]'
        ) AS approved_applications
      FROM users u
      WHERE u.id = $1 AND u.role = 'student'`,
      [userId]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const user = userResult.rows[0];

    res.json({
      success: true,
      user: {
        id: user.id,
        full_name: user.full_name,
        email: user.email,
        phone_number: user.phone_number,
        aadhaar_number: user.aadhaar_number,
        full_address: user.full_address,
        has_reg_payment: user.has_reg_payment,
        stu_card_verified: user.stu_card_verified,
        student_id: user.student_id,
        can_verify_student_card: user.has_reg_payment && !user.stu_card_verified
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;