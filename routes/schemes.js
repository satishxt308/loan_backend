const express = require("express");
const router = express.Router();
const pool = require("../db/db");
const multer = require("multer");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
  },
  fileFilter: (req, file, cb) => {
    const allowedMimeTypes = ["image/jpeg", "image/png", "image/jpg", "application/pdf"];
    if (allowedMimeTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Invalid file type. Only JPEG, PNG, and PDF are allowed."));
    }
  }
});

// Helper function to organize features by type
const organizeFeaturesByType = (features) => {
    const organized = {
        features: [],
        coverage_details: [],
        key_benefits: [],
        exclusions: [],
        documents_required: []
    };
    
    features.forEach(feature => {
        switch(feature.feature_type) {
            case 'feature':
                organized.features.push(feature.feature_text);
                break;
            case 'coverage':
                organized.coverage_details.push({
                    name: feature.feature_name,
                    description: feature.feature_text
                });
                break;
            case 'benefit':
                organized.key_benefits.push(feature.feature_text);
                break;
            case 'exclusion':
                organized.exclusions.push(feature.feature_text);
                break;
            case 'document':
                // Now include file_type for documents
                organized.documents_required.push({
                    text: feature.feature_text,
                    type: feature.file_type || 'text' // Default to 'text' if not specified
                });
                break;
        }
    });
    
    return organized;
};

