// backend/routes/applicationSubmit.js
const express = require("express");
const router = express.Router();
const multer = require("multer");
const db = require("../db/db");

const upload = multer({
  storage: multer.memoryStorage(), // ✅ REQUIRED
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
  },
});

// Generate APP ID
const generateAppId = () => "APP" + Date.now() + Math.floor(Math.random() * 1000);

// Helper function to truncate long string fields
const truncateString = (str, max) => {
  if (!str) return null;
  return str.toString().substring(0, max);
};

// SUBMIT APPLICATION (BYTEA Version)
router.post("/submit-application", upload.array("documents"), async (req, res) => {
  const client = await db.connect();

  try {
    await client.query("BEGIN");

    const { user_id, category, ...rest } = req.body; // Changed: removed formData from destructuring
    const docs = req.files;

    console.log("Received form data:", req.body); // Debug log
    console.log("Files received:", docs ? docs.length : 0); // Debug log

    if (!user_id) {
      return res.status(400).json({ success: false, error: "User ID missing" });
    }

    // FIX 1: Avoid duplicate applications
    const existingApp = await client.query(
      "SELECT id FROM applications WHERE user_id = $1 LIMIT 1",
      [user_id]
    );

    let application_id;

    if (existingApp.rows.length > 0) {
      // Existing application → UPDATE (no new row)
      application_id = existingApp.rows[0].id;
      console.log("Updating existing application:", application_id);
    } else {
      // New application → CREATE ID
      application_id = generateAppId();
      console.log("Creating new application:", application_id);
    }

    // Sanitize category
    const allowedCategories = ["school", "college", "others"];
    let sanitizedCategory = allowedCategories.includes(category)
      ? category
      : "others";

let parsedFormData = {};
    
    // Try to parse formData if it exists as a JSON string
    if (req.body.formData) {
      try {
        parsedFormData = JSON.parse(req.body.formData);
      } catch (e) {
        console.log("Could not parse formData as JSON:", e.message);
        parsedFormData = rest; // Fall back to rest
      }
    } else {
      // If no formData field, use all other fields
      parsedFormData = rest;
    }
    
    console.log("Parsed form data:", parsedFormData); // Debug log

    const formFields = {
      aadhaar_number: truncateString(parsedFormData.aadhaar_number, 20) || null,
      pan_number: truncateString(parsedFormData.pan_number, 10) || null,
      guardian_name: truncateString(parsedFormData.guardian_name, 100) || null,
      full_address: truncateString(parsedFormData.full_address, 500) || null,
      // School fields
      class: truncateString(parsedFormData.class, 10) || null,
      board: truncateString(parsedFormData.board, 100) || null,
      school_name: truncateString(parsedFormData.school_name, 255) || null,
      stream: truncateString(parsedFormData.stream, 100) || null,
      // College fields
      year: truncateString(parsedFormData.year, 10) || null,
      semester: truncateString(parsedFormData.semester, 10) || null,
      degree: truncateString(parsedFormData.degree, 100) || null,
      college_name: truncateString(parsedFormData.college_name, 255) || null,
      university_name: truncateString(parsedFormData.university_name, 255) || null,
      // Guardian fields
      guardian_number: truncateString(parsedFormData.guardian_number, 15) || null,
      guardian_relation: truncateString(parsedFormData.guardian_relation, 50) || null,
      guardian_aadhaar: truncateString(parsedFormData.guardian_aadhaar, 20) || null,
      guardian_pan: truncateString(parsedFormData.guardian_pan, 10) || null,
    };

    if (existingApp.rows.length > 0) {
      // Build SET clauses and values
      const setClauses = [];
      const values = [];
      let paramIndex = 1;
      
      // Always update category
      setClauses.push(`category = $${paramIndex++}`);
      values.push(sanitizedCategory);
      
      // Add last_updated without parameter
      setClauses.push('last_updated = NOW()');
      
      // Add fields that have values
      const addField = (fieldName, fieldValue) => {
        if (fieldValue !== null && fieldValue !== undefined) {
          setClauses.push(`${fieldName} = $${paramIndex++}`);
          values.push(fieldValue);
        }
      };
      
      addField('aadhaar_number', formFields.aadhaar_number);
      addField('pan_number', formFields.pan_number);
      addField('guardian_name', formFields.guardian_name);
      addField('full_address', formFields.full_address);
      addField('class', formFields.class);
      addField('board', formFields.board);
      addField('school_name', formFields.school_name);
      addField('stream', formFields.stream);
      addField('year', formFields.year);
      addField('semester', formFields.semester);
      addField('degree', formFields.degree);
      addField('college_name', formFields.college_name);
      addField('university_name', formFields.university_name);
      addField('guardian_number', formFields.guardian_number);
      addField('guardian_relation', formFields.guardian_relation);
      addField('guardian_aadhaar', formFields.guardian_aadhaar);
      addField('guardian_pan', formFields.guardian_pan);
      
      // Add WHERE clause value
      values.push(parseInt(user_id));
      
      // Build final query - IMPORTANT: WHERE is NOT part of setClauses array
      const updateQuery = `UPDATE applications SET ${setClauses.join(', ')} WHERE user_id = $${paramIndex}`;
      
      console.log("Update query:", updateQuery); // Debug log
      console.log("Update values:", values); // Debug log
      
      await client.query(updateQuery, values);
    } else {
      await client.query(
        `INSERT INTO applications 
        (id, user_id, category, status, aadhaar_number, pan_number, guardian_name, full_address, class, board, school_name, stream, year, semester, degree, college_name, university_name, guardian_number, guardian_relation, guardian_aadhaar, guardian_pan) 
        VALUES ($1, $2, $3, 'pending', $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)`,
        [
          application_id,
          parseInt(user_id),
          sanitizedCategory,
          formFields.aadhaar_number,
          formFields.pan_number,
          formFields.guardian_name,
          formFields.full_address,
          formFields.class,
          formFields.board,
          formFields.school_name,
          formFields.stream,
          formFields.year,
          formFields.semester,
          formFields.degree,
          formFields.college_name,
          formFields.university_name,
          formFields.guardian_number,
          formFields.guardian_relation,
          formFields.guardian_aadhaar,
          formFields.guardian_pan
        ]
      );
    }

    if (docs && docs.length > 0) {

      for (let file of docs) {
        let key = file.originalname.replace(/\.[^/.]+$/, "");

        // Auto detect doc type
        let document_type =
          key.toLowerCase().includes("guardian") ? "guardian" : "student";

        // Check if document already exists
        const existingDoc = await client.query(
          "SELECT id FROM application_documents WHERE application_id=$1 AND document_key=$2",
          [application_id, key]
        );

        if (existingDoc.rows.length > 0) {
          // Update existing document
          await client.query(
            `UPDATE application_documents 
             SET document_file = $1, file_name = $2, file_size = $3, mime_type = $4, status = 'pending'
             WHERE application_id = $5 AND document_key = $6`,
            [
              file.buffer,
              file.originalname,
              file.size,
              file.mimetype,
              application_id,
              key
            ]
          );
        } else {
          // Insert new document
          await client.query(
            `INSERT INTO application_documents 
             (application_id, user_id, document_type, document_key, document_file, file_name, file_size, mime_type, status)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending')`,
            [
              application_id,
              user_id,
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
    }

    await client.query("COMMIT");

    return res.json({
      success: true,
      message: "Application completed",
      application_id,
    });
  } catch (error) {
    console.error("Submit application error:", error);
    await client.query("ROLLBACK");
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  } finally {
    client.release();
  }
});

router.get("/get-application/:user_id", async (req, res) => {
  try {
    const { user_id } = req.params;

    if (!user_id) {
      return res.status(400).json({
        success: false,
        error: "User ID is required",
      });
    }

    // Fetch a SINGLE application for this user
    const result = await db.query(
      `SELECT *
       FROM applications
       WHERE user_id = $1
       ORDER BY submitted_date DESC
       LIMIT 1`,
      [user_id]
    );

    if (result.rows.length === 0) {
      return res.json({
        success: true,
        exists: false,
        data: null,
      });
    }

    const app = result.rows[0];

    // Convert numeric string fields to proper numbers
    const cleanedData = {
      ...app,
      user_id: Number(app.user_id),
    };

    return res.json({
      success: true,
      exists: true,
      data: cleanedData,
    });

  } catch (err) {
    console.error("GET APPLICATION ERROR:", err);
    return res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

// Save/Update application
router.post("/save-application", async (req, res) => {
  const client = await db.connect();
  
  try {
    await client.query('BEGIN');

    const {
      user_id,
      category,
      ...formFields // All form fields should come directly now
    } = req.body;

    if (!user_id) {
      return res.status(400).json({ success: false, error: "User ID required" });
    }

    // Check if application already exists for this user
    const existingApp = await client.query(
      `SELECT id FROM applications WHERE user_id = $1`,
      [user_id]
    );

    let application_id;

    if (existingApp.rows.length > 0) {
      // Update existing application
      application_id = existingApp.rows[0].id;
      
      await client.query(
        `UPDATE applications SET 
          category = $1, 
          last_updated = CURRENT_TIMESTAMP,
          aadhaar_number = $2, 
          pan_number = $3, 
          guardian_name = $4,
          full_address = $5,
          class = $6,
          board = $7,
          school_name = $8,
          stream = $9,
          year = $10,
          semester = $11,
          degree = $12,
          college_name = $13,
          university_name = $14,
          guardian_number = $15,
          guardian_relation = $16,
          guardian_aadhaar = $17,
          guardian_pan = $18
        WHERE id = $19`,
        [
          category,
          truncateString(formFields.aadhaar_number, 20) || null,
          truncateString(formFields.pan_number, 10) || null,
          truncateString(formFields.guardian_name, 100) || null,
          truncateString(formFields.full_address, 500) || null,
          truncateString(formFields.class, 10) || null,
          truncateString(formFields.board, 100) || null,
          truncateString(formFields.school_name, 255) || null,
          truncateString(formFields.stream, 100) || null,
          truncateString(formFields.year, 10) || null,
          truncateString(formFields.semester, 10) || null,
          truncateString(formFields.degree, 100) || null,
          truncateString(formFields.college_name, 255) || null,
          truncateString(formFields.university_name, 255) || null,
          truncateString(formFields.guardian_number, 15) || null,
          truncateString(formFields.guardian_relation, 50) || null,
          truncateString(formFields.guardian_aadhaar, 20) || null,
          truncateString(formFields.guardian_pan, 10) || null,
          application_id
        ]
      );

    } else {
      // Create new application
      application_id = "APP" + Date.now() + Math.floor(Math.random() * 1000);

      await client.query(
        `INSERT INTO applications (
          id, user_id, category, aadhaar_number, pan_number, guardian_name,
          full_address, class, board, school_name, stream, year, semester,
          degree, college_name, university_name, guardian_number,
          guardian_relation, guardian_aadhaar, guardian_pan
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)`,
        [
          application_id,
          user_id,
          category,
          truncateString(formFields.aadhaar_number, 20) || null,
          truncateString(formFields.pan_number, 10) || null,
          truncateString(formFields.guardian_name, 100) || null,
          truncateString(formFields.full_address, 500) || null,
          truncateString(formFields.class, 10) || null,
          truncateString(formFields.board, 100) || null,
          truncateString(formFields.school_name, 255) || null,
          truncateString(formFields.stream, 100) || null,
          truncateString(formFields.year, 10) || null,
          truncateString(formFields.semester, 10) || null,
          truncateString(formFields.degree, 100) || null,
          truncateString(formFields.college_name, 255) || null,
          truncateString(formFields.university_name, 255) || null,
          truncateString(formFields.guardian_number, 15) || null,
          truncateString(formFields.guardian_relation, 50) || null,
          truncateString(formFields.guardian_aadhaar, 20) || null,
          truncateString(formFields.guardian_pan, 10) || null
        ]
      );
    }

    await client.query('COMMIT');

    res.json({
      success: true,
      application_id,
      message: existingApp.rows.length > 0 ? "Application updated" : "Application created"
    });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error("SAVE APPLICATION ERROR:", err);
    res.status(500).json({
      success: false,
      error: "Server error: " + err.message
    });
  } finally {
    client.release();
  }
});

router.get("/get-documents/:user_id", async (req, res) => {
  try {
    const { user_id } = req.params;

    const result = await db.query(
      `SELECT 
         document_key,
         document_file,
         mime_type,
         status
       FROM application_documents
       WHERE user_id = $1`,
      [user_id]
    );

    const docs = result.rows.map(doc => ({
      key: doc.document_key,
      base64: doc.document_file
        ? `data:${doc.mime_type};base64,${doc.document_file.toString("base64")}`
        : null,
      status: doc.status?.toLowerCase() // ✅ IMPORTANT
    }));

    res.json({ success: true, documents: docs });

  } catch (error) {
    console.error("Fetch Documents Error:", error);
    res.status(500).json({
      success: false,
      message: "Server error fetching documents"
    });
  }
});

// ✅ CORRECTED backend route in applicationSubmit.js
router.post("/update-stu-card", async (req, res) => {
  try {
    const { student_id } = req.body;

    console.log("Updating student card for:", student_id);

    // ✅ Use db instead of pool (since you imported db)
    await db.query(
      "UPDATE users SET stu_card = TRUE WHERE id = $1",
      [student_id]
    );

    res.json({ success: true, message: "Student card activated successfully" });
  } catch (err) {
    console.error("Update student card error:", err);
    res.status(500).json({ 
      success: false, 
      message: "Server error: " + err.message 
    });
  }
});

// GET COMPLETE APPLICATION STATUS
router.get("/get-full-application/:user_id", async (req, res) => {
  try {
    const { user_id } = req.params;

    // 1️⃣ Fetch latest application by user
    const appRes = await db.query(
      `SELECT *
       FROM applications
       WHERE user_id = $1
       ORDER BY submitted_date DESC
       LIMIT 1`,
      [user_id]
    );

    if (appRes.rows.length === 0) {
      return res.json({
        success: true,
        application: null
      });
    }

    const app = appRes.rows[0];

    // 2️⃣ Build FULL formData (ALL DB fields)
    const formData = {
      // Common fields
      aadhaar_number: app.aadhaar_number,
      pan_number: app.pan_number,
      full_address: app.full_address,

      // School fields
      class: app.class,
      board: app.board,
      school_name: app.school_name,
      stream: app.stream,
      previous_class: app.previous_class,
      previous_class_result: app.previous_class_result,
      tenth_marks: app.tenth_marks,
      tenth_board: app.tenth_board,
      tenth_school_name: app.tenth_school_name,

      // College fields
      year: app.year,
      semester: app.semester,
      degree: app.degree,
      college_name: app.college_name,
      university_name: app.university_name,
      previous_sem_result: app.previous_sem_result,
      twelfth_marks: app.twelfth_marks,
      twelfth_board: app.twelfth_board,
      twelfth_school_name: app.twelfth_school_name,

      // Others fields
      employment_status: app.employment_status,
      loan_reason: app.loan_reason,

      // Guardian fields
      guardian_name: app.guardian_name,
      guardian_number: app.guardian_number,
      guardian_relation: app.guardian_relation,
      guardian_aadhaar: app.guardian_aadhaar,
      guardian_pan: app.guardian_pan,

      // JSONB form_data from DB
      form_data: app.form_data || {}
    };

    // 3️⃣ Fetch documents
    const docRes = await db.query(
      `SELECT *
       FROM application_documents
       WHERE application_id = $1`,
      [app.id]
    );

    // 4️⃣ Organize documents cleanly
    let documents = { student: {}, guardian: {} };

    for (let d of docRes.rows) {
      const type = d.document_type || "student";
      const key = d.document_key || "unknown";

      if (!documents[type]) documents[type] = {};

      documents[type][key] = {
        uri: d.document_file
          ? `data:${d.mime_type};base64,${d.document_file.toString("base64")}`
          : null,
        status: d.status,
        reason: d.rejection_reason,
        file_name: d.file_name,
        mime_type: d.mime_type,
        file_size: d.file_size,
        uploaded_at: d.uploaded_at
      };
    }

    // 5️⃣ Convert JSONB fields safely
    let fieldStatus = {};
    let fieldReasons = {};

    try { fieldStatus = app.field_status || {}; } catch {}
    try { fieldReasons = app.field_reasons || {}; } catch {}

    // 6️⃣ Final response
    return res.json({
      success: true,
      application: {
        // Basic info
        id: app.id,
        user_id: app.user_id,
        category: app.category,
        status: app.status,
        submitted_date: app.submitted_date,
        last_updated: app.last_updated,
        can_pay: app.can_pay,
        admin_reason: app.admin_reason || app.rejection_reason || "No reason provided",

        // Full form data
        formData,

        // JSON field status
        fieldStatus,
        fieldReasons,

        // All documents
        documents
      }
    });

  } catch (err) {
    console.error("Get Full Application Error:", err);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// Upload documents for student (admin uploads for students without stu_card)
router.post("/upload-student-documents", upload.array("documents"), async (req, res) => {
  const client = await db.connect();
  
  try {
    await client.query("BEGIN");
    
    const { user_id } = req.body;
    const docs = req.files;
    
    if (!user_id) {
      return res.status(400).json({ success: false, error: "User ID missing" });
    }
    
    if (!docs || docs.length === 0) {
      return res.status(400).json({ success: false, error: "No documents uploaded" });
    }
    
    // Check if user exists and get or create application
    let application = await client.query(
      "SELECT id FROM applications WHERE user_id = $1 LIMIT 1",
      [user_id]
    );
    
    let application_id;
    
    if (application.rows.length === 0) {
      // Create a new application if none exists
      application_id = "APP" + Date.now() + Math.floor(Math.random() * 1000);
      
      await client.query(
        `INSERT INTO applications (id, user_id, status, category) 
         VALUES ($1, $2, 'pending', 'others')`,
        [application_id, user_id]
      );
    } else {
      application_id = application.rows[0].id;
    }
    
    // Upload documents
    for (let file of docs) {
      let key = file.originalname.replace(/\.[^/.]+$/, "");
      
      // Auto detect document type
      let document_type = "student";
      if (key.toLowerCase().includes("aadhaar")) document_type = "student";
      else if (key.toLowerCase().includes("pan")) document_type = "student";
      else if (key.toLowerCase().includes("photo")) document_type = "student";
      else if (key.toLowerCase().includes("signature")) document_type = "student";
      
      // Check if document already exists
      const existingDoc = await client.query(
        "SELECT id FROM application_documents WHERE application_id=$1 AND document_key=$2",
        [application_id, key]
      );
      
      if (existingDoc.rows.length > 0) {
        // Update existing document
        await client.query(
          `UPDATE application_documents 
           SET document_file = $1, file_name = $2, file_size = $3, mime_type = $4, 
               status = 'pending', uploaded_at = CURRENT_TIMESTAMP
           WHERE application_id = $5 AND document_key = $6`,
          [file.buffer, file.originalname, file.size, file.mimetype, application_id, key]
        );
      } else {
        // Insert new document
        await client.query(
          `INSERT INTO application_documents 
           (application_id, user_id, document_type, document_key, document_file, 
            file_name, file_size, mime_type, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending')`,
          [application_id, user_id, document_type, key, file.buffer, 
           file.originalname, file.size, file.mimetype]
        );
      }
    }
    
    await client.query("COMMIT");
    
    return res.json({
      success: true,
      message: "Documents uploaded successfully",
      application_id
    });
    
  } catch (error) {
    console.error("Upload documents error:", error);
    await client.query("ROLLBACK");
    return res.status(500).json({
      success: false,
      error: error.message
    });
  } finally {
    client.release();
  }
});

router.get("/get-employee-documents/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    const result = await db.query(
      `SELECT id, document_type, base64_data, status, reason, created_at, updated_at
       FROM emp_documents
       WHERE user_id = $1`,
      [userId]
    );

    if (result.rows.length === 0) {
      return res.json({ success: true, documents: [] });
    }

    return res.json({
      success: true,
      documents: result.rows
    });

  } catch (error) {
    console.error("Fetch employee documents error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

module.exports = router;
