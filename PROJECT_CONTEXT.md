# PROJECT_CONTEXT.md — AI Document Translation Service

## 1. PRODUCT VISION
Build an AI-powered document translation service that converts scanned PDF documents into translated PDFs across 10+ languages. Target users: international individuals dealing with immigration, university admissions, insurance, banks, and consulates. The service competes with traditional translation bureaus on price (2–3x cheaper) and speed (minutes vs days), positioned as INFORMATIONAL translation, not certified/notarized.

## 2. CORE VALUE PROPOSITION
- Upload scanned PDF → get translated PDF in < 5 minutes
- All major languages: EN, RU, TH, ZH, KO, ES, AR, JA, DE, FR
- All document types: passports, birth/marriage certificates, diplomas, contracts, bank statements, medical records, etc.
- Price: $8–15 per document (vs $25–40 at bureaus)
- "Clean reformat" output: not visually identical to original, but structured, readable, with all data preserved
- Visible disclaimer on every page: "UNOFFICIAL TRANSLATION — FOR INFORMATIONAL PURPOSES ONLY"

## 3. INITIAL MARKET (MVP)
Russian-speaking expats in Southeast Asia (Thailand primarily). Primary language pairs for MVP launch: RU↔EN, RU↔TH, EN↔TH. Expand pairs after product-market fit.

## 4. TECHNICAL STACK (FIXED — DO NOT DEVIATE)
- **Frontend**: Next.js 15 (App Router), TypeScript, Tailwind CSS, shadcn/ui
- **Backend**: Next.js API routes for light endpoints; separate Node.js worker on Railway for OCR/translation jobs
- **Database**: Supabase (Postgres)
- **Auth**: Supabase Auth (email + Google OAuth)
- **File storage**: Cloudflare R2 (S3-compatible, cheaper egress)
- **Queue**: BullMQ + Redis (Railway addon) OR Inngest (prefer Inngest for MVP simplicity)
- **OCR primary**: Mistral OCR API ($0.001/page, multilingual)
- **OCR fallback**: Google Document AI
- **Translation primary**: Anthropic Claude Sonnet 4.6 (via @anthropic-ai/sdk)
- **Translation fallback**: Google Gemini 2.5 Pro (especially for CJK languages)
- **PDF generation**: Puppeteer (HTML template → PDF) running on Railway worker
- **Payments**: Stripe Checkout (subscription + one-time)
- **Email**: Resend
- **Monitoring**: Sentry + Axiom for logs
- **Hosting**: Vercel (web), Railway (worker + Redis)
- **Domain**: njalla DNS

## 5. CORE PIPELINE (THE PRODUCT)
User flow:
1. User signs up / logs in
2. User uploads PDF (max 50 pages, max 25 MB)
3. User selects source language (or "auto-detect") and target language
4. User selects document type from preset list (passport, diploma, contract, bank statement, medical, other)
5. User pays (Stripe Checkout — one-time or uses subscription credits)
6. Job goes into queue
7. Worker processes:
   a. Download PDF from R2
   b. Send to Mistral OCR → get structured Markdown with text, tables, layout hints
   c. Detect language if "auto"
   d. Chunk content semantically (preserve tables, headings, key-value pairs)
   e. Translate via Claude Sonnet 4.6 with document-type-specific system prompt
   f. Post-process: preserve numbers, dates, names (transliterate where needed), proper nouns
   g. Render translated content into HTML template (matches document type)
   h. Convert HTML → PDF via Puppeteer with watermark
   i. Upload result to R2
8. Notify user via email + show in dashboard
9. User downloads PDF; original + translation kept for 30 days, then auto-deleted (privacy)

## 6. KEY BUSINESS RULES
- Always preserve: numbers, dates, document numbers, passport numbers, IBANs, names (transliterate, never translate names)
- Names of people: transliterate to target language script using ICAO 9303 for passports, GOST for Russian docs
- Currencies: never auto-convert, preserve original
- Every translated PDF includes: watermark "UNOFFICIAL TRANSLATION", footer with translation date + source/target languages + service name + disclaimer in both languages
- Original document fingerprint (SHA-256) is logged for audit
- GDPR: user can request deletion of all their documents at any time
- Auto-delete files after 30 days
- No human in the loop for MVP (pure AI), but UI mentions optional "human review +$X" as future feature

## 7. DOCUMENT TYPES (MVP SCOPE)
Each type has a dedicated translation system prompt and HTML template:
1. Passport / ID card
2. Birth / marriage / divorce certificate
3. Diploma + transcript
4. Bank statement
5. Medical record / certificate
6. Employment contract / labor book
7. Police clearance certificate
8. Driver license
9. Generic / other (catch-all)

## 8. NON-GOALS FOR MVP
- NOT pixel-perfect layout preservation (clean reformat only)
- NOT certified/notarized translation (information only)
- NOT B2B/enterprise dashboard (only personal accounts initially)
- NOT API for third parties
- NOT mobile app (responsive web only)
- NOT support for handwritten documents (printed scans only; warn user otherwise)
- NOT real-time editing of translated text in MVP (post-MVP feature)

## 9. CODE STANDARDS
- TypeScript strict mode everywhere
- All async functions properly typed with explicit return types
- Zod for runtime validation of all external inputs (API requests, env vars, LLM outputs)
- Server actions for mutations where possible (Next.js App Router pattern)
- All LLM calls wrapped in retry logic (exponential backoff, max 3 retries)
- All LLM outputs validated against Zod schemas
- Errors logged to Sentry with context
- Secrets in env vars only, never committed (use .env.local + Vercel/Railway env vars)
- Database migrations via Supabase CLI
- ESLint + Prettier preconfigured
- Conventional commits

## 10. ENV VARIABLES (canonical list)
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
ANTHROPIC_API_KEY=
GEMINI_API_KEY=
MISTRAL_API_KEY=
GOOGLE_DOCUMENT_AI_CREDENTIALS_JSON=
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET_NAME=
REDIS_URL=
RESEND_API_KEY=
SENTRY_DSN=
INNGEST_EVENT_KEY=  (if using Inngest)
INNGEST_SIGNING_KEY=

## 11. DEFINITION OF DONE (MVP LAUNCH CRITERIA)
- User can sign up, upload a PDF, pay, and receive a translated PDF
- All 9 document types tested end-to-end on real documents
- All 3 priority language pairs tested (RU↔EN, RU↔TH, EN↔TH)
- 95th-percentile end-to-end processing time < 5 minutes for 1–5 page documents
- Stripe webhooks tested in production mode
- ToS + Privacy Policy + disclaimer pages live
- Auto-delete cron job tested
- Sentry catching errors
- Basic landing page with pricing and FAQ
- Working from a single brand domain with SSL

## 12. WHAT CLAUDE CODE SHOULD DO IN EVERY SESSION
- Always read this file first
- Always check if a relevant SKILL.md exists before creating files
- Never invent env vars not in section 10
- Never use a different model name than specified in section 4
- Never deviate from the stack in section 4 without explicit instruction
- When in doubt, ask before writing code
