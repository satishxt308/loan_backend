// routes/employeeAdminRoutes.js
const express = require("express");
const router = express.Router();
const pool = require("../db/db");

// Helper function to create notification
const createNotification = async (userId, title, message) => {
  try {
    await pool.query(
      `INSERT INTO notifications (user_id, title, message, created_at)
       VALUES ($1, $2, $3, CURRENT_TIMESTAMP)`,
      [userId, title, message]
    );
  } catch (err) {
    console.error("❌ Notification Error:", err);
  }
};

// Helper function to check if all documents are approved
const areAllDocumentsApproved = async (userId) => {
  const result = await pool.query(
    `SELECT COUNT(*) as total, 
            COUNT(CASE WHEN status = 'approved' THEN 1 END) as approved_count
     FROM emp_documents 
     WHERE user_id = $1`,
    [userId]
  );
  
  const { total, approved_count } = result.rows[0];
  return total > 0 && total === parseInt(approved_count);
};

const generateEmployeeId = async () => {
  const result = await pool.query(
    `SELECT COUNT(*) FROM users WHERE employee_id IS NOT NULL`
  );

  const count = parseInt(result.rows[0].count) + 1;

  return `PSWBEMP${Date.now().toString().slice(-6)}${count}`;
};

// ==============================
// GET ALL EMPLOYEES
// ==============================
router.get("/employees", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        u.id,
        u.full_name,
        u.email,
        u.phone_number,
        u.role,
        u.created_at,
        u.student_id,
        u.employee_id,
        u.emp_card,
        u.emp_card_verified,
        u.is_active,
        ec.aadhaar_number,
        ec.full_address,
        ec.pan_number,
        ec.referral_source,
        COALESCE(ec.status, 'pending') as card_status,
        ec.rejection_reason,
        ec.created_at as card_created_at,
        ec.updated_at as card_updated_at
      FROM users u
      LEFT JOIN emp_cards ec ON ec.user_id = u.id
      WHERE u.role = 'employee'
      ORDER BY u.id DESC
    `);

    // Transform data to match frontend expectations
    const employees = result.rows.map(emp => ({
      id: emp.id,
      employee_id: emp.employee_id || `EMP${emp.id.toString().padStart(4, '0')}`,
      full_name: emp.full_name,
      email: emp.email,
      phone: emp.phone_number,
      status: emp.card_status || 'pending',
      rejection_reason: emp.rejection_reason,
      submitted_date: emp.card_created_at || emp.created_at,
      last_updated: emp.card_updated_at || emp.updated_at,
      aadhaar_number: emp.aadhaar_number,
      pan_number: emp.pan_number,
      full_address: emp.full_address,
      referral_source: emp.referral_source,
      emp_card: emp.emp_card,
      emp_card_verified: emp.emp_card_verified,
      is_active: emp.is_active
    }));

    res.json({
      success: true,
      data: employees
    });

  } catch (err) {
    console.error("❌ Fetch Employees Error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ==============================
// GET SINGLE EMPLOYEE
// ==============================
router.get("/employees/:id", async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await pool.query(`
      SELECT 
        u.id,
        u.full_name,
        u.email,
        u.profile_image,
        u.phone_number,
        u.date_of_birth as dob,
        u.gender,
        u.created_at as submitted_date,
        u.updated_at as last_updated,
        u.emp_card,
        u.emp_card_verified,
        u.employee_id,
        ec.aadhaar_number,
        ec.full_address,
        ec.pan_number,
        ec.referral_source,
        COALESCE(ec.status, 'pending') as card_status,
        ec.rejection_reason,
        ec.created_at as card_created_at,
        ec.updated_at as card_updated_at
      FROM users u
      LEFT JOIN emp_cards ec ON ec.user_id = u.id
      WHERE u.id = $1 AND u.role = 'employee'
    `, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Employee not found" });
    }
    

    const emp = result.rows[0];
    
    // Format response for frontend
    const employee = {
      id: emp.id,
      employee_id: emp.employee_id || `EMP${emp.id.toString().padStart(4, '0')}`,
      full_name: emp.full_name,
      email: emp.email,
      phone: emp.phone_number,
      profile_image: emp.profile_image
  ? `data:image/png;base64,${emp.profile_image.toString("base64")}`
  : null,
      dob: emp.dob,
      gender: emp.gender,
      status: emp.card_status || 'pending',
      rejection_reason: emp.rejection_reason,
      submitted_date: emp.card_created_at || emp.submitted_date,
      last_updated: emp.card_updated_at || emp.last_updated,
      aadhaar_number: emp.aadhaar_number,
      pan_number: emp.pan_number,
      full_address: emp.full_address,
      referral_source: emp.referral_source,
      emp_card_verified: emp.emp_card_verified,
      // Add empty fields for other sections to match modal
      passport_number: null,
      driving_license: null,
      department: null,
      designation: null,
      employment_type: null,
      joining_date: null,
      employee_status: 'active',
      reporting_manager: null,
      work_location: null,
      shift_timing: null,
      highest_qualification: null,
      specialization: null,
      university: null,
      year_of_passing: null,
      percentage: null,
      previous_experience: null,
      bank_name: null,
      account_number: null,
      ifsc_code: null,
      upi_id: null,
      emergency_contact_name: null,
      emergency_contact_number: null,
      emergency_relationship: null,
      linkedin: null,
      twitter: null,
      github: null
    };

    res.json({
      success: true,
      data: employee
    });

  } catch (err) {
    console.error("❌ Fetch Employee Error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ==============================
// UPDATE EMPLOYEE STATUS (Card Status)
// ==============================
router.put("/employees/:id", async (req, res) => {
    console.log("STATUS UPDATE:", req.body);
  try {
    const { id } = req.params;
    const { status, rejection_reason } = req.body;

    // Check if employee exists
    const userResult = await pool.query(
      `SELECT id, full_name, email FROM users WHERE id = $1 AND role = 'employee'`,
      [id]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Employee not found" });
    }

    const user = userResult.rows[0];

    // Check if emp_card record exists
    const cardCheck = await pool.query(
      `SELECT id FROM emp_cards WHERE user_id = $1`,
      [id]
    );

    if (cardCheck.rows.length === 0) {
      await pool.query(
        `INSERT INTO emp_cards (user_id, status, rejection_reason, updated_at)
         VALUES ($1, $2, $3, CURRENT_TIMESTAMP)`,
        [id, status, rejection_reason || null]
      );
    } else {
      await pool.query(
        `UPDATE emp_cards 
         SET status = $1, rejection_reason = $2, updated_at = CURRENT_TIMESTAMP
         WHERE user_id = $3`,
        [status, rejection_reason || null, id]
      );
    }

    // Create notification for status change
    let title = "", message = "";
    if (status === 'approved') {
      title = "✅ Employee Card Approved";
      message = `Dear ${user.full_name}, your employee card has been approved. Please wait for final verification.`;
    } else if (status === 'rejected') {
      title = "❌ Employee Card Rejected";
      message = `Dear ${user.full_name}, your employee card has been rejected. Reason: ${rejection_reason || 'Not specified'}`;
    } else if (status === 'pending') {
      title = "⏳ Employee Card Status Updated";
      message = `Dear ${user.full_name}, your employee card status has been changed to pending.`;
    }
    
    await createNotification(user.id, title, message);

    res.json({ 
      success: true, 
      message: `Employee card ${status} successfully` 
    });

  } catch (err) {
    console.error("❌ Update Employee Error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ==============================
// VERIFY EMPLOYEE (Final Verification)
// Generates Employee ID and sets emp_card_verified = true
// ==============================
router.post("/employees/:id/verify", async (req, res) => {
  try {
    const { id } = req.params;
    
    // Check if employee exists
    const userResult = await pool.query(
      `SELECT id, full_name, email, emp_card_verified, employee_id 
       FROM users WHERE id = $1 AND role = 'employee'`,
      [id]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Employee not found" });
    }

    const user = userResult.rows[0];

let employeeId = user.employee_id;

// If already verified but NO employee_id → generate it
if (user.emp_card_verified && !user.employee_id) {
  employeeId = await generateEmployeeId();
  
  await pool.query(
    `UPDATE users 
     SET employee_id = $1,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $2`,
    [employeeId, id]
  );

  return res.json({
    success: true,
    message: "Employee ID generated successfully",
    data: { employee_id: employeeId }
  });
}

// If already verified AND already has ID → no action
if (user.emp_card_verified && user.employee_id) {
  return res.json({
    success: true,
    message: "Employee already verified",
    data: { employee_id: user.employee_id }
  });
}

    // Check if card is approved
    const cardResult = await pool.query(
      `SELECT status FROM emp_cards WHERE user_id = $1`,
      [id]
    );

    const cardStatus = cardResult.rows[0]?.status;
    if (cardStatus !== 'approved') {
      return res.status(400).json({ 
        success: false, 
        message: "Employee card must be approved first" 
      });
    }

    // Check if all documents are approved
    const allDocsApproved = await areAllDocumentsApproved(id);
    if (!allDocsApproved) {
      return res.status(400).json({ 
        success: false, 
        message: "All documents must be approved first" 
      });
    }

    // Generate employee ID
    employeeId = await generateEmployeeId();

    // Update user: set emp_card_verified = true and assign employee_id
    await pool.query(
      `UPDATE users 
       SET emp_card_verified = true, 
           emp_card = true,
           employee_id = $1,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $2`,
      [employeeId, id]
    );

    // Update emp_cards status to verified
    await pool.query(
      `UPDATE emp_cards 
       SET status = 'verified', updated_at = CURRENT_TIMESTAMP
       WHERE user_id = $1`,
      [id]
    );

    // Create success notification
    await createNotification(
      user.id,
      "🎉 Employee ID Generated!",
      `Dear ${user.full_name}, your employee ID has been generated: ${employeeId}. You are now a verified employee!`
    );

    res.json({ 
      success: true, 
      message: "Employee verified successfully",
      data: { employee_id: employeeId }
    });

  } catch (err) {
    console.error("❌ Verify Employee Error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ==============================
// CHECK IF EMPLOYEE CAN BE VERIFIED
// ==============================
router.get("/employees/:id/can-verify", async (req, res) => {
  try {
    const { id } = req.params;
    
    // Check card status
    const cardResult = await pool.query(
      `SELECT status FROM emp_cards WHERE user_id = $1`,
      [id]
    );
    
    const isCardApproved = cardResult.rows[0]?.status === 'approved';
    
    // Check all documents approved
    const allDocsApproved = await areAllDocumentsApproved(id);
    
    // Check if already verified
    const userResult = await pool.query(
      `SELECT emp_card_verified FROM users WHERE id = $1`,
      [id]
    );
    
    const isAlreadyVerified = userResult.rows[0]?.emp_card_verified || false;
    
    const canVerify = isCardApproved && allDocsApproved && !isAlreadyVerified;
    
    res.json({
      success: true,
      data: {
        can_verify: canVerify,
        card_approved: isCardApproved,
        all_docs_approved: allDocsApproved,
        already_verified: isAlreadyVerified
      }
    });
    
  } catch (err) {
    console.error("❌ Check Verify Error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ==============================
// GET EMPLOYEE DOCUMENTS
// ==============================
router.get("/employee-documents", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        ed.id,
        ed.user_id AS employee_id,
        ed.document_type,
        ed.base64_data AS document_file,
        ed.status,
        ed.reason AS rejection_reason,
        ed.created_at AS uploaded_date,
        ed.updated_at AS last_updated,
        u.full_name AS employee_name
      FROM emp_documents ed
      LEFT JOIN users u ON u.id = ed.user_id
      WHERE u.role = 'employee'
      ORDER BY ed.id DESC
    `);

    const documents = result.rows.map(doc => ({
      id: doc.id,
      employee_id: doc.employee_id,
      document_type: doc.document_type,
      document_key: doc.document_type?.replace('_', ' ') || 'Document',
      document_name: `${doc.document_type}_${doc.employee_id}`,
      document_file: doc.document_file ? `data:image/png;base64,${doc.document_file.toString('base64')}` : null,
      mime_type: 'image/png',
      status: doc.status || 'pending',
      rejection_reason: doc.rejection_reason,
      uploaded_date: doc.uploaded_date,
      last_updated: doc.last_updated
    }));

    res.json({
      success: true,
      data: documents
    });

  } catch (err) {
    console.error("❌ Fetch Documents Error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ==============================
// UPDATE DOCUMENT STATUS
// ==============================
router.put("/employee-documents/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { status, rejection_reason } = req.body;

    // Get user_id before update
    const docResult = await pool.query(
      `SELECT user_id FROM emp_documents WHERE id = $1`,
      [id]
    );
    
    const userId = docResult.rows[0]?.user_id;

    await pool.query(
      `UPDATE emp_documents
       SET status = $1, 
           reason = $2, 
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $3`,
      [status, rejection_reason || null, id]
    );

    // Create notification for document status change
    if (userId) {
      const userResult = await pool.query(
        `SELECT full_name FROM users WHERE id = $1`,
        [userId]
      );
      const userName = userResult.rows[0]?.full_name || "Employee";
      
      let title = "", message = "";
      if (status === 'approved') {
        title = "✅ Document Approved";
        message = `Dear ${userName}, your document has been approved.`;
      } else if (status === 'rejected') {
        title = "❌ Document Rejected";
        message = `Dear ${userName}, your document has been rejected. Reason: ${rejection_reason || 'Not specified'}`;
      }
      
      await createNotification(userId, title, message);
    }

    res.json({ 
      success: true, 
      message: `Document ${status} successfully` 
    });

  } catch (err) {
    console.error("❌ Update Document Error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});


// ==============================
// GET EMPLOYEE STATISTICS
// ==============================
router.get("/employees/statistics", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(CASE WHEN ec.status = 'pending' THEN 1 END) as pending,
        COUNT(CASE WHEN ec.status = 'approved' THEN 1 END) as approved,
        COUNT(CASE WHEN ec.status = 'rejected' THEN 1 END) as rejected
      FROM users u
      LEFT JOIN emp_cards ec ON ec.user_id = u.id
      WHERE u.role = 'employee'
    `);

    res.json({
      success: true,
      data: result.rows[0]
    });

  } catch (err) {
    console.error("❌ Fetch Statistics Error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;