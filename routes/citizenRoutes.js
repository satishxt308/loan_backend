// backend/routes/citizenRoutes.js
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

// Add citizen
router.post("/add", async (req, res) => {
    const client = await pool.connect();

    try {
        await client.query("BEGIN");
        const {
            name,
            dateOfBirth,
            age,
            address,
            phone,
            gender,
            occupation,
            annualIncome,
            aadhaarNumber,
            panNumber,
            photo,
            aadhaarCardImage,
            panCardImage,
            employeeId
        } = req.body;

        const photoBuffer = convertImage(photo);
        const aadhaarBuffer = convertImage(aadhaarCardImage);
        const panBuffer = convertImage(panCardImage);

        // Check if phone already exists in users
        const exists = await client.query(
            `SELECT id FROM users WHERE phone_number = $1`,
            [phone]
        );

        if (exists.rows.length > 0) {
            await client.query("ROLLBACK");
            return res.status(400).json({
                success: false,
                message: "Phone number already registered"
            });
        }

        // Check if Aadhaar already exists in citizens
        const aadhaarExists = await client.query(
            `SELECT id FROM citizens WHERE aadhaar_number = $1`,
            [aadhaarNumber]
        );

        if (aadhaarExists.rows.length > 0) {
            await client.query("ROLLBACK");
            return res.status(400).json({
                success: false,
                message: "Aadhaar number already registered"
            });
        }

        // Insert into users
        const user = await client.query(
            `
            INSERT INTO users
            (full_name, date_of_birth, gender, role, phone_number, created_by)
            VALUES ($1, $2, $3, 'citizen', $4, $5)
            RETURNING id
            `,
            [name, dateOfBirth, gender, phone, employeeId]
        );

        const userId = user.rows[0].id;

        // Insert into citizens
        await client.query(
            `
            INSERT INTO citizens
            (user_id, employee_id, name, date_of_birth, age, address, phone, 
             gender, occupation, annual_income, aadhaar_number, pan_number,
             photo, aadhaar_card_image, pan_card_image, verification_status)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, 'pending')
            `,
            [
                userId, employeeId, name, dateOfBirth, age, address, phone,
                gender, occupation, annualIncome, aadhaarNumber, panNumber,
                photoBuffer, aadhaarBuffer, panBuffer
            ]
        );

        await client.query("COMMIT");

        res.json({
            success: true,
            message: "Citizen registered successfully"
        });

    } catch (err) {
        await client.query("ROLLBACK");
        console.error("Error adding citizen:", err);
        res.status(500).json({
            success: false,
            message: "Server Error"
        });
    } finally {
        client.release();
    }
});

// Get all citizens (for admin)
router.get("/all", async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 
                c.*,
                u.full_name as employee_name,
                u.phone_number as employee_phone
            FROM citizens c
            LEFT JOIN users u ON c.employee_id = u.id
            ORDER BY c.created_at DESC
        `);

        const citizens = result.rows.map(c => ({
            ...c,
            photo: c.photo
                ? `data:image/jpeg;base64,${Buffer.from(c.photo).toString("base64")}`
                : null,
            aadhaar_card_image: c.aadhaar_card_image
                ? `data:image/jpeg;base64,${Buffer.from(c.aadhaar_card_image).toString("base64")}`
                : null,
            pan_card_image: c.pan_card_image
                ? `data:image/jpeg;base64,${Buffer.from(c.pan_card_image).toString("base64")}`
                : null
        }));

        res.json({
            success: true,
            data: citizens
        });

    } catch (err) {
        console.error("Error fetching citizens:", err);
        res.status(500).json({
            success: false,
            message: "Server Error"
        });
    }
});

// Get citizens by employee ID
router.get("/employee/:id", async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT * FROM citizens WHERE employee_id = $1 ORDER BY id DESC`,
            [req.params.id]
        );

        const citizens = result.rows.map(c => ({
            ...c,
            photo: c.photo
                ? `data:image/jpeg;base64,${Buffer.from(c.photo).toString("base64")}`
                : null,
            aadhaar_card_image: c.aadhaar_card_image
                ? `data:image/jpeg;base64,${Buffer.from(c.aadhaar_card_image).toString("base64")}`
                : null,
            pan_card_image: c.pan_card_image
                ? `data:image/jpeg;base64,${Buffer.from(c.pan_card_image).toString("base64")}`
                : null
        }));

        res.json({
            success: true,
            citizens
        });

    } catch (err) {
        console.error("Error fetching citizens by employee:", err);
        res.status(500).json({
            success: false,
            message: "Server Error"
        });
    }
});

