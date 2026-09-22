// Outgoing email (faculty OTP codes). Credentials come ONLY from environment variables —
// never from code or the repo. For the KL Microsoft 365 mailbox set, in Coolify:
//   SMTP_USER=engg.skilldevelopment@kluniversity.in   SMTP_PASS=<mailbox or app password>
// Optional: SMTP_HOST (default smtp.office365.com), SMTP_PORT (587), SMTP_FROM.
import nodemailer from 'nodemailer';

let transport = null;
export const smtpConfigured = () => !!(process.env.SMTP_USER && process.env.SMTP_PASS);
export const smtpUser = () => process.env.SMTP_USER || '';

function getTransport() {
  if (transport) return transport;
  const port = Number(process.env.SMTP_PORT || 587);
  transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.office365.com',
    port,
    secure: port === 465, // 587 = STARTTLS
    requireTLS: port !== 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    connectionTimeout: 15_000, greetingTimeout: 15_000, socketTimeout: 20_000,
  });
  return transport;
}

export async function sendMail({ to, subject, text, html }) {
  if (!smtpConfigured()) throw new Error('Email is not configured on the server (SMTP_USER / SMTP_PASS).');
  const from = process.env.SMTP_FROM || `KL Skill Development <${process.env.SMTP_USER}>`;
  try {
    return await getTransport().sendMail({ from, to, subject, text, html });
  } catch (e) {
    transport = null; // rebuild on next attempt (e.g. after a credentials fix)
    // Microsoft 365 returns 535 when SMTP AUTH is disabled for the mailbox or the password is wrong.
    if (/535|5\.7\.139|5\.7\.3|SmtpClientAuthentication/i.test(e.message)) {
      throw new Error('Microsoft 365 rejected the login. Ask KL IT to enable "Authenticated SMTP" for this mailbox, or use an app password. (' + e.message.slice(0, 160) + ')');
    }
    throw e;
  }
}
