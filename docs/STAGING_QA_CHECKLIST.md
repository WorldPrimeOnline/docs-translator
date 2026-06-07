# Staging QA Checklist

Run through every case below before promoting `staging` to `main`.
Each test must be run on the Vercel Preview deployment connected to staging Supabase + staging R2.

Mark as ✅ (pass) / ❌ (fail) / ⏭ (skipped with reason).

---

## 0. Pre-flight

| # | Check | Status |
|---|---|---|
| 0.1 | Staging banner visible at top of every page | |
| 0.2 | Banner NOT visible on production (main branch) URL | |
| 0.3 | Worker logs show `APP_ENV=staging` and `R2_BUCKET_NAME=wpo-staging-documents` | |
| 0.4 | Worker logs show `EMAILS_ENABLED=false` (or redirect configured) | |
| 0.5 | Worker logs show `PAYMENTS_MODE=test` | |
| 0.6 | No errors in worker startup logs | |

---

## 1. Normal PDF translation (subscription path)

| # | Check | Status |
|---|---|---|
| 1.1 | Upload a clean PDF (passport or diploma scan) | |
| 1.2 | Source language auto-detected or manually set | |
| 1.3 | Target language selected | |
| 1.4 | Document type selected (e.g. `passport_id`) | |
| 1.5 | "Official/Notary" checkbox NOT checked | |
| 1.6 | Job created with `status=queued` in Supabase | |
| 1.7 | Worker claims job within 10s (status → `ocr_in_progress`) | |
| 1.8 | OCR completes (status → `ocr_completed`) | |
| 1.9 | Translation completes (status → `translation_in_progress`) | |
| 1.10 | PDF rendered and uploaded (status → `completed`) | |
| 1.11 | `jobs.workflow_status = 'completed'` in DB | |
| 1.12 | `translations.translated_pdf_key` is set (not null) | |
| 1.13 | File exists in `wpo-staging-documents` R2 bucket | |
| 1.14 | Download from dashboard returns the file (HTTP 200) | |
| 1.15 | Downloaded PDF is readable and in correct language | |
| 1.16 | Footer disclaimer "UNOFFICIAL TRANSLATION" present in PDF | |
| 1.17 | No email sent to customer (or email redirected to internal) | |

---

## 2. Normal DOCX translation

| # | Check | Status |
|---|---|---|
| 2.1 | Upload a PDF, select output format DOCX | |
| 2.2 | Job completes with `status=completed` | |
| 2.3 | `translations.translated_pdf_key` ends with `.docx` | |
| 2.4 | Downloaded file opens in Word/LibreOffice | |
| 2.5 | No technical terms (Claude, Mistral, JSON, Markdown) visible in document | |

---

## 3. Official/notary mode — PDF selected

| # | Check | Status |
|---|---|---|
| 3.1 | Upload a PDF, check "Official/Notary translation" option | |
| 3.2 | `jobs.notarized = true` in DB after upload | |
| 3.3 | Worker detects `computeOutputPlan(notarized=true)` → `translator_review_draft` | |
| 3.4 | Worker generates DOCX draft (not final PDF) | |
| 3.5 | Worker generates preview PDF (watermarked or draft quality) | |
| 3.6 | `jobs.workflow_status = 'awaiting_translator_review'` | |
| 3.7 | `translations.translated_docx_key` is set | |
| 3.8 | `translations.translated_preview_pdf_key` is set | |
| 3.9 | `translations.qa_report` is a valid JSON object (not null) | |
| 3.10 | `qa_report.ok` is true (or false with specific errors logged) | |
| 3.11 | Download from dashboard returns HTTP 403 "awaiting translator review" | |
| 3.12 | Customer cannot download the DOCX draft | |
| 3.13 | No final PDF (`translated_pdf_key` should be null or absent) | |
| 3.14 | Review email sent to internal address (not customer) if EMAILS_ENABLED=true | |

---

## 4. Official/notary mode — DOCX output selected

| # | Check | Status |
|---|---|---|
| 4.1 | Upload with notarized=true AND output format DOCX | |
| 4.2 | DOCX draft generated and stored in `translated_docx_key` | |
| 4.3 | `workflow_status = 'awaiting_translator_review'` | |
| 4.4 | Customer cannot download — HTTP 403 | |

---

## 5. Bad scan / quality gate

| # | Check | Status |
|---|---|---|
| 5.1 | Upload a nearly-blank page or very low quality scan | |
| 5.2 | Worker OCR extracts fewer than minimum words | |
| 5.3 | Job fails with `status=failed` and meaningful error in `error_message` | |
| 5.4 | No credit wasted on translation API call | |
| 5.5 | No R2 artifact uploaded for failed job | |

---