// Get citizen by ID with documents
router.get("/:id", async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 
                c.*,
                u.full_name as employee_name,
                u.phone_number as employee_phone
            FROM citizens c
            LEFT JOIN users u ON c.employee_id = u.id
            WHERE c.id = $1
        `, [req.params.id]);

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Citizen not found"
            });
        }

        const citizen = {
            ...result.rows[0],
            photo: result.rows[0].photo
                ? `data:image/jpeg;base64,${Buffer.from(result.rows[0].photo).toString("base64")}`
                : null,
            aadhaar_card_image: result.rows[0].aadhaar_card_image
                ? `data:image/jpeg;base64,${Buffer.from(result.rows[0].aadhaar_card_image).toString("base64")}`
                : null,
            pan_card_image: result.rows[0].pan_card_image
                ? `data:image/jpeg;base64,${Buffer.from(result.rows[0].pan_card_image).toString("base64")}`
                : null
        };

        res.json({
            success: true,
            data: citizen
        });

    } catch (err) {
        console.error("Error fetching citizen:", err);
        res.status(500).json({
            success: false,
            message: "Server Error"
        });
    }
});

// Update citizen
router.put("/:id", async (req, res) => {
    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        // Get user_id from citizens
        const citizen = await client.query(
            `SELECT user_id FROM citizens WHERE id = $1`,
            [req.params.id]
        );

        if (citizen.rows.length === 0) {
            await client.query("ROLLBACK");
            return res.status(404).json({
                success: false,
                message: "Citizen not found"
            });
        }

        const userId = citizen.rows[0].user_id;

        const {
            name,
            dateOfBirth,
            age,
            address,
            phone,
            gender,
            occupation,
            annualIncome,
            aadhaarNumber,
            panNumber,
            photo,
            aadhaarCardImage,
            panCardImage
        } = req.body;

        const photoBuffer = convertImage(photo);
        const aadhaarBuffer = convertImage(aadhaarCardImage);
        const panBuffer = convertImage(panCardImage);

        // Update users table
        await client.query(
            `UPDATE users
             SET full_name = $1, date_of_birth = $2, gender = $3, phone_number = $4
             WHERE id = $5`,
            [name, dateOfBirth, gender, phone, userId]
        );

        // Update citizens table
        await client.query(
            `UPDATE citizens
             SET name = $1, date_of_birth = $2, age = $3, address = $4, phone = $5,
                 gender = $6, occupation = $7, annual_income = $8,
                 aadhaar_number = $9, pan_number = $10, photo = $11,
                 aadhaar_card_image = $12, pan_card_image = $13,
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = $14`,
            [
                name, dateOfBirth, age, address, phone,
                gender, occupation, annualIncome,
                aadhaarNumber, panNumber,
                photoBuffer, aadhaarBuffer, panBuffer,
                req.params.id
            ]
        );

        await client.query("COMMIT");

        res.json({
            success: true,
            message: "Citizen updated successfully"
        });

    } catch (err) {
        await client.query("ROLLBACK");
        console.error("Error updating citizen:", err);
        res.status(500).json({
            success: false,
            message: "Server Error"
        });
    } finally {
        client.release();
    }
});

// Update citizen verification status
router.put("/:id/status", async (req, res) => {
    const { id } = req.params;
    const { verification_status, rejection_reason } = req.body;

    try {
        const result = await pool.query(`
            UPDATE citizens 
            SET verification_status = $1, 
                rejection_reason = $2,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $3
            RETURNING *
        `, [verification_status, rejection_reason, id]);

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Citizen not found"
            });
        }

        // If approved, update user role if user exists
        if (verification_status === 'approved') {
            const userCheck = await pool.query(
                `SELECT id FROM users WHERE phone_number = $1`,
                [result.rows[0].phone]
            );
            
            if (userCheck.rows.length > 0) {
                await pool.query(
                    `UPDATE users SET role = 'citizen' WHERE id = $1`,
                    [userCheck.rows[0].id]
                );
            }
        }

        res.json({
            success: true,
            data: result.rows[0],
            message: `Citizen ${verification_status} successfully`
        });

    } catch (err) {
        console.error("Error updating citizen status:", err);
        res.status(500).json({
            success: false,
            message: "Server Error"
        });
    }
});

// Delete citizen
router.delete("/:id", async (req, res) => {
    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        // Get user_id first
        const citizen = await client.query(
            `SELECT user_id FROM citizens WHERE id = $1`,
            [req.params.id]
        );

        if (citizen.rows.length === 0) {
            await client.query("ROLLBACK");
            return res.status(404).json({
                success: false,
                message: "Citizen not found"
            });
        }

        const userId = citizen.rows[0].user_id;

        // Delete from citizens
        await client.query(
            `DELETE FROM citizens WHERE id = $1`,
            [req.params.id]
        );

        // Delete from users
        await client.query(
            `DELETE FROM users WHERE id = $1`,
            [userId]
        );

        await client.query("COMMIT");

        res.json({
            success: true,
            message: "Citizen deleted successfully"
        });

    } catch (err) {
        await client.query("ROLLBACK");
        console.error("Error deleting citizen:", err);
        res.status(500).json({
            success: false,
            message: "Server Error"
        });
    } finally {
        client.release();
    }
});

// Get citizen statistics
router.get("/stats/:employeeId", async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 
                COUNT(*) as total,
                COUNT(CASE WHEN verification_status = 'pending' THEN 1 END) as pending,
                COUNT(CASE WHEN verification_status = 'approved' THEN 1 END) as approved,
                COUNT(CASE WHEN verification_status = 'rejected' THEN 1 END) as rejected
            FROM citizens
            WHERE employee_id = $1
        `, [req.params.employeeId]);

        res.json({
            success: true,
            data: result.rows[0]
        });

    } catch (err) {
        console.error("Error fetching citizen stats:", err);
        res.status(500).json({
            success: false,
            message: "Server Error"
        });
    }
});

module.exports = router;