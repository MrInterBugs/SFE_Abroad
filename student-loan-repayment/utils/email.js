const https = require('https');
const logger = require('./logger');

const DEFAULT_RESEND_TIMEOUT_MS = 10000;

function appBaseUrl() {
  return (process.env.APP_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');
}

function emailFrom() {
  return process.env.EMAIL_FROM || 'Student Finance Overseas Calculator <onboarding@resend.dev>';
}

function resendTimeoutMs() {
  const configured = Number(process.env.RESEND_TIMEOUT_MS);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_RESEND_TIMEOUT_MS;
}

function postResend(payload) {
  const body = JSON.stringify(payload);
  const timeoutMs = resendTimeoutMs();

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
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`Resend request timed out after ${timeoutMs}ms`));
    });
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

function emailHtml({ heading, body, ctaLabel, ctaUrl, footer }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${heading}</title>
</head>
<body style="margin:0;padding:0;background-color:#f3f4f6;font-family:Arial,Helvetica,sans-serif;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
  <tr>
    <td style="padding:32px 16px;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:560px;margin:0 auto;background-color:#ffffff;border-radius:8px;overflow:hidden;border:1px solid #e5e7eb;">
        <tr>
          <td style="background-color:#1d70b8;padding:20px 32px;">
            <span style="color:#ffffff;font-size:16px;font-weight:bold;text-decoration:none;">Student Finance Overseas Repayment Calculator</span>
          </td>
        </tr>
        <tr>
          <td style="padding:32px;">
            <h1 style="margin:0 0 16px;font-size:20px;color:#111827;">${heading}</h1>
            ${body}
            <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:24px 0;">
              <tr>
                <td style="border-radius:6px;background-color:#1d70b8;">
                  <a href="${ctaUrl}" style="display:inline-block;padding:12px 24px;color:#ffffff;font-size:15px;font-weight:bold;text-decoration:none;border-radius:6px;">${ctaLabel}</a>
                </td>
              </tr>
            </table>
            <p style="margin:0 0 8px;font-size:13px;color:#6b7280;">If the button above doesn't work, copy and paste this link into your browser:</p>
            <p style="margin:0;font-size:13px;color:#1d70b8;word-break:break-all;"><a href="${ctaUrl}" style="color:#1d70b8;">${ctaUrl}</a></p>
          </td>
        </tr>
        <tr>
          <td style="padding:16px 32px;border-top:1px solid #e5e7eb;background-color:#f9fafb;">
            <p style="margin:0;font-size:12px;color:#9ca3af;">${footer}</p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

function sendEmailConfirmation(email, token) {
  const url = `${appBaseUrl()}/confirm-email/${encodeURIComponent(token)}`;
  return sendEmail({
    to: email,
    subject: 'Confirm your email address — Student Finance Overseas Calculator',
    text: [
      'Confirm your email address',
      '',
      'Thanks for registering with the Student Finance Overseas Repayment Calculator.',
      'Please confirm your email address by visiting the link below:',
      '',
      url,
      '',
      'This link expires in 24 hours.',
      '',
      'If you did not create an account, you can safely ignore this email.',
      '',
      '— Student Finance Overseas Repayment Calculator',
      appBaseUrl(),
    ].join('\n'),
    html: emailHtml({
      heading: 'Confirm your email address',
      body: `
        <p style="margin:0 0 12px;font-size:15px;color:#374151;">Thanks for registering with the Student Finance Overseas Repayment Calculator.</p>
        <p style="margin:0 0 12px;font-size:15px;color:#374151;">Please confirm your email address by clicking the button below. This link expires in 24 hours.</p>
      `,
      ctaLabel: 'Confirm email address',
      ctaUrl: url,
      footer: 'You received this because someone used this email address to register an account. If that wasn\'t you, you can safely ignore this email.',
    }),
  });
}

function sendPasswordReset(email, token) {
  const url = `${appBaseUrl()}/reset-password/${encodeURIComponent(token)}`;
  return sendEmail({
    to: email,
    subject: 'Reset your password — Student Finance Overseas Calculator',
    text: [
      'Reset your password',
      '',
      'We received a request to reset the password for your Student Finance Overseas Calculator account.',
      'Click the link below to choose a new password:',
      '',
      url,
      '',
      'This link expires in 1 hour.',
      '',
      'If you did not request a password reset, you can safely ignore this email. Your password will not change.',
      '',
      '— Student Finance Overseas Repayment Calculator',
      appBaseUrl(),
    ].join('\n'),
    html: emailHtml({
      heading: 'Reset your password',
      body: `
        <p style="margin:0 0 12px;font-size:15px;color:#374151;">We received a request to reset the password for your Student Finance Overseas Calculator account.</p>
        <p style="margin:0 0 12px;font-size:15px;color:#374151;">Click the button below to choose a new password. This link expires in 1 hour.</p>
        <p style="margin:0 0 12px;font-size:15px;color:#374151;">If you did not request a password reset, you can safely ignore this email — your password will not change.</p>
      `,
      ctaLabel: 'Reset password',
      ctaUrl: url,
      footer: 'You received this because a password reset was requested for the account associated with this email address.',
    }),
  });
}

module.exports = { sendEmail, sendEmailConfirmation, sendPasswordReset, appBaseUrl, emailFrom, resendTimeoutMs };
