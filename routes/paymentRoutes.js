const express = require("express");
const router = express.Router();
const multer = require("multer");
const pool = require("../db/db");

const Tesseract = require("tesseract.js");

// MEMORY STORAGE (important for BYTEA)
const upload = multer({ storage: multer.memoryStorage() });

/* =========================
   EXTRACT UTR FROM IMAGE
========================= */
router.post("/extract-utr", upload.single("screenshot"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No image uploaded" });
    }

    const imageBuffer = req.file.buffer;

    // 🔍 OCR PROCESS
    const { data } = await Tesseract.recognize(imageBuffer, "eng", {
      logger: m => console.log(m), // optional logs
    });

    const rawText = data.text || "";
    console.log("📝 OCR TEXT:", rawText);

    // =========================
    // 🔎 EXTRACT UTR (Regex)
    // =========================
    let extractedUtr = null;

    // Common UTR patterns (India UPI / Bank)
    const utrPatterns = [
      /\b\d{12}\b/,             // 12 digit
      /\b\d{16}\b/,             // 16 digit
      /\b[A-Z0-9]{10,20}\b/     // alphanumeric
    ];

    for (let pattern of utrPatterns) {
      const match = rawText.match(pattern);
      if (match) {
        extractedUtr = match[0];
        break;
      }
    }

    // =========================
    // 💰 EXTRACT AMOUNT
    // =========================
    let extractedAmount = 0;

    const amountMatch = rawText.match(/(?:₹|rs\.?|inr)?\s?(\d{2,6})/i);
    if (amountMatch) {
      extractedAmount = parseInt(amountMatch[1]);
    }

    return res.json({
      success: true,
      raw_text: rawText,
      extracted_utr: extractedUtr,
      extracted_amount: extractedAmount,
    });

  } catch (err) {
    console.error("❌ OCR ERROR:", err);
    res.status(500).json({
      success: false,
      error: "OCR processing failed",
    });
  }
});

