/**
 * Price Breakdown Jira Story builder for WPO orders.
 *
 * Creates a client-facing-safe breakdown issue in Jira showing what the customer
 * paid for (client-visible line items only). Created at order initialisation time
 * (alongside the main Заказ issue), not post-completion.
 *
 * Differs from the Finance Report Story (finance-report.ts) which is created
 * post-completion and contains internal unit economics (margins, reserves, fiscal).
 *
 * Env vars:
 *   JIRA_PRICE_BREAKDOWN_ISSUE_ENABLED  — "true" to enable (default: false)
 *   JIRA_PRICE_BREAKDOWN_PROJECT_KEY    — Jira project key (default: JIRA_FINANCE_PROJECT_KEY ?? 'WO')
 *   JIRA_PRICE_BREAKDOWN_ISSUE_TYPE     — Jira issue type name (default: 'Story')
 *   JIRA_PRICE_BREAKDOWN_LABELS         — comma-separated labels (default: 'wpo-price-breakdown')
 */

interface QuoteLineItem {
  itemType: string;
  label: string;
  quantity: number;
  unitPriceKzt: number | null;
  amountKzt: number;
  isClientVisible: boolean;
  isCost: boolean;
  sortOrder: number;
}

interface PricingResultContext {
  languagePair: string;
  baseMinimumKzt: number;
  extraWords: number;
  additionalPages: number;
  documentCoefficient: number;
  urgencyCoefficient: number;
  includedWordCount: number;
  includedPageCount: number;
}

export interface PriceBreakdownPricingResult {
  amountKzt: number;
  currency: string;
  status: string;
  items: QuoteLineItem[];
  pricingVersionCode: string;
  context: PricingResultContext;
}

export const PRICE_BREAKDOWN_LABELS = ['wpo-price-breakdown'] as const;

export function getPriceBreakdownConfig() {
  return {
    enabled: process.env.JIRA_PRICE_BREAKDOWN_ISSUE_ENABLED === 'true',
    projectKey: process.env.JIRA_PRICE_BREAKDOWN_PROJECT_KEY
      ?? process.env.JIRA_FINANCE_PROJECT_KEY
      ?? 'WO',
    issueType: process.env.JIRA_PRICE_BREAKDOWN_ISSUE_TYPE ?? 'Story',
    labels: (process.env.JIRA_PRICE_BREAKDOWN_LABELS ?? PRICE_BREAKDOWN_LABELS.join(',')).split(',').map(l => l.trim()).filter(Boolean),
  };
}

export interface PriceBreakdownParams {
  jobId: string;
  mainIssueKey: string;
  quoteId: string | null;
  serviceLevel: string;
  sourceLanguage: string;
  targetLanguage: string;
  documentType: string;
  paymentSource: string | null;
  pricingResult: PriceBreakdownPricingResult | null;
}

export function buildPriceBreakdownSummary(mainIssueKey: string): string {
  return `Price Breakdown for ${mainIssueKey}`;
}

function kztLine(label: string, amount: number | null | undefined): string {
  if (amount == null) return `${label}: —`;
  return `${label}: ${Math.round(amount).toLocaleString('ru-RU')} KZT`;
}

export function buildPriceBreakdownDescription(params: PriceBreakdownParams): Record<string, unknown> {
  const lines: string[] = [];

  lines.push('=== WPO Price Breakdown ===');
  lines.push('');
  lines.push(`Main order: ${params.mainIssueKey}`);
  lines.push(`Job ID: ${params.jobId}`);
  lines.push(`Quote ID: ${params.quoteId ?? '—'}`);
  lines.push(`Service: ${params.serviceLevel}`);
  lines.push(`Language pair: ${params.sourceLanguage} → ${params.targetLanguage}`);
  lines.push(`Document type: ${params.documentType}`);
  lines.push(`Payment source: ${params.paymentSource ?? '—'}`);
  lines.push('');

  lines.push('--- Total ---');
  if (params.pricingResult) {
    lines.push(kztLine('Client price', params.pricingResult.amountKzt));
    lines.push(`Currency: ${params.pricingResult.currency}`);
    lines.push(`Pricing version: ${params.pricingResult.pricingVersionCode}`);
  } else {
    lines.push('Client price: — (quote not available at issue creation time)');
  }
  lines.push('');

  if (params.pricingResult?.context) {
    const ctx = params.pricingResult.context;
    lines.push('--- Pricing Context ---');
    lines.push(`Language group/pair: ${ctx.languagePair}`);
    lines.push(kztLine('Base minimum', ctx.baseMinimumKzt));
    lines.push(`Included words: ${ctx.includedWordCount}`);
    lines.push(`Extra words billed: ${ctx.extraWords}`);
    lines.push(`Document coefficient: ${ctx.documentCoefficient}`);
    lines.push(`Urgency coefficient: ${ctx.urgencyCoefficient}`);
    lines.push('');
  }

  if (params.pricingResult?.items) {
    const clientItems = params.pricingResult.items.filter(i => i.isClientVisible);
    if (clientItems.length > 0) {
      lines.push('--- Line Items (client-visible) ---');
      for (const item of clientItems) {
        const unitStr = item.unitPriceKzt != null ? ` × ${item.quantity} × ${Math.round(item.unitPriceKzt).toLocaleString('ru-RU')} KZT` : '';
        lines.push(`  ${item.label}${unitStr}: ${Math.round(item.amountKzt).toLocaleString('ru-RU')} KZT`);
      }
      lines.push('');
    }
  }

  lines.push('Created at order initialisation — payment and receipt data in Finance Report Story');

  return {
    version: 1,
    type: 'doc',
    content: lines.map(line => ({
      type: 'paragraph',
      content: [{ type: 'text', text: line || ' ' }],
    })),
  };
}

export function buildPriceBreakdownPayload(params: PriceBreakdownParams): Record<string, unknown> {
  const config = getPriceBreakdownConfig();

  return {
    fields: {
      project: { key: config.projectKey },
      summary: buildPriceBreakdownSummary(params.mainIssueKey),
      issuetype: { name: config.issueType },
      labels: config.labels,
      description: buildPriceBreakdownDescription(params),
    },
  };
}