// GET all schemas with features - UPDATED
router.get('/schemas', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 
                s.*,
                json_agg(
                    jsonb_build_object(
                        'feature_type', sf.feature_type,
                        'feature_name', sf.feature_name,
                        'feature_text', sf.feature_text,
                        'file_type', sf.file_type
                    )
                ) FILTER (WHERE sf.id IS NOT NULL) as all_features
            FROM schemes s
            LEFT JOIN scheme_features sf ON s.id = sf.scheme_id
            GROUP BY s.id
            ORDER BY s.created_at DESC
        `);
        
        // Organize features by type
      const organizedData = result.rows.map(row => {
  const features = row.all_features || [];
  const organized = organizeFeaturesByType(features);

  let imageBase64 = null;

  if (row.icon_image) {
    imageBase64 = `data:image/png;base64,${row.icon_image.toString('base64')}`;
  }

  return {
    ...row,
    icon_image: imageBase64, // ✅ send usable image
    ...organized,
    all_features: undefined
  };
});
        
        res.json(organizedData);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to fetch schemas' });
    }
});

// GET single schema by ID - UPDATED
router.get('/schemas/:id', async (req, res) => {
    try {
        const { id } = req.params;
        if (!id || id === 'undefined' || isNaN(parseInt(id))) {
            return res.status(400).json({ error: 'Invalid schema ID' });
        }
        const result = await pool.query(`
            SELECT 
                s.*,
                json_agg(
                    jsonb_build_object(
                        'feature_type', sf.feature_type,
                        'feature_name', sf.feature_name,
                        'feature_text', sf.feature_text,
                        'file_type', sf.file_type
                    )
                ) FILTER (WHERE sf.id IS NOT NULL) as all_features
            FROM schemes s
            LEFT JOIN scheme_features sf ON s.id = sf.scheme_id
            WHERE s.id = $1
            GROUP BY s.id
        `, [id]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Schema not found' });
        }
        
        const row = result.rows[0];
const organized = organizeFeaturesByType(row.all_features || []);

let imageBase64 = null;

if (row.icon_image) {
  imageBase64 = `data:image/png;base64,${row.icon_image.toString('base64')}`;
}

res.json({
  ...row,
  icon_image: imageBase64, // ✅ FIX
  ...organized,
  all_features: undefined
});
        
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to fetch schema' });
    }
});

// POST create new schema - COMPLETELY FIXED
router.post('/schemas/add', async (req, res) => { 
    const client = await pool.connect();
    let schemaId; // Declare schemaId here so it's accessible in catch block
    
    try {
        await client.query('BEGIN');
        
        const {
            schema_name,
            schema_type,
            short_description,
            amount,
            frequency,
            full_description,
            rating,
            enrolled_count,
            iconImage,
            interest_rate,
            tenure_months,
            eligibility,
            features,
            coverage_details,
            key_benefits,
            exclusions,
            documents_required
        } = req.body;
        
        const iconBuffer = iconImage 
  ? Buffer.from(iconImage, "base64") 
  : null;
        // Check if schema name already exists
        const existingSchema = await client.query(
            'SELECT id FROM schemes WHERE schema_name = $1',
            [schema_name]
        );
        
        if (existingSchema.rows.length > 0) {
            await client.query('ROLLBACK');
            return res.status(409).json({ 
                success: false, 
                error: 'Schema name already exists. Please use a different name.' 
            });
        }
        
        // Insert into schemes table
        const schemeResult = await client.query(`
            INSERT INTO schemes (
    schema_name, schema_type, short_description, 
    amount, frequency, full_description, 
    rating, enrolled_count, icon_image,
    interest_rate, tenure_months, eligibility
)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
RETURNING id
        `, [
  schema_name,
  schema_type,
  short_description || '',
  parseFloat(amount) || 0,
  frequency,
  full_description || '',
  parseFloat(rating) || 4.8,
  parseInt(enrolled_count) || 2500,
  iconBuffer,
  parseFloat(interest_rate) || 0.00,
  parseInt(tenure_months) || 12,
  eligibility || ''
]);
        
        schemaId = schemeResult.rows[0].id; // Assign to the outer variable
        
        // Insert all features into single table
        const featureInserts = [];
        
        // Insert features (feature_type = 'feature')
        if (features && Array.isArray(features) && features.length > 0) {
            for (const feature of features) {
                if (feature && feature.trim()) {
                    featureInserts.push(
                        client.query(
                            `INSERT INTO scheme_features (scheme_id, feature_type, feature_text) 
                             VALUES ($1, 'feature', $2)`,
                            [schemaId, feature]
                        )
                    );
                }
            }
        }
        
        // Insert coverage details (feature_type = 'coverage')
        if (coverage_details && Array.isArray(coverage_details) && coverage_details.length > 0) {
            for (const coverage of coverage_details) {
                if (coverage && (coverage.name?.trim() || coverage.description?.trim())) {
                    featureInserts.push(
                        client.query(
                            `INSERT INTO scheme_features (scheme_id, feature_type, feature_name, feature_text) 
                             VALUES ($1, 'coverage', $2, $3)`,
                            [schemaId, coverage.name || '', coverage.description || '']
                        )
                    );
                }
            }
        }
        
        // Insert key benefits (feature_type = 'benefit')
        if (key_benefits && Array.isArray(key_benefits) && key_benefits.length > 0) {
            for (const benefit of key_benefits) {
                if (benefit && benefit.trim()) {
                    featureInserts.push(
                        client.query(
                            `INSERT INTO scheme_features (scheme_id, feature_type, feature_text) 
                             VALUES ($1, 'benefit', $2)`,
                            [schemaId, benefit]
                        )
                    );
                }
            }
        }
        
        // Insert exclusions (feature_type = 'exclusion')
        if (exclusions && Array.isArray(exclusions) && exclusions.length > 0) {
            for (const exclusion of exclusions) {
                if (exclusion && exclusion.trim()) {
                    featureInserts.push(
                        client.query(
                            `INSERT INTO scheme_features (scheme_id, feature_type, feature_text) 
                             VALUES ($1, 'exclusion', $2)`,
                            [schemaId, exclusion]
                        )
                    );
                }
            }
        }
        
        // Insert documents required (feature_type = 'document')
        if (documents_required && Array.isArray(documents_required) && documents_required.length > 0) {
            for (const document of documents_required) {
                // Check if document is object with text and type
                if (document && document.text && document.text.trim()) {
                    // Ensure type is either 'text' or 'pdf'
                    const fileType = document.type === 'pdf' ? 'pdf' : 'text';
                    
                    featureInserts.push(
                        client.query(
                            `INSERT INTO scheme_features (scheme_id, feature_type, feature_text, file_type) 
                             VALUES ($1, 'document', $2, $3)`,
                            [schemaId, document.text, fileType]
                        )
                    );
                }
                // Handle legacy format (just string)
                else if (document && typeof document === 'string' && document.trim()) {
                    featureInserts.push(
                        client.query(
                            `INSERT INTO scheme_features (scheme_id, feature_type, feature_text, file_type) 
                             VALUES ($1, 'document', $2, 'text')`,
                            [schemaId, document]
                        )
                    );
                }
            }
        }
        
        // Execute all inserts in parallel
        if (featureInserts.length > 0) {
            await Promise.all(featureInserts);
        }
        
        await client.query('COMMIT');
        
        res.json({ 
            success: true, 
            message: 'Schema created successfully',
            schemaId: schemaId, // Use the variable
            schemaName: schema_name
        });
        
    } catch (error) {
        await client.query('ROLLBACK');
        console.error("Create Schema Error:", error);
        
        if (error.code === '23505') { // Unique violation
            res.status(409).json({ 
                success: false, 
                error: 'Schema name already exists. Please use a different name.' 
            });
        } else {
            res.status(500).json({ 
                success: false, 
                error: 'Failed to create schema: ' + error.message 
            });
        }
    } finally {
        client.release();
    }
});

// PUT update schema - FIXED variable name
router.put('/schemas/edit/:id', async (req, res) => {
    const { id } = req.params;
    if (!id || id === 'undefined' || isNaN(parseInt(id))) {
        return res.status(400).json({ error: 'Invalid schema ID' });
    }
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');
        
        // Check if schema exists
        const checkResult = await client.query(
            'SELECT id FROM schemes WHERE id = $1',
            [id]
        );
        
        if (checkResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Schema not found' });
        }
        
        const {
            schema_name,
            schema_type,
            short_description,
            amount,
            frequency,
            full_description,
            rating,
            enrolled_count,
            iconImage,
            interest_rate,
            tenure_months,
            eligibility,
            features,
            coverage_details,
            key_benefits,
            exclusions,
            documents_required
        } = req.body;
        
        let iconBuffer = null;

if (iconImage) {
  const base64Data = iconImage.includes('base64,')
    ? iconImage.split('base64,')[1]
    : iconImage;

  iconBuffer = Buffer.from(base64Data, "base64");
}

        // Update schemes table
        await client.query(`
           UPDATE schemes SET
    schema_name = $1,
    schema_type = $2,
    short_description = $3,
    amount = $4,
    frequency = $5,
    full_description = $6,
    rating = $7,
    enrolled_count = $8,
    icon_image = COALESCE($9, icon_image),
    interest_rate = $10,
    tenure_months = $11,
    eligibility = $12,
    updated_at = CURRENT_TIMESTAMP
WHERE id = $13
        `,[
  schema_name,
  schema_type,
  short_description,
  parseFloat(amount) || 0,
  frequency,
  full_description,
  parseFloat(rating) || 4.8,
  parseInt(enrolled_count) || 2500,
  iconBuffer,
  parseFloat(interest_rate) || 0.00,
  parseInt(tenure_months) || 12,
  eligibility || '',
  id
]);
        
        // Delete existing features
        await client.query('DELETE FROM scheme_features WHERE scheme_id = $1', [id]);
        
        // Insert new features
        const featureInserts = [];
        
        
        // Insert features
        if (features && Array.isArray(features) && features.length > 0) {
            for (const feature of features) {
                if (feature.trim()) {
                    featureInserts.push(
                        client.query(
                            `INSERT INTO scheme_features (scheme_id, feature_type, feature_text) 
                             VALUES ($1, 'feature', $2)`,
                            [id, feature]
                        )
                    );
                }
            }
        }
        
        // Insert coverage details
        if (coverage_details && Array.isArray(coverage_details) && coverage_details.length > 0) {
            for (const coverage of coverage_details) {
                if (coverage.name.trim() || coverage.description.trim()) {
                    featureInserts.push(
                        client.query(
                            `INSERT INTO scheme_features (scheme_id, feature_type, feature_name, feature_text) 
                             VALUES ($1, 'coverage', $2, $3)`,
                            [id, coverage.name, coverage.description]
                        )
                    );
                }
            }
        }
        
        // Insert key benefits
        if (key_benefits && Array.isArray(key_benefits) && key_benefits.length > 0) {
            for (const benefit of key_benefits) {
                if (benefit.trim()) {
                    featureInserts.push(
                        client.query(
                            `INSERT INTO scheme_features (scheme_id, feature_type, feature_text) 
                             VALUES ($1, 'benefit', $2)`,
                            [id, benefit]
                        )
                    );
                }
            }
        }
        
        // Insert exclusions
        if (exclusions && Array.isArray(exclusions) && exclusions.length > 0) {
            for (const exclusion of exclusions) {
                if (exclusion.trim()) {
                    featureInserts.push(
                        client.query(
                            `INSERT INTO scheme_features (scheme_id, feature_type, feature_text) 
                             VALUES ($1, 'exclusion', $2)`,
                            [id, exclusion]
                        )
                    );
                }
            }
        }
        
        // Insert documents required
        if (documents_required && Array.isArray(documents_required) && documents_required.length > 0) {
            for (const document of documents_required) {
                // Check if document is object with text and type
                if (document.text && document.text.trim()) {
                    // Ensure type is either 'text' or 'pdf'
                    const fileType = document.type === 'pdf' ? 'pdf' : 'text';
                    
                    featureInserts.push(
                        client.query(
                            `INSERT INTO scheme_features (scheme_id, feature_type, feature_text, file_type) 
                             VALUES ($1, 'document', $2, $3)`,
                            [id, document.text, fileType]
                        )
                    );
                }
                // Handle legacy format (just string)
                else if (typeof document === 'string' && document.trim()) {
                    featureInserts.push(
                        client.query(
                            `INSERT INTO scheme_features (scheme_id, feature_type, feature_text, file_type) 
                             VALUES ($1, 'document', $2, 'text')`,
                            [id, document]
                        )
                    );
                }
            }
        }
        
        // Execute all inserts
        if (featureInserts.length > 0) {
            await Promise.all(featureInserts);
        }
        
        await client.query('COMMIT');
        res.json({ 
            success: true, 
            message: 'Schema updated successfully' 
        });
        
    } catch (error) {
        await client.query('ROLLBACK');
        console.error("Update Error:", error);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to update schema: ' + error.message 
        });
    } finally {
        client.release();
    }
});

// DELETE schema type (SAFE)
router.delete("/schema-types/delete/:id", async (req, res) => {
  try {
    const { id } = req.params;
    if (!id || id === 'undefined' || isNaN(parseInt(id))) {
      return res.status(400).json({ error: "Invalid schema type ID" });
    }

    // Get type name
    const typeRes = await pool.query(
      "SELECT type_name FROM schema_types WHERE id = $1",
      [id]
    );

    if (typeRes.rows.length === 0) {
      return res.status(404).json({ error: "Schema type not found" });
    }

    const typeName = typeRes.rows[0].type_name;

    // Check if used in schemes
    const used = await pool.query(
      "SELECT 1 FROM schemes WHERE schema_type = $1 LIMIT 1",
      [typeName]
    );

    if (used.rows.length > 0) {
      return res.status(400).json({
        error: "Cannot delete. This schema type is used by existing schemas."
      });
    }

    // Safe to delete
    await pool.query(
      "DELETE FROM schema_types WHERE id = $1",
      [id]
    );

    res.json({
      success: true,
      message: "Schema type deleted successfully"
    });

  } catch (err) {
    console.error("Delete Schema Type Error:", err);
    res.status(500).json({ error: "Failed to delete schema type" });
  }
});


router.delete('/schemas/delete/:id', async (req, res) => {
    const { id } = req.params;
    if (!id || id === 'undefined' || isNaN(parseInt(id))) {
        return res.status(400).json({ success: false, error: 'Invalid schema ID' });
    }
    const client = await pool.connect();
    try {

        await client.query('BEGIN');

        const check = await client.query(
            'SELECT schema_name FROM schemes WHERE id = $1',
            [id]
        );

        if (check.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({
                success: false,
                error: 'Schema not found'
            });
        }

        // delete child records first
        await client.query(
            'DELETE FROM scheme_features WHERE scheme_id = $1',
            [id]
        );

        // then delete schema
        await client.query(
            'DELETE FROM schemes WHERE id = $1',
            [id]
        );

        await client.query('COMMIT');

        res.json({
            success: true,
            message: 'Schema deleted successfully',
            deletedSchema: check.rows[0].schema_name
        });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error("Delete Error:", error);
        res.status(500).json({
            success: false,
            error: 'Failed to delete schema'
        });
    } finally {
        client.release();
    }
});


router.get("/schema-types", async (req, res) => {
  const result = await pool.query(
    "SELECT id, type_name FROM schema_types ORDER BY id ASC"
  );
  res.json(result.rows);
});


// POST add new schema type (no changes needed)
router.post('/schema-types/add', async (req, res) => {
    try {
        const { type_name } = req.body;
        
        const result = await pool.query(
            'INSERT INTO schema_types (type_name) VALUES ($1) RETURNING type_name',
            [type_name]
        );
        
        res.json({ 
            success: true, 
            message: 'Schema type added successfully',
            type_name: result.rows[0].type_name
        });
        
    } catch (err) {
  console.error(err);

  if (err.response?.status === 409) {
   if (err.code === '23505') {
  return res.status(409).json({
    success: false,
    error: 'Type already exists'
  });
}

res.status(500).json({
  success: false,
  error: 'Failed to add schema type'
});
  } else {
    Swal.fire({
      title: "Error!",
      text: "Failed to save schema",
      icon: "error",
      confirmButtonColor: "#2ED197"
    });
  }
}

});

// Initialize loan_applications and loan_emis tables automatically
const initLoanApplicationsTable = async () => {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS loan_applications (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                scheme_name VARCHAR(255) NOT NULL,
                requested_amount NUMERIC NOT NULL,
                tenure_months INTEGER NOT NULL,
                monthly_emi NUMERIC NOT NULL,
                bank_name VARCHAR(100) NOT NULL,
                account_number VARCHAR(50) NOT NULL,
                ifsc_code VARCHAR(20) NOT NULL,
                account_holder VARCHAR(150) NOT NULL,
                status VARCHAR(50) DEFAULT 'Pending',
                document_name VARCHAR(255),
                document_file TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        // Safely add columns if table already exists
        await pool.query(`
            ALTER TABLE loan_applications ADD COLUMN IF NOT EXISTS document_name VARCHAR(255);
            ALTER TABLE loan_applications ADD COLUMN IF NOT EXISTS document_file TEXT;
        `);
        
        // Create loan_emis table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS loan_emis (
                id SERIAL PRIMARY KEY,
                loan_application_id INTEGER NOT NULL REFERENCES loan_applications(id) ON DELETE CASCADE,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                emi_number INTEGER NOT NULL,
                due_date DATE NOT NULL,
                amount NUMERIC NOT NULL,
                status VARCHAR(50) DEFAULT 'Pending',
                paid_date TIMESTAMP,
                transaction_id VARCHAR(100),
                payment_method VARCHAR(50),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        console.log("✓ loan_applications and loan_emis tables are verified/created");

        // Add approved_at column to track when loan was approved (used for correct EMI start date)
        await pool.query(`
            ALTER TABLE loan_applications ADD COLUMN IF NOT EXISTS approved_at TIMESTAMP;
        `);

        // Alter payments table to add emi_id and loan_id columns if they don't exist
        await pool.query(`
            ALTER TABLE payments ADD COLUMN IF NOT EXISTS emi_id INTEGER REFERENCES loan_emis(id) ON DELETE SET NULL;
            ALTER TABLE payments ADD COLUMN IF NOT EXISTS loan_id INTEGER REFERENCES loan_applications(id) ON DELETE SET NULL;
        `);
        console.log("✓ payments table columns are updated");
    } catch (err) {
        console.error("Error creating loan database tables:", err.message);
    }
};
initLoanApplicationsTable();

// POST apply for a scheme/loan
router.post('/apply', upload.single('document'), async (req, res) => {
    try {
        const { 
            user_id, 
            scheme_name, 
            requested_amount, 
            tenure_months, 
            monthly_emi, 
            bank_name, 
            account_number, 
            ifsc_code, 
            account_holder,
            document_name
        } = req.body;

        if (!user_id || !scheme_name || !requested_amount || !tenure_months || !monthly_emi) {
            return res.status(400).json({ success: false, error: 'Required fields missing' });
        }

        let db_document_file = null;
        let db_document_name = document_name || null;

        if (req.file) {
            const base64Str = req.file.buffer.toString("base64");
            db_document_file = `data:${req.file.mimetype};base64,` + base64Str;
            if (!db_document_name) {
                db_document_name = req.file.originalname;
            }
        }

        const result = await pool.query(`
            INSERT INTO loan_applications (
                user_id, 
                scheme_name, 
                requested_amount, 
                tenure_months, 
                monthly_emi, 
                bank_name, 
                account_number, 
                ifsc_code, 
                account_holder,
                document_name,
                document_file
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *
        `, [
            parseInt(user_id), 
            scheme_name, 
            parseFloat(requested_amount), 
            parseInt(tenure_months), 
            parseFloat(monthly_emi), 
            bank_name, 
            account_number, 
            ifsc_code, 
            account_holder,
            db_document_name,
            db_document_file
        ]);

        res.json({ 
            success: true, 
            message: 'Loan application submitted successfully', 
            application: result.rows[0] 
        });
    } catch (error) {
        console.error("Error submitting loan application:", error);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// GET all loan applications for admin
router.get('/applications', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT la.*, u.full_name, u.email, u.phone_number
            FROM loan_applications la
            JOIN users u ON la.user_id = u.id
            ORDER BY la.created_at DESC
        `);
        res.json({ success: true, data: result.rows });
    } catch (error) {
        console.error("Error fetching loan applications:", error);
        res.status(500).json({ success: false, error: 'Failed to fetch loan applications' });
    }
});

