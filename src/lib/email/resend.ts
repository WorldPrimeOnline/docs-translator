import { Resend } from 'resend';
import { generateEmailHtml } from './templates';

const resend = new Resend(process.env.RESEND_API_KEY);

function applyEmailSafetyPolicy(
  intendedTo: string,
  subject: string,
): { to: string; subject: string } | null {
  const enabled = process.env.EMAILS_ENABLED;
  if (enabled === 'false') {
    console.log(`[email] suppressed (EMAILS_ENABLED=false) — intended recipient: ${intendedTo}`);
    return null;
  }

  const redirect = process.env.EMAIL_REDIRECT_ALL_TO;
  if (redirect) {
    console.log(`[email] redirecting — intended: ${intendedTo} → actual: ${redirect}`);
    return { to: redirect, subject: `[STAGING] ${subject}` };
  }

  return { to: intendedTo, subject };
}

export async function sendTranslationReady({
  to,
  filename,
  downloadUrl,
  targetLanguage,
}: {
  to: string;
  filename: string;
  downloadUrl: string;
  targetLanguage: string;
}): Promise<void> {
  const safe = applyEmailSafetyPolicy(to, `Your translation is ready — ${filename}`);
  if (!safe) return;

  await resend.emails.send({
    from: 'WPO Translations <noreply@wpotranslations.org>',
    to: safe.to,
    subject: safe.subject,
    html: generateEmailHtml({ filename, downloadUrl, targetLanguage }),
  });
}
