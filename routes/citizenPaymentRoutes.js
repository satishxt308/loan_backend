// routes/citizenPaymentRoutes.js - FIXED

console.log("🔵 citizenPaymentRoutes.js is being loaded...");

const express = require("express");
const router = express.Router();
const db = require("../db/db");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

// Configure multer for memory storage (for base64 conversion)
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    if (mimetype && extname) {
      return cb(null, true);
    }
    cb(new Error("Only image files are allowed"));
  },
});

// Helper to convert buffer to base64
const bufferToBase64 = (buffer) => {
  if (!buffer) return null;
  return buffer.toString("base64");
};

// Helper to convert base64 to buffer
const base64ToBuffer = (base64Str) => {
  if (!base64Str) return null;
  const base64Data = base64Str.replace(/^data:image\/\w+;base64,/, "");
  return Buffer.from(base64Data, "base64");
};

// ============================================
// 1. GET all citizen payments for an employee
// ============================================
router.get("/employee/:employeeId", async (req, res) => {
  try {
    const { employeeId } = req.params;

    const query = `
      SELECT 
        cph.*,
        u.full_name as citizen_name,
        u.email as citizen_email,
        u.phone_number as citizen_phone,
        e.full_name as employee_name
      FROM citizen_payment_history cph
      LEFT JOIN users u ON cph.citizen_id = u.id
      LEFT JOIN users e ON cph.employee_id = e.id
      WHERE cph.employee_id = $1
      ORDER BY cph.created_at DESC
    `;

    const result = await db.query(query, [employeeId]);

    const payments = result.rows.map(row => ({
      ...row,
      payment_image: row.payment_image ? bufferToBase64(row.payment_image) : null,
    }));

    res.json({
      success: true,
      payments,
    });
  } catch (error) {
    console.error("Error fetching citizen payments:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch payments",
      error: error.message,
    });
  }
});

// ============================================
// 2. GET payments for a specific citizen
// ============================================
router.get("/citizen/:citizenId", async (req, res) => {
  try {
    const { citizenId } = req.params;

    const query = `
      SELECT 
        cph.*,
        e.full_name as employee_name
      FROM citizen_payment_history cph
      LEFT JOIN users e ON cph.employee_id = e.id
      WHERE cph.citizen_id = $1
      ORDER BY cph.created_at DESC
    `;

    const result = await db.query(query, [citizenId]);

    const payments = result.rows.map(row => ({
      ...row,
      payment_image: row.payment_image ? bufferToBase64(row.payment_image) : null,
    }));

    res.json({
      success: true,
      payments,
    });
  } catch (error) {
    console.error("Error fetching citizen payments:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch payments",
      error: error.message,
    });
  }
});

