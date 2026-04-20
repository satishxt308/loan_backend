// backend/routes/applications.js
// no need
const express = require('express');
const router = express.Router();
const pool = require('../db/db');

// Get all applications (with filters)
router.get('/applications', async (req, res) => {
  try {
    const { status, category, page = 1, limit = 10 } = req.query;
    const offset = (page - 1) * limit;

    let whereClause = 'WHERE 1=1';
    const values = [];
    let paramCount = 1;

    if (status) {
      whereClause += ` AND status = $${paramCount}`;
      values.push(status);
      paramCount++;
    }

    if (category) {
      whereClause += ` AND category = $${paramCount}`;
      values.push(category);
      paramCount++;
    }

    const query = `
      SELECT a.*, u.full_name, u.email, u.phone_number
      FROM applications a
      JOIN users u ON a.user_id = u.id
      ${whereClause}
      ORDER BY a.submitted_date DESC
      LIMIT $${paramCount} OFFSET $${paramCount + 1}
    `;

    values.push(limit, offset);

    const result = await db.query(query, values);

    // Get total count for pagination
    const countQuery = `
      SELECT COUNT(*) FROM applications a
      JOIN users u ON a.user_id = u.id
      ${whereClause}
    `;
    const countResult = await db.query(countQuery, values.slice(0, -2));
    const total = parseInt(countResult.rows[0].count);

    res.json({
      success: true,
      applications: result.rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });

  } catch (error) {
    console.error('Error fetching applications:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch applications',
      error: error.message
    });
  }
});

// Approve application
router.patch('/applications/:applicationId/approve', async (req, res) => {
  try {
    const { applicationId } = req.params;

    const query = `
      UPDATE applications 
      SET status = 'approved', can_pay = TRUE, last_updated = CURRENT_TIMESTAMP
      WHERE id = $1
      RETURNING *
    `;

    const result = await db.query(query, [applicationId]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Application not found'
      });
    }

    res.json({
      success: true,
      message: 'Application approved successfully',
      application: result.rows[0]
    });

  } catch (error) {
    console.error('Error approving application:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to approve application',
      error: error.message
    });
  }
});

// Reject application
router.patch('/applications/:applicationId/reject', async (req, res) => {
  try {
    const { applicationId } = req.params;
    const { reason } = req.body;

    const query = `
      UPDATE applications 
      SET status = 'rejected', admin_reason = $1, can_pay = FALSE, last_updated = CURRENT_TIMESTAMP
      WHERE id = $2
      RETURNING *
    `;

    const result = await db.query(query, [reason, applicationId]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Application not found'
      });
    }

    res.json({
      success: true,
      message: 'Application rejected successfully',
      application: result.rows[0]
    });

  } catch (error) {
    console.error('Error rejecting application:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to reject application',
      error: error.message
    });
  }
});

module.exports = router;