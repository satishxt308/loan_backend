const express = require("express");
const router = express.Router();
const pool = require("../db/db");
const upload = require("../middleware/upload");

const path = require("path");
const fs = require("fs");

// ✅ Serve video file by ID (for browser test)
router.get("/file/:id", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT video_url FROM videos WHERE id=$1",
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).send("Video not found");
    }

    const videoUrl = result.rows[0].video_url;

    // ❌ If base64 → return error (important debug)
    if (videoUrl.startsWith("data:")) {
      return res.status(400).send("Video stored as base64 - NOT SUPPORTED");
    }

    // ✅ File path
    const filePath = path.join(__dirname, "..", videoUrl);

    if (!fs.existsSync(filePath)) {
      return res.status(404).send("File not found");
    }

    const stat = fs.statSync(filePath);
    const fileSize = stat.size;
    const range = req.headers.range;

    // ✅ STREAM VIDEO (important for mobile)
    if (range) {
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

      const chunkSize = end - start + 1;
      const file = fs.createReadStream(filePath, { start, end });

      res.writeHead(206, {
        "Content-Range": `bytes ${start}-${end}/${fileSize}`,
        "Accept-Ranges": "bytes",
        "Content-Length": chunkSize,
        "Content-Type": "video/mp4",
      });

      file.pipe(res);
    } else {
      res.writeHead(200, {
        "Content-Length": fileSize,
        "Content-Type": "video/mp4",
      });

      fs.createReadStream(filePath).pipe(res);
    }
  } catch (err) {
    console.error(err);
    res.status(500).send("Server error");
  }
});

// GET all videos
router.get("/", async (req, res) => {
  const result = await pool.query("SELECT * FROM videos ORDER BY id DESC");
  res.json(result.rows);
});

// CREATE video
router.post("/", upload.fields([
  { name: "video_file" },
  { name: "thumbnail_file" }
]), async (req, res) => {

  const {
    type_id,
    name,
    description,
    video_url,
    thumbnail_url,
    video_source
  } = req.body;

  let finalVideoUrl = video_url;
  let finalThumbnailUrl = thumbnail_url;

 // create folder if not exists
const videoDir = path.join(__dirname, "../uploads/videos");
if (!fs.existsSync(videoDir)) {
  fs.mkdirSync(videoDir, { recursive: true });
}

if (req.files?.video_file) {
  const file = req.files.video_file[0];
  const fileName = Date.now() + "-" + file.originalname;
  const filePath = path.join(videoDir, fileName);

  fs.writeFileSync(filePath, file.buffer);

  // SAVE PATH (NOT BASE64)
  finalVideoUrl = `/uploads/videos/${fileName}`;
}

  if (req.files?.thumbnail_file) {
    finalThumbnailUrl = `data:image/png;base64,${req.files.thumbnail_file[0].buffer.toString("base64")}`;
  }

  const result = await pool.query(
    `INSERT INTO videos 
    (type_id, name, description, video_url, thumbnail_url, video_source)
    VALUES ($1,$2,$3,$4,$5,$6)
    RETURNING *`,
    [type_id, name, description, finalVideoUrl, finalThumbnailUrl, video_source]
  );

  res.json(result.rows[0]);
});

// UPDATE
router.put("/:id", upload.fields([
  { name: "video_file" },
  { name: "thumbnail_file" }
]), async (req, res) => {

  const {
    type_id,
    name,
    description,
    video_url,
    thumbnail_url,
    video_source
  } = req.body;

  await pool.query(
    `UPDATE videos 
     SET type_id=$1, name=$2, description=$3, video_url=$4, thumbnail_url=$5, video_source=$6
     WHERE id=$7`,
    [type_id, name, description, video_url, thumbnail_url, video_source, req.params.id]
  );

  res.json({ success: true });
});

// DELETE
router.delete("/:id", async (req, res) => {
  await pool.query("DELETE FROM videos WHERE id=$1", [req.params.id]);
  res.json({ success: true });
});

module.exports = router;