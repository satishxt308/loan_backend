const express = require("express");
const router = express.Router();
const db = require("../db/db");


// ✅ GET WALLET + HISTORY
router.get("/:userId", async (req, res) => {
  const { userId } = req.params;

  try {
    const wallet = await db.query(
      "SELECT * FROM wallets WHERE user_id=$1",
      [userId]
    );

    const history = await db.query(
      "SELECT * FROM wallet_transactions WHERE user_id=$1 ORDER BY id DESC",
      [userId]
    );

    res.json({
      balance: wallet.rows[0]?.balance || 0,
      transactions: history.rows,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/add", async (req, res) => {
  const { user_id, amount, utr, note, screenshot } = req.body;

  try {
    console.log("📥 Incoming Data:", req.body);

    const user = await db.query(
      "SELECT id, employee_id FROM users WHERE id=$1",
      [user_id]
    );

    console.log("👤 User Data:", user.rows);

    if (!user.rows.length) {
      console.log("❌ User not found");
      return res.status(400).json({ msg: "User not found" });
    }

    if (!user.rows[0].employee_id) {
      console.log("❌ employee_id missing for user:", user.rows[0]);
      return res.status(400).json({ msg: "Apply for Employee ID" });
    }

    console.log("✅ Employee verified");

    // continue...

    const pending = await db.query(
      "SELECT * FROM wallet_transactions WHERE user_id=$1 AND status='PENDING'",
      [user_id]
    );

    if (pending.rows.length > 0) {
      return res.status(400).json({ msg: "Pending request exists" });
    }

    // ✅ CONVERT BASE64 → BUFFER
    let imageBuffer = null;
    if (screenshot) {
      imageBuffer = Buffer.from(screenshot, "base64");
    }

    await db.query(
      `INSERT INTO wallet_transactions 
      (user_id, type, amount, utr, note, screenshot)
      VALUES ($1,'ADD',$2,$3,$4,$5)`,
      [user_id, amount, utr, note, imageBuffer]
    );

    res.json({ msg: "Request submitted" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/withdraw", async (req, res) => {
  const {
    user_id,
    amount,
    payment_method,
    bank_name,
    account_holder,
    ifsc_code,
    upi_id,
  } = req.body;

  try {
    // check pending
    const pending = await db.query(
      "SELECT * FROM wallet_transactions WHERE user_id=$1 AND status='PENDING'",
      [user_id]
    );

    if (pending.rows.length > 0) {
      return res.status(400).json({ msg: "Pending request exists" });
    }

    await db.query(
      `INSERT INTO wallet_transactions 
      (user_id, type, amount, payment_method, bank_name, account_holder, ifsc_code, upi_id)
      VALUES ($1,'WITHDRAW',$2,$3,$4,$5,$6,$7)`,
      [user_id, amount, payment_method, bank_name, account_holder, ifsc_code, upi_id]
    );

    res.json({ msg: "Withdraw request sent" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ✅ GET USER PAYMENT DETAILS (BANK + UPI)
router.get("/payment-details/:userId", async (req, res) => {
  const { userId } = req.params;

  try {
    const result = await db.query(
      `SELECT 
        id,
        type,
        amount,
        payment_method,
        bank_name,
        account_holder,
        ifsc_code,
        upi_id,
        status,
        created_at
       FROM wallet_transactions
       WHERE user_id = $1
       AND type = 'WITHDRAW'
       ORDER BY id DESC`,
      [userId]
    );

    res.json({
      success: true,
      data: result.rows
    });

  } catch (err) {
    console.error("Error fetching payment details:", err);
    res.status(500).json({ error: err.message });
  }
});

router.get("/user/:userId", async (req, res) => {
  const { userId } = req.params;

  try {
    // ✅ BALANCE (only APPROVED)
    const balanceRes = await db.query(
      `SELECT 
        COALESCE(SUM(
          CASE 
            WHEN type='ADD' AND status='APPROVED' THEN amount
            WHEN type='WITHDRAW' AND status='APPROVED' THEN -amount
            ELSE 0
          END
        ),0) as balance
      FROM wallet_transactions
      WHERE user_id=$1`,
      [userId]
    );

    // ✅ PENDING
    const pendingRes = await db.query(
      `SELECT 
        COALESCE(SUM(amount),0) as pending
      FROM wallet_transactions
      WHERE user_id=$1 AND status='PENDING'`,
      [userId]
    );

    // ✅ TRANSACTIONS
    const trxRes = await db.query(
      `SELECT * FROM wallet_transactions
       WHERE user_id=$1
       ORDER BY id DESC`,
      [userId]
    );

    res.json({
      balance: balanceRes.rows[0].balance,
      pending: pendingRes.rows[0].pending,
      transactions: trxRes.rows,
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Add to your wallet routes file

// Employee cancel their own pending request
router.put("/employee/cancel/:id", async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  
  try {
    const trx = await db.query(
      "SELECT * FROM wallet_transactions WHERE id=$1 AND status='PENDING'",
      [id]
    );
    
    if (!trx.rows.length) {
      return res.status(404).json({ msg: "Request not found or already processed" });
    }
    
    await db.query(
      "UPDATE wallet_transactions SET status=$1 WHERE id=$2",
      [status, id]
    );
    
    res.json({ msg: "Request cancelled successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put("/admin/update/:id", async (req, res) => {
  const { status, reject_reason } = req.body;
  const { id } = req.params;

  try {
    const trx = await db.query(
      "SELECT * FROM wallet_transactions WHERE id=$1",
      [id]
    );

    const data = trx.rows[0];
    if (!data) return res.status(404).json({ msg: "Not found" });

    if (data.status !== "PENDING") {
      return res.status(400).json({ msg: "Already processed" });
    }

    // ✅ Update transaction
    await db.query(
      `UPDATE wallet_transactions 
       SET status=$1,
           reject_reason=$2
       WHERE id=$3`,
      [
        status,
        status === "REJECTED" ? reject_reason : null,
        id
      ]
    );

    // ✅ Wallet balance update
    if (status === "APPROVED") {
      await db.query(
        `UPDATE wallets 
         SET balance = balance + $1 
         WHERE user_id=$2`,
        [data.amount, data.user_id]
      );
    }

    // 🔥 INSERT NOTIFICATION
    let title = "";
    let message = "";

    if (status === "APPROVED") {
      title = "✅ Request Approved";
      message = `Your ${data.type} request of ₹${data.amount} has been approved.`;
    } else if (status === "REJECTED") {
      title = "❌ Request Rejected";
      message = `Your ${data.type} request of ₹${data.amount} was rejected. Reason: ${reject_reason}`;
    }

    await db.query(
      `INSERT INTO notifications (user_id, title, message)
       VALUES ($1, $2, $3)`,
      [data.user_id, title, message]
    );

    res.json({ msg: "Updated successfully" });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Add to your wallet routes file - GET ALL REQUESTS FOR ADMIN
router.get("/admin/all-requests", async (req, res) => {
  try {
    // Fetch all wallet transactions with user details
    const result = await db.query(`
      SELECT 
        wt.*,
        u.full_name,
        u.email,
        u.phone_number,
        u.employee_id
      FROM wallet_transactions wt
      JOIN users u ON wt.user_id = u.id
      ORDER BY wt.id DESC
    `);
    
    res.json({
      success: true,
      requests: result.rows
    });
  } catch (err) {
    console.error("Error fetching all requests:", err);
    res.status(500).json({ error: err.message });
  }
});

// Get request statistics for admin dashboard
router.get("/admin/stats", async (req, res) => {
  try {
    const stats = await db.query(`
      SELECT 
        COUNT(CASE WHEN status = 'PENDING' THEN 1 END) as pending_count,
        COUNT(CASE WHEN status = 'APPROVED' THEN 1 END) as approved_count,
        COUNT(CASE WHEN status = 'REJECTED' THEN 1 END) as rejected_count,
        COALESCE(SUM(CASE WHEN status = 'PENDING' AND type = 'ADD' THEN amount ELSE 0 END), 0) as pending_add_amount,
        COALESCE(SUM(CASE WHEN status = 'PENDING' AND type = 'WITHDRAW' THEN amount ELSE 0 END), 0) as pending_withdraw_amount,
        COALESCE(SUM(CASE WHEN status = 'APPROVED' AND type = 'ADD' THEN amount ELSE 0 END), 0) as total_added,
        COALESCE(SUM(CASE WHEN status = 'APPROVED' AND type = 'WITHDRAW' THEN amount ELSE 0 END), 0) as total_withdrawn
      FROM wallet_transactions
    `);
    
    res.json({
      success: true,
      stats: stats.rows[0]
    });
  } catch (err) {
    console.error("Error fetching stats:", err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;