import { Resend } from 'resend';
import { generateEmailHtml } from './templates';

const resend = new Resend(process.env.RESEND_API_KEY);

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
  await resend.emails.send({
    from: 'WPO Translations <noreply@wpotranslations.org>',
    to,
    subject: `Your translation is ready — ${filename}`,
    html: generateEmailHtml({ filename, downloadUrl, targetLanguage }),
  });
}
