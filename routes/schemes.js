// backend/routes/schemes.js
const express = require("express");
const router = express.Router();
const pool = require("../db/db");

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
    rating, enrolled_count, icon_image
)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
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
  iconBuffer
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
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');
        const { id } = req.params;
        
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
    updated_at = CURRENT_TIMESTAMP
WHERE id = $10
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
    const client = await pool.connect();
    try {
        const { id } = req.params;

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

module.exports = router;