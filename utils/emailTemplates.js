// backend/utils/emailTemplates.js

const getWelcomeEmailTemplate = (email, otp) => `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Verify Your Email</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      margin: 0;
      padding: 20px;
    }
    .container {
      max-width: 520px;
      margin: 0 auto;
      background: #ffffff;
      border-radius: 24px;
      overflow: hidden;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
    }
    .header {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      padding: 40px 32px;
      text-align: center;
    }
    .logo {
      font-size: 32px;
      font-weight: 800;
      color: white;
      margin-bottom: 12px;
    }
    .logo span {
      background: rgba(255,255,255,0.2);
      padding: 4px 12px;
      border-radius: 12px;
    }
    .header h1 {
      color: white;
      font-size: 28px;
      font-weight: 700;
      margin-top: 16px;
    }
    .content {
      padding: 40px 32px;
    }
    .greeting {
      font-size: 18px;
      font-weight: 600;
      color: #1a202c;
      margin-bottom: 16px;
    }
    .message {
      color: #4a5568;
      line-height: 1.6;
      margin-bottom: 32px;
    }
    .otp-container {
      background: linear-gradient(135deg, #f6f9fc 0%, #f1f5f9 100%);
      border-radius: 16px;
      padding: 28px;
      text-align: center;
      margin: 28px 0;
      border: 1px solid #e2e8f0;
    }
    .otp-label {
      font-size: 14px;
      font-weight: 600;
      color: #64748b;
      text-transform: uppercase;
      letter-spacing: 1px;
      margin-bottom: 12px;
    }
    .otp-code {
      font-size: 48px;
      font-weight: 800;
      font-family: 'Courier New', monospace;
      letter-spacing: 8px;
      color: #4f46e5;
      background: white;
      padding: 16px 24px;
      border-radius: 12px;
      display: inline-block;
    }
    .expiry {
      margin-top: 16px;
      font-size: 13px;
      color: #94a3b8;
    }
    .expiry span {
      font-weight: 600;
      color: #ef4444;
    }
    .footer {
      background: #f8fafc;
      padding: 24px 32px;
      text-align: center;
      border-top: 1px solid #e2e8f0;
    }
    .footer p {
      color: #94a3b8;
      font-size: 12px;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="logo">
        <span>🏫 PSWB</span>
      </div>
      <h1>Verify Your Email</h1>
    </div>
    
    <div class="content">
      <div class="greeting">
        Welcome to PSWB!
      </div>
      
      <div class="message">
        Thanks for registering! Please use the verification code below to complete your registration.
      </div>
      
      <div class="otp-container">
        <div class="otp-label">Verification Code</div>
        <div class="otp-code">${otp}</div>
        <div class="expiry">
          ⏰ This code will expire in <span>5 minutes</span>
        </div>
      </div>
      
      <div class="message" style="font-size: 13px; margin-top: 20px;">
        If you didn't request this, please ignore this email.
      </div>
    </div>
    
    <div class="footer">
      <p>This is an automated message, please do not reply to this email.</p>
      <p>© 2024 PSWB Platform. All rights reserved.</p>
    </div>
  </div>
</body>
</html>
`;

const getOtpTemplate = (otp, email) => `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Your OTP Code</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
      background: #f0f9ff;
      padding: 20px;
    }
    .container {
      max-width: 480px;
      margin: 0 auto;
      background: white;
      border-radius: 20px;
      overflow: hidden;
      box-shadow: 0 20px 25px -5px rgba(0,0,0,0.1);
    }
    .header {
      background: linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%);
      padding: 32px;
      text-align: center;
    }
    .header h1 {
      color: white;
      font-size: 24px;
    }
    .content {
      padding: 32px;
      text-align: center;
    }
    .otp-code {
      font-size: 42px;
      font-weight: bold;
      font-family: monospace;
      letter-spacing: 6px;
      background: #f3f4f6;
      padding: 16px;
      border-radius: 12px;
      margin: 20px 0;
      color: #3b82f6;
    }
    .warning {
      font-size: 12px;
      color: #6b7280;
      margin-top: 20px;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🔐 Your OTP Code</h1>
    </div>
    <div class="content">
      <p>Your verification code is:</p>
      <div class="otp-code">${otp}</div>
      <p>This code will expire in 5 minutes.</p>
      <div class="warning">If you didn't request this, please ignore this email.</div>
    </div>
  </div>
</body>
</html>
`;

const getPasswordResetTemplate = (otp, userName) => `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Password Reset</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
      background: #fef2f2;
      padding: 20px;
    }
    .container {
      max-width: 520px;
      margin: 0 auto;
      background: white;
      border-radius: 20px;
      overflow: hidden;
      box-shadow: 0 20px 25px -5px rgba(0,0,0,0.1);
    }
    .header {
      background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
      padding: 40px 32px;
      text-align: center;
    }
    .header h1 {
      color: white;
      font-size: 28px;
    }
    .content {
      padding: 40px 32px;
    }
    .otp-code {
      font-size: 48px;
      font-weight: bold;
      font-family: monospace;
      letter-spacing: 8px;
      background: #fef2f2;
      padding: 20px;
      border-radius: 12px;
      text-align: center;
      margin: 24px 0;
      color: #dc2626;
    }
    .warning {
      background: #fef2f2;
      border-left: 4px solid #ef4444;
      padding: 12px;
      font-size: 13px;
      margin-top: 20px;
      color: #991b1b;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🔑 Password Reset</h1>
    </div>
    <div class="content">
      <p>Hello ${userName || 'User'},</p>
      <p>We received a request to reset your password. Use the code below:</p>
      <div class="otp-code">${otp}</div>
      <p>This code expires in 5 minutes.</p>
      <div class="warning">⚠️ If you didn't request this, please ignore this email.</div>
    </div>
  </div>
</body>
</html>
`;

module.exports = {
  getWelcomeEmailTemplate,
  getOtpTemplate,
  getPasswordResetTemplate
};