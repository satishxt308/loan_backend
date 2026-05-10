const express = require("express");
const router = express.Router();
const pool = require("../db/db");

// ✅ Check if ALL documents approved
const areAllDocsApproved = async (applicationId) => {
  const res = await pool.query(
    `SELECT status FROM application_documents WHERE application_id = $1`,
    [applicationId]
  );

  return res.rows.every(d => d.status === "approved");
};

// ✅ Check if ALL fields approved
const areAllFieldsApproved = (fieldStatus) => {
  if (!fieldStatus) return false;
  return Object.values(fieldStatus).every(s => s === "approved");
};

// ✅ Generate student ID
const generateStudentId = () => {
  const random = Math.floor(1000000000 + Math.random() * 9000000000);
  return `PSWB${random}`;
};

// ✅ Insert notification
const createNotification = async (userId, title, message) => {
  await pool.query(
    `INSERT INTO notifications (user_id, title, message)
     VALUES ($1, $2, $3)`,
    [userId, title, message]
  );
};

router.get("/applications", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        a.*,
        u.full_name,
        u.email,
        u.phone_number AS phone,
        u.student_id,   -- ✅ added

        CASE 
          WHEN a.category = 'school' THEN a.class
          WHEN a.category = 'college' THEN a.degree
          ELSE a.loan_reason
        END AS course

      FROM applications a
      LEFT JOIN users u 
        ON a.user_id = u.id

      ORDER BY a.id ASC
    `);

    res.json({
      success: true,
      data: result.rows
    });

  } catch (err) {
    console.error("❌ Applications Error:", err);
    res.status(500).json({ success: false });
  }
});

// GET all application documents
router.get("/application-documents", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT * FROM application_documents
      ORDER BY id ASC
    `);

    const data = result.rows.map(doc => ({
      ...doc,
      document_file: doc.document_file
        ? `data:${doc.mime_type};base64,${doc.document_file.toString("base64")}`
        : null
    }));

    res.json({ success: true, data });
  } catch (err) {
    console.error("❌ Documents Error:", err);
    res.status(500).json({ success: false });
  }
});

router.get("/payments", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        p.*,
        a.id AS application_id
      FROM payments p
      LEFT JOIN applications a 
        ON p.user_id = a.user_id
      ORDER BY p.id ASC
    `);

    const data = result.rows.map(pay => ({
      ...pay,
      payment_image: pay.payment_image
        ? `data:image/png;base64,${pay.payment_image.toString("base64")}`
        : null
    }));

    res.json({ success: true, data });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false });
  }
});

router.put("/applications/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { status, rejection_reason } = req.body;

    const appRes = await pool.query(
      `SELECT * FROM applications WHERE id = $1`,
      [id]
    );

    router.post("/upload-by-employee", upload.array("documents"), async (req, res) => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const student_id = parseInt(req.body.user_id);      // 👈 student
    const employee_id = parseInt(req.body.uploaded_by); // 👈 employee
    const docs = req.files;

    if (!student_id) {
      return res.status(400).json({ success: false, error: "Student ID required" });
    }

    // 1️⃣ Get or create application for student
    let application = await client.query(
      "SELECT id FROM applications WHERE user_id = $1 LIMIT 1",
      [student_id]
    );

    let application_id;

    if (application.rows.length === 0) {
      application_id = "APP" + Date.now() + Math.floor(Math.random() * 1000);

      await client.query(
        `INSERT INTO applications (id, user_id, status, category) 
         VALUES ($1, $2, 'pending', 'others')`,
        [application_id, student_id]
      );
    } else {
      application_id = application.rows[0].id;
    }

    // 2️⃣ Upload documents
    for (let file of docs) {
      let key = file.originalname.replace(/\.[^/.]+$/, "");

      let document_type =
        key.toLowerCase().includes("guardian") ? "guardian" : "student";

      const existingDoc = await client.query(
        `SELECT id FROM application_documents 
         WHERE application_id=$1 AND document_key=$2`,
        [application_id, key]
      );

      if (existingDoc.rows.length > 0) {
        // 🔁 Update
        await client.query(
          `UPDATE application_documents 
           SET document_file=$1, file_name=$2, file_size=$3, mime_type=$4,
               status='pending', updated_at=NOW(), uploaded_by=$5
           WHERE application_id=$6 AND document_key=$7`,
          [
            file.buffer,
            file.originalname,
            file.size,
            file.mimetype,
            employee_id,
            application_id,
            key,
          ]
        );
      } else {
        // ➕ Insert
        await client.query(
          `INSERT INTO application_documents
           (application_id, user_id, uploaded_by, document_type, document_key,
            document_file, file_name, file_size, mime_type, status)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending')`,
          [
            application_id,
            student_id,
            employee_id,
            document_type,
            key,
            file.buffer,
            file.originalname,
            file.size,
            file.mimetype,
          ]
        );
      }
    }

    await client.query("COMMIT");

    return res.json({
      success: true,
      message: "Documents uploaded by employee successfully",
      application_id,
    });

  } catch (error) {
    await client.query("ROLLBACK");
    console.error("❌ Employee upload error:", error);

    return res.status(500).json({
      success: false,
      error: error.message,
    });
  } finally {
    client.release();
  }
});

    if (appRes.rowCount === 0) {
      return res.status(404).json({ success: false });
    }

    const app = appRes.rows[0];

    // ✅ UPDATE AFTER VALIDATION
    const result = await pool.query(
      `UPDATE applications
       SET status=$1, rejection_reason=$2, last_updated=NOW()
       WHERE id=$3
       RETURNING *`,
      [status, rejection_reason || null, id]
    );

    // ✅ Notification
    await createNotification(
      app.user_id,
      "Application Status Updated",
      `Your application is ${status}`
    );

    res.json({ success: true, data: result.rows[0] });

  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false });
  }
});

