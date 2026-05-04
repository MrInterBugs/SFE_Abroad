const https = require('https');
const logger = require('./logger');

function appBaseUrl() {
  return (process.env.APP_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');
}

function emailFrom() {
  return process.env.EMAIL_FROM || 'Student Finance Overseas <onboarding@resend.dev>';
}

function postResend(payload) {
  const body = JSON.stringify(payload);

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.resend.com',
      path: '/emails',
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'User-Agent': 'student-loan-repayment/1.0',
      },
    }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) return resolve(data);
        reject(new Error(`Resend returned ${res.statusCode}: ${data}`));
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function sendEmail({ to, subject, html, text }) {
  if (!process.env.RESEND_API_KEY) {
    logger.warn(`Email not sent because RESEND_API_KEY is not configured: ${subject}`);
    return false;
  }

  await postResend({
    from: emailFrom(),
    to,
    subject,
    html,
    text,
  });
  return true;
}

function sendEmailConfirmation(email, token) {
  const url = `${appBaseUrl()}/confirm-email/${encodeURIComponent(token)}`;
  return sendEmail({
    to: email,
    subject: 'Confirm your Student Finance Overseas email',
    text: `Confirm your email address: ${url}`,
    html: `<p>Confirm your email address:</p><p><a href="${url}">${url}</a></p>`,
  });
}

function sendPasswordReset(email, token) {
  const url = `${appBaseUrl()}/reset-password/${encodeURIComponent(token)}`;
  return sendEmail({
    to: email,
    subject: 'Reset your Student Finance Overseas password',
    text: `Reset your password: ${url}\n\nThis link expires soon. If you did not request it, you can ignore this email.`,
    html: `<p>Reset your password:</p><p><a href="${url}">${url}</a></p><p>This link expires soon. If you did not request it, you can ignore this email.</p>`,
  });
}

module.exports = { sendEmail, sendEmailConfirmation, sendPasswordReset, appBaseUrl, emailFrom };
