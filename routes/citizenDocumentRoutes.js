// backend/routes/citizenDocumentRoutes.js
const express = require("express");
const router = express.Router();
const pool = require("../db/db");

const convertImage = (img) => {
    if (!img) return null;
    return Buffer.from(
        img.replace(/^data:image\/\w+;base64,/, ""),
        "base64"
    );
};

// Helper function to check if photo is mandatory and present
const validateMandatoryDocuments = (citizen) => {
    const missingDocs = [];
    
    // Photo is MANDATORY - check in citizens table
    if (!citizen.photo) {
        missingDocs.push('photo');
    }
    
    // Aadhaar is MANDATORY
    if (!citizen.aadhaar_number) {
        missingDocs.push('aadhaar');
    }
    
    return {
        isValid: missingDocs.length === 0,
        missingDocs: missingDocs,
        message: missingDocs.length > 0 
            ? `Missing mandatory documents: ${missingDocs.join(', ')}` 
            : 'All mandatory documents present'
    };
};

// ============================================
// 1. GET all citizen documents with photo validation
// ============================================
router.get("/", async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT
                c.*,
                u.full_name,
                u.email
            FROM citizens c
            LEFT JOIN users u
                ON c.user_id = u.id
            ORDER BY c.created_at DESC
        `);

        const data = result.rows.map(c => ({
            ...c,

            photo: c.photo
                ? `data:image/jpeg;base64,${c.photo.toString("base64")}`
                : null,

            aadhaar_card_image: c.aadhaar_card_image
                ? `data:image/jpeg;base64,${c.aadhaar_card_image.toString("base64")}`
                : null,

            pan_card_image: c.pan_card_image
                ? `data:image/jpeg;base64,${c.pan_card_image.toString("base64")}`
                : null,
        }));

        res.json({
            success: true,
            data
        });

    } catch (err) {
        res.status(500).json({
            success: false,
            error: err.message
        });
    }
});

// ============================================
// 2. GET documents by citizen ID with photo validation
// ============================================
router.get("/citizen/:citizenId", async (req, res) => {
    try {
        const { citizenId } = req.params;
        
        // First, check if citizen exists and has mandatory documents
        const citizenCheck = await pool.query(`
            SELECT 
                id,
                name,
                phone,
                aadhaar_number,
                photo,
                aadhaar_card_image,
                pan_card_image,
                verification_status,
                rejection_reason
            FROM citizens
            WHERE id = $1
        `, [citizenId]);

        if (citizenCheck.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Citizen not found"
            });
        }

        const citizen = citizenCheck.rows[0];
        const validation = validateMandatoryDocuments(citizen);

        // If photo is missing, return warning
        if (!validation.isValid) {
            // Still fetch documents but with warning
            const docResult = await pool.query(`
                SELECT 
                    cd.*,
                    c.name as citizen_name,
                    c.phone as citizen_phone
                FROM citizen_documents cd
                LEFT JOIN citizens c ON cd.citizen_id = c.id
                WHERE cd.citizen_id = $1
                ORDER BY cd.created_at DESC
            `, [citizenId]);

            const documents = docResult.rows.map(d => ({
                ...d,
                document_file: d.document_file
                    ? `data:${d.mime_type || 'image/jpeg'};base64,${Buffer.from(d.document_file).toString("base64")}`
                    : null
            }));

            return res.status(400).json({
                success: false,
                message: validation.message,
                warning: "Photo is mandatory for document verification",
                citizen_info: {
                    id: citizen.id,
                    name: citizen.name,
                    has_photo: citizen.photo !== null,
                    has_aadhaar: citizen.aadhaar_number !== null && citizen.aadhaar_number !== '',
                    verification_status: citizen.verification_status
                },
                documents: documents,
                missing_documents: validation.missingDocs
            });
        }

        // If all mandatory documents are present, fetch all documents
        const result = await pool.query(`
            SELECT 
                cd.*,
                c.name as citizen_name,
                c.phone as citizen_phone,
                c.aadhaar_number,
                c.photo,
                c.aadhaar_card_image,
                c.pan_card_image,
                c.verification_status as citizen_status
            FROM citizen_documents cd
            LEFT JOIN citizens c ON cd.citizen_id = c.id
            WHERE cd.citizen_id = $1
            ORDER BY cd.created_at DESC
        `, [citizenId]);

        const documents = result.rows.map(d => ({
            ...d,
            document_file: d.document_file
                ? `data:${d.mime_type || 'image/jpeg'};base64,${Buffer.from(d.document_file).toString("base64")}`
                : null,
            photo: d.photo
                ? `data:image/jpeg;base64,${Buffer.from(d.photo).toString("base64")}`
                : null,
            aadhaar_card_image: d.aadhaar_card_image
                ? `data:image/jpeg;base64,${Buffer.from(d.aadhaar_card_image).toString("base64")}`
                : null,
            pan_card_image: d.pan_card_image
                ? `data:image/jpeg;base64,${Buffer.from(d.pan_card_image).toString("base64")}`
                : null
        }));

        res.json({
            success: true,
            message: "Documents fetched successfully",
            citizen_info: {
                id: citizen.id,
                name: citizen.name,
                has_photo: true,
                has_aadhaar: true,
                verification_status: citizen.verification_status
            },
            data: documents,
            count: documents.length,
            document_status: "COMPLETE"
        });

    } catch (err) {
        console.error("Error fetching citizen documents:", err);
        res.status(500).json({
            success: false,
            message: "Server Error",
            error: err.message
        });
    }
});

// ============================================
// 3. GET documents by status with photo validation
// ============================================
router.get("/status/:status", async (req, res) => {
    try {
        const { status } = req.params;
        
        const result = await pool.query(`
            SELECT 
                cd.*,
                c.id as citizen_id,
                c.name as citizen_name,
                c.phone as citizen_phone,
                c.aadhaar_number,
                c.photo,
                c.aadhaar_card_image,
                c.pan_card_image,
                c.verification_status as citizen_status,
                u.full_name as user_name,
                u.email as user_email,
                CASE WHEN c.photo IS NOT NULL THEN true ELSE false END AS has_photo
            FROM citizen_documents cd
            LEFT JOIN citizens c ON cd.citizen_id = c.id
            LEFT JOIN users u ON c.user_id = u.id
            WHERE cd.status = $1
            ORDER BY cd.created_at DESC
        `, [status]);

        const documents = result.rows.map(d => ({
            ...d,
            document_file: d.document_file
                ? `data:${d.mime_type || 'image/jpeg'};base64,${Buffer.from(d.document_file).toString("base64")}`
                : null,
            photo: d.photo
                ? `data:image/jpeg;base64,${Buffer.from(d.photo).toString("base64")}`
                : null,
            has_mandatory_photo: d.has_photo,
            is_photo_mandatory: true
        }));

        // Filter out documents without photo if status is approved
        let filteredDocs = documents;
        if (status === 'approved') {
            filteredDocs = documents.filter(d => d.has_photo);
        }

        res.json({
            success: true,
            data: filteredDocs,
            count: filteredDocs.length,
            total_without_photo: documents.filter(d => !d.has_photo).length,
            message: status === 'approved' 
                ? "Only showing approved documents with mandatory photo" 
                : `Documents with status: ${status}`
        });

    } catch (err) {
        console.error("Error fetching documents by status:", err);
        res.status(500).json({
            success: false,
            message: "Server Error",
            error: err.message
        });
    }
});

// ============================================
// 4. GET document by ID with validation
// ============================================
// GET citizen by ID
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `
      SELECT
        c.*,
        u.full_name,
        u.email
      FROM citizens c
      LEFT JOIN users u
        ON u.id = c.user_id
      WHERE c.id = $1
      `,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Citizen not found",
      });
    }

    const c = result.rows[0];

    res.json({
      success: true,
      data: {
        ...c,

        photo: c.photo
          ? `data:image/jpeg;base64,${c.photo.toString("base64")}`
          : null,

        aadhaar_card_image: c.aadhaar_card_image
          ? `data:image/jpeg;base64,${c.aadhaar_card_image.toString("base64")}`
          : null,

        pan_card_image: c.pan_card_image
          ? `data:image/jpeg;base64,${c.pan_card_image.toString("base64")}`
          : null,
      },
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
});

// ============================================
// 5. GET documents by employee ID with validation
// ============================================
router.get("/employee/:employeeId", async (req, res) => {
    try {
        const { employeeId } = req.params;
        
        const result = await pool.query(`
            SELECT 
                cd.*,
                c.id as citizen_id,
                c.name as citizen_name,
                c.phone as citizen_phone,
                c.aadhaar_number,
                c.photo,
                c.aadhaar_card_image,
                c.pan_card_image,
                c.verification_status as citizen_status,
                u.full_name as user_name,
                u.email as user_email,
                CASE WHEN c.photo IS NOT NULL THEN true ELSE false END AS has_photo
            FROM citizen_documents cd
            LEFT JOIN citizens c ON cd.citizen_id = c.id
            LEFT JOIN users u ON c.user_id = u.id
            WHERE c.employee_id = $1
            ORDER BY cd.created_at DESC
        `, [employeeId]);

        const documents = result.rows.map(d => {
            const validation = validateMandatoryDocuments(d);
            return {
                ...d,
                document_file: d.document_file
                    ? `data:${d.mime_type || 'image/jpeg'};base64,${Buffer.from(d.document_file).toString("base64")}`
                    : null,
                photo: d.photo
                    ? `data:image/jpeg;base64,${Buffer.from(d.photo).toString("base64")}`
                    : null,
                document_validation: validation,
                is_complete: validation.isValid
            };
        });

        res.json({
            success: true,
            data: documents,
            count: documents.length,
            summary: {
                total: documents.length,
                complete: documents.filter(d => d.is_complete).length,
                missing_photo: documents.filter(d => !d.has_photo).length
            }
        });

    } catch (err) {
        console.error("Error fetching employee documents:", err);
        res.status(500).json({
            success: false,
            message: "Server Error",
            error: err.message
        });
    }
});

// ============================================
// 6. GET document statistics with photo validation
// ============================================
router.get("/stats/all", async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 
                COUNT(DISTINCT cd.id) as total_documents,
                COUNT(DISTINCT cd.citizen_id) as total_citizens,
                COUNT(CASE WHEN cd.status = 'pending' THEN 1 END) as pending,
                COUNT(CASE WHEN cd.status = 'approved' THEN 1 END) as approved,
                COUNT(CASE WHEN cd.status = 'rejected' THEN 1 END) as rejected,
                COUNT(CASE WHEN c.photo IS NULL THEN 1 END) as citizens_without_photo,
                COUNT(CASE WHEN c.photo IS NOT NULL THEN 1 END) as citizens_with_photo,
                COUNT(CASE WHEN c.aadhaar_number IS NULL OR c.aadhaar_number = '' THEN 1 END) as citizens_without_aadhaar
            FROM citizen_documents cd
            LEFT JOIN citizens c ON cd.citizen_id = c.id
        `);

        const stats = result.rows[0];
        
        // Calculate completion percentage
        const totalCitizens = parseInt(stats.total_citizens) || 0;
        const withPhoto = parseInt(stats.citizens_with_photo) || 0;
        const completionRate = totalCitizens > 0 
            ? Math.round((withPhoto / totalCitizens) * 100) 
            : 0;

        res.json({
            success: true,
            data: {
                ...stats,
                photo_completion_rate: `${completionRate}%`,
                mandatory_documents: {
                    photo: {
                        required: true,
                        present: withPhoto,
                        missing: parseInt(stats.citizens_without_photo) || 0
                    },
                    aadhaar: {
                        required: true,
                        present: totalCitizens - (parseInt(stats.citizens_without_aadhaar) || 0),
                        missing: parseInt(stats.citizens_without_aadhaar) || 0
                    }
                }
            }
        });

    } catch (err) {
        console.error("Error fetching document stats:", err);
        res.status(500).json({
            success: false,
            message: "Server Error",
            error: err.message
        });
    }
});

