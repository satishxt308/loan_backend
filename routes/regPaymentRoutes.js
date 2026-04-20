const express = require("express");
const router = express.Router();
const multer = require("multer");
const sharp = require("sharp");
const Tesseract = require("tesseract.js");
const pool = require("../db/db");

/* =========================
   MULTER CONFIG (MEMORY)
========================= */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

/* =========================
   OCR HELPER
========================= */
const extractTextFromImage = async (imageBuffer) => {
  console.log("🔍 OCR STARTED");

  const processedImage = await sharp(imageBuffer)
    .resize(2000)
    .grayscale()
    .normalize()
    .toBuffer();

  const {
    data: { text },
  } = await Tesseract.recognize(processedImage, "eng", {
    logger: (m) => console.log("🧠 OCR:", m.status),
  });

  console.log("📝 RAW OCR TEXT");
  console.log("================================");
  console.log(text);
  console.log("================================");

  return text;
};

/* =========================
   EXTRACT UTR FROM TEXT
   Enhanced for PhonePe/GPay/UPI
========================= */
const extractUTR = (text) => {
  console.log("🔍 ANALYZING TEXT FOR UTR");
  
  // Normalize text: remove extra spaces, newlines, make uppercase
  const normalizedText = text.toUpperCase().replace(/\s+/g, ' ');
  
  // Common UTR patterns in order of priority
  const patterns = [
    // Pattern 1: UTR: XXXXXXXX
    /UTR[:\-\s]+([A-Z0-9]{8,30})/i,
    
    // Pattern 2: Ref No/Reference: XXXXXXXX
    /(?:REF(?:ERENCE)?|REF\s*NO?)[:\-\s]+([A-Z0-9]{8,30})/i,
    
    // Pattern 3: Transaction ID: XXXXXXXX
    /(?:TXN|TRANSACTION)[\s\-]*(?:ID)?[:\-\s]+([A-Z0-9]{8,30})/i,
    
    // Pattern 4: UPI Ref: XXXXXXXX
    /UPI[\s\-]*(?:REF(?:ERENCE)?)[:\-\s]+([A-Z0-9]{8,30})/i,
    
    // Pattern 5: PhonePe specific patterns
    /(?:PHONEPE|PH)[\s\-]*UTR[:\-\s]+([A-Z0-9]{8,30})/i,
    
    // Pattern 6: P2AXXXXXXXXX (PhonePe format)
    /(P2A[A-Z0-9]{12,25})/,
    
    // Pattern 7: PTMXXXXXXXXX (Paytm format)
    /(PTM[A-Z0-9]{12,25})/,
    
    // Pattern 8: PHNXXXXXXXXX (PhonePe format)
    /(PHN[A-Z0-9]{12,25})/,
    
    // Pattern 9: Any alphanumeric 12-30 chars in transaction context
    /SUCCESSFUL.*?([A-Z0-9]{12,30})/i,
    /COMPLETED.*?([A-Z0-9]{12,30})/i,
    /PAID.*?([A-Z0-9]{12,30})/i,
    
    // Pattern 10: Standard numeric UTR (10-22 digits)
    /\b(\d{10,22})\b/,
    
    // Pattern 11: Any long alphanumeric sequence (fallback)
    /\b([A-Z0-9]{12,30})\b/,
  ];

  for (const pattern of patterns) {
    const match = normalizedText.match(pattern);
    if (match) {
      const potentialUTR = match[1] || match[0];
      console.log(`✅ POTENTIAL UTR FOUND WITH PATTERN ${pattern}:`, potentialUTR);
      
      // Additional validation
      if (isValidUTR(potentialUTR)) {
        console.log(`✅ VALIDATED UTR: ${potentialUTR}`);
        return potentialUTR;
      }
    }
  }

  // If no pattern matches, try to find any long sequence
  const allSequences = normalizedText.match(/\b([A-Z0-9]{10,30})\b/g) || [];
  for (const seq of allSequences) {
    if (isValidUTR(seq)) {
      console.log(`✅ FOUND IN GENERAL SEARCH: ${seq}`);
      return seq;
    }
  }

  console.log("❌ NO UTR FOUND");
  return null;
};

/* =========================
   VALIDATE UTR FORMAT
========================= */
const isValidUTR = (utr) => {
  if (!utr) return false;
  
  const cleaned = String(utr).trim().toUpperCase();
  
  // Check length
  if (cleaned.length < 8 || cleaned.length > 30) {
    console.log(`❌ Invalid length: ${cleaned.length}`);
    return false;
  }
  
  // Should contain only alphanumeric characters
  if (!/^[A-Z0-9]+$/.test(cleaned)) {
    console.log(`❌ Contains special characters: ${cleaned}`);
    return false;
  }
  
  // Common valid prefixes (optional)
  const validPrefixes = ['P2A', 'PTM', 'PHN', 'UPI', 'TXN', 'UTR', 'REF'];
  const hasValidPrefix = validPrefixes.some(prefix => cleaned.startsWith(prefix));
  
  // At least 50% should be digits (for alphanumeric UTRs)
  const digitCount = (cleaned.match(/\d/g) || []).length;
  const digitRatio = digitCount / cleaned.length;
  
  if (!hasValidPrefix && digitRatio < 0.5 && cleaned.length < 12) {
    console.log(`❌ Low digit ratio: ${digitRatio}`);
    return false;
  }
  
  console.log(`✅ UTR VALID: ${cleaned}`);
  return true;
};

