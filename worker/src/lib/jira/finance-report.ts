/**
 * Finance Report Jira Story builder for WPO orders.
 *
 * Creates a separate Story in the WO project containing internal unit economics.
 * This data must NEVER appear in the main order issue (Заказ) to prevent
 * leaking margin/reserve/cost data to translators with broad Jira access.
 *
 * MVP mode: if JIRA_FINANCE_SECURITY_LEVEL_ID is not set, the issue is
 * created without a security level. Labels (wpo-finance, confidential,
 * internal-finance) provide fallback access control.
 *
 * Production recommendation: configure Jira Issue Security Scheme and set
 * JIRA_FINANCE_SECURITY_LEVEL_ID before granting translators broad project access.
 */

// Local type copies kept in sync with src/lib/pricing/types.ts
interface InternalCostBreakdown {
  taxReserve: number; acquiringFee: number; riskReserve: number;
  ownerReserve: number; marketingReserve: number; partnerCommission: number;
  aiItReserve: number; translatorReserved: number;
  notaryFee: number; notaryCoordFee: number; courierCost: number; printingCost: number;
}
interface MarginBreakdown {
  grossRevenue: number; totalCosts: number; targetProfit: number;
  estimatedMarginKzt: number; estimatedMarginRate: number;
}
interface QuoteLineItem {
  itemType: string; label: string; quantity: number;
  unitPriceKzt: number | null; amountKzt: number;
  isClientVisible: boolean; isCost: boolean; sortOrder: number;
}
interface PricingResultContext {
  languagePair: string; baseMinimumKzt: number; extraWords: number;
  additionalPages: number; documentCoefficient: number; urgencyCoefficient: number;
  includedWordCount: number; includedPageCount: number;
}
export interface PricingResult {
  amountKzt: number; currency: string; status: string;
  items: QuoteLineItem[]; pricingVersionId: string; pricingVersionCode: string;
  internalCosts: InternalCostBreakdown; margin: MarginBreakdown;
  requiresOperatorReview: boolean; reviewReasons: string[];
  context: PricingResultContext;
}

// ─── Config ───────────────────────────────────────────────────────────────────

export const FINANCE_LABELS = ['wpo-finance', 'confidential', 'internal-finance'] as const;

export function getFinanceConfig() {
  return {
    projectKey: process.env.JIRA_FINANCE_PROJECT_KEY ?? 'WO',
    issueType: process.env.JIRA_FINANCE_ISSUE_TYPE ?? 'Story',
    securityLevelId: process.env.JIRA_FINANCE_SECURITY_LEVEL_ID?.trim() || null,
    labels: (process.env.JIRA_FINANCE_LABELS ?? FINANCE_LABELS.join(',')).split(',').map(l => l.trim()).filter(Boolean),
  };
}

// ─── Params ───────────────────────────────────────────────────────────────────

export interface FinanceReportParams {
  jobId: string;
  mainIssueKey: string;
  quoteId: string | null;
  serviceLevel: string;
  sourceLanguage: string;
  targetLanguage: string;
  documentType: string;
  pricingResult: PricingResult | null;
  paymentTransactionId: string | null;
  paymentAmountKzt: number | null;
  paymentStatus: string | null;
  fiscalStatus: string | null;
  fiscalReceiptId: string | null;
  customerComment: string | null;
}

// ─── Summary ──────────────────────────────────────────────────────────────────

export function buildFinanceSummary(mainIssueKey: string): string {
  return `Finance Report for ${mainIssueKey}`;
}

// ─── Description helpers ──────────────────────────────────────────────────────

function kztLine(label: string, amount: number | null | undefined): string {
  if (amount == null) return `${label}: —`;
  return `${label}: ${Math.round(amount).toLocaleString('ru-RU')} KZT`;
}

function pctLine(label: string, rate: number | null | undefined): string {
  if (rate == null) return `${label}: —`;
  return `${label}: ${(rate * 100).toFixed(1)}%`;
}

export function buildFinanceReportDescription(params: FinanceReportParams): Record<string, unknown> {
  const lines: string[] = [];

  lines.push('=== WPO Finance Report ===');
  lines.push('');
  lines.push(`Main order: ${params.mainIssueKey}`);
  lines.push(`Job ID: ${params.jobId}`);
  lines.push(`Quote ID: ${params.quoteId ?? '—'}`);
  lines.push(`Service: ${params.serviceLevel}`);
  lines.push(`Language pair: ${params.sourceLanguage} → ${params.targetLanguage}`);
  lines.push(`Document type: ${params.documentType}`);
  lines.push('');

  lines.push('--- Client Total ---');
  if (params.pricingResult) {
    lines.push(kztLine('Client price', params.pricingResult.amountKzt));
    lines.push(`Currency: ${params.pricingResult.currency}`);
    lines.push(`Pricing version: ${params.pricingResult.pricingVersionCode}`);
    lines.push(`Requires operator review: ${params.pricingResult.requiresOperatorReview ? 'YES' : 'no'}`);
    if (params.pricingResult.reviewReasons.length > 0) {
      lines.push(`Review reasons: ${params.pricingResult.reviewReasons.join(', ')}`);
    }
  } else {
    lines.push('Client price: — (quote not available)');
  }
  lines.push('');

  if (params.pricingResult?.context) {
    const ctx = params.pricingResult.context;
    lines.push('--- Why This Price ---');
    lines.push(`Language group/pair: ${ctx.languagePair}`);
    lines.push(kztLine('Base minimum', ctx.baseMinimumKzt));
    lines.push(`Included words: ${ctx.includedWordCount}`);
    lines.push(`Extra words billed: ${ctx.extraWords}`);
    lines.push(`Document coefficient: ${ctx.documentCoefficient}`);
    lines.push(`Urgency coefficient: ${ctx.urgencyCoefficient}`);
    lines.push('');
    lines.push('Line items (client-visible):');
    for (const item of params.pricingResult.items.filter(i => i.isClientVisible)) {
      lines.push(`  ${item.itemType}: ${Math.round(item.amountKzt).toLocaleString('ru-RU')} KZT — ${item.label}`);
    }
    lines.push('');
  }

  if (params.pricingResult?.internalCosts) {
    const ic = params.pricingResult.internalCosts;
    lines.push('--- Internal Economics (CONFIDENTIAL) ---');
    lines.push(kztLine('Tax reserve (3%)', ic.taxReserve));
    lines.push(kztLine('Acquiring fee (2.5%)', ic.acquiringFee));
    lines.push(kztLine('Risk reserve (5%)', ic.riskReserve));
    lines.push(kztLine('Owner reserve (7%)', ic.ownerReserve));
    lines.push(kztLine('Marketing reserve (10%)', ic.marketingReserve));
    lines.push(kztLine('Partner commission', ic.partnerCommission));
    lines.push(kztLine('AI/IT reserve', ic.aiItReserve));
    lines.push(kztLine('Translator reserved (30%)', ic.translatorReserved));
    lines.push(kztLine('Notary official fee', ic.notaryFee));
    lines.push(kztLine('Notary coordination fee', ic.notaryCoordFee));
    lines.push(kztLine('Printing/binding cost', ic.printingCost));
    lines.push(kztLine('Courier cost', ic.courierCost));
    lines.push('');
    lines.push('Internal line items:');
    for (const item of params.pricingResult.items.filter(i => !i.isClientVisible || i.isCost)) {
      lines.push(`  ${item.itemType}: ${Math.round(item.amountKzt).toLocaleString('ru-RU')} KZT — ${item.label}`);
    }
    lines.push('');
  }

  if (params.pricingResult?.margin) {
    const m = params.pricingResult.margin;
    lines.push('--- Margin ---');
    lines.push(kztLine('Gross revenue', m.grossRevenue));
    lines.push(kztLine('Total costs', m.totalCosts));
    lines.push(kztLine('Target profit', m.targetProfit));
    lines.push(kztLine('Estimated margin (KZT)', m.estimatedMarginKzt));
    lines.push(pctLine('Estimated margin (%)', m.estimatedMarginRate));
    lines.push('');
  }

  lines.push('--- Payment ---');
  lines.push(`Payment TX ID: ${params.paymentTransactionId ?? '—'}`);
  lines.push(kztLine('Payment amount charged', params.paymentAmountKzt));
  lines.push(`Payment status: ${params.paymentStatus ?? '—'}`);
  lines.push('');

  lines.push('--- Fiscal ---');
  lines.push(`Fiscal receipt ID: ${params.fiscalReceiptId ?? '—'}`);
  lines.push(`Fiscal status: ${params.fiscalStatus ?? '—'}`);
  lines.push('');

  lines.push('--- Customer Comment ---');
  lines.push(params.customerComment?.trim() || 'не указан');
  lines.push('');

  lines.push('INTERNAL USE ONLY — do not share with clients or translators');

  return {
    version: 1,
    type: 'doc',
    content: lines.map(line => ({
      type: 'paragraph',
      content: [{ type: 'text', text: line || ' ' }],
    })),
  };
}

// ─── Payload builder ──────────────────────────────────────────────────────────

export function buildFinanceIssuePayload(params: FinanceReportParams): Record<string, unknown> {
  const config = getFinanceConfig();

  const fields: Record<string, unknown> = {
    project: { key: config.projectKey },
    summary: buildFinanceSummary(params.mainIssueKey),
    issuetype: { name: config.issueType },
    labels: config.labels,
    description: buildFinanceReportDescription(params),
  };

  // Security level is OPTIONAL — MVP may run without it
  if (config.securityLevelId) {
    fields.security = { id: config.securityLevelId };
  }

  return { fields };
}
