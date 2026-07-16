require("dotenv").config();
const express = require("express");
const app = express();
const cors = require("cors");

// DB connection (important)
require("./db/db");

app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({
    extended: true,
    limit: "50mb"
}));

// Import routes
const userRoutes = require("./routes/userRoutes");
const applicationSubmit = require("./routes/applicationSubmit");
const notifyRoutes = require("./routes/notify");
const empCardRoutes = require("./routes/emp_card");
const regPaymentRoutes = require('./routes/regPaymentRoutes');
const applicationAdmin = require("./routes/applicationAdmin");
const bannerRoutes = require("./routes/banner");
const paymentRoutes = require("./routes/paymentRoutes");
const notificationRoutes = require("./routes/notifications");
const policyRoutes = require("./routes/policyRoutes");
const videoTypeRoutes = require("./routes/videoTypeRoutes");
const videoRoutes = require("./routes/videoRoutes");
const studentDocumentsRoutes = require("./routes/studentDocumentsRoutes");
const employeeAdminRoutes = require("./routes/employeeAdminRoutes");
const applicationRoutes = require("./routes/applicationRoutes");
const schemeRoutes = require("./routes/schemes");
const employeeDocumentRoutes = require('./routes/employeeDocuments');
const citizenRoutes = require("./routes/citizenRoutes");
const citizenPaymentRoutes = require("./routes/citizenPaymentRoutes");
const citizenDocumentRoutes = require("./routes/citizenDocumentRoutes"); // NEW

app.use("/api/auth", require("./routes/auth"));
app.use('/api/applications', require('./routes/applications'));
app.use('/api/student-card', require('./routes/studentCardRoutes'));
app.use("/api", require("./routes/studentCard"));
app.use("/api/wallet", require("./routes/walletRoutes"));
app.use("/api/guardians", require("./routes/guardians"));

// Use routes
app.use("/api", applicationSubmit);
app.use("/api/users", userRoutes);
app.use("/api/emp-card", empCardRoutes);
app.use("/api/payment", paymentRoutes);
app.use("/api/admin", applicationAdmin);
app.use("/api/banners", bannerRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/policies", policyRoutes);
app.use("/api/video/video-types", videoTypeRoutes);
app.use("/api/video/videos", videoRoutes);
app.use("/api/reg-payment", regPaymentRoutes);
app.use("/api/admin", studentDocumentsRoutes);
app.use("/api/admin", employeeAdminRoutes);
app.use('/api/employee', employeeDocumentRoutes);
app.use("/api/schemes", schemeRoutes);
app.use("/api/notification", notifyRoutes);
app.use("/api", applicationRoutes);

// Citizen Routes
app.use("/api/citizens", citizenRoutes);
app.use("/api/citizen-payment", citizenPaymentRoutes);
app.use("/api/citizen-documents", citizenDocumentRoutes); // NEW

const PORT = process.env.PORT || 5000;

app.listen(PORT, "0.0.0.0", () => {
    console.log(`🚀 Server running on port ${PORT}`);
});