// ============================================
// Helper: Ensure citizen exists in users table
// ============================================
const ensureCitizenExists = async (citizenId) => {
  // Check if citizen exists
  const check = await db.query(
    "SELECT id, full_name FROM users WHERE id = $1",
    [citizenId]
  );

  if (check.rows.length === 0) {
    console.log(`🔵 Creating citizen with ID: ${citizenId}`);
    await db.query(
      `INSERT INTO users (id, full_name, email, phone_number, role, created_at, updated_at)
       VALUES ($1, 'Citizen ${citizenId}', 'citizen${citizenId}@example.com', '${citizenId}0000000000', 'citizen', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [citizenId]
    );
    return true;
  }
  return false;
};

// ============================================
// 3. Submit citizen payment (with screenshot)
// ============================================
router.post("/citizen/confirm", upload.single("payment_image"), async (req, res) => {
  console.log("📥 POST /citizen/confirm");
  console.log("Body:", req.body);
  console.log("File:", req.file ? "✅ File received" : "❌ No file");
  
  try {
    const { 
      user_id, 
      utr, 
      via_payment, 
      submitted_by_employee,
      payment_type,
      employee_id
    } = req.body;

    if (!user_id) {
      return res.status(400).json({
        success: false,
        message: "Citizen ID is required",
      });
    }

    if (!utr) {
      return res.status(400).json({
        success: false,
        message: "UTR number is required",
      });
    }

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "Payment screenshot is required",
      });
    }

    // Ensure citizen exists in users table (auto-create if not)
    await ensureCitizenExists(user_id);

    // Check if UTR already exists (prevent duplicate submissions)
    const utrCheck = await db.query(
      "SELECT id FROM citizen_payment_history WHERE utr = $1",
      [utr]
    );

    if (utrCheck.rows.length > 0) {
      return res.status(400).json({
        success: false,
        message: "UTR already exists. Please check your transaction.",
      });
    }

    // Get employee ID
    let empId = null;
    if (submitted_by_employee === "true") {
      if (employee_id) {
        const employeeData = await db.query(
          "SELECT id FROM users WHERE id = $1",
          [employee_id]
        );
        if (employeeData.rows.length > 0) {
          empId = employeeData.rows[0].id;
        }
      }
    }

    let amount = 1200;
    try {
      const settings = await db.query(
        "SELECT citizen_amount FROM payment_settings ORDER BY id DESC LIMIT 1"
      );
      if (settings.rows.length > 0 && settings.rows[0].citizen_amount) {
        amount = settings.rows[0].citizen_amount;
      }
    } catch (e) {
      console.log("Using default amount:", amount);
    }

    const paymentImageBuffer = req.file.buffer;

    // ✅ Status is set to 'PENDING' by default
    const insertQuery = `
      INSERT INTO citizen_payment_history (
        citizen_id,
        employee_id,
        amount,
        payment_type,
        payment_method,
        utr,
        payment_image,
        status,
        created_at,
        updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'PENDING', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      RETURNING id, status
    `;

    const result = await db.query(insertQuery, [
      user_id,
      empId,
      amount,
      payment_type || "citizen_card",
      via_payment || "qr",
      utr,
      paymentImageBuffer,
    ]);

    res.json({
      success: true,
      message: "Payment submitted successfully",
      paymentId: result.rows[0].id,
      status: result.rows[0].status,
    });

  } catch (error) {
    console.error("Error submitting citizen payment:", error);
    res.status(500).json({
      success: false,
      message: "Failed to submit payment",
      error: error.message,
    });
  }
});

// ============================================
// 4. Employee wallet deduction for citizen
// ============================================
router.post("/employee/deduct-wallet-citizen", async (req, res) => {
  const client = await db.connect();

  try {
    const { citizen_id, employee_id, amount, payment_type } = req.body;

    if (!citizen_id || !employee_id || !amount) {
      return res.status(400).json({
        success: false,
        message: "Citizen ID, Employee ID and amount are required."
      });
    }

    await client.query("BEGIN");

    await ensureCitizenExists(citizen_id);

    // Check duplicate payment
    const paymentCheck = await client.query(
      `SELECT status
       FROM citizen_payment_history
       WHERE citizen_id=$1
       ORDER BY created_at DESC
       LIMIT 1`,
      [citizen_id]
    );

    if (paymentCheck.rows.length) {
      const status = paymentCheck.rows[0].status;

      if (status === "PENDING") {
        await client.query("ROLLBACK");

        return res.status(400).json({
          success: false,
          message:
            "A payment for this citizen is already pending approval. Please wait for the admin to verify it."
        });
      }

      if (status === "APPROVED") {
        await client.query("ROLLBACK");

        return res.status(400).json({
          success: false,
          message:
            "Citizen card payment has already been completed for this citizen."
        });
      }
    }

    const wallet = await client.query(
      `SELECT wallet_balance
       FROM users
       WHERE id=$1
       FOR UPDATE`,
      [employee_id]
    );

    if (!wallet.rows.length) {
      await client.query("ROLLBACK");

      return res.status(404).json({
        success: false,
        message: "Employee not found."
      });
    }

    const balance = Number(wallet.rows[0].wallet_balance);

    if (balance < amount) {
      await client.query("ROLLBACK");

      return res.status(400).json({
        success: false,
        message: `Insufficient wallet balance.\nAvailable: ₹${balance}\nRequired: ₹${amount}`
      });
    }

    // Deduct wallet
    await client.query(
      `UPDATE users
       SET wallet_balance = wallet_balance - $1
       WHERE id=$2`,
      [amount, employee_id]
    );

    // Wallet history
    const walletTx = await client.query(
      `INSERT INTO wallet_transactions
      (
        user_id,
        type,
        amount,
        note,
        payment_method,
        status,
        created_at
      )
      VALUES
      (
        $1,
        'WITHDRAW',
        $2,
        $3,
        'wallet',
        'APPROVED',
        CURRENT_TIMESTAMP
      )
      RETURNING id`,
      [
        employee_id,
        amount,
        `Citizen card payment for citizen ${citizen_id}`
      ]
    );

    const walletTransactionId = walletTx.rows[0].id;

    // Payment history
    const payment = await client.query(
      `INSERT INTO citizen_payment_history
      (
        citizen_id,
        employee_id,
        amount,
        payment_type,
        payment_method,
        wallet_transaction_id,
        status,
        created_at,
        updated_at
      )
      VALUES
      (
        $1,
        $2,
        $3,
        $4,
        'wallet',
        $5,
        'PENDING',
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
      )
      RETURNING id`,
      [
        citizen_id,
        employee_id,
        amount,
        payment_type || "citizen_card",
        walletTransactionId
      ]
    );

    await client.query("COMMIT");

    res.json({
      success: true,
      message:
        "₹" +
        amount +
        " has been deducted successfully. Payment is pending admin approval.",
      paymentId: payment.rows[0].id,
      status: "PENDING",
      newBalance: balance - amount
    });

  } catch (err) {
    await client.query("ROLLBACK");

    console.error(err);

    res.status(500).json({
      success: false,
      message:
        "Payment could not be completed. Your wallet has NOT been deducted.",
      error: err.message
    });

  } finally {
    client.release();
  }
});

// ============================================
// 5. Admin: Approve citizen payment
// ============================================
router.put("/admin/approve/:paymentId", async (req, res) => {
  try {
    const { paymentId } = req.params;
    const { admin_id, remarks } = req.body;

    const paymentCheck = await db.query(
      "SELECT * FROM citizen_payment_history WHERE id = $1",
      [paymentId]
    );

    if (paymentCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Payment not found",
      });
    }

    const payment = paymentCheck.rows[0];

    if (payment.status === "APPROVED") {
      return res.status(400).json({
        success: false,
        message: "Payment already approved",
      });
    }

    // Update payment status to APPROVED
    await db.query(
      `UPDATE citizen_payment_history 
       SET status = 'APPROVED', 
           approved_by = $1, 
           approved_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $2`,
      [admin_id, paymentId]
    );

    // Update citizen verification status to verified
    await db.query(
      "UPDATE citizens SET verification_status = 'verified' WHERE user_id = $1",
      [payment.citizen_id]
    );

    // Also update users table if needed
    await db.query(
      "UPDATE users SET citizen_card_status = 'active' WHERE id = $1",
      [payment.citizen_id]
    );

    res.json({
      success: true,
      message: "Payment approved successfully",
    });

  } catch (error) {
    console.error("Error approving payment:", error);
    res.status(500).json({
      success: false,
      message: "Failed to approve payment",
      error: error.message,
    });
  }
});

// ============================================
// 6. Admin: Reject citizen payment
// ============================================
router.put("/admin/reject/:paymentId", async (req, res) => {
  try {
    const { paymentId } = req.params;
    const { admin_id, rejection_reason } = req.body;

    if (!rejection_reason) {
      return res.status(400).json({
        success: false,
        message: "Rejection reason is required",
      });
    }

    const paymentCheck = await db.query(
      "SELECT * FROM citizen_payment_history WHERE id = $1",
      [paymentId]
    );

    if (paymentCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Payment not found",
      });
    }

    const payment = paymentCheck.rows[0];

    if (payment.status === "APPROVED") {
      return res.status(400).json({
        success: false,
        message: "Payment is already approved",
      });
    }

    // Update payment status to REJECTED
    await db.query(
      `UPDATE citizen_payment_history 
       SET status = 'REJECTED', 
           rejection_reason = $1,
           approved_by = $2,
           approved_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $3`,
      [rejection_reason, admin_id, paymentId]
    );

    // Update citizen verification status back to pending
    await db.query(
      "UPDATE citizens SET verification_status = 'pending' WHERE user_id = $1",
      [payment.citizen_id]
    );

    res.json({
      success: true,
      message: "Payment rejected",
    });

  } catch (error) {
    console.error("Error rejecting payment:", error);
    res.status(500).json({
      success: false,
      message: "Failed to reject payment",
      error: error.message,
    });
  }
});

// ============================================
// 7. Get payment status for a citizen
// ============================================
router.get("/status/:citizenId", async (req, res) => {
  try {
    const { citizenId } = req.params;

    const query = `
      SELECT 
        id,
        amount,
        payment_method,
        utr,
        status,
        created_at,
        approved_at,
        rejection_reason
      FROM citizen_payment_history
      WHERE citizen_id = $1
      ORDER BY created_at DESC
      LIMIT 1
    `;

    const result = await db.query(query, [citizenId]);

    if (result.rows.length === 0) {
      return res.json({
        success: true,
        hasPayment: false,
        message: "No payment found for this citizen",
      });
    }

    res.json({
      success: true,
      hasPayment: true,
      payment: result.rows[0],
    });

  } catch (error) {
    console.error("Error fetching payment status:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch payment status",
      error: error.message,
    });
  }
});

// ============================================
// 8. Get all citizen payments (admin)
// ============================================
router.get("/admin/all", async (req, res) => {
  try {
    const query = `
      SELECT
        cph.id,
        cph.citizen_id,
        cph.employee_id,
        cph.amount,
        cph.payment_type,
        cph.payment_method,
        cph.utr,
        cph.wallet_transaction_id,
        cph.status,
        cph.remarks,
        cph.rejection_reason,
        cph.approved_by,
        cph.approved_at,
        cph.created_at,
        cph.updated_at,

        c.id AS citizen_table_id,
        c.name AS citizen_name,
        c.date_of_birth,
        c.age,
        c.gender,
        c.phone,
        c.address,
        c.occupation,
        c.annual_income,
        c.aadhaar_number,
        c.pan_number,
        c.verification_status,

        cu.full_name AS citizen_user_name,
        cu.email AS citizen_email,
        cu.phone_number AS citizen_mobile,

        e.full_name AS employee_name,
        e.email AS employee_email,

        CASE
          WHEN LOWER(COALESCE(cph.payment_method, '')) = 'wallet' THEN NULL
          WHEN cph.payment_image IS NOT NULL
            THEN 'data:image/jpeg;base64,' || encode(cph.payment_image, 'base64')
          ELSE NULL
        END AS payment_image

      FROM citizen_payment_history cph

      LEFT JOIN citizens c
        ON c.user_id = cph.citizen_id

      LEFT JOIN users cu
        ON cu.id = cph.citizen_id

      LEFT JOIN users e
        ON e.id = cph.employee_id

      ORDER BY cph.created_at DESC;
    `;

    const result = await db.query(query);

    res.json({
      success: true,
      count: result.rows.length,
      payments: result.rows,
    });

  } catch (error) {
    console.error("Error fetching citizen payment history:", error);

    res.status(500).json({
      success: false,
      message: "Failed to fetch citizen payment history",
      error: error.message,
    });
  }
});
// ============================================
// 9. Update payment status (for retry)
// ============================================
router.put("/update-status/:paymentId", async (req, res) => {
  try {
    const { paymentId } = req.params;
    const { status } = req.body;

    if (!status) {
      return res.status(400).json({
        success: false,
        message: "Status is required",
      });
    }

    const result = await db.query(
      `UPDATE citizen_payment_history 
       SET status = $1,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $2
       RETURNING id, status`,
      [status, paymentId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Payment not found",
      });
    }

    res.json({
      success: true,
      message: "Payment status updated",
      payment: result.rows[0],
    });

  } catch (error) {
    console.error("Error updating payment status:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update payment status",
      error: error.message,
    });
  }
});

module.exports = router;