/* =========================
   EXTRACT PAYMENT METADATA
========================= */
const extractPaymentMetadata = (text) => {
  const metadata = {};
  
  // Extract amount (₹ or Rs)
  const amountPatterns = [
    /₹\s*(\d{1,5}(?:,\d{3})*(?:\.\d{2})?)/,
    /RS\.?\s*(\d{1,5}(?:,\d{3})*(?:\.\d{2})?)/i,
    /AMOUNT[:\-\s]+(?:₹|RS\.?)?\s*(\d{1,5}(?:,\d{3})*(?:\.\d{2})?)/i,
    /PAID[:\-\s]+(?:₹|RS\.?)?\s*(\d{1,5}(?:,\d{3})*(?:\.\d{2})?)/i
  ];
  
  for (const pattern of amountPatterns) {
    const match = text.match(pattern);
    if (match) {
      metadata.amount = match[1];
      break;
    }
  }
  
  // Extract date
  const datePatterns = [
    /\b(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})\b/,
    /DATE[:\-\s]+(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i,
    /ON[:\-\s]+(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i
  ];
  
  for (const pattern of datePatterns) {
    const match = text.match(pattern);
    if (match) {
      metadata.date = match[1];
      break;
    }
  }
  
  // Extract time
  const timeMatch = text.match(/\b(\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?)\b/i);
  if (timeMatch) metadata.time = timeMatch[1];
  
  return metadata;
};

/* OCR + STORE RAW TEXT */
router.post(
  "/test-reg-payment-ocr",
  upload.single("screenshot"),
  async (req, res) => {
    try {
      console.log("🧪 REG PAYMENT OCR REQUEST");

      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: "Screenshot required",
        });
      }

      const rawText = await extractTextFromImage(req.file.buffer);
      const extractedUtr = extractUTR(rawText);

      console.log("🔢 EXTRACTED UTR:", extractedUtr);

      res.json({
        success: true,
        raw_text: rawText,
        extracted_utr: extractedUtr,
      });
    } catch (err) {
      console.error("❌ OCR ERROR:", err.message);
      res.status(500).json({
        success: false,
        message: "OCR failed",
      });
    }
  }
);

/* VERIFY PAYMENT + UPDATE USER */
router.post(
  "/confirm-registration-payment",
  upload.single("payment_image"),
  async (req, res) => {
    const {
      user_id,
      manual_utr,
      extracted_utr,
      amount = 2500,
      raw_ocr_text,
      payment_method = "UPI",
    } = req.body;

    try {
      console.log("💳 PAYMENT VERIFY REQUEST");

      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: "Payment screenshot required",
        });
      }

      if (!user_id || !manual_utr || !extracted_utr) {
        return res.status(400).json({
          success: false,
          message: "Missing required fields",
        });
      }

      /* =========================
         UTR MATCH CHECK
      ========================= */
      if (manual_utr.trim() !== extracted_utr.trim()) {
        return res.status(400).json({
          success: false,
          message: "UTR mismatch",
        });
      }

      /* =========================
         INSERT PAYMENT RECORD
      ========================= */
      await pool.query(
        `
        INSERT INTO registration_payments
        (
          user_id,
          amount,
          method,
          status,
          utr_number,
          raw_ocr_text,
          payment_image
        )
        VALUES ($1, $2, $3, 'success', $4, $5, $6)
        `,
        [
          user_id,
          amount,
          payment_method,
          manual_utr.trim(),
          raw_ocr_text,
          req.file.buffer, // ✅ BYTEA STORED HERE
        ]
      );

      /* =========================
         UPDATE USER
      ========================= */
      await pool.query(
        `UPDATE users SET reg_pay = true WHERE id = $1`,
        [user_id]
      );

      console.log("✅ PAYMENT STORED WITH IMAGE");

      res.json({
        success: true,
        message: "Registration payment successful",
      });
    } catch (err) {
      console.error("❌ PAYMENT ERROR:", err.message);
      res.status(500).json({
        success: false,
        message: "Payment verification failed",
      });
    }
  }
);


/* CHECK REGISTRATION PAYMENT STATUS */
router.get("/reg-pay-status/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "User ID is required",
      });
    }

    const result = await pool.query(
      "SELECT reg_pay FROM users WHERE id = $1",
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    return res.json({
      success: true,
      reg_pay: result.rows[0].reg_pay === true,
    });
  } catch (error) {
    console.error("❌ Reg pay status error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch registration payment status",
    });
  }
});

module.exports = router;