/* =========================
   GET PAYMENT SETTINGS
========================= */
router.get("/", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM payment_settings ORDER BY id DESC LIMIT 1"
    );

    if (!result.rows.length) return res.json({});

    const data = result.rows[0];

    // Convert BYTEA → base64
    if (data.qr_image) {
      data.qr_image = data.qr_image.toString("base64");
    }

    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/confirm", upload.single("payment_image"), async (req, res) => {
  try {
    const { user_id, utr, via_payment, emi_id, loan_id } = req.body;

    if (!user_id || !utr) {
      return res.status(400).json({
        success: false,
        message: "Missing fields"
      });
    }

    const isEmiPayment = !!emi_id;

    // ✅ INSERT PAYMENT WITH EMI/LOAN TRACKING
    await pool.query(
      `INSERT INTO payments 
       (user_id, utr, via_payment, payment_image, status, emi_id, loan_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        parseInt(user_id),
        utr,
        via_payment || 'upi_manual',
        req.file ? req.file.buffer : null,
        "pending",
        emi_id ? parseInt(emi_id) : null,
        loan_id ? parseInt(loan_id) : null,
      ]
    );

    if (isEmiPayment) {
      // ✅ Mark EMI as 'Pending Approval' — wait for admin
      await pool.query(
        `UPDATE loan_emis SET status = 'Pending Approval' WHERE id = $1`,
        [parseInt(emi_id)]
      );
      // Notify user
      await pool.query(
        `INSERT INTO notifications (user_id, title, message) VALUES ($1, $2, $3)`,
        [parseInt(user_id), "EMI Payment Submitted",
          "Your EMI payment screenshot has been submitted. Admin will verify and approve within a few hours."]
      );
    } else {
      // ✅ Registration payment: mark student card pending
      await pool.query(
        `UPDATE users SET stu_card = true WHERE id = $1`,
        [parseInt(user_id)]
      );
      await pool.query(
        `INSERT INTO notifications (user_id, title, message) VALUES ($1, $2, $3)`,
        [parseInt(user_id), "Registration Payment Submitted",
          "Your registration payment has been submitted and is pending admin verification."]
      );
    }

    res.json({
      success: true,
      message: "Payment submitted successfully"
    });

  } catch (err) {
    console.error("Payment confirm error:", err);
    res.status(500).json({
      success: false,
      message: "Server error"
    });
  }
});

router.get("/check/:user_id", async (req, res) => {
  try {
    const { user_id } = req.params;

    const result = await pool.query(
      "SELECT id FROM payments WHERE user_id = $1",
      [user_id]
    );

    res.json({
      exists: result.rows.length > 0
    });

  } catch (err) {
    res.status(500).json({ exists: false });
  }
});
router.get("/status/:user_id", async (req, res) => {
  try {
    const { user_id } = req.params;

    const result = await pool.query(
      `SELECT p.status
       FROM payments p
       LEFT JOIN users u ON p.user_id = u.id
       WHERE p.user_id = $1
          OR u.student_id = (
              SELECT student_id FROM users WHERE id = $1
          )
       ORDER BY p.id DESC
       LIMIT 1`,
      [user_id]
    );

    if (result.rows.length === 0) {
      return res.json({ exists: false });
    }

    res.json({
      exists: true,
      status: result.rows[0].status
    });

  } catch (err) {
    console.error("Payment status error:", err);
    res.status(500).json({ exists: false });
  }
});


// Get user by ID
router.get("/get-user/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const result = await pool.query("SELECT * FROM users WHERE id = $1", [userId]);
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: "User not found" });
    }
    res.json({ success: true, user: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get payments by user
router.get("/payments", async (req, res) => {
  try {
    const { user_id } = req.query;
    let query = "SELECT * FROM payments";
    let params = [];
    
    if (user_id) {
      query += " WHERE user_id = $1";
      params.push(user_id);
    }
    
    query += " ORDER BY id DESC";
    
    const result = await pool.query(query, params);
    
    // Convert BYTEA to base64 for each payment
    const payments = result.rows.map(payment => ({
      ...payment,
      payment_image: payment.payment_image ? payment.payment_image.toString('base64') : null
    }));
    
    res.json({ success: true, data: payments });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});
/* =========================
   SAVE / UPDATE
========================= */
router.post("/", upload.single("qr_image"), async (req, res) => {
  try {
    const {
      upi_id,
      bank_name,
      account_number,
      ifsc_code,
      account_holder,
      support_email,
      support_phone,
    } = req.body;

    // FILE BUFFER (important)
    const qr_image = req.file ? req.file.buffer : null;

    const existing = await pool.query(
      "SELECT * FROM payment_settings LIMIT 1"
    );

    if (existing.rows.length > 0) {
      await pool.query(
        `UPDATE payment_settings SET
          qr_image = COALESCE($1, qr_image),
          upi_id = $2,
          bank_name = $3,
          account_number = $4,
          ifsc_code = $5,
          account_holder = $6,
          support_email = $7,
          support_phone = $8,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $9`,
        [
          qr_image,
          upi_id,
          bank_name,
          account_number,
          ifsc_code,
          account_holder,
          support_email,
          support_phone,
          existing.rows[0].id,
        ]
      );
    } else {
      await pool.query(
        `INSERT INTO payment_settings
        (qr_image, upi_id, bank_name, account_number, ifsc_code, account_holder, support_email, support_phone)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          qr_image,
          upi_id,
          bank_name,
          account_number,
          ifsc_code,
          account_holder,
          support_email,
          support_phone,
        ]
      );
    }

    res.json({ message: "Saved successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/employee/submit-payment", upload.single("payment_image"), async (req, res) => {
  try {
    const { student_id, employee_id, utr, via_payment, amount } = req.body;

    if (!student_id || !employee_id || !via_payment || !amount) {
      return res.status(400).json({
        success: false,
        message: "Missing fields"
      });
    }

    // ✅ SAVE PAYMENT (PENDING VERIFY)
    await pool.query(
      `INSERT INTO payments 
       (user_id, utr, via_payment, payment_image, status)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        student_id,
        utr || null,
        via_payment,
        req.file ? req.file.buffer : null,
        false
      ]
    );

    // ✅ STORE TRANSACTION
    await pool.query(
      `INSERT INTO transactions 
       (user_id, employee_id, amount, type, via)
       VALUES ($1, $2, $3, $4, $5)`,
      [student_id, employee_id, amount, "payment", via_payment]
    );

    // ✅ STUDENT NOTIFICATION
    await pool.query(
      `INSERT INTO notifications (user_id, title, message)
       VALUES ($1, $2, $3)`,
      [
        student_id,
        "Payment Submitted",
        `Your payment of ₹${amount} via ${via_payment} is submitted and under verification`
      ]
    );

    // ✅ EMPLOYEE NOTIFICATION
    await pool.query(
      `INSERT INTO notifications (user_id, title, message)
       VALUES ($1, $2, $3)`,
      [
        employee_id,
        "Payment Submitted",
        `You submitted ₹${amount} for student ID ${student_id}`
      ]
    );

    res.json({
      success: true,
      message: "Payment submitted successfully"
    });

  } catch (err) {
    console.error("EMP PAYMENT ERROR:", err);
    res.status(500).json({
      success: false,
      message: "Server error"
    });
  }
});

router.post("/employee/deduct-wallet", async (req, res) => {
  try {
    const { student_id, employee_id, amount } = req.body;

    if (!student_id || !employee_id || !amount) {
      return res.status(400).json({
        success: false,
        message: "Missing fields"
      });
    }

    // ✅ CHECK WALLET
    const emp = await pool.query(
      `SELECT wallet_balance FROM users WHERE id = $1`,
      [employee_id]
    );

    if (!emp.rows.length) {
      return res.status(404).json({ success: false, message: "Employee not found" });
    }

    const balance = parseFloat(emp.rows[0].wallet_balance || 0);

    if (balance < amount) {
      return res.status(400).json({
        success: false,
        message: "Insufficient wallet balance"
      });
    }

    // ✅ DEDUCT WALLET
    await pool.query(
      `UPDATE users 
       SET wallet_balance = wallet_balance - $1 
       WHERE id = $2`,
      [amount, employee_id]
    );

    // ✅ MARK PAYMENT SUCCESS DIRECT
    await pool.query(
      `INSERT INTO payments (user_id, via_payment, status)
       VALUES ($1, $2, $3)`,
      [student_id, "cash", true]
    );
// ✅ UPDATE STUDENT CARD STATUS
await pool.query(
  `UPDATE users 
   SET stu_card = true, reg_pay = true 
   WHERE id = $1`,
  [student_id]
);

// ✅ AUTO-ACTIVATE IF APPLICATION & DOCUMENTS APPROVED
try {
  const appRes = await pool.query(
    `SELECT id, status, field_status FROM applications WHERE user_id = $1 LIMIT 1`,
    [student_id]
  );
  if (appRes.rows.length > 0) {
    const app = appRes.rows[0];
    
    const docsRes = await pool.query(
      `SELECT status FROM application_documents WHERE application_id = $1`,
      [app.id]
    );
    const docsApproved = docsRes.rows.length > 0 && docsRes.rows.every(d => d.status === "approved");
    
    const fieldsApproved = app.field_status && Object.values(app.field_status).every(s => s === "approved");
    
    if (app.status === "approved" || (docsApproved && fieldsApproved)) {
      if (app.status !== "approved") {
        await pool.query(
          `UPDATE applications SET status = 'approved', last_updated = NOW() WHERE id = $1`,
          [app.id]
        );
      }

      const random = Math.floor(1000000000 + Math.random() * 9000000000);
      const genStudentId = `PSWB${random}`;
      
      await pool.query(
        `UPDATE users 
         SET 
           student_id = $1,
           stu_card = TRUE,
           stu_card_verified = TRUE
         WHERE id = $2`,
        [genStudentId, student_id]
      );

      await pool.query(
        `INSERT INTO notifications (user_id, title, message)
         VALUES ($1, $2, $3)`,
        [
          student_id,
          "🎓 Student ID Generated",
          `Your Student ID is ${genStudentId}. Your profile has been auto-activated.`
        ]
      );
      console.log(`Auto-activated student card for user ${student_id} on wallet payment deduction.`);
    }
  }
} catch (err) {
  console.error("Auto-activation error on wallet payment deduction:", err);
}
    // ✅ TRANSACTION LOG
    await pool.query(
      `INSERT INTO transactions 
       (user_id, employee_id, amount, type, via)
       VALUES ($1, $2, $3, $4, $5)`,
      [student_id, employee_id, amount, "cash", "cash"]
    );

    // ✅ STUDENT NOTIFICATION
    await pool.query(
      `INSERT INTO notifications (user_id, title, message)
       VALUES ($1, $2, $3)`,
      [
        student_id,
        "Payment Successful",
        `₹${amount} paid successfully via cash`
      ]
    );

    // ✅ EMPLOYEE NOTIFICATION (WALLET DEDUCT)
    await pool.query(
      `INSERT INTO notifications (user_id, title, message)
       VALUES ($1, $2, $3)`,
      [
        employee_id,
        "Wallet Deducted",
        `₹${amount} deducted from your wallet for student payment`
      ]
    );

    res.json({
      success: true,
      message: "Cash payment successful"
    });

  } catch (err) {
    console.error("CASH PAYMENT ERROR:", err);
    res.status(500).json({
      success: false,
      message: "Server error"
    });
  }
});

/* =========================
   ADMIN: GET PENDING PAYMENTS
   ========================= */
router.get("/admin/pending", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT 
         p.id,
         p.user_id,
         p.utr,
         p.via_payment,
         p.created_at,
         p.status,
         p.emi_id,
         p.loan_id,
         encode(p.payment_image, 'base64') AS payment_image_base64,
         u.full_name,
         u.email,
         u.phone_number,
         u.student_id,
         le.emi_number,
         le.due_date,
         le.amount AS emi_amount,
         la.scheme_name
       FROM payments p
       JOIN users u ON p.user_id = u.id
       LEFT JOIN loan_emis le ON p.emi_id = le.id
       LEFT JOIN loan_applications la ON p.loan_id = la.id
       WHERE p.status = 'pending'
       ORDER BY p.created_at DESC`
    );

    res.json({
      success: true,
      payments: result.rows
    });
  } catch (err) {
    console.error("GET admin pending payments error:", err);
    res.status(500).json({
      success: false,
      message: "Server error"
    });
  }
});

/* =========================
   ADMIN: APPROVE PAYMENT
   ========================= */
router.post("/admin/approve/:id", async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query("BEGIN");

    // Get the payment record first
    const paymentRes = await pool.query(
      "SELECT user_id, emi_id, loan_id FROM payments WHERE id = $1",
      [id]
    );

    if (paymentRes.rows.length === 0) {
      await pool.query("ROLLBACK");
      return res.status(404).json({
        success: false,
        message: "Payment not found"
      });
    }

    const { user_id, emi_id, loan_id } = paymentRes.rows[0];
    const isEmiPayment = !!emi_id;

    // 1. Update payment status to approved
    await pool.query(
      `UPDATE payments SET status = 'approved', updated_at = NOW() WHERE id = $1`,
      [id]
    );

    if (isEmiPayment) {
      // 2a. Mark the EMI as Paid
      await pool.query(
        `UPDATE loan_emis SET status = 'Paid', paid_date = NOW(), transaction_id = $1 WHERE id = $2`,
        ['ADM' + Date.now(), emi_id]
      );

      // Get EMI details for notification message
      const emiInfo = await pool.query(
        `SELECT le.emi_number, le.amount, la.scheme_name 
         FROM loan_emis le 
         JOIN loan_applications la ON le.loan_application_id = la.id 
         WHERE le.id = $1`,
        [emi_id]
      );
      const emi = emiInfo.rows[0];

      // 3a. Notification for EMI payment approved
      await pool.query(
        `INSERT INTO notifications (user_id, title, message) VALUES ($1, $2, $3)`,
        [
          user_id,
          "✅ EMI Payment Approved",
          `Your EMI #${emi?.emi_number || ''} payment of ₹${parseFloat(emi?.amount || 0).toLocaleString('en-IN')} for "${emi?.scheme_name || 'your scheme'}" has been verified and approved!`
        ]
      );
      // 2b. Registration payment: set reg_pay = true
      await pool.query(
        `UPDATE users SET reg_pay = true, updated_at = NOW() WHERE id = $1`,
        [user_id]
      );

      // 3b. Notification for registration payment approved
      await pool.query(
        `INSERT INTO notifications (user_id, title, message) VALUES ($1, $2, $3)`,
        [
          user_id,
          "✅ Registration Payment Approved",
          "Your manual registration payment has been successfully approved! You can now generate your Student ID card."
        ]
      );

      // 4b. Auto-activate student card if application and documents are already approved
      try {
        const userRes = await pool.query(
          "SELECT student_id FROM users WHERE id = $1",
          [user_id]
        );
        if (userRes.rows.length > 0 && !userRes.rows[0].student_id) {
          const appRes = await pool.query(
            "SELECT id, status FROM applications WHERE user_id = $1",
            [user_id]
          );
          if (appRes.rows.length > 0 && appRes.rows[0].status === "approved") {
            const appId = appRes.rows[0].id;
            const docsRes = await pool.query(
              "SELECT status FROM application_documents WHERE application_id = $1",
              [appId]
            );
            const allDocsApproved = docsRes.rows.length > 0 && docsRes.rows.every(d => d.status === "approved");
            
            if (allDocsApproved) {
              const random = Math.floor(1000000000 + Math.random() * 9000000000);
              const studentId = `PSWB${random}`;
              
              await pool.query(
                `UPDATE users 
                 SET 
                   student_id = $1,
                   stu_card = TRUE,
                   stu_card_verified = TRUE
                 WHERE id = $2`,
                [studentId, user_id]
              );

              await pool.query(
                `INSERT INTO notifications (user_id, title, message)
                 VALUES ($1, $2, $3)`,
                [
                  user_id,
                  "🎓 Student ID Generated",
                  `Your Student ID is ${studentId}`
                ]
              );
              console.log(`Auto-activated student card for user ${user_id} on payment approval.`);
            }
          }
        }
      } catch (err) {
        console.error("Auto-activation error on payment approval:", err);
      }
    }

    await pool.query("COMMIT");

    res.json({
      success: true,
      message: "Payment approved successfully"
    });
  } catch (err) {
    await pool.query("ROLLBACK");
    console.error("Approve payment error:", err);
    res.status(500).json({
      success: false,
      message: "Server error"
    });
  }
});