router.put("/application-documents/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { status, rejection_reason } = req.body;

    // 1️⃣ Update document
    const docRes = await pool.query(
      `UPDATE application_documents
       SET status=$1, rejection_reason=$2, updated_at=NOW()
       WHERE id=$3
       RETURNING application_id`,
      [status, rejection_reason || null, id]
    );

    const applicationId = docRes.rows[0].application_id;

    // 2️⃣ Check all docs
    const docsApproved = await areAllDocsApproved(applicationId);

    const appRes = await pool.query(
      `SELECT * FROM applications WHERE id=$1`,
      [applicationId]
    );

    const app = appRes.rows[0];
    const fieldsApproved = areAllFieldsApproved(app.field_status);

    // 3️⃣ AUTO APPROVE APPLICATION
    if (docsApproved && fieldsApproved) {
      await pool.query(
        `UPDATE applications
         SET status='approved', last_updated=NOW()
         WHERE id=$1`,
        [applicationId]
      );

      await createNotification(
        app.user_id,
        "Application Approved 🎉",
        "Your application has been approved"
      );
    }

    // 4️⃣ Notification
    await createNotification(
      app.user_id,
      "Document Updated",
      `A document was ${status}`
    );

    res.json({ success: true });

  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false });
  }
});

router.put("/payments/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { status, rejection_reason } = req.body;

    // 1️⃣ Update payment (temporarily)
    const paymentRes = await pool.query(
      `UPDATE payments
       SET status=$1, rejection_reason=$2
       WHERE id=$3
       RETURNING user_id`,
      [status, rejection_reason || null, id]
    );

    if (paymentRes.rowCount === 0) {
      return res.status(404).json({ success: false });
    }

    const userId = paymentRes.rows[0].user_id;

    // 2️⃣ Get application
    const appRes = await pool.query(
      `SELECT * FROM applications WHERE user_id=$1`,
      [userId]
    );

    const app = appRes.rows[0];

    // ❌ No application
    if (!app) {
      return res.json({
        success: false,
        message: "Application not found"
      });
    }

    // 3️⃣ Check all documents
    const docsApproved = await areAllDocsApproved(app.id);

    // ❌ MAIN CONDITION
    if (status === "approved") {
      if (app.status !== "approved" || !docsApproved) {
        // 🔴 REVERT payment back to pending
        await pool.query(
          `UPDATE payments SET status='pending' WHERE id=$1`,
          [id]
        );

        return res.json({
          success: false,
          message: "Approve application & all documents first"
        });
      }
    }

    // 4️⃣ Get user
    const userRes = await pool.query(
      `SELECT * FROM users WHERE id=$1`,
      [userId]
    );
    const user = userRes.rows[0];

    // 5️⃣ Generate student ID ONLY ONCE
// 5️⃣ Handle student creation + card activation
if (status === "approved") {

  let studentId = user.student_id;

  // ✅ Generate student_id if not exists
  if (!studentId) {
    studentId = generateStudentId();

    await createNotification(
      userId,
      "🎓 Student ID Generated",
      `Your Student ID is ${studentId}`
    );
  }

  // ✅ Update ALL at once
  await pool.query(
    `UPDATE users 
     SET 
       student_id = $1,
       stu_card = TRUE,
       stu_card_verified = TRUE
     WHERE id = $2`,
    [studentId, userId]
  );
}

    // 6️⃣ Notification
    await createNotification( 
      userId,
      "Payment Status Updated",
      `Your payment is ${status}`
    );

    res.json({ success: true });

  } catch (err) {
    console.error("❌ Payment Update Error:", err);
    res.status(500).json({ success: false });
  }
});



// http://localhost:5000/api/admin/applications
// http://localhost:5000/api/admin/application-documents
// http://localhost:5000/api/admin/payments
module.exports = router;