// routes/employeeDocuments.js
const express = require("express");
const router = express.Router();
const pool = require("../db/db");
const multer = require("multer");
const storage = multer.memoryStorage();
const upload = multer({ storage });

// Helper function to create notification
const createNotification = async (userId, title, message) => {
  try {
    await pool.query(
      `INSERT INTO notifications (user_id, title, message, created_at)
       VALUES ($1, $2, $3, NOW())`,
      [userId, title, message]
    );
  } catch (error) {
    console.error("Notification error:", error);
  }
};

// Helper function to generate application ID for employee
const generateEmployeeApplicationId = async () => {
  const result = await pool.query(
    `SELECT 'EMP' || LPAD(COALESCE(MAX(CAST(SUBSTRING(application_id FROM 4) AS INTEGER)), 0) + 1, 6, '0') as new_id 
     FROM applications 
     WHERE application_id LIKE 'EMP%'`
  );
  return result.rows[0].new_id;
};

// ✅ GET employee documents by user ID
router.get("/get-employee-documents/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    
    // First get or create employee application
    let application = await pool.query(
      `SELECT id, application_id FROM applications 
       WHERE user_id = $1 AND category = 'employee'`,
      [userId]
    );
    
    let applicationId = null;
    
    if (application.rows.length === 0) {
      // Create new employee application
      const newAppId = await generateEmployeeApplicationId();
      const newApp = await pool.query(
        `INSERT INTO applications (application_id, user_id, category, status, created_at, last_updated)
         VALUES ($1, $2, 'employee', 'pending', NOW(), NOW())
         RETURNING id, application_id`,
        [newAppId, userId]
      );
      applicationId = newApp.rows[0].id;
    } else {
      applicationId = application.rows[0].id;
    }
    
    // Get employee documents
    const result = await pool.query(
      `SELECT id, application_id, document_type, document_key, document_file, 
              file_name, mime_type, status, rejection_reason, uploaded_at, updated_at
       FROM application_documents 
       WHERE user_id = $1 AND document_type = 'employee'
       ORDER BY uploaded_at DESC`,
      [userId]
    );
    
    const documents = result.rows.map(doc => ({
      id: doc.id,
      application_id: doc.application_id,
      document_type: doc.document_key,
      base64_data: doc.document_file ? doc.document_file.toString('base64') : null,
      mime_type: doc.mime_type,
      status: doc.status,
      reason: doc.rejection_reason,
      created_at: doc.uploaded_at,
      updated_at: doc.updated_at
    }));
    
    res.json({
      success: true,
      documents: documents,
      application_id: applicationId
    });
    
  } catch (error) {
    console.error("❌ Get employee documents error:", error);
    res.status(500).json({ 
      success: false, 
      message: "Failed to fetch documents",
      error: error.message 
    });
  }
});

