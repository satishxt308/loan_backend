const express = require("express");
const router = express.Router();
const db = require("../db/db");

// ✅ Helper response
const success = (res, message, data = {}) =>
  res.json({ success: true, msg: message, data });

const fail = (res, message, code = 400) =>
  res.status(code).json({ success: false, msg: message });

router.get("/user/:userId", async (req, res) => {
  const { userId } = req.params;

  try {
    // ✅ GET BALANCE FROM USERS TABLE
    const userRes = await db.query(
      `SELECT wallet_balance FROM users WHERE id=$1`,
      [userId]
    );

    const balance = Number(userRes.rows[0]?.wallet_balance || 0);

    // ✅ PENDING AMOUNT
    const pendingRes = await db.query(
      `SELECT 
        COALESCE(SUM(amount),0) as pending
      FROM wallet_transactions
      WHERE user_id=$1 AND status='PENDING'`,
      [userId]
    );

    // ✅ ALL TRANSACTIONS
    const trxRes = await db.query(
      `SELECT * FROM wallet_transactions
       WHERE user_id=$1
       ORDER BY id DESC`,
      [userId]
    );

    res.json({
      balance: balance,
      pending: Number(pendingRes.rows[0].pending || 0),
      transactions: trxRes.rows,
    });

  } catch (err) {
    console.error("Wallet fetch error:", err);
    res.status(500).json({ error: err.message });
  }
});

router.get("/admin/all-requests", async (req, res) => {
  try {
    const result = await db.query(`
      SELECT wt.*, u.full_name, u.email, u.phone_number, u.employee_id
      FROM wallet_transactions wt
      JOIN users u ON wt.user_id = u.id
      ORDER BY wt.id DESC
    `);

    res.json({
      success: true,
      requests: result.rows
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: "Failed to fetch requests" });
  }
});

router.get("/admin/stats", async (req, res) => {
  try {
    const stats = await db.query(`
      SELECT
        COUNT(*) FILTER (WHERE status='PENDING') AS pending_count,
        COUNT(*) FILTER (WHERE status='APPROVED') AS approved_count,
        COUNT(*) FILTER (WHERE status='REJECTED') AS rejected_count,

        COALESCE(SUM(amount) FILTER (WHERE status='PENDING' AND type='ADD'),0) AS pending_add_amount,
        COALESCE(SUM(amount) FILTER (WHERE status='PENDING' AND type='WITHDRAW'),0) AS pending_withdraw_amount,

        COALESCE(SUM(amount) FILTER (WHERE status='APPROVED' AND type='ADD'),0) AS total_added,
        COALESCE(SUM(amount) FILTER (WHERE status='APPROVED' AND type='WITHDRAW'),0) AS total_withdrawn
      FROM wallet_transactions
    `);

    res.json({
      success: true,
      stats: stats.rows[0]
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: "Failed to fetch stats" });
  }
});

// ✅ ADD MONEY
router.post("/add", async (req, res) => {
  const { user_id, amount, utr, note, screenshot } = req.body;

  try {
    if (!user_id || !amount || !utr || !screenshot) {
      return fail(res, "All fields are required");
    }

    if (amount < 100) {
      return fail(res, "Minimum amount is ₹100");
    }

    const user = await db.query(
      "SELECT employee_id FROM users WHERE id=$1",
      [user_id]
    );

    if (!user.rows.length) {
      return fail(res, "User not found");
    }

    if (!user.rows[0].employee_id) {
      return fail(res, "Apply for Employee ID first");
    }

    const pending = await db.query(
      "SELECT 1 FROM wallet_transactions WHERE user_id=$1 AND status='PENDING'",
      [user_id]
    );

    if (pending.rows.length) {
      return fail(res, "You already have a pending request");
    }

    const imageBuffer = Buffer.from(screenshot, "base64");

    await db.query(
      `INSERT INTO wallet_transactions 
       (user_id, type, amount, utr, note, screenshot, status)
       VALUES ($1,'ADD',$2,$3,$4,$5,'PENDING')`,
      [user_id, amount, utr, note, imageBuffer]
    );

    success(res, "Money add request submitted");

  } catch (err) {
    console.error(err);
    fail(res, "Failed to submit request", 500);
  }
});


// ✅ WITHDRAW
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
    if (!user_id || !amount) {
      return fail(res, "Amount is required");
    }

    if (amount < 100) {
      return fail(res, "Minimum withdrawal is ₹100");
    }

    const user = await db.query(
      "SELECT wallet_balance FROM users WHERE id=$1",
      [user_id]
    );

    const balance = Number(user.rows[0]?.wallet_balance || 0);

    if (balance < amount) {
      return fail(res, `Insufficient balance. Available ₹${balance}`);
    }

    const pending = await db.query(
      "SELECT 1 FROM wallet_transactions WHERE user_id=$1 AND status='PENDING'",
      [user_id]
    );

    if (pending.rows.length) {
      return fail(res, "Complete previous request first");
    }

    await db.query(
      `INSERT INTO wallet_transactions 
       (user_id, type, amount, payment_method, bank_name, account_holder, ifsc_code, upi_id, status)
       VALUES ($1,'WITHDRAW',$2,$3,$4,$5,$6,$7,'PENDING')`,
      [user_id, amount, payment_method, bank_name, account_holder, ifsc_code, upi_id]
    );

    await db.query(
      `UPDATE users SET wallet_balance = wallet_balance - $1 WHERE id=$2`,
      [amount, user_id]
    );

    success(res, "Withdrawal request submitted");

  } catch (err) {
    console.error(err);
    fail(res, "Withdrawal failed", 500);
  }
});