// ============================================
// 7. Add document for citizen with validation
// ============================================
router.post("/", async (req, res) => {
    const {
        citizen_id,
        document_key,
        document_type,
        document_name,
        document_file,
        mime_type,
        status = 'pending'
    } = req.body;

    if (!citizen_id || !document_key || !document_file) {
        return res.status(400).json({
            success: false,
            message: "citizen_id, document_key, and document_file are required"
        });
    }

    // Check if citizen exists and has photo
    const citizenCheck = await pool.query(
        `SELECT id, photo, aadhaar_number FROM citizens WHERE id = $1`,
        [citizen_id]
    );

    if (citizenCheck.rows.length === 0) {
        return res.status(404).json({
            success: false,
            message: "Citizen not found"
        });
    }

    const citizen = citizenCheck.rows[0];

    // Validate mandatory documents
    const validation = validateMandatoryDocuments(citizen);
    
    if (!validation.isValid) {
        return res.status(400).json({
            success: false,
            message: "Cannot add document: Citizen missing mandatory documents",
            missing_documents: validation.missingDocs,
            required_action: "Please upload photo and aadhaar first"
        });
    }

    const fileBuffer = convertImage(document_file);

    try {
        const result = await pool.query(`
            INSERT INTO citizen_documents
            (citizen_id, document_key, document_type, document_name,
             document_file, mime_type, status, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            RETURNING *
        `, [citizen_id, document_key, document_type, document_name,
            fileBuffer, mime_type, status]);

        const document = {
            ...result.rows[0],
            document_file: result.rows[0].document_file
                ? `data:${result.rows[0].mime_type || 'image/jpeg'};base64,${Buffer.from(result.rows[0].document_file).toString("base64")}`
                : null
        };

        res.json({
            success: true,
            data: document,
            message: "Document added successfully",
            note: "All mandatory documents (photo, aadhaar) are present"
        });

    } catch (err) {
        console.error("Error adding document:", err);
        res.status(500).json({
            success: false,
            message: "Server Error",
            error: err.message
        });
    }
});

