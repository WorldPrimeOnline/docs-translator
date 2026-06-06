# ── Stage 1: build ──────────────────────────────────────────────────────────
FROM node:22-slim AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src

RUN npm run build

# ── Stage 2: runtime ─────────────────────────────────────────────────────────
FROM node:22-slim AS runner

# @sparticuz/chromium bundles its own Chromium — only need these system libs
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    fonts-liberation \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libx11-6 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libxss1 \
    libxtst6 \
    && rm -rf /var/lib/apt/lists/*

# Noto fonts for CJK, Thai, and multilingual official document rendering
RUN apt-get update && apt-get install -y --no-install-recommends \
    fonts-noto \
    fonts-noto-cjk \
    fonts-noto-color-emoji \
    fonts-thai-tlwg \
  && rm -rf /var/lib/apt/lists/*

# Do not let puppeteer download its own chrome — @sparticuz/chromium is used
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

WORKDIR /app

# Production deps only
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist

# Non-root user for security
RUN groupadd -r pptruser && useradd -r -g pptruser -G audio,video pptruser \
    && chown -R pptruser:pptruser /app

USER pptruser

ENV NODE_ENV=production

CMD ["node", "dist/index.js"]
