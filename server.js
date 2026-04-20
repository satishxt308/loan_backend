require("dotenv").config();
const express = require("express");
const app = express();
const cors = require("cors");

// DB connection (important)
require("./db/db");

app.use(cors());
// app.use(express.json());
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

// Import routes
const userRoutes = require("./routes/userRoutes");
const applicationSubmit = require("./routes/applicationSubmit");

const empCardRoutes = require("./routes/emp_card");
const regPaymentRoutes = require('./routes/regPaymentRoutes');
const applicationAdmin = require("./routes/applicationAdmin");
const bannerRoutes = require("./routes/banner");
const paymentRoutes = require("./routes/paymentRoutes");
const notificationRoutes = require("./routes/notifications");
const schemeRoutes = require("./routes/schemes");
const policyRoutes = require("./routes/policyRoutes");
const videoTypeRoutes = require("./routes/videoTypeRoutes");
const videoRoutes = require("./routes/videoRoutes");
const studentDocumentsRoutes = require("./routes/studentDocumentsRoutes");
const employeeAdminRoutes = require("./routes/employeeAdminRoutes");
const applicationRoutes = require("./routes/applicationRoutes");

app.use("/api/auth", require("./routes/auth"));
app.use('/api/applications', require('./routes/applications'));
app.use('/api/student-card', require('./routes/studentCardRoutes'));
app.use("/api", require("./routes/studentCard"));
app.use("/api/wallet", require("./routes/walletRoutes"));

// Use routes
app.use("/api", applicationSubmit);
app.use("/api/users", userRoutes);
app.use("/api/emp-card", empCardRoutes);
app.use("/api/payment", paymentRoutes);
app.use("/api/admin", applicationAdmin);
app.use("/api/banners", bannerRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/schemes", schemeRoutes);
app.use("/api/policies", policyRoutes);
app.use("/api/video/video-types", videoTypeRoutes);
app.use("/api/video/videos", videoRoutes);
app.use("/api/reg-payment", regPaymentRoutes); 
app.use("/api/admin", studentDocumentsRoutes);
app.use("/api/admin", employeeAdminRoutes);
app.use("/api", applicationRoutes);


const PORT = process.env.PORT || 5000;

app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