// ============================================
// 8. Update document status (Approve/Reject) with validation
// ============================================
router.put("/:id", async (req, res) => {
    const { id } = req.params;
    const { status, rejection_reason } = req.body;

    if (!status) {
        return res.status(400).json({
            success: false,
            message: "Status is required"
        });
    }

    if (status === 'rejected' && !rejection_reason) {
        return res.status(400).json({
            success: false,
            message: "Rejection reason is required for rejected status"
        });
    }

    try {
        // Get document and check citizen's mandatory documents
        const docCheck = await pool.query(`
            SELECT cd.*, c.photo, c.aadhaar_number 
            FROM citizen_documents cd
            LEFT JOIN citizens c ON cd.citizen_id = c.id
            WHERE cd.id = $1
        `, [id]);

        if (docCheck.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Document not found"
            });
        }

        const doc = docCheck.rows[0];
        const validation = validateMandatoryDocuments(doc);

        // If approving, check mandatory documents
        if (status === 'approved' && !validation.isValid) {
            return res.status(400).json({
                success: false,
                message: "Cannot approve: Citizen missing mandatory documents",
                missing_documents: validation.missingDocs,
                required_action: "Upload missing mandatory documents first"
            });
        }

        const result = await pool.query(`
            UPDATE citizen_documents 
            SET status = $1, 
                rejection_reason = $2,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $3
            RETURNING *
        `, [status, rejection_reason, id]);

        const document = {
            ...result.rows[0],
            document_file: result.rows[0].document_file
                ? `data:${result.rows[0].mime_type || 'image/jpeg'};base64,${Buffer.from(result.rows[0].document_file).toString("base64")}`
                : null
        };

        res.json({
            success: true,
            data: document,
            message: `Document ${status} successfully`,
            validation: validation
        });

    } catch (err) {
        console.error("Error updating document:", err);
        res.status(500).json({
            success: false,
            message: "Server Error",
            error: err.message
        });
    }
});

// ============================================
// 9. Bulk update with validation
// ============================================
router.put("/bulk/update", async (req, res) => {
    const { ids, status, rejection_reason } = req.body;

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({
            success: false,
            message: "ids array is required"
        });
    }

    if (!status) {
        return res.status(400).json({
            success: false,
            message: "Status is required"
        });
    }

    try {
        // Check all documents have mandatory documents if approving
        if (status === 'approved') {
            const checkResult = await pool.query(`
                SELECT 
                    cd.id,
                    c.id as citizen_id,
                    c.photo,
                    c.aadhaar_number
                FROM citizen_documents cd
                LEFT JOIN citizens c ON cd.citizen_id = c.id
                WHERE cd.id = ANY($1::int[])
            `, [ids]);

            const invalidDocs = checkResult.rows.filter(row => 
                !row.photo || !row.aadhaar_number
            );

            if (invalidDocs.length > 0) {
                return res.status(400).json({
                    success: false,
                    message: "Cannot approve: Some citizens missing mandatory documents",
                    invalid_documents: invalidDocs.map(d => ({
                        document_id: d.id,
                        citizen_id: d.citizen_id,
                        missing: !d.photo ? 'photo' : 'aadhaar'
                    }))
                });
            }
        }

        const result = await pool.query(`
            UPDATE citizen_documents 
            SET status = $1, 
                rejection_reason = $2,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ANY($3::int[])
            RETURNING *
        `, [status, rejection_reason, ids]);

        const documents = result.rows.map(d => ({
            ...d,
            document_file: d.document_file
                ? `data:${d.mime_type || 'image/jpeg'};base64,${Buffer.from(d.document_file).toString("base64")}`
                : null
        }));

        res.json({
            success: true,
            data: documents,
            message: `${documents.length} documents updated to ${status}`,
            note: status === 'approved' ? "All documents have mandatory photo and aadhaar" : undefined
        });

    } catch (err) {
        console.error("Error updating documents:", err);
        res.status(500).json({
            success: false,
            message: "Server Error",
            error: err.message
        });
    }
});

