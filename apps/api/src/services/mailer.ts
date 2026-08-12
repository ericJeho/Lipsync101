import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';

/**
 * Mail delivery. Without SMTP_URL configured we log the message instead of
 * sending it, so signup and password reset are exercisable locally without a
 * mail account — the token appears in the API log.
 */

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

async function deliver(message: MailMessage): Promise<void> {
  if (!env.SMTP_URL) {
    logger.info(
      { to: message.to, subject: message.subject, body: message.text },
      'Mail not configured — logging message instead of sending',
    );
    return;
  }

  // nodemailer is loaded lazily so the dependency is only required by
  // deployments that actually send mail.
  const { createTransport } = await import('nodemailer').catch(() => {
    logger.error('SMTP_URL is set but nodemailer is not installed');
    return { createTransport: null } as never;
  });

  if (!createTransport) return;

  const transport = createTransport(env.SMTP_URL);
  await transport.sendMail({ from: env.MAIL_FROM, ...message });
}

function layout(title: string, body: string, cta?: { label: string; url: string }): string {
  return `<!doctype html>
<html><body style="margin:0;background:#0a0a0f;font-family:ui-sans-serif,system-ui,sans-serif;color:#e5e7eb">
  <div style="max-width:560px;margin:0 auto;padding:40px 24px">
    <p style="font-size:20px;font-weight:600;color:#fff;margin:0 0 24px">LipSync Studio</p>
    <div style="background:#14141c;border:1px solid #26262f;border-radius:16px;padding:32px">
      <h1 style="font-size:22px;margin:0 0 16px;color:#fff">${title}</h1>
      <div style="font-size:15px;line-height:1.6;color:#a1a1aa">${body}</div>
      ${
        cta
          ? `<p style="margin:28px 0 0"><a href="${cta.url}" style="display:inline-block;background:linear-gradient(135deg,#6366f1,#a855f7);color:#fff;text-decoration:none;padding:12px 24px;border-radius:10px;font-weight:600">${cta.label}</a></p>`
          : ''
      }
    </div>
    <p style="font-size:12px;color:#52525b;margin:24px 0 0">
      You are receiving this because you have a LipSync Studio account.
    </p>
  </div>
</body></html>`;
}

export const mailer = {
  async sendVerification(to: string, token: string): Promise<void> {
    const url = `${env.WEB_URL}/auth/verify?token=${encodeURIComponent(token)}`;
    await deliver({
      to,
      subject: 'Confirm your email',
      text: `Confirm your LipSync Studio email address: ${url}`,
      html: layout(
        'Confirm your email',
        '<p>One click and your account is ready. This link is good for an hour.</p>',
        { label: 'Confirm email', url },
      ),
    });
  },

  async sendPasswordReset(to: string, token: string): Promise<void> {
    const url = `${env.WEB_URL}/auth/reset?token=${encodeURIComponent(token)}`;
    await deliver({
      to,
      subject: 'Reset your password',
      text: `Reset your LipSync Studio password: ${url}`,
      html: layout(
        'Reset your password',
        '<p>Use the button below to choose a new password. The link expires in an hour, ' +
          'and nothing changes if you ignore this email.</p>',
        { label: 'Choose a new password', url },
      ),
    });
  },

  async sendRenderComplete(
    to: string,
    job: { id: string; projectName: string; durationSeconds: number },
  ): Promise<void> {
    const url = `${env.WEB_URL}/dashboard/renders/${job.id}`;
    await deliver({
      to,
      subject: `Your render is ready — ${job.projectName}`,
      text: `Your lip-synced render for "${job.projectName}" is ready: ${url}`,
      html: layout(
        'Your render is ready',
        `<p><strong style="color:#fff">${job.projectName}</strong> finished rendering. ` +
          `It is available in your dashboard for download.</p>`,
        { label: 'Open render', url },
      ),
    });
  },

  async sendRenderFailed(
    to: string,
    job: { id: string; projectName: string; reason: string },
  ): Promise<void> {
    const url = `${env.WEB_URL}/dashboard/renders/${job.id}`;
    await deliver({
      to,
      subject: `Render failed — ${job.projectName}`,
      text: `Your render for "${job.projectName}" failed: ${job.reason}. Credits were refunded.`,
      html: layout(
        'That render did not finish',
        `<p>We could not complete <strong style="color:#fff">${job.projectName}</strong>.</p>
         <p style="color:#f87171">${job.reason}</p>
         <p>Your credits have been refunded in full.</p>`,
        { label: 'View details', url },
      ),
    });
  },
};