router.get("/get-all-student-applications", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        a.id AS application_id,   -- ✅ FIX HERE
        a.user_id,
        a.category,
        a.status,
        a.submitted_date AS created_at,

        u.full_name,
        u.email,

        COUNT(ad.id) as total_documents,
        SUM(CASE WHEN ad.status = 'approved' THEN 1 ELSE 0 END) as approved_documents,
        SUM(CASE WHEN ad.status = 'pending' THEN 1 ELSE 0 END) as pending_documents,
        SUM(CASE WHEN ad.status = 'rejected' THEN 1 ELSE 0 END) as rejected_documents

      FROM applications a
      JOIN users u ON a.user_id = u.id
      LEFT JOIN application_documents ad 
        ON a.id = ad.application_id   -- ✅ THIS IS CORRECT

      GROUP BY a.id, u.id
      ORDER BY a.submitted_date DESC
    `);

    res.json({
      success: true,
      applications: result.rows
    });

  } catch (err) {
    console.error("❌ Error fetching students:", err);
    res.status(500).json({ 
      success: false, 
      message: err.message 
    });
  }
});

router.get("/application-status/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    const result = await pool.query(`
      SELECT 
        a.id,
       a.id AS application_id,
        a.category,
        a.status,
        a.created_at,
        a.last_updated,

        COUNT(ad.id) as total_documents,
        SUM(CASE WHEN ad.status = 'approved' THEN 1 ELSE 0 END) as approved_documents,
        SUM(CASE WHEN ad.status = 'pending' THEN 1 ELSE 0 END) as pending_documents,
        SUM(CASE WHEN ad.status = 'rejected' THEN 1 ELSE 0 END) as rejected_documents

      FROM applications a
      LEFT JOIN application_documents ad 
        ON a.id = ad.application_id
      WHERE a.user_id = $1
      GROUP BY a.id
      ORDER BY a.created_at DESC
      LIMIT 1
    `, [userId]);

    if (result.rows.length === 0) {
      return res.json({
        success: true,
        status: "not_started",
        message: "No application found"
      });
    }

    res.json({
      success: true,
      data: result.rows[0]
    });

  } catch (error) {
    console.error("❌ Status fetch error:", error);
    res.status(500).json({
      success: false,
      message: "Server error"
    });
  }
});

// ✅ SUBMIT employee documents

// GET single student application
router.get("/student-application/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    const result = await pool.query(`
      SELECT 
        a.*,
        u.full_name,
        u.email
      FROM applications a
      JOIN users u ON a.user_id = u.id
      WHERE a.user_id = $1
      LIMIT 1
    `, [userId]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Student not found"
      });
    }

    res.json({
      success: true,
      application: result.rows[0]
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false });
  }
});

router.post(
  "/emp-card/submit-employee-documents",
  upload.array("documents"),
  async (req, res) => {
    try {
      const { user_id, employee_data } = req.body;
      const files = req.files;
      const keys = req.body.document_keys;

      console.log("FILES:", files);
      console.log("KEYS:", keys);

      // map files with keys
      files.forEach((file, index) => {
        const key = Array.isArray(keys) ? keys[index] : keys;

        console.log("Saving:", key);

        // file.buffer = image buffer
      });

      res.json({ success: true });

    } catch (err) {
      console.error(err);
      res.status(500).json({ success: false });
    }
  }
);

// ✅ UPDATE employee document status (for admin)
router.put("/employee-documents/:id", async (req, res) => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    const { id } = req.params;
    const { status, rejection_reason } = req.body;
    
    if (!['pending', 'approved', 'rejected'].includes(status)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ 
        success: false, 
        message: "Invalid status" 
      });
    }
    
    // Get document details with application info
    const docResult = await client.query(
      `SELECT ad.id, ad.user_id, ad.document_key, ad.status, ad.application_id,
              a.category, a.application_id as app_number
       FROM application_documents ad
       JOIN applications a ON ad.application_id = a.id
       WHERE ad.id = $1`,
      [id]
    );
    
    if (docResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ 
        success: false, 
        message: "Document not found" 
      });
    }
    
    const document = docResult.rows[0];
    
    // Get previous status for tracking
    const previousStatus = document.status;
    
    // Update document status
    await client.query(
      `UPDATE application_documents 
       SET status = $1, 
           rejection_reason = $2,
           previous_status = $3,
           updated_at = NOW()
       WHERE id = $4`,
      [status, rejection_reason || null, previousStatus, id]
    );
    
    // Get user details for notification
    const userResult = await client.query(
      `SELECT full_name, email FROM users WHERE id = $1`,
      [document.user_id]
    );
    
    const user = userResult.rows[0];
    
    // Create notification for user
    let notificationTitle = "";
    let notificationMessage = "";
    
    if (status === "approved") {
      notificationTitle = "Document Approved ✓";
      notificationMessage = `Your ${document.document_key.replace(/_/g, ' ')} has been approved.`;
    } else if (status === "rejected") {
      notificationTitle = "Document Rejected ✗";
      notificationMessage = `Your ${document.document_key.replace(/_/g, ' ')} was rejected. Reason: ${rejection_reason || 'Please re-upload with correct document'}`;
    }
    
    if (notificationTitle) {
      await createNotification(
        document.user_id,
        notificationTitle,
        notificationMessage
      );
    }
    
    // Check if all required documents are approved
    const requiredDocs = ['aadhaar_card', 'pan_card', 'employee_photo'];
    const allDocsResult = await client.query(
      `SELECT document_key, status FROM application_documents 
       WHERE user_id = $1 
       AND document_type = 'employee'
       AND document_key = ANY($2)`,
      [document.user_id, requiredDocs]
    );
    
    const allDocs = allDocsResult.rows;
    const allApproved = allDocs.length === 3 && allDocs.every(doc => doc.status === "approved");
    
    if (allApproved) {
      // Update application status to approved
      await client.query(
        `UPDATE applications 
         SET status = 'approved', last_updated = NOW()
         WHERE id = $1`,
        [document.application_id]
      );
      
      // Generate employee ID if not exists
      const employeeIdResult = await client.query(
        `SELECT user_id FROM employees WHERE user_id = $1`,
        [document.user_id]
      );
      
      let employeeId;
      
      if (employeeIdResult.rows.length === 0) {
        // Generate employee ID
        const empIdNum = await client.query(
          `SELECT COALESCE(MAX(CAST(SUBSTRING(employee_id FROM 4) AS INTEGER)), 0) + 1 as next_id FROM employees`
        );
        const nextId = empIdNum.rows[0].next_id;
        employeeId = `EMP${String(nextId).padStart(6, '0')}`;
        
        // Create employee record
        await client.query(
          `INSERT INTO employees (user_id, employee_id, full_name, email, is_verified, verified_at, created_at, updated_at)
           VALUES ($1, $2, $3, $4, true, NOW(), NOW(), NOW())`,
          [document.user_id, employeeId, user.full_name, user.email]
        );
      } else {
        // Update existing employee record
        await client.query(
          `UPDATE employees 
           SET is_verified = true, verified_at = NOW(), updated_at = NOW()
           WHERE user_id = $1`,
          [document.user_id]
        );
        
        const empData = await client.query(
          `SELECT employee_id FROM employees WHERE user_id = $1`,
          [document.user_id]
        );
        employeeId = empData.rows[0].employee_id;
      }
      
      // Update user table with employee ID
      await client.query(
        `UPDATE users 
         SET student_id = $1, updated_at = NOW()
         WHERE id = $2`,
        [employeeId, document.user_id]
      );
      
      // Create success notification
      await createNotification(
        document.user_id,
        "Employee Verification Complete 🎉",
        `Congratulations! Your employee verification is complete. Your Employee ID is ${employeeId}. You can now access all employee features.`
      );
    }
    
    await client.query('COMMIT');
    
    res.json({
      success: true,
      message: `Document ${status} successfully`,
      all_documents_approved: allApproved,
      employee_id: allApproved ? employeeId : null
    });
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error("❌ Update employee document error:", error);
    res.status(500).json({ 
      success: false, 
      message: "Failed to update document",
      error: error.message 
    });
  } finally {
    client.release();
  }
});

// ✅ GET all employee applications for admin
router.get("/employee-applications", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        a.id,
        a.application_id,
        a.user_id,
        a.status,
        a.field_status,
        a.created_at,
        a.last_updated,
        u.full_name,
        u.email,
        u.phone_number,
        COUNT(ad.id) as total_documents,
        SUM(CASE WHEN ad.status = 'approved' THEN 1 ELSE 0 END) as approved_documents,
        SUM(CASE WHEN ad.status = 'pending' THEN 1 ELSE 0 END) as pending_documents,
        SUM(CASE WHEN ad.status = 'rejected' THEN 1 ELSE 0 END) as rejected_documents
      FROM applications a
      JOIN users u ON a.user_id = u.id
      LEFT JOIN application_documents ad ON a.id = ad.application_id AND ad.document_type = 'employee'
      WHERE a.category = 'employee'
      GROUP BY a.id, u.id
      ORDER BY a.created_at DESC
    `);
    
    // Parse field_status JSON for each row
    const applications = result.rows.map(app => ({
      ...app,
      field_status: typeof app.field_status === 'string' ? JSON.parse(app.field_status) : app.field_status
    }));
    
    res.json({
      success: true,
      data: applications
    });
    
  } catch (error) {
    console.error("❌ Get employee applications error:", error);
    res.status(500).json({ 
      success: false, 
      message: "Failed to fetch employee applications" 
    });
  }
});