/* =========================
   ADMIN: REJECT PAYMENT
   ========================= */
router.post("/admin/reject/:id", async (req, res) => {
  const { id } = req.params;
  const { reason } = req.body;

  if (!reason) {
    return res.status(400).json({
      success: false,
      message: "Rejection reason is required"
    });
  }

  try {
    await pool.query("BEGIN");

    // Get the payment record first
    const paymentRes = await pool.query(
      "SELECT user_id, emi_id FROM payments WHERE id = $1",
      [id]
    );

    if (paymentRes.rows.length === 0) {
      await pool.query("ROLLBACK");
      return res.status(404).json({
        success: false,
        message: "Payment not found"
      });
    }

    const { user_id, emi_id } = paymentRes.rows[0];
    const isEmiPayment = !!emi_id;

    // 1. Update payment status to rejected
    await pool.query(
      `UPDATE payments SET status = 'rejected', rejection_reason = $1, updated_at = NOW() WHERE id = $2`,
      [reason, id]
    );

    if (isEmiPayment) {
      // 2a. Reset EMI back to Pending or Overdue based on due_date
      await pool.query(
        `UPDATE loan_emis 
         SET status = CASE WHEN due_date < CURRENT_DATE THEN 'Overdue' ELSE 'Pending' END
         WHERE id = $1`,
        [emi_id]
      );

      // Get EMI details for notification
      const emiInfo = await pool.query(
        `SELECT le.emi_number, la.scheme_name 
         FROM loan_emis le 
         JOIN loan_applications la ON le.loan_application_id = la.id 
         WHERE le.id = $1`,
        [emi_id]
      );
      const emi = emiInfo.rows[0];

      // 3a. Notification for EMI rejection
      await pool.query(
        `INSERT INTO notifications (user_id, title, message) VALUES ($1, $2, $3)`,
        [
          user_id,
          "❌ EMI Payment Rejected",
          `Your EMI #${emi?.emi_number || ''} payment for "${emi?.scheme_name || 'your scheme'}" was rejected. Reason: ${reason}. Please re-submit with correct details.`
        ]
      );
    } else {
      // 2b. Clear reg_pay for registration payment rejection
      await pool.query(
        `UPDATE users SET reg_pay = false, updated_at = NOW() WHERE id = $1`,
        [user_id]
      );

      // 3b. Notification for registration rejection
      await pool.query(
        `INSERT INTO notifications (user_id, title, message) VALUES ($1, $2, $3)`,
        [
          user_id,
          "❌ Registration Payment Rejected",
          `Your registration payment was rejected. Reason: ${reason}. Please submit again with correct details.`
        ]
      );
    }

    await pool.query("COMMIT");

    res.json({
      success: true,
      message: "Payment rejected successfully"
    });
  } catch (err) {
    await pool.query("ROLLBACK");
    console.error("Reject payment error:", err);
    res.status(500).json({
      success: false,
      message: "Server error"
    });
  }
});

/* ==========================================================
   ADMIN: GET PAYMENT & DISBURSEMENT HISTORY (INFLOW & OUTFLOW)
   ========================================================== */
router.get("/admin/history", async (req, res) => {
  try {
    // 1. Get Inflow (all payments: approved, pending, rejected)
    const inflowRes = await pool.query(
      `SELECT 
         p.id,
         p.user_id,
         p.utr,
         p.via_payment,
         p.created_at,
         p.status,
         p.emi_id,
         p.loan_id,
         u.full_name,
         u.email,
         u.phone_number,
         u.student_id,
         le.emi_number,
         le.due_date,
         le.amount AS emi_amount,
         la.scheme_name,
         COALESCE(le.amount, 1200) AS amount
       FROM payments p
       JOIN users u ON p.user_id = u.id
       LEFT JOIN loan_emis le ON p.emi_id = le.id
       LEFT JOIN loan_applications la ON p.loan_id = la.id
       ORDER BY p.created_at DESC`
    );

    // 2. Get Outflow (all disbursed loan applications)
    const outflowRes = await pool.query(
      `SELECT 
         la.id,
         la.user_id,
         la.scheme_name,
         la.requested_amount AS amount,
         la.tenure_months,
         la.monthly_emi,
         la.created_at,
         la.status,
         la.bank_name,
         la.account_number,
         la.account_holder,
         la.ifsc_code,
         u.full_name,
         u.email,
         u.phone_number,
         u.student_id
       FROM loan_applications la
       JOIN users u ON la.user_id = u.id
       WHERE la.status = 'disbursed'
       ORDER BY la.created_at DESC`
    );

    // 3. Compute stats
    let totalInflow = 0;
    let pendingInflow = 0;
    let rejectedInflow = 0;

    inflowRes.rows.forEach(p => {
      const amt = parseFloat(p.amount) || 0;
      if (p.status === 'approved') {
        totalInflow += amt;
      } else if (p.status === 'pending') {
        pendingInflow += amt;
      } else if (p.status === 'rejected') {
        rejectedInflow += amt;
      }
    });

    let totalOutflow = 0;
    outflowRes.rows.forEach(o => {
      totalOutflow += parseFloat(o.amount) || 0;
    });

    res.json({
      success: true,
      stats: {
        totalInflow,
        pendingInflow,
        rejectedInflow,
        totalOutflow,
        netCashflow: totalInflow - totalOutflow
      },
      inflow: inflowRes.rows,
      outflow: outflowRes.rows
    });
  } catch (err) {
    console.error("GET admin history error:", err);
    res.status(500).json({
      success: false,
      message: "Server error"
    });
  }
});

module.exports = router;