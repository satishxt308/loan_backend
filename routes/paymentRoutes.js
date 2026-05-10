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
    const { user_id, utr, via_payment } = req.body;

    if (!user_id || !utr) {
      return res.status(400).json({
        success: false,
        message: "Missing fields"
      });
    }

    await pool.query(
      `INSERT INTO payments 
       (user_id, utr, via_payment, payment_image, status)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        user_id,
        utr,
        via_payment,
        req.file ? req.file.buffer : null,
        false // pending verification
      ]
    );

    // ✅ INSERT PAYMENT
await pool.query(
  `INSERT INTO payments 
   (user_id, utr, via_payment, payment_image, status)
   VALUES ($1, $2, $3, $4, $5)`,
  [
    user_id,
    utr,
    via_payment,
    req.file ? req.file.buffer : null,
    false // pending verification
  ]
);

// ✅ UPDATE STUDENT CARD (IMPORTANT)
await pool.query(
  `UPDATE users 
   SET stu_card = true 
   WHERE id = $1`,
  [user_id]
);

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
   SET stu_card = true 
   WHERE id = $1`,
  [student_id]
);
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
module.exports = router;