/**
 * Price Breakdown Jira Story builder for WPO orders.
 *
 * Creates an operator-facing full breakdown issue in Jira showing:
 *   A. Order / Quote summary
 *   B. Revenue / client price components (all is_cost=false items, including non-visible)
 *   C. Internal cost / reserve allocation (all is_cost=true items)
 *   D. Cost reservations
 *   E. Margin summary
 *   F. Reconciliation
 *   G. Raw debug JSON
 *
 * Created at order initialisation time alongside the main Заказ issue.
 * This is the full OPERATOR view — all items shown regardless of is_client_visible.
 * Client-only view is separate (UI). Internal costs/margin are intentionally included here.
 *
 * Differs from the Finance Report Story (finance-report.ts):
 *   - Price Breakdown: created at order init, shows planned economics
 *   - Finance Report: created post-completion, shows actual payment/fiscal/payout data
 *
 * Env vars:
 *   JIRA_PRICE_BREAKDOWN_ISSUE_ENABLED  — "true" to enable (default: false)
 *   JIRA_PRICE_BREAKDOWN_PROJECT_KEY    — Jira project key (default: JIRA_FINANCE_PROJECT_KEY ?? 'WO')
 *   JIRA_PRICE_BREAKDOWN_ISSUE_TYPE     — Jira issue type name (default: 'Story')
 *   JIRA_PRICE_BREAKDOWN_LABELS         — comma-separated labels (default: 'wpo-price-breakdown')
 */

// ─── DB-mapped interfaces (Supabase returns snake_case → mapped to camelCase) ─

export interface DbPriceQuoteItem {
  id: string;
  itemType: string;            // item_type
  label: string;
  quantity: number;
  unitPriceKzt: number | null; // unit_price_kzt
  amountKzt: number;           // amount_kzt
  isClientVisible: boolean;    // is_client_visible
  isCost: boolean;             // is_cost
  sortOrder: number;           // sort_order
  metadataJson: Record<string, unknown>; // metadata_json
}

export interface DbCostReservation {
  id: string;
  costType: string;            // cost_type
  amountKzt: number;           // amount_kzt
  status: string;
  payableToType: string | null; // payable_to_type
  payableToId: string | null;   // payable_to_id
  notes: string | null;
}

export interface DbPriceQuote {
  id: string;
  amountKzt: number;           // amount_kzt
  currency: string;
  status: string;
  sourceLanguage: string | null;  // source_language
  targetLanguage: string | null;  // target_language
  languagePair: string | null;    // language_pair
  documentType: string | null;    // document_type
  serviceLevel: string | null;    // service_level
  physicalPageCount: number | null;  // physical_page_count
  includedPageCount: number;         // included_page_count
  includedWordCount: number;         // included_word_count
  sourceWordCount: number | null;    // source_word_count
  urgencyLevel: string | null;       // urgency_level
  salesChannel: string | null;       // sales_channel
  fulfillmentMethod: string | null;  // fulfillment_method
  pricingVersionId: string | null;   // pricing_version_id
  pricingContextJson: Record<string, unknown>; // pricing_context_json
  internalCostJson: Record<string, unknown>;   // internal_cost_json
  marginJson: Record<string, unknown>;          // margin_json
  breakdownJson: Record<string, unknown>;       // breakdown_json
}

export interface PriceBreakdownFullParams {
  jobId: string;
  mainIssueKey: string;
  paymentTransactionId: string | null;
  paymentSource: string | null;
  documentId: string | null;
  serviceLevel: string;    // fallback when quote is null
  sourceLanguage: string;
  targetLanguage: string;
  documentType: string;
  quote: DbPriceQuote | null;
  items: DbPriceQuoteItem[];
  reservations: DbCostReservation[];
}

// ─── Snake-case mappers ───────────────────────────────────────────────────────
// Supabase returns DB column names verbatim. Map explicitly — never rely on JSON key casing.

export function mapPriceQuoteItem(row: Record<string, unknown>): DbPriceQuoteItem {
  return {
    id: row.id as string,
    itemType: row.item_type as string,
    label: row.label as string,
    quantity: Number(row.quantity ?? 1),
    unitPriceKzt: row.unit_price_kzt != null ? Number(row.unit_price_kzt) : null,
    amountKzt: Number(row.amount_kzt ?? 0),
    isClientVisible: Boolean(row.is_client_visible ?? true),
    isCost: Boolean(row.is_cost ?? false),
    sortOrder: Number(row.sort_order ?? 0),
    metadataJson: (row.metadata_json as Record<string, unknown>) ?? {},
  };
}

export function mapCostReservation(row: Record<string, unknown>): DbCostReservation {
  return {
    id: row.id as string,
    costType: row.cost_type as string,
    amountKzt: Number(row.amount_kzt ?? 0),
    status: row.status as string,
    payableToType: (row.payable_to_type as string | null) ?? null,
    payableToId: (row.payable_to_id as string | null) ?? null,
    notes: (row.notes as string | null) ?? null,
  };
}

export function mapPriceQuote(row: Record<string, unknown>): DbPriceQuote {
  return {
    id: row.id as string,
    amountKzt: Number(row.amount_kzt ?? 0),
    currency: (row.currency as string) ?? 'KZT',
    status: row.status as string,
    sourceLanguage: (row.source_language as string | null) ?? null,
    targetLanguage: (row.target_language as string | null) ?? null,
    languagePair: (row.language_pair as string | null) ?? null,
    documentType: (row.document_type as string | null) ?? null,
    serviceLevel: (row.service_level as string | null) ?? null,
    physicalPageCount: row.physical_page_count != null ? Number(row.physical_page_count) : null,
    includedPageCount: Number(row.included_page_count ?? 1),
    includedWordCount: Number(row.included_word_count ?? 250),
    sourceWordCount: row.source_word_count != null ? Number(row.source_word_count) : null,
    urgencyLevel: (row.urgency_level as string | null) ?? null,
    salesChannel: (row.sales_channel as string | null) ?? null,
    fulfillmentMethod: (row.fulfillment_method as string | null) ?? null,
    pricingVersionId: (row.pricing_version_id as string | null) ?? null,
    pricingContextJson: (row.pricing_context_json as Record<string, unknown>) ?? {},
    internalCostJson: (row.internal_cost_json as Record<string, unknown>) ?? {},
    marginJson: (row.margin_json as Record<string, unknown>) ?? {},
    breakdownJson: (row.breakdown_json as Record<string, unknown>) ?? {},
  };
}

// ─── Feature flag config ──────────────────────────────────────────────────────

export const PRICE_BREAKDOWN_LABELS = ['wpo-price-breakdown'] as const;

export function getPriceBreakdownConfig() {
  return {
    enabled: process.env.JIRA_PRICE_BREAKDOWN_ISSUE_ENABLED === 'true',
    projectKey: process.env.JIRA_PRICE_BREAKDOWN_PROJECT_KEY
      ?? process.env.JIRA_FINANCE_PROJECT_KEY
      ?? 'WO',
    issueType: process.env.JIRA_PRICE_BREAKDOWN_ISSUE_TYPE ?? 'Story',
    labels: (process.env.JIRA_PRICE_BREAKDOWN_LABELS ?? PRICE_BREAKDOWN_LABELS.join(','))
      .split(',').map(l => l.trim()).filter(Boolean),
  };
}

// ─── Summary ──────────────────────────────────────────────────────────────────

export function buildPriceBreakdownSummary(mainIssueKey: string): string {
  return `Price Breakdown for ${mainIssueKey}`;
}

// ─── Legacy detection ─────────────────────────────────────────────────────────

const KNOWN_LEGACY_ITEM_TYPES = new Set([
  'official_service_fee',
  'risk_reserve',
  'marketing_reserve',
  'base_price',
  'base_minimum',
]);

export function hasLegacyItemTypes(items: DbPriceQuoteItem[]): boolean {
  return items.some(i => KNOWN_LEGACY_ITEM_TYPES.has(i.itemType));
}

// ─── ADF node builders ─────────────────────────────────────────────────────────

function adfHeading(level: number, text: string): Record<string, unknown> {
  return { type: 'heading', attrs: { level }, content: [{ type: 'text', text }] };
}

function adfParagraph(text: string): Record<string, unknown> {
  return { type: 'paragraph', content: [{ type: 'text', text: text || ' ' }] };
}

function adfCodeBlock(code: string, language = 'json'): Record<string, unknown> {
  return { type: 'codeBlock', attrs: { language }, content: [{ type: 'text', text: code }] };
}

function adfCell(text: string, isHeader = false): Record<string, unknown> {
  return {
    type: isHeader ? 'tableHeader' : 'tableCell',
    attrs: {},
    content: [{ type: 'paragraph', content: [{ type: 'text', text: String(text ?? '') }] }],
  };
}

function adfTableRow(cells: string[], isHeader = false): Record<string, unknown> {
  return { type: 'tableRow', content: cells.map(c => adfCell(c, isHeader)) };
}

function adfTable(headers: string[], rows: string[][]): Record<string, unknown> {
  return {
    type: 'table',
    attrs: { isNumberColumnEnabled: false, layout: 'default' },
    content: [
      adfTableRow(headers, true),
      ...rows.map(r => adfTableRow(r, false)),
    ],
  };
}

function adfPanel(panelType: 'info' | 'warning' | 'error', text: string): Record<string, unknown> {
  return {
    type: 'panel',
    attrs: { panelType },
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  };
}

// ─── Formatters ───────────────────────────────────────────────────────────────

function kzt(amount: number): string {
  return `${amount.toFixed(2)} KZT`;
}

function pct(rate: number): string {
  return `${(rate * 100).toFixed(2)}%`;
}

// ─── Description builder ──────────────────────────────────────────────────────

export function buildPriceBreakdownDescription(params: PriceBreakdownFullParams): Record<string, unknown> {
  const nodes: Record<string, unknown>[] = [];

  nodes.push(adfHeading(1, 'WPO Price Breakdown — Operator Audit'));

  // Legacy warning banner
  if (params.items.length > 0 && hasLegacyItemTypes(params.items)) {
    nodes.push(adfPanel('warning',
      'WARNING: legacy quote item taxonomy detected. Rebuild/new quote required for full canonical pricing audit.',
    ));
  }

  // ── A. Order / Quote Summary ────────────────────────────────────────────────
  nodes.push(adfHeading(2, 'A: Order / Quote Summary'));

  const langPair = params.quote?.languagePair
    ?? `${params.quote?.sourceLanguage ?? params.sourceLanguage}→${params.quote?.targetLanguage ?? params.targetLanguage}`;

  const sectionARows: string[][] = [
    ['Main order issue', params.mainIssueKey],
    ['Quote ID', params.quote?.id ?? '—'],
    ['Payment TX', params.paymentTransactionId ?? '—'],
    ['Job ID', params.jobId],
    ['Document ID', params.documentId ?? '—'],
    ['Quote status', params.quote?.status ?? '—'],
    ['Service level', params.quote?.serviceLevel ?? params.serviceLevel],
    ['Document type', params.quote?.documentType ?? params.documentType],
    ['Language pair', langPair],
    ['Source language', params.quote?.sourceLanguage ?? params.sourceLanguage],
    ['Target language', params.quote?.targetLanguage ?? params.targetLanguage],
    ['Physical pages', String(params.quote?.physicalPageCount ?? '—')],
    ['Included pages', String(params.quote?.includedPageCount ?? '—')],
    ['Source word count', String(params.quote?.sourceWordCount ?? '—')],
    ['Included words', String(params.quote?.includedWordCount ?? '—')],
    ['Urgency level', params.quote?.urgencyLevel ?? '—'],
    ['Fulfillment method', params.quote?.fulfillmentMethod ?? '—'],
    ['Sales channel', params.quote?.salesChannel ?? '—'],
    ['Payment source', params.paymentSource ?? '—'],
    ['Pricing version ID', params.quote?.pricingVersionId ?? '—'],
    ['Final amount', params.quote != null ? kzt(params.quote.amountKzt) : '—'],
  ];
  nodes.push(adfTable(['Field', 'Value'], sectionARows));

  // ── B. Revenue / Client Price Components ────────────────────────────────────
  nodes.push(adfHeading(2, 'B: Revenue / Client Price Components'));
  if (params.items.length === 0) {
    nodes.push(adfPanel('warning',
      'WARNING: price_quote_items not found. Only final amount is available. ' +
      'This quote may have been created before canonical pricing breakdown migration.',
    ));
  } else {
    const revenueItems = params.items.filter(i => !i.isCost);
    if (revenueItems.length === 0) {
      nodes.push(adfParagraph('(no revenue items found)'));
    } else {
      const revenueRows = revenueItems.map(item => [
        item.itemType,
        item.label,
        String(item.quantity),
        item.unitPriceKzt != null ? item.unitPriceKzt.toFixed(2) : '—',
        item.amountKzt.toFixed(2),
        item.isClientVisible ? 'client' : 'internal',
        Object.keys(item.metadataJson ?? {}).length > 0 ? JSON.stringify(item.metadataJson) : '',
      ]);
      nodes.push(adfTable(
        ['Item type', 'Label', 'Qty', 'Unit KZT', 'Amount KZT', 'Visibility', 'Metadata'],
        revenueRows,
      ));
      const subtotal = revenueItems.reduce((s, i) => s + i.amountKzt, 0);
      nodes.push(adfParagraph(`Revenue subtotal (all is_cost=false): ${kzt(subtotal)}`));
    }
  }

  // ── C. Internal Cost / Reserve Allocation ──────────────────────────────────
  nodes.push(adfHeading(2, 'C: Internal Cost / Reserve Allocation'));
  if (params.items.length === 0) {
    nodes.push(adfParagraph('(price_quote_items not available)'));
  } else {
    const costItems = params.items.filter(i => i.isCost);
    if (costItems.length === 0) {
      nodes.push(adfParagraph('(no cost items)'));
    } else {
      const costRows = costItems.map(item => [
        item.itemType,
        item.label,
        item.amountKzt.toFixed(2),
        Object.keys(item.metadataJson ?? {}).length > 0 ? JSON.stringify(item.metadataJson) : '',
      ]);
      nodes.push(adfTable(
        ['Cost type', 'Label', 'Amount KZT', 'Notes / metadata'],
        costRows,
      ));
      const subtotal = costItems.reduce((s, i) => s + i.amountKzt, 0);
      nodes.push(adfParagraph(`Cost items subtotal: ${kzt(subtotal)}`));
    }
  }

  // ── D. Cost Reservations ───────────────────────────────────────────────────
  nodes.push(adfHeading(2, 'D: Cost Reservations'));
  if (params.reservations.length === 0) {
    nodes.push(adfParagraph('(no cost reservations found)'));
  } else {
    const reservationRows = params.reservations.map(r => [
      r.costType,
      r.amountKzt.toFixed(2),
      r.status,
      r.payableToType ?? '—',
      r.notes ?? '',
    ]);
    nodes.push(adfTable(
      ['Cost type', 'Amount KZT', 'Status', 'Payable to', 'Notes'],
      reservationRows,
    ));
    const total = params.reservations.reduce((s, r) => s + r.amountKzt, 0);
    nodes.push(adfParagraph(`Total reserved: ${kzt(total)}`));
  }

  // ── E. Margin Summary ──────────────────────────────────────────────────────
  nodes.push(adfHeading(2, 'E: Margin Summary'));
  const margin = (params.quote?.marginJson ?? {}) as {
    grossRevenue?: number;
    totalCosts?: number;
    targetProfit?: number;
    estimatedMarginKzt?: number;
    estimatedMarginRate?: number;
    rawPriceBeforeMarginFloor?: number;
    estimatedMarginRateBeforeFloor?: number;
    marginFloorAdjustmentKzt?: number;
    targetMarginFloorRate?: number;
    profitBufferAboveTargetKzt?: number;
    profitBufferAboveTargetRate?: number;
  };
  if (Object.keys(margin).length === 0) {
    nodes.push(adfParagraph('(margin_json not available)'));
  } else {
    const marginRows: string[][] = [];
    // Margin-floor fields — absent on quotes created before this feature; older
    // quotes' margin_json simply won't have these keys, so the rows are skipped.
    if (margin.rawPriceBeforeMarginFloor != null) marginRows.push(['Raw price before margin floor', kzt(margin.rawPriceBeforeMarginFloor)]);
    if (margin.marginFloorAdjustmentKzt != null)  marginRows.push(['Margin floor adjustment', kzt(margin.marginFloorAdjustmentKzt)]);
    if (margin.grossRevenue != null)        marginRows.push(['Gross revenue (final client price)', kzt(margin.grossRevenue)]);
    if (margin.totalCosts != null)          marginRows.push(['Total costs / reserves', kzt(margin.totalCosts)]);
    if (margin.targetProfit != null)        marginRows.push(['Target profit (benchmark, not a cost)', kzt(margin.targetProfit)]);
    if (margin.estimatedMarginRateBeforeFloor != null) marginRows.push(['Estimated margin % (before floor)', pct(margin.estimatedMarginRateBeforeFloor)]);
    if (margin.estimatedMarginKzt != null)  marginRows.push(['Estimated margin', kzt(margin.estimatedMarginKzt)]);
    if (margin.estimatedMarginRate != null) marginRows.push(['Estimated margin %', pct(margin.estimatedMarginRate)]);
    if (margin.targetMarginFloorRate != null) marginRows.push(['Target margin %', pct(margin.targetMarginFloorRate)]);
    if (margin.profitBufferAboveTargetKzt != null) marginRows.push(['Profit buffer above target', kzt(margin.profitBufferAboveTargetKzt)]);
    if (margin.profitBufferAboveTargetRate != null) marginRows.push(['Profit buffer above target %', pct(margin.profitBufferAboveTargetRate)]);
    if (marginRows.length > 0) {
      nodes.push(adfTable(['Metric', 'Value'], marginRows));
    }
  }

  // ── F. Reconciliation ─────────────────────────────────────────────────────
  nodes.push(adfHeading(2, 'F: Reconciliation'));
  if (params.items.length > 0 && params.quote != null) {
    const clientRevenueSubtotal = params.items
      .filter(i => !i.isCost)
      .reduce((s, i) => s + i.amountKzt, 0);
    const finalAmount = params.quote.amountKzt;
    const diff = Math.abs(clientRevenueSubtotal - finalAmount);
    const statusText = diff <= 1
      ? 'OK: subtotal reconciles with final amount'
      : `WARNING: item subtotal differs from final amount by ${kzt(diff)} — check rounding_adjustment or missing items`;
    nodes.push(adfTable(
      ['Metric', 'Amount KZT', 'Status'],
      [
        ['Client price item subtotal (is_cost=false)', kzt(clientRevenueSubtotal), ''],
        ['Final amount (price_quotes.amount_kzt)', kzt(finalAmount), ''],
        ['Difference', kzt(diff), statusText],
      ],
    ));
  } else if (params.quote != null) {
    nodes.push(adfParagraph(`Final amount: ${kzt(params.quote.amountKzt)}`));
    nodes.push(adfParagraph('(cannot reconcile — price_quote_items not available)'));
  } else {
    nodes.push(adfParagraph('(cannot reconcile — quote not available)'));
  }

  // ── G. Debug JSON ──────────────────────────────────────────────────────────
  nodes.push(adfHeading(2, 'G: Debug JSON'));
  if (params.quote) {
    nodes.push(adfParagraph('pricing_context_json'));
    nodes.push(adfCodeBlock(JSON.stringify(params.quote.pricingContextJson, null, 2)));
    nodes.push(adfParagraph('internal_cost_json'));
    nodes.push(adfCodeBlock(JSON.stringify(params.quote.internalCostJson, null, 2)));
    nodes.push(adfParagraph('margin_json'));
    nodes.push(adfCodeBlock(JSON.stringify(params.quote.marginJson, null, 2)));
    nodes.push(adfParagraph('breakdown_json'));
    nodes.push(adfCodeBlock(JSON.stringify(params.quote.breakdownJson, null, 2)));
  } else {
    nodes.push(adfParagraph('(quote not available)'));
  }

  return { version: 1, type: 'doc', content: nodes };
}

// ─── Payload builder ──────────────────────────────────────────────────────────

export function buildPriceBreakdownPayload(params: PriceBreakdownFullParams): Record<string, unknown> {
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