// ============================================
// 10. Search documents with validation
// ============================================
router.get("/search/:query", async (req, res) => {
    try {
        const { query } = req.params;
        
        const result = await pool.query(`
            SELECT 
                cd.*,
                c.id as citizen_id,
                c.name as citizen_name,
                c.phone as citizen_phone,
                c.aadhaar_number,
                c.photo,
                c.aadhaar_card_image,
                c.pan_card_image,
                c.verification_status as citizen_status,
                u.full_name as user_name,
                u.email as user_email,
                CASE WHEN c.photo IS NOT NULL THEN true ELSE false END AS has_photo,
                CASE WHEN c.aadhaar_number IS NOT NULL AND c.aadhaar_number != '' THEN true ELSE false END AS has_aadhaar
            FROM citizen_documents cd
            LEFT JOIN citizens c ON cd.citizen_id = c.id
            LEFT JOIN users u ON c.user_id = u.id
            WHERE c.name ILIKE $1 
               OR cd.document_key ILIKE $1
               OR cd.document_type ILIKE $1
               OR c.aadhaar_number ILIKE $1
            ORDER BY cd.created_at DESC
        `, [`%${query}%`]);

        const documents = result.rows.map(d => {
            const validation = validateMandatoryDocuments(d);
            return {
                ...d,
                document_file: d.document_file
                    ? `data:${d.mime_type || 'image/jpeg'};base64,${Buffer.from(d.document_file).toString("base64")}`
                    : null,
                photo: d.photo
                    ? `data:image/jpeg;base64,${Buffer.from(d.photo).toString("base64")}`
                    : null,
                document_validation: validation,
                is_complete: validation.isValid
            };
        });

        res.json({
            success: true,
            data: documents,
            count: documents.length,
            summary: {
                complete: documents.filter(d => d.is_complete).length,
                missing_photo: documents.filter(d => !d.has_photo).length,
                missing_aadhaar: documents.filter(d => !d.has_aadhaar).length
            }
        });

    } catch (err) {
        console.error("Error searching documents:", err);
        res.status(500).json({
            success: false,
            message: "Server Error",
            error: err.message
        });
    }
});

// ============================================
// 11. Get citizens without mandatory documents
// ============================================
router.get("/incomplete/mandatory", async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 
                c.id,
                c.name,
                c.phone,
                c.aadhaar_number,
                c.verification_status,
                CASE WHEN c.photo IS NULL THEN 'MISSING_PHOTO' ELSE '' END as missing_photo,
                CASE WHEN c.aadhaar_number IS NULL OR c.aadhaar_number = '' THEN 'MISSING_AADHAAR' ELSE '' END as missing_aadhaar,
                COUNT(cd.id) as total_documents
            FROM citizens c
            LEFT JOIN citizen_documents cd ON c.id = cd.citizen_id
            WHERE c.photo IS NULL 
               OR c.aadhaar_number IS NULL 
               OR c.aadhaar_number = ''
            GROUP BY c.id
            ORDER BY c.created_at DESC
        `);

        const citizens = result.rows.map(c => ({
            ...c,
            missing_documents: [
                c.missing_photo,
                c.missing_aadhaar
            ].filter(Boolean),
            is_photo_mandatory: true,
            is_aadhaar_mandatory: true
        }));

        res.json({
            success: true,
            data: citizens,
            count: citizens.length,
            message: "Citizens missing mandatory documents (Photo and Aadhaar)",
            note: "Photo and Aadhaar are mandatory for all citizens"
        });

    } catch (err) {
        console.error("Error fetching incomplete citizens:", err);
        res.status(500).json({
            success: false,
            message: "Server Error",
            error: err.message
        });
    }
});

module.exports = router;