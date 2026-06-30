import { getJiraCredentials, makeAuthHeader } from './config';

// Hardcoded routing — Jira project/type for payouts are business rules, not deployment config.
// Do NOT move these to env vars.
const PARTNER_PAYOUT_JIRA_PROJECT_KEY = 'WPO';
const PARTNER_PAYOUT_JIRA_ISSUE_TYPE = 'Payout';

export interface PayoutReferralRow {
  id: string;
  job_id: string | null;
  order_amount_kzt: number | null;
  client_discount_applied_kzt: number | null;
  commission_base_kzt: number | null;
  commission_rate: number | null;
  commission_kzt: number | null;
  confirmed_at: string | null;
}

export interface CreatePayoutIssueParams {
  payoutId: string;
  partnerName: string;
  partnerType: string;
  referralCode: string;
  partnerId: string;
  periodStart: string;
  periodEnd: string;
  referralsCount: number;
  grossOrderAmountKzt: number;
  totalClientDiscountKzt: number;
  totalCommissionBaseKzt: number;
  totalCommissionAmountKzt: number;
  referrals: PayoutReferralRow[];
}

export interface JiraPayoutIssueResult {
  issueId: string;
  issueKey: string;
  issueUrl: string;
}

async function jiraFetch(path: string, options: RequestInit): Promise<Response> {
  const creds = getJiraCredentials();
  if (!creds) throw new Error('Jira not configured — set JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN');
  return fetch(`${creds.baseUrl}/rest/api/3${path}`, {
    ...options,
    headers: {
      Authorization: makeAuthHeader(creds),
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(options.headers as Record<string, string> ?? {}),
    },
  });
}

function fmtKzt(n: number | null | undefined): string {
  if (n == null) return '—';
  return n.toLocaleString('ru-RU') + ' ₸';
}

function fmtPct(rate: number | null | undefined): string {
  if (rate == null) return '—';
  return (rate * 100).toFixed(1) + '%';
}

function para(text: string) {
  return {
    type: 'paragraph',
    content: text ? [{ type: 'text', text }] : [],
  };
}

function heading(text: string, level: 2 | 3) {
  return { type: 'heading', attrs: { level }, content: [{ type: 'text', text }] };
}

function buildPayoutIssueAdf(params: CreatePayoutIssueParams): object {
  const period = `${params.periodStart} — ${params.periodEnd}`;
  const yearMonth = params.periodStart.slice(0, 7);

  const tableRows = [
    {
      type: 'tableRow',
      content: [
        'Referral ID', 'Order ID', 'Order amount', 'Client discount',
        'Commission base', 'Rate', 'Commission', 'Confirmed at',
      ].map((h) => ({
        type: 'tableHeader',
        attrs: {},
        content: [para(h)],
      })),
    },
    ...params.referrals.map((r) => ({
      type: 'tableRow',
      content: [
        r.id.slice(0, 8) + '…',
        r.job_id ? r.job_id.slice(0, 8) + '…' : '—',
        fmtKzt(r.order_amount_kzt),
        fmtKzt(r.client_discount_applied_kzt),
        fmtKzt(r.commission_base_kzt),
        fmtPct(r.commission_rate),
        fmtKzt(r.commission_kzt),
        r.confirmed_at ? r.confirmed_at.slice(0, 10) : '—',
      ].map((cell) => ({
        type: 'tableCell',
        attrs: {},
        content: [para(String(cell))],
      })),
    })),
  ];

  return {
    type: 'doc',
    version: 1,
    content: [
      heading('Partner payout', 2),
      para(''),

      heading('1. Partner', 3),
      para(`Partner name: ${params.partnerName}`),
      para(`Partner type: ${params.partnerType}`),
      para(`Referral code: ${params.referralCode}`),
      para(`Partner ID: ${params.partnerId}`),
      para(''),

      heading('2. Period', 3),
      para(`Period: ${period}`),
      para(`Period start: ${params.periodStart}`),
      para(`Period end: ${params.periodEnd}`),
      para(''),

      heading('3. Summary', 3),
      para(`Number of included orders: ${params.referralsCount}`),
      para(`Gross order amount: ${fmtKzt(params.grossOrderAmountKzt)}`),
      para(`Total client discount: ${fmtKzt(params.totalClientDiscountKzt)}`),
      para(`Total commission base: ${fmtKzt(params.totalCommissionBaseKzt)}`),
      para(`Total commission amount to pay: ${fmtKzt(params.totalCommissionAmountKzt)}`),
      para(`Currency: KZT`),
      para(''),

      heading('4. Included orders', 3),
      {
        type: 'table',
        attrs: { isNumberColumnEnabled: false, layout: 'default' },
        content: tableRows,
      },
      para(''),

      heading('5. Manual payout warning', 3),
      para(
        'This payout is not an automatic bank transfer. ' +
        'Accounting/operator must verify refunds, disputes, tax/legal documents, ' +
        'and partner payment details before sending money.',
      ),
      para(''),

      heading('6. Payment checklist', 3),
      para(`Period: ${period} (${yearMonth})`),
      para('[ ] Check partner legal/payment details'),
      para('[ ] Check refunds/cancellations for the period'),
      para('[ ] Check chargebacks/disputes'),
      para(`[ ] Confirm total amount: ${fmtKzt(params.totalCommissionAmountKzt)}`),
      para('[ ] Pay manually via bank transfer'),
      para(`[ ] Run: npm run partners:mark-paid -- --payout-id=${params.payoutId} --payment-reference="<bank reference>"`),
    ],
  };
}

/**
 * Create a Jira Payout issue in the WPO project.
 * Project key and issue type are hardcoded — not env-configurable.
 * Retries without labels if Jira rejects the labels field.
 * Throws if Jira is not configured or issue creation fails.
 */
export async function createPayoutIssue(
  params: CreatePayoutIssueParams,
): Promise<JiraPayoutIssueResult> {
  const creds = getJiraCredentials();
  if (!creds) throw new Error('Jira not configured — set JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN');

  const yearMonth = params.periodStart.slice(0, 7);
  const summary = `Partner payout — ${params.partnerName} — ${yearMonth}`;
  const labels = ['partner-payout', 'payout', `payout-${yearMonth}`];

  const baseFields = {
    project: { key: PARTNER_PAYOUT_JIRA_PROJECT_KEY },
    issuetype: { name: PARTNER_PAYOUT_JIRA_ISSUE_TYPE },
    summary,
    description: buildPayoutIssueAdf(params),
  };

  console.log(
    `[jira/payout] Creating issue: project=${PARTNER_PAYOUT_JIRA_PROJECT_KEY} ` +
    `type=${PARTNER_PAYOUT_JIRA_ISSUE_TYPE} partner=${params.partnerName} period=${yearMonth}`,
  );

  let res = await jiraFetch('/issue', {
    method: 'POST',
    body: JSON.stringify({ fields: { ...baseFields, labels } }),
  });

  if (!res.ok && res.status === 400) {
    const errText = await res.text().catch(() => '');
    console.warn(
      `[jira/payout] 400 with labels (partner=${params.partnerName}): ${errText.slice(0, 200)} — retrying without labels`,
    );
    res = await jiraFetch('/issue', {
      method: 'POST',
      body: JSON.stringify({ fields: baseFields }),
    });
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(
      `Jira createPayoutIssue failed: ${res.status} — ${errText.slice(0, 300)}`,
    );
  }

  const data = (await res.json()) as { id: string; key: string };
  const issueUrl = `${creds.baseUrl}/browse/${data.key}`;
  console.log(`[jira/payout] Issue created: ${data.key} (${issueUrl})`);
  return { issueId: data.id, issueKey: data.key, issueUrl };
}

/**
 * Add a "marked as paid" comment to the Jira Payout issue.
 * Failure is logged but must not rollback the DB update.
 */
export async function addPayoutPaidComment(
  issueKey: string,
  paymentReference: string,
  paidAt: string,
): Promise<void> {
  const creds = getJiraCredentials();
  if (!creds) {
    console.log('[jira/payout] Jira not configured — skipping paid comment');
    return;
  }

  const body = {
    type: 'doc',
    version: 1,
    content: [
      {
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text: `Payout marked as paid. Payment reference: ${paymentReference}. Paid at: ${paidAt}.`,
          },
        ],
      },
    ],
  };

  const res = await jiraFetch(`/issue/${issueKey}/comment`, {
    method: 'POST',
    body: JSON.stringify({ body }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Jira addPayoutPaidComment failed: ${res.status} — ${errText.slice(0, 200)}`);
  }

  console.log(`[jira/payout] Paid comment added to ${issueKey}`);
}

export { PARTNER_PAYOUT_JIRA_PROJECT_KEY, PARTNER_PAYOUT_JIRA_ISSUE_TYPE };