// ✅ GET employee document status
router.get("/employee-document-status/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    
    const result = await pool.query(`
      SELECT 
        a.id as application_id,
        a.application_id as app_number,
        a.status as application_status,
        a.field_status,
        a.created_at,
        a.last_updated,
        COUNT(ad.id) as total_documents,
        SUM(CASE WHEN ad.status = 'approved' THEN 1 ELSE 0 END) as approved_documents,
        SUM(CASE WHEN ad.status = 'pending' THEN 1 ELSE 0 END) as pending_documents,
        SUM(CASE WHEN ad.status = 'rejected' THEN 1 ELSE 0 END) as rejected_documents,
        e.employee_id,
        e.is_verified,
        e.verified_at
      FROM applications a
      LEFT JOIN application_documents ad ON a.id = ad.application_id AND ad.document_type = 'employee'
      LEFT JOIN employees e ON a.user_id = e.user_id
      WHERE a.user_id = $1 AND a.category = 'employee'
      GROUP BY a.id, e.employee_id, e.is_verified, e.verified_at
    `, [userId]);
    
    if (result.rows.length === 0) {
      return res.json({
        success: true,
        status: 'not_started',
        message: 'No employee application found'
      });
    }
    
    const application = result.rows[0];
    application.field_status = typeof application.field_status === 'string' 
      ? JSON.parse(application.field_status) 
      : application.field_status;
    
    res.json({
      success: true,
      data: application
    });
    
  } catch (error) {
    console.error("❌ Get employee status error:", error);
    res.status(500).json({ 
      success: false, 
      message: "Failed to fetch status" 
    });
  }
});

// ✅ GET employee documents for admin review
router.get("/admin/employee-documents/:applicationId", async (req, res) => {
  try {
    const { applicationId } = req.params;
    
    const result = await pool.query(`
      SELECT 
        ad.id,
        ad.document_key,
        ad.document_file,
        ad.file_name,
        ad.mime_type,
        ad.status,
        ad.rejection_reason,
        ad.uploaded_at,
        ad.updated_at,
        a.application_id as app_number,
        a.user_id,
        u.full_name,
        u.email
      FROM application_documents ad
      JOIN applications a ON ad.application_id = a.id
      JOIN users u ON a.user_id = u.id
      WHERE ad.application_id = $1 AND ad.document_type = 'employee'
      ORDER BY ad.document_key
    `, [applicationId]);
    
    const documents = result.rows.map(doc => ({
      ...doc,
      document_file: doc.document_file ? `data:${doc.mime_type};base64,${doc.document_file.toString('base64')}` : null
    }));
    
    res.json({
      success: true,
      data: documents
    });
  } catch (error) {
    console.error("❌ Get admin employee documents error:", error);
    res.status(500).json({ 
      success: false, 
      message: "Failed to fetch documents" 
    });
  }
});

module.exports = router;