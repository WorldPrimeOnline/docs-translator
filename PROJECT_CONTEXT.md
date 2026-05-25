# PROJECT_CONTEXT.md — Global Document Translation Workflow Platform

## 1. PRODUCT VISION

Build a global AI-powered document translation workflow platform for people dealing with immigration, visas, universities, banks, consulates, relocation, notaries, and official paperwork.

The product is not just a generic AI translator. It is a document workflow service focused on specific bureaucratic use cases where users need fast, structured, readable translations of official documents.

Core strategy:
- One global brand and one main platform
- Multiple country-specific and workflow-specific landing pages
- Thailand/DTV and Kazakhstan document workflows are the first two priority verticals
- Backend translation engine is shared
- Frontend positioning changes by vertical, country, document type, and use case

The service competes with traditional translation bureaus on:
- speed
- convenience
- online workflow
- lower price
- reduced paperwork friction
- better UX

For MVP, the service is positioned as an unofficial/informational document translation tool, with optional human review/certified/notarized workflows planned later through partners.

---

## 2. POSITIONING

Do not position the product as:
- generic AI translator
- “translate anything”
- cheap GPT wrapper
- replacement for certified translators
- guaranteed immigration approval service

Position the product as:
- fast document translation workflow
- visa and immigration document translation helper
- structured translation for bureaucratic paperwork
- online alternative to slow manual translation bureaus
- platform for preparing documents before submission, review, or notarization

Core message:
“Upload your document and receive a clean translated PDF prepared for visa, immigration, university, banking, or relocation workflows.”

Important legal wording:
- Never promise that documents are guaranteed to be accepted
- Never claim official certification unless that specific workflow exists
- Always include visible disclaimer:
  “UNOFFICIAL TRANSLATION — FOR INFORMATIONAL PURPOSES ONLY”
- Future feature: “Human review / certified partner review”

---

## 3. GLOBAL ARCHITECTURE

Use one main brand/domain.

Recommended site structure:

/
├── thailand/
│   ├── dtv-visa-translation
│   ├── immigration-document-translation
│   ├── bank-statement-translation
│   ├── russian-to-english-translation
│   └── thai-english-document-translation
│
├── kazakhstan/
│   ├── notarized-translation
│   ├── university-document-translation
│   ├── apostille-document-translation
│   ├── immigration-document-translation
│   └── russian-english-document-translation
│
├── documents/
│   ├── passport-translation
│   ├── birth-certificate-translation
│   ├── diploma-translation
│   ├── bank-statement-translation
│   ├── medical-certificate-translation
│   └── police-clearance-translation
│
├── languages/
│   ├── russian-to-english
│   ├── english-to-thai
│   ├── thai-to-english
│   └── russian-to-thai

Homepage stays global.
Traffic pages are vertical-specific.

Each landing page must behave like a mini-product page with:
- specific pain point
- specific document types
- specific workflow
- FAQ
- pricing section
- CTA
- disclaimer
- trust section
- upload flow entry point

---

## 4. PRIORITY VERTICALS

### 4.1 Thailand / DTV / Expat Vertical

Primary audience:
- Russian-speaking expats
- digital nomads
- DTV visa applicants
- people preparing documents for Thai immigration, consulates, banks, or agencies

Primary use cases:
- DTV visa documents
- bank statements
- proof of income
- employment letters
- diplomas
- passports
- police clearance
- medical documents
- Russian/English/Thai translation workflows

Positioning:
“Fast online translation of documents for Thailand visa and expat paperwork.”

Main pain points:
- user is abroad
- user needs documents quickly
- agency replies slowly
- user does not know formatting requirements
- user wants PDF output without WhatsApp/manual back-and-forth

Priority language pairs:
- RU → EN
- EN → RU
- RU → TH
- TH → EN
- EN → TH

Landing tone:
- international
- practical
- fast
- visa-focused
- no aggressive claims

---

### 4.2 Kazakhstan / Notary / University / Migration Vertical

Primary audience:
- people in Kazakhstan preparing documents for foreign universities, immigration, work, relocation, visas, banks, or legal use
- students
- parents
- notaries
- migration consultants
- educational agencies
- relocation agents

Primary use cases:
- notarized translation preparation
- university admissions
- diplomas and transcripts
- birth/marriage certificates
- apostille-related document translation
- immigration files
- bank and employment documents

Positioning:
“Онлайн-перевод документов для учёбы, миграции, нотариальных и международных задач.”

Important:
Kazakhstan is not the whole product. Kazakhstan is a local distribution vertical and first offline/B2B channel.

Potential partners:
- notaries
- migration lawyers
- visa agencies
- education consultants
- university admission agents
- relocation consultants

Partner model:
- referral fee
- partner dashboard later
- white-label-ish workflow later
- partner uploads client documents and receives translated drafts faster

Do not position against notaries.
Position as a tool that helps them process documents faster.

---

## 5. CORE VALUE PROPOSITION

For users:
- Upload PDF or scanned document
- Select source and target language
- Select document type and use case
- Pay online
- Receive clean translated PDF in minutes
- Use for review, preparation, agency communication, visa paperwork, or further human/notary review

For partners:
- Faster first draft translation
- Lower manual workload
- Better document formatting
- More revenue through referral/markup
- Less back-and-forth with clients

---

## 6. MVP PRODUCT SCOPE

MVP supports:
- PDF upload
- scanned document OCR
- automatic or manual source language selection
- target language selection
- document type selection
- clean translated PDF output
- visible unofficial translation disclaimer
- Stripe payment
- user dashboard
- email notification
- 30-day file retention
- auto-delete after 30 days

MVP does not support:
- official certified translation
- notarization
- guaranteed acceptance
- API access
- enterprise dashboard
- live human editing
- handwritten documents
- pixel-perfect layout preservation

Future features:
- human review
- certified partner review
- notary partner workflow
- B2B partner dashboard
- bulk upload
- reusable templates per vertical
- country-specific workflow checklists
- document readiness checker
- DTV checklist tool
- university admission document checklist

---

## 7. TECHNICAL STACK — FIXED

Frontend:
- Next.js 15 App Router
- TypeScript
- Tailwind CSS
- shadcn/ui

Backend:
- Next.js API routes for light endpoints
- Separate Node.js worker on Railway for OCR/translation jobs

Database:
- Supabase Postgres

Auth:
- Supabase Auth
- Email login
- Google OAuth

Storage:
- Cloudflare R2

Queue:
- Inngest preferred for MVP simplicity
- BullMQ + Redis acceptable only if explicitly needed

OCR:
- Primary: Mistral OCR API
- Fallback: Google Document AI

Translation:
- Primary: Anthropic Claude Sonnet 4.6 via @anthropic-ai/sdk
- Fallback: Google Gemini 2.5 Pro

PDF generation:
- Puppeteer HTML template → PDF on Railway worker

Payments:
- Stripe Checkout
- one-time payments first
- subscriptions/credits later

Email:
- Resend

Monitoring:
- Sentry
- Axiom

Hosting:
- Vercel for web
- Railway for worker and queue infrastructure

Domain:
- one main brand domain
- DNS through Njalla or Cloudflare

---

## 8. CORE PIPELINE

User flow:
1. User opens a vertical landing page or homepage
2. User clicks CTA
3. User uploads PDF
4. User selects:
   - source language or auto-detect
   - target language
   - document type
   - use case / vertical
5. User sees price
6. User pays through Stripe Checkout
7. Job goes into queue
8. Worker processes document:
   a. Download PDF from R2
   b. OCR through Mistral OCR
   c. Detect language if needed
   d. Extract structured content
   e. Preserve tables, headings, numbers, dates, names, IDs, stamps, and signatures as text references
   f. Translate with document-type and vertical-specific prompt
   g. Validate output structure
   h. Render clean HTML template
   i. Generate translated PDF through Puppeteer
   j. Add watermark and footer disclaimer
   k. Upload result to R2
9. User receives email
10. User downloads translated PDF from dashboard
11. Files are deleted automatically after 30 days

---

## 9. DOCUMENT TYPES — MVP

Each document type must have a dedicated translation prompt and clean PDF template:

1. Passport / ID card
2. Birth certificate
3. Marriage / divorce certificate
4. Diploma
5. Transcript
6. Bank statement
7. Employment letter / contract
8. Medical certificate
9. Police clearance certificate
10. Driver license
11. Generic official document

---

## 10. BUSINESS RULES

Always preserve:
- names
- document numbers
- dates
- amounts
- currencies
- addresses
- passport numbers
- ID numbers
- bank account numbers
- IBANs
- SWIFT/BIC
- signatures as “[signature]”
- stamps as “[stamp]”
- QR codes as “[QR code present]”

Never:
- invent missing text
- translate names semantically
- convert currencies
- change dates
- remove disclaimers
- claim certification
- claim guaranteed acceptance

Names:
- transliterate, do not translate
- use ICAO 9303 for passport-like documents when possible
- use consistent transliteration across document

Footer on every translated PDF:
- service name
- translation date
- source language
- target language
- document type
- disclaimer:
  “UNOFFICIAL TRANSLATION — FOR INFORMATIONAL PURPOSES ONLY. This document is not a certified or notarized translation.”

Privacy:
- original and translated files stored for 30 days
- auto-delete after 30 days
- user can request deletion
- document fingerprint SHA-256 stored for audit

---

## 11. LANDING PAGE REQUIREMENTS

Each vertical landing page must include:

1. Hero section
   - clear vertical-specific headline
   - subheadline focused on document workflow pain
   - CTA: “Upload document”
   - secondary CTA: “See supported documents”

2. Pain section
   - why this workflow is painful
   - slow bureaus
   - agency delays
   - unclear requirements
   - language barriers

3. Supported documents
   - list of document types relevant to that vertical

4. How it works
   - upload
   - choose language/use case
   - pay
   - receive PDF

5. Trust/disclaimer section
   - unofficial translation disclaimer
   - privacy
   - auto-delete
   - no human sees documents by default

6. Pricing section
   - simple per-document pricing
   - future human review option

7. FAQ
   - specific to the vertical

8. SEO content block
   - natural language explanation
   - no keyword stuffing

9. Final CTA

---

## 12. SEO / GEO / AI VISIBILITY STRATEGY

The product must support:
- classic Google SEO
- long-tail SEO
- AI answer engine visibility
- LLM-readable semantic pages
- clean HTML
- structured data

Required schema types:
- Organization
- WebSite
- Service
- FAQPage
- BreadcrumbList
- LocalBusiness only for local vertical pages when appropriate

SEO page types:
- country pages
- visa/workflow pages
- document type pages
- language pair pages
- comparison pages
- FAQ pages

Do not create spam pages.
Each page must have a real use case and useful content.

---

## 13. ROUTING / APP STRUCTURE EXPECTATION

Use Next.js App Router.

Expected route groups:

app/
├── page.tsx
├── thailand/
│   ├── page.tsx
│   ├── dtv-visa-translation/page.tsx
│   └── immigration-document-translation/page.tsx
├── kazakhstan/
│   ├── page.tsx
│   ├── notarized-translation/page.tsx
│   └── university-document-translation/page.tsx
├── documents/
│   ├── passport-translation/page.tsx
│   ├── diploma-translation/page.tsx
│   └── bank-statement-translation/page.tsx
├── upload/
│   └── page.tsx
├── dashboard/
│   └── page.tsx
├── pricing/
│   └── page.tsx
├── legal/
│   ├── terms/page.tsx
│   ├── privacy/page.tsx
│   └── disclaimer/page.tsx

Use reusable landing components:
- HeroSection
- PainSection
- SupportedDocumentsSection
- HowItWorksSection
- PricingSection
- FAQSection
- TrustSection
- FinalCTASection
- StructuredData

Landing pages should be generated from typed config objects, not duplicated manually.

---

## 14. CODE STANDARDS

- TypeScript strict mode everywhere
- Explicit return types for async functions
- Zod for runtime validation
- Zod for env validation
- Zod for LLM output validation
- Server actions for mutations where appropriate
- API routes only where needed
- All LLM calls wrapped in retry logic
- Exponential backoff, max 3 retries
- Errors logged to Sentry
- Never expose secrets to client
- All env vars must come from canonical list
- ESLint and Prettier enabled
- Conventional commits
- No mock claims, no fake reviews, no fake certifications

---

## 15. ENV VARIABLES

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
INNGEST_EVENT_KEY=
INNGEST_SIGNING_KEY=

Do not invent new env vars.

---

## 16. MVP LAUNCH CRITERIA

MVP is ready when:

- Homepage works
- Thailand vertical landing works
- Kazakhstan vertical landing works
- At least one DTV-specific page works
- At least one Kazakhstan notary/university page works
- Upload flow works
- Payment flow works
- Worker can process PDF end-to-end
- Translated PDF is generated
- Disclaimer appears on every PDF page
- User receives result by email
- Dashboard shows uploaded and translated documents
- Files auto-delete after 30 days
- Privacy Policy, Terms, and Disclaimer pages exist
- Stripe production webhooks tested
- Sentry catches errors
- Site runs on one real domain with SSL

---

## 17. WHAT CLAUDE CODE SHOULD DO IN EVERY SESSION

Claude Code must:

1. Read PROJECT_CONTEXT.md first
2. Respect the fixed technical stack
3. Never reposition the product as generic AI translator
4. Preserve the global platform + local verticals strategy
5. Never claim certified/notarized status unless explicitly implemented
6. Use typed config-driven landing pages
7. Keep homepage global
8. Build Thailand and Kazakhstan as separate verticals inside the same site
9. Ask before changing stack, models, payments, or storage
10. Avoid fake reviews, fake guarantees, fake official claims
