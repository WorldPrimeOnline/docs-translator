import { Resend } from 'resend';
import { env } from './env';

// Lazy — only instantiated when actually sending, so missing key doesn't crash startup
let _resend: Resend | null = null;
function getResend(): Resend {
  if (!_resend) {
    const key = env.RESEND_API_KEY;
    if (!key) throw new Error('RESEND_API_KEY is not set');
    _resend = new Resend(key);
  }
  return _resend;
}

// Returns { to, subject } after applying staging email safety rules:
// - EMAILS_ENABLED=false  → returns null (caller must skip send)
// - EMAIL_REDIRECT_ALL_TO → rewrites recipient, prefixes subject with [STAGING]
function applyEmailSafetyPolicy(
  intendedTo: string,
  subject: string,
): { to: string; subject: string } | null {
  if (!env.EMAILS_ENABLED) {
    console.log(`[email] suppressed (EMAILS_ENABLED=false) — intended recipient: ${intendedTo}`);
    return null;
  }

  if (env.EMAIL_REDIRECT_ALL_TO) {
    console.log(`[email] redirecting (EMAIL_REDIRECT_ALL_TO) — intended: ${intendedTo} → actual: ${env.EMAIL_REDIRECT_ALL_TO}`);
    return {
      to: env.EMAIL_REDIRECT_ALL_TO,
      subject: `[STAGING] ${subject}`,
    };
  }

  return { to: intendedTo, subject };
}

