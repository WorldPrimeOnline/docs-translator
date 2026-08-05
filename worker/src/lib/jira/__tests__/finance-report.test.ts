import { buildFinanceIssuePayload, buildFinanceSummary, getFinanceConfig, FINANCE_LABELS } from '../finance-report';

describe('buildFinanceSummary', () => {
  it('includes main issue key', () => {
    expect(buildFinanceSummary('WO-123')).toBe('Finance Report for WO-123');
  });
});

describe('getFinanceConfig', () => {
  const origEnv = { ...process.env };
  afterEach(() => {
    process.env = { ...origEnv };
  });

  it('defaults projectKey to WO', () => {
    delete process.env.JIRA_FINANCE_PROJECT_KEY;
    expect(getFinanceConfig().projectKey).toBe('WO');
  });

  it('defaults issueType to Story', () => {
    delete process.env.JIRA_FINANCE_ISSUE_TYPE;
    expect(getFinanceConfig().issueType).toBe('Story');
  });

  it('returns null securityLevelId when env not set', () => {
    delete process.env.JIRA_FINANCE_SECURITY_LEVEL_ID;
    expect(getFinanceConfig().securityLevelId).toBeNull();
  });

  it('returns null for empty JIRA_FINANCE_SECURITY_LEVEL_ID', () => {
    process.env.JIRA_FINANCE_SECURITY_LEVEL_ID = '';
    expect(getFinanceConfig().securityLevelId).toBeNull();
  });

  it('returns securityLevelId when env is set', () => {
    process.env.JIRA_FINANCE_SECURITY_LEVEL_ID = '10001';
    expect(getFinanceConfig().securityLevelId).toBe('10001');
  });

  it('returns default labels', () => {
    delete process.env.JIRA_FINANCE_LABELS;
    expect(getFinanceConfig().labels).toEqual(['wpo-finance', 'confidential', 'internal-finance']);
  });

  it('custom labels are split by comma', () => {
    process.env.JIRA_FINANCE_LABELS = 'custom-a,custom-b';
    expect(getFinanceConfig().labels).toEqual(['custom-a', 'custom-b']);
  });
});