// PUT update status of loan application
router.put('/applications/:id/status', async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;

        if (!id || id === 'undefined' || isNaN(parseInt(id))) {
            return res.status(400).json({ success: false, error: 'Invalid application ID' });
        }

        // When loan is approved/disbursed, record approved_at timestamp
        // This is the reference date for EMI schedule generation
        const isApproving = ['approved', 'Approved', 'disbursed', 'Disbursed'].includes(status);

        const result = await pool.query(
            isApproving
                ? `UPDATE loan_applications SET status = $1, approved_at = NOW() WHERE id = $2 RETURNING *`
                : `UPDATE loan_applications SET status = $1 WHERE id = $2 RETURNING *`,
            [status, id]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Application not found' });
        }

        // If approving, delete any stale/incorrect EMIs that may have been generated before approval
        if (isApproving) {
            await pool.query(`DELETE FROM loan_emis WHERE loan_application_id = $1`, [id]);
        }

        res.json({ success: true, message: 'Status updated successfully', data: result.rows[0] });
    } catch (error) {
        console.error("Error updating status:", error);
        res.status(500).json({ success: false, error: 'Failed to update status' });
    }
});

// GET ALL loan applications for a user (full history)
router.get('/applications/user/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        if (!userId || userId === 'undefined' || isNaN(parseInt(userId))) {
            return res.status(400).json({ success: false, error: 'Invalid user ID' });
        }
        const result = await pool.query(`
            SELECT * FROM loan_applications
            WHERE user_id = $1
            ORDER BY created_at DESC
        `, [parseInt(userId)]);

        res.json({ success: true, applications: result.rows });
    } catch (error) {
        console.error("Error fetching all user loan applications:", error);
        res.status(500).json({ success: false, error: 'Failed to fetch loan applications' });
    }
});

// GET a user's most recent loan application status
router.get('/application/user/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        if (!userId || userId === 'undefined' || isNaN(parseInt(userId))) {
            return res.status(400).json({ success: false, error: 'Invalid user ID' });
        }
        const result = await pool.query(`
            SELECT * FROM loan_applications
            WHERE user_id = $1
            ORDER BY created_at DESC
            LIMIT 1
        `, [parseInt(userId)]);
        
        if (result.rows.length === 0) {
            return res.json({ success: true, hasApplication: false });
        }
        
        res.json({ success: true, hasApplication: true, application: result.rows[0] });
    } catch (error) {
        console.error("Error fetching user loan application:", error);
        res.status(500).json({ success: false, error: 'Failed to fetch user loan application' });
    }
});

// GET repayment schedule for an active loan
router.get('/repayment/schedule/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        if (!userId || userId === 'undefined' || isNaN(parseInt(userId))) {
            return res.status(400).json({ success: false, error: 'Invalid user ID' });
        }
        
        // 1. Get the active (Approved/Disbursed) loan first. If none, get the most recent one.
        const loanRes = await pool.query(`
            SELECT * FROM loan_applications
            WHERE user_id = $1
            ORDER BY 
                CASE 
                    WHEN status IN ('Approved', 'Approved', 'disbursed', 'Disbursed') THEN 1 
                    ELSE 2 
                END ASC,
                created_at DESC
            LIMIT 1
        `, [parseInt(userId)]);

        if (loanRes.rows.length === 0) {
            return res.json({ success: true, hasActiveLoan: false });
        }

        const loan = loanRes.rows[0];
        const statusLower = loan.status?.toLowerCase();

        // If the loan is not approved or disbursed, return that it's not active yet
        if (statusLower !== 'approved' && statusLower !== 'disbursed') {
            return res.json({ 
                success: true, 
                hasActiveLoan: true, 
                isActive: false, 
                application: loan 
            });
        }

        // Update any overdue EMIs in the database before querying
        await pool.query(`
            UPDATE loan_emis
            SET status = 'Overdue'
            WHERE loan_application_id = $1 AND due_date < CURRENT_DATE AND status = 'Pending'
        `, [loan.id]);

        // 2. Query EMIs for this loan application
        const emiRes = await pool.query(`
            SELECT * FROM loan_emis
            WHERE loan_application_id = $1
            ORDER BY emi_number ASC
        `, [loan.id]);

        let emis = emiRes.rows;

        // 3. If no EMIs exist, generate them from the APPROVAL date (not creation date)
        if (emis.length === 0) {
            const tenure = parseInt(loan.tenure_months) || 24;
            const emiAmount = parseFloat(loan.monthly_emi) || 12500;

            // CRITICAL FIX: Use approved_at as the EMI start reference.
            // If approved_at is not set (older records), fall back to today to avoid past dates.
            const referenceDate = loan.approved_at
                ? new Date(loan.approved_at)
                : new Date(); // fallback: today

            for (let i = 1; i <= tenure; i++) {
                const dueDate = new Date(referenceDate);
                // First EMI due exactly 1 month after approval, second 2 months, etc.
                dueDate.setMonth(dueDate.getMonth() + i);

                await pool.query(`
                    INSERT INTO loan_emis (loan_application_id, user_id, emi_number, due_date, amount, status, paid_date, transaction_id, payment_method)
                    VALUES ($1, $2, $3, $4, $5, 'Pending', NULL, NULL, NULL)
                `, [loan.id, userId, i, dueDate.toISOString().slice(0, 10), emiAmount]);
            }

            // Refetch generated EMIs
            const generatedEmis = await pool.query(`
                SELECT * FROM loan_emis
                WHERE loan_application_id = $1
                ORDER BY emi_number ASC
            `, [loan.id]);
            emis = generatedEmis.rows;
        }

        res.json({
            success: true,
            hasActiveLoan: true,
            isActive: true,
            application: loan,
            schedule: emis
        });

    } catch (error) {
        console.error("Error fetching repayment schedule:", error);
        res.status(500).json({ success: false, error: 'Failed to fetch repayment schedule' });
    }
});

// POST make payment for an EMI
router.post('/repayment/pay/:emiId', async (req, res) => {
    try {
        const { emiId } = req.params;
        const { paymentMethod } = req.body;

        if (!emiId || emiId === 'undefined' || isNaN(parseInt(emiId))) {
            return res.status(400).json({ success: false, error: 'Invalid installment ID' });
        }

        // Double payment safeguard: Verify status before updating
        const emiCheck = await pool.query('SELECT status FROM loan_emis WHERE id = $1', [parseInt(emiId)]);
        if (emiCheck.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'EMI record not found' });
        }
        if (emiCheck.rows[0].status === 'Paid') {
            return res.status(400).json({ success: false, error: 'This EMI installment has already been successfully settled and paid.' });
        }

        const txnId = 'TXN' + Math.floor(Math.random() * 900000000000 + 100000000000);
        const method = paymentMethod || 'Manual Payment';

        const result = await pool.query(`
            UPDATE loan_emis
            SET status = 'Paid',
                paid_date = CURRENT_TIMESTAMP,
                transaction_id = $1,
                payment_method = $2
            WHERE id = $3
            RETURNING *
        `, [txnId, method, parseInt(emiId)]);

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'EMI record not found' });
        }

        res.json({
            success: true,
            message: 'EMI payment successful',
            emi: result.rows[0]
        });

    } catch (error) {
        console.error("Error processing EMI payment:", error);
        res.status(500).json({ success: false, error: 'Failed to process EMI payment' });
    }
});

module.exports = router;