function generateEmailHtml({
  filename,
  downloadUrl,
  targetLanguage,
}: {
  filename: string;
  downloadUrl: string;
  targetLanguage: string;
}): string {
  const safeFilename = filename.replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const safeLang = targetLanguage.replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const safeUrl = downloadUrl.replace(/"/g, '&quot;');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Your translation is ready</title>
</head>
<body style="margin:0;padding:0;background-color:#0a1628;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;background-color:#0a1628;padding:40px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;max-width:560px;">
          <tr>
            <td style="padding:0 0 24px;">
              <span style="font-size:22px;font-weight:700;color:#e8b84b;letter-spacing:-0.5px;">WPO</span>
              <span style="font-size:22px;font-weight:300;color:#ffffff;letter-spacing:-0.5px;"> Translations</span>
            </td>
          </tr>
          <tr>
            <td style="background-color:#0f1f3d;border-radius:12px;border:1px solid rgba(255,255,255,0.1);overflow:hidden;">
              <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;">
                <tr>
                  <td style="padding:36px 40px 32px;">
                    <h1 style="margin:0 0 10px;font-size:26px;font-weight:700;color:#ffffff;letter-spacing:-0.5px;line-height:1.2;">
                      Your translation is ready
                    </h1>
                    <p style="margin:0 0 28px;font-size:15px;color:rgba(255,255,255,0.55);line-height:1.6;">
                      Your document has been translated to
                      <strong style="color:#ffffff;">${safeLang}</strong>
                      and is ready to download.
                    </p>
                    <table role="presentation" cellpadding="0" cellspacing="0"
                      style="width:100%;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:8px;margin-bottom:32px;">
                      <tr>
                        <td style="padding:16px 20px;">
                          <p style="margin:0 0 4px;font-size:11px;color:rgba(255,255,255,0.4);text-transform:uppercase;letter-spacing:0.1em;">Document</p>
                          <p style="margin:0;font-size:15px;color:#ffffff;font-weight:500;">${safeFilename}</p>
                        </td>
                      </tr>
                    </table>
                    <a href="${safeUrl}"
                      style="display:inline-block;background-color:#e8b84b;color:#0a1628;font-size:15px;font-weight:700;padding:14px 36px;border-radius:8px;text-decoration:none;letter-spacing:-0.2px;">
                      Download Translation
                    </a>
                    <p style="margin:24px 0 0;font-size:12px;color:rgba(255,255,255,0.3);line-height:1.6;">
                      This link expires in 7 days. If the button does not work, copy this URL:<br/>
                      <a href="${safeUrl}" style="color:#e8b84b;word-break:break-all;">${safeUrl}</a>
                    </p>
                  </td>
                </tr>
                <tr>
                  <td style="padding:18px 40px;border-top:1px solid rgba(255,255,255,0.08);background:rgba(0,0,0,0.25);">
                    <p style="margin:0;font-size:11px;color:rgba(255,255,255,0.3);line-height:1.7;text-transform:uppercase;letter-spacing:0.06em;">
                      UNOFFICIAL TRANSLATION &mdash; FOR INFORMATIONAL PURPOSES ONLY.<br/>
                      This document is not a certified or notarized translation.
                    </p>
                  </td>
                </tr>
                <tr>
                  <td style="padding:16px 40px;border-top:1px solid rgba(255,255,255,0.06);">
                    <p style="margin:0;font-size:12px;color:rgba(255,255,255,0.25);">
                      <a href="https://wpotranslations.org" style="color:#e8b84b;text-decoration:none;">wpotranslations.org</a>
                      &nbsp;&middot;&nbsp; Your files are permanently deleted after 30 days.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function generateReviewEmailHtml({ filename }: { filename: string }): string {
  const safeFilename = filename.replace(/</g, '&lt;').replace(/>/g, '&gt;');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Your document has been received</title>
</head>
<body style="margin:0;padding:0;background-color:#0a1628;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;background-color:#0a1628;padding:40px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;max-width:560px;">
          <tr>
            <td style="padding:0 0 24px;">
              <span style="font-size:22px;font-weight:700;color:#e8b84b;letter-spacing:-0.5px;">WPO</span>
              <span style="font-size:22px;font-weight:300;color:#ffffff;letter-spacing:-0.5px;"> Translations</span>
            </td>
          </tr>
          <tr>
            <td style="background-color:#0f1f3d;border-radius:12px;border:1px solid rgba(255,255,255,0.1);overflow:hidden;">
              <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;">
                <tr>
                  <td style="padding:36px 40px 32px;">
                    <h1 style="margin:0 0 10px;font-size:26px;font-weight:700;color:#ffffff;letter-spacing:-0.5px;line-height:1.2;">
                      Document received for review
                    </h1>
                    <p style="margin:0 0 28px;font-size:15px;color:rgba(255,255,255,0.55);line-height:1.6;">
                      Your document has been received and is being prepared for official translation review.
                      The final official translation will be available after human verification.
                    </p>
                    <table role="presentation" cellpadding="0" cellspacing="0"
                      style="width:100%;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:8px;margin-bottom:32px;">
                      <tr>
                        <td style="padding:16px 20px;">
                          <p style="margin:0 0 4px;font-size:11px;color:rgba(255,255,255,0.4);text-transform:uppercase;letter-spacing:0.1em;">Document</p>
                          <p style="margin:0;font-size:15px;color:#ffffff;font-weight:500;">${safeFilename}</p>
                        </td>
                      </tr>
                    </table>
                    <p style="margin:0;font-size:14px;color:rgba(255,255,255,0.6);line-height:1.6;">
                      We will notify you by email when your official translation is ready.
                    </p>
                  </td>
                </tr>
                <tr>
                  <td style="padding:16px 40px;border-top:1px solid rgba(255,255,255,0.06);">
                    <p style="margin:0;font-size:12px;color:rgba(255,255,255,0.25);">
                      <a href="https://wpotranslations.org" style="color:#e8b84b;text-decoration:none;">wpotranslations.org</a>
                      &nbsp;&middot;&nbsp; Your files are permanently deleted after 30 days.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
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

  await getResend().emails.send({
    from: 'WPO Translations <noreply@wpotranslations.org>',
    to: safe.to,
    subject: safe.subject,
    html: generateEmailHtml({ filename, downloadUrl, targetLanguage }),
  });
}

export async function sendDocumentReceivedForReview({
  to,
  filename,
}: {
  to: string;
  filename: string;
}): Promise<void> {
  const safe = applyEmailSafetyPolicy(to, `Document received for translator review — ${filename}`);
  if (!safe) return;

  await getResend().emails.send({
    from: 'WPO Translations <noreply@wpotranslations.org>',
    to: safe.to,
    subject: safe.subject,
    html: generateReviewEmailHtml({ filename }),
  });
}
