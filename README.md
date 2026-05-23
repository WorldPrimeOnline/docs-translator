# Docs Translator

AI-powered document translation — upload a scanned PDF, receive a translated PDF in minutes.

## Prerequisites

- Node.js 20+
- npm 10+

## Setup

```bash
git clone <your-repo-url>
cd <repo-name>
npm install
cp .env.example .env.local   # then fill in your values
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to view the app.

## Available Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start development server |
| `npm run build` | Build for production |
| `npm run start` | Start production server |
| `npm run lint` | Run ESLint |

## Architecture

See [PROJECT_CONTEXT.md](./PROJECT_CONTEXT.md) for the full product vision, technical stack, pipeline design, and environment variable reference.

## Status

**Stage 0 — Bootstrap complete.**

Next stages:
1. Stage 1 — Supabase setup (database schema, auth)
2. Stage 2 — Authentication (email + Google OAuth)
3. Stage 3 — Core pipeline (OCR → translation → PDF)
4. Stage 4 — Payments (Stripe Checkout)
5. Stage 5 — Monitoring & polish (Sentry, Axiom, landing page)