## 6. Large file

| # | Check | Status |
|---|---|---|
| 6.1 | Upload a PDF close to 25 MB | |
| 6.2 | Upload accepted (no size rejection) | |
| 6.3 | Processing completes successfully | |
| 6.4 | Upload of a file > 25 MB returns HTTP 400 | |

---

## 7. Multi-file upload

| # | Check | Status |
|---|---|---|
| 7.1 | Upload 2–3 files (PDF + PNG or multiple PDFs) | |
| 7.2 | Files merged into single PDF before processing | |
| 7.3 | Total size check: files exceeding 50 MB total return HTTP 400 | |

---

## 8. Authorization — document access control

| # | Check | Status |
|---|---|---|
| 8.1 | Log in as User A, upload a document, note the `documentId` | |
| 8.2 | Log in as User B (different test account) | |
| 8.3 | Try: `GET /api/documents/<userA-documentId>/download` as User B | |
| 8.4 | Response must be HTTP 403 (Forbidden) | |
| 8.5 | Try the same endpoint while unauthenticated (no session) | |
| 8.6 | Response must be HTTP 401 (Unauthorized) | |
| 8.7 | QA report (`translations.qa_report`) NOT included in download response | |

---

## 9. Email behavior

| # | Check | Status |
|---|---|---|
| 9.1 | If `EMAILS_ENABLED=false`: no email delivered to any address | |
| 9.2 | If `EMAILS_ENABLED=false`: worker logs "suppressed" with intended recipient | |
| 9.3 | If `EMAIL_REDIRECT_ALL_TO` set: email arrives at redirect address | |
| 9.4 | If redirected: subject contains `[STAGING]` prefix | |
| 9.5 | Redirected email body contains correct document filename | |
| 9.6 | Original customer email address NOT present in the redirected email body | |

---

## 10. R2 artifact isolation

| # | Check | Status |
|---|---|---|
| 10.1 | All staging documents are in `wpo-staging-documents` bucket only | |
| 10.2 | Production bucket (`wpo-documents` or equivalent) has no new staging files | |
| 10.3 | Staging R2 keys do not match production R2 key patterns | |

---

## 11. Translation output quality — no technical traces

| # | Check | Status |
|---|---|---|
| 11.1 | No text "Claude" visible anywhere in translated output | |
| 11.2 | No text "Mistral" visible | |
| 11.3 | No text "JSON", "Markdown", "renderer", "parser" visible | |
| 11.4 | No text "fallback", "serviceLevel", "document_type" visible | |
| 11.5 | `qa_report.hasForbiddenTechnicalTerms = false` | |

---

## 12. Visual elements block

| # | Check | Status |
|---|---|---|
| 12.1 | Translated PDF contains a "Visual Elements" or equivalent section | |
| 12.2 | Stamps are listed as `[stamp]` or described | |
| 12.3 | Signatures are listed as `[signature]` | |
| 12.4 | QR codes are listed as `[QR code present]` | |
| 12.5 | MRZ lines (if passport) are preserved verbatim | |
| 12.6 | `qa_report.hasVisualElementsBlock = true` | |

---

## 13. Translator block (official workflow)

| # | Check | Status |
|---|---|---|
| 13.1 | For `translator_review_draft` jobs: translator block present in DOCX | |
| 13.2 | `qa_report.hasTranslatorBlock = true` | |
| 13.3 | Translator name / signature field is present (even if blank) | |

---

## 14. CJK / Thai font rendering

| # | Check | Status |
|---|---|---|
| 14.1 | Upload a document with Chinese characters → PDF renders without tofu (□□□) | |
| 14.2 | Upload a Thai-language document → Thai characters render correctly | |
| 14.3 | Upload a Korean document → Korean characters render correctly | |

---

## 15. Wide table rendering

| # | Check | Status |
|---|---|---|
| 15.1 | Upload a document with a wide multi-column table (e.g. bank statement) | |
| 15.2 | Table does not clip at the right page margin grossly | |
| 15.3 | `qa_report.hasPotentialTableClipping = false` | |

---

## 16. Supabase `workflow_status` correctness

| # | Check | Status |
|---|---|---|
| 16.1 | Normal job: `workflow_status = 'completed'` | |
| 16.2 | Notarized job: `workflow_status = 'awaiting_translator_review'` | |
| 16.3 | Pre-migration rows (null): treated as completed for download | |
| 16.4 | Failed job: `status = 'failed'`, `workflow_status` irrelevant | |

---

## Sign-off

| Date | Tester | Build / Branch | Result |
|---|---|---|---|
| | | `staging` | |

All critical checks (sections 1–10) must pass before promoting to `main`.
Sections 11–16 should pass but may be deferred if there are known open issues.
