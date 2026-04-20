const express = require("express");
const multer = require("multer");
const pool = require("../db/db");

const router = express.Router();

  //  Multer (Memory Storage)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
}); 

  //  Upload Banner
router.post("/upload", upload.single("image"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "Image is required" });
    }

    await pool.query(
      `INSERT INTO banners (image) VALUES ($1)`,
      [req.file.buffer]
    );

    res.json({
      success: true,
      message: "Banner uploaded successfully",
    });
  } catch (error) {
    console.error("Upload error:", error);
    res.status(500).json({ message: "Upload failed" });
  }
});

  //  Get All Banners
router.get("/", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT 
         id, 
         encode(image, 'base64') AS image, 
         created_at
       FROM banners
       ORDER BY id DESC`
    );

    res.json(rows);
  } catch (error) {
    console.error("Fetch error:", error);
    res.status(500).json({ message: "Fetch failed" });
  }
});

  //  Delete Banner
router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    await pool.query(
      `DELETE FROM banners WHERE id = $1`,
      [id]
    );

    res.json({ success: true, message: "Banner deleted" });
  } catch (error) {
    console.error("Delete error:", error);
    res.status(500).json({ message: "Delete failed" });
  }
});

module.exports = router;