describe('buildFinanceIssuePayload', () => {
  const baseParams = {
    jobId: 'job-uuid-1',
    mainIssueKey: 'WO-123',
    quoteId: 'quote-uuid-1',
    serviceLevel: 'electronic',
    sourceLanguage: 'ru',
    targetLanguage: 'en',
    documentType: 'passport_id',
    pricingResult: null,
    paymentTransactionId: null,
    paymentAmountKzt: null,
    paymentStatus: null,
    fiscalStatus: null,
    fiscalReceiptId: null,
    customerComment: null,
  };

  const origEnv = { ...process.env };
  afterEach(() => {
    process.env = { ...origEnv };
  });

  it('does NOT include security field when JIRA_FINANCE_SECURITY_LEVEL_ID is not set', () => {
    delete process.env.JIRA_FINANCE_SECURITY_LEVEL_ID;
    const payload = buildFinanceIssuePayload(baseParams);
    expect((payload.fields as Record<string, unknown>).security).toBeUndefined();
  });

  it('includes security field when JIRA_FINANCE_SECURITY_LEVEL_ID is set', () => {
    process.env.JIRA_FINANCE_SECURITY_LEVEL_ID = '10001';
    const payload = buildFinanceIssuePayload(baseParams);
    expect((payload.fields as Record<string, unknown>).security).toEqual({ id: '10001' });
  });

  describe('staging Jira Admin security level (2026-08-01) — staging always wins', () => {
    it('staging + no JIRA_FINANCE_SECURITY_LEVEL_ID: forces the hardcoded Admin level', () => {
      process.env.APP_ENV = 'staging';
      delete process.env.JIRA_FINANCE_SECURITY_LEVEL_ID;
      const payload = buildFinanceIssuePayload(baseParams);
      expect((payload.fields as Record<string, unknown>).security).toEqual({ id: '10000' });
    });

    it('staging + JIRA_FINANCE_SECURITY_LEVEL_ID also set: Admin still wins, the finance-specific level is ignored', () => {
      process.env.APP_ENV = 'staging';
      process.env.JIRA_FINANCE_SECURITY_LEVEL_ID = '10001';
      const payload = buildFinanceIssuePayload(baseParams);
      expect((payload.fields as Record<string, unknown>).security).toEqual({ id: '10000' });
    });

    it('production + no JIRA_FINANCE_SECURITY_LEVEL_ID: security field absent — unchanged prior behavior', () => {
      process.env.APP_ENV = 'production';
      delete process.env.JIRA_FINANCE_SECURITY_LEVEL_ID;
      const payload = buildFinanceIssuePayload(baseParams);
      expect('security' in (payload.fields as Record<string, unknown>)).toBe(false);
    });

    it('production + JIRA_FINANCE_SECURITY_LEVEL_ID set: uses the configured level, not Admin — unchanged prior behavior', () => {
      process.env.APP_ENV = 'production';
      process.env.JIRA_FINANCE_SECURITY_LEVEL_ID = '10001';
      const payload = buildFinanceIssuePayload(baseParams);
      expect((payload.fields as Record<string, unknown>).security).toEqual({ id: '10001' });
    });
  });

  it('includes all required labels', () => {
    delete process.env.JIRA_FINANCE_LABELS;
    const payload = buildFinanceIssuePayload(baseParams);
    const labels = (payload.fields as Record<string, unknown>).labels as string[];
    expect(labels).toContain('wpo-finance');
    expect(labels).toContain('confidential');
    expect(labels).toContain('internal-finance');
  });

  it('sets project key to WO by default', () => {
    delete process.env.JIRA_FINANCE_PROJECT_KEY;
    const payload = buildFinanceIssuePayload(baseParams);
    expect((payload.fields as Record<string, unknown>).project).toEqual({ key: 'WO' });
  });

  it('sets issue type to Story by default', () => {
    delete process.env.JIRA_FINANCE_ISSUE_TYPE;
    const payload = buildFinanceIssuePayload(baseParams);
    expect((payload.fields as Record<string, unknown>).issuetype).toEqual({ name: 'Story' });
  });

  it('summary contains main issue key', () => {
    const payload = buildFinanceIssuePayload(baseParams);
    expect((payload.fields as Record<string, unknown>).summary).toContain('WO-123');
  });

  it('description mentions INTERNAL USE ONLY', () => {
    const payload = buildFinanceIssuePayload(baseParams);
    const desc = JSON.stringify((payload.fields as Record<string, unknown>).description);
    expect(desc).toContain('INTERNAL USE ONLY');
  });

  it('description contains job ID', () => {
    const payload = buildFinanceIssuePayload(baseParams);
    const desc = JSON.stringify((payload.fields as Record<string, unknown>).description);
    expect(desc).toContain('job-uuid-1');
  });

  it('description contains customer comment when provided', () => {
    const params = { ...baseParams, customerComment: 'Test comment from client' };
    const payload = buildFinanceIssuePayload(params);
    const desc = JSON.stringify((payload.fields as Record<string, unknown>).description);
    expect(desc).toContain('Test comment from client');
  });

  it('description shows не указан when no customer comment', () => {
    const payload = buildFinanceIssuePayload(baseParams);
    const desc = JSON.stringify((payload.fields as Record<string, unknown>).description);
    expect(desc).toContain('не указан');
  });

  it('description is ADF format with version 1', () => {
    const payload = buildFinanceIssuePayload(baseParams);
    const desc = (payload.fields as Record<string, unknown>).description as Record<string, unknown>;
    expect(desc.version).toBe(1);
    expect(desc.type).toBe('doc');
    expect(Array.isArray(desc.content)).toBe(true);
  });

  it('renders pricing result when provided', () => {
    const params = {
      ...baseParams,
      pricingResult: {
        amountKzt: 5500,
        currency: 'KZT',
        status: 'quoted',
        pricingVersionId: 'v1',
        pricingVersionCode: '2026-Q3-KZ-MVP',
        requiresOperatorReview: false,
        reviewReasons: [],
        items: [{ itemType: 'base_minimum', label: 'Base', quantity: 1, unitPriceKzt: 5500, amountKzt: 5500, isClientVisible: true, isCost: false, sortOrder: 1 }],
        internalCosts: { taxReserve: 165, acquiringFee: 138, riskReserve: 275, ownerReserve: 385, marketingReserve: 550, partnerCommission: 0, aiItReserve: 100, translatorReserved: 1650, notaryFee: 0, notaryCoordinationInternalCostKzt: 0, courierCost: 0, printingCost: 0 },
        margin: { grossRevenue: 5500, totalCosts: 3263, targetProfit: 550, estimatedMarginKzt: 2237, estimatedMarginRate: 0.407 },
        context: { languagePair: 'ru → en', baseMinimumKzt: 5500, extraWords: 0, additionalPages: 0, documentCoefficient: 1.0, urgencyCoefficient: 1.0, includedWordCount: 250, includedPageCount: 1 },
      },
    };
    const payload = buildFinanceIssuePayload(params);
    const desc = JSON.stringify((payload.fields as Record<string, unknown>).description);
    expect(desc).toContain('5'); // amount present
    expect(desc).toContain('2026-Q3-KZ-MVP');
    expect(desc).toContain('CONFIDENTIAL');
  });

  it('FINANCE_LABELS export is correct', () => {
    expect(FINANCE_LABELS).toContain('wpo-finance');
    expect(FINANCE_LABELS).toContain('confidential');
    expect(FINANCE_LABELS).toContain('internal-finance');
  });
});