// ✅ ADMIN UPDATE
router.put("/admin/update/:id", async (req, res) => {
  const { id } = req.params;
  const { status, reject_reason } = req.body;

  try {
    const trx = await db.query(
      "SELECT * FROM wallet_transactions WHERE id=$1",
      [id]
    );

    if (!trx.rows.length) {
      return fail(res, "Transaction not found");
    }

    const data = trx.rows[0];

    if (data.status !== "PENDING") {
      return fail(res, "Already processed");
    }

    await db.query(
      `UPDATE wallet_transactions 
       SET status=$1, reject_reason=$2
       WHERE id=$3`,
      [
        status,
        status === "REJECTED" ? reject_reason : null,
        id
      ]
    );

    // 💰 LOGIC
    if (status === "APPROVED" && data.type === "ADD") {
      await db.query(
        `UPDATE users SET wallet_balance = wallet_balance + $1 WHERE id=$2`,
        [data.amount, data.user_id]
      );
    }

    if (status === "REJECTED" && data.type === "WITHDRAW") {
      await db.query(
        `UPDATE users SET wallet_balance = wallet_balance + $1 WHERE id=$2`,
        [data.amount, data.user_id]
      );
    }

    // 🔔 Notification
    const message =
      status === "APPROVED"
        ? `Your ${data.type} request ₹${data.amount} approved`
        : `Your ${data.type} request rejected: ${reject_reason}`;

    await db.query(
      `INSERT INTO notifications (user_id, title, message)
       VALUES ($1,$2,$3)`,
      [data.user_id, status, message]
    );

    success(res, "Request updated");

  } catch (err) {
    console.error(err);
    fail(res, "Update failed", 500);
  }
});

// ✅ ADMIN DIRECT CREDIT INDIVIDUAL
router.post("/admin/credit-individual", async (req, res) => {
  const { userId, amount, note } = req.body;

  if (!userId || !amount || amount <= 0) {
    return fail(res, "Invalid user ID or amount");
  }

  const client = await db.connect();
  try {
    await client.query("BEGIN");

    // Check if user exists and is employee
    const userRes = await client.query(
      "SELECT full_name, role FROM users WHERE id = $1",
      [userId]
    );

    if (userRes.rows.length === 0) {
      await client.query("ROLLBACK");
      return fail(res, "Employee not found");
    }

    const employee = userRes.rows[0];
    if (employee.role !== 'employee') {
      await client.query("ROLLBACK");
      return fail(res, "User is not an employee");
    }

    const utr = `ADMIN-MANUAL-${Date.now()}`;
    const txnNote = note || "Direct Credit from Admin";

    // Insert wallet transaction
    await client.query(
      `INSERT INTO wallet_transactions 
       (user_id, type, amount, utr, note, status, created_at)
       VALUES ($1, 'ADD', $2, $3, $4, 'APPROVED', CURRENT_TIMESTAMP)`,
      [userId, amount, utr, txnNote]
    );

    // Update wallet balance
    await client.query(
      `UPDATE users SET wallet_balance = COALESCE(wallet_balance, 0) + $1 WHERE id = $2`,
      [amount, userId]
    );

    // Create notification
    const notifMsg = `Your wallet has been credited with ₹${amount} by Admin. Note: ${txnNote}`;
    await client.query(
      `INSERT INTO notifications (user_id, title, message, created_at)
       VALUES ($1, 'Wallet Credited', $2, CURRENT_TIMESTAMP)`,
      [userId, notifMsg]
    );

    await client.query("COMMIT");
    success(res, "Wallet credited successfully");

  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Admin manual credit error:", err);
    fail(res, err.message, 500);
  } finally {
    client.release();
  }
});

// ✅ ADMIN DIRECT CREDIT BULK (DAILY/MONTHLY)
router.post("/admin/credit-bulk", async (req, res) => {
  const { employeeIds, amount, note, scheduleType } = req.body;

  if (!amount || amount <= 0) {
    return fail(res, "Invalid amount");
  }

  if (!employeeIds || !Array.isArray(employeeIds) || employeeIds.length === 0) {
    return fail(res, "No employees selected");
  }

  const typeLabel = scheduleType ? scheduleType.toUpperCase() : "BULK";
  const txnNote = note || `Admin ${scheduleType || 'Bulk'} Credit`;
  
  const client = await db.connect();
  try {
    await client.query("BEGIN");

    for (const userId of employeeIds) {
      // Verify user is employee
      const userRes = await client.query(
        "SELECT id FROM users WHERE id = $1 AND role = 'employee'",
        [userId]
      );
      if (userRes.rows.length === 0) {
        continue; // Skip invalid or non-employee users
      }

      const utr = `ADMIN-BULK-${typeLabel}-${userId}-${Date.now()}`;

      // Insert transaction
      await client.query(
        `INSERT INTO wallet_transactions 
         (user_id, type, amount, utr, note, status, created_at)
         VALUES ($1, 'ADD', $2, $3, $4, 'APPROVED', CURRENT_TIMESTAMP)`,
        [userId, amount, utr, txnNote]
      );

      // Update wallet balance
      await client.query(
        `UPDATE users SET wallet_balance = COALESCE(wallet_balance, 0) + $1 WHERE id = $2`,
        [amount, userId]
      );

      // Create notification
      const notifMsg = `Your wallet has been credited with a bulk payment of ₹${amount} by Admin. Note: ${txnNote}`;
      await client.query(
        `INSERT INTO notifications (user_id, title, message, created_at)
         VALUES ($1, 'Wallet Bulk Credit', $2, CURRENT_TIMESTAMP)`,
        [userId, notifMsg]
      );
    }

    await client.query("COMMIT");
    success(res, `Bulk credit processed successfully for selected employees`);

  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Admin bulk credit error:", err);
    fail(res, err.message, 500);
  } finally {
    client.release();
  }
});

module.exports = router;