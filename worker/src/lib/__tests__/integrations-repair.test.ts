/**
 * @jest-environment node
 *
 * Tests for the Drive/Jira backfill repair function (WO-75 incident follow-up).
 * All external dependencies (Supabase, Drive, R2, Jira) are mocked.
 */

// ─── Module mocks (must be before any imports) ────────────────────────────────

interface FakeJob {
  id: string;
  document_id: string;
  jira_issue_key: string | null;
  google_drive_folder_id: string | null;
  google_drive_folder_url: string | null;
  fulfillment_method: 'pickup' | 'delivery' | null;
  delivery_phone: string | null;
  delivery_address: string | null;
}

interface FakeDoc {
  id: string;
  file_key: string;
}

interface FakeTranslation {
  translated_docx_key: string | null;
  translated_preview_pdf_key: string | null;
}

let fakeJob: FakeJob;
let fakeDoc: FakeDoc;
let fakeTranslation: FakeTranslation | null;
const jobUpdates: Record<string, unknown>[] = [];

function makeQuery(table: string): unknown {
  const chain = {
    select: () => chain,
    eq: () => chain,
    order: () => chain,
    limit: () => chain,
    single: async () => {
      if (table === 'jobs') return { data: fakeJob, error: null };
      if (table === 'documents') return { data: fakeDoc, error: null };
      return { data: null, error: { message: 'not found' } };
    },
    maybeSingle: async () => {
      if (table === 'translations') return { data: fakeTranslation, error: null };
      return { data: null, error: null };
    },
    update: (payload: Record<string, unknown>) => {
      jobUpdates.push(payload);
      return { eq: async () => ({ data: null, error: null }) };
    },
  };
  return chain;
}

jest.mock('../supabase', () => ({
  supabase: { from: (table: string) => makeQuery(table) },
}));

const mockCreateOrderFolder = jest.fn();
const mockUploadFileToDrive = jest.fn();
const mockGetSubfolderId = jest.fn();
const mockIsDriveConfigured = jest.fn();

jest.mock('../google-drive', () => ({
  createOrderFolder: (...args: unknown[]) => mockCreateOrderFolder(...args),
  uploadFileToDrive: (...args: unknown[]) => mockUploadFileToDrive(...args),
  getSubfolderId: (...args: unknown[]) => mockGetSubfolderId(...args),
  isDriveConfigured: () => mockIsDriveConfigured(),
  DRIVE_SUBFOLDER_NAMES: {
    source: '01_SOURCE',
    aiDraft: '02_AI_DRAFT',
    translatorResult: '03_TRANSLATOR_RESULT',
    signatureStamp: '04_SIGNATURE_AND_STAMP',
    notary: '05_NOTARY',
    final: '06_FINAL',
  },
}));

const mockDownloadFile = jest.fn();
jest.mock('../r2', () => ({
  downloadFile: (...args: unknown[]) => mockDownloadFile(...args),
}));

const mockBackfillJiraOrderFields = jest.fn();
const mockGetPartnerApplicationId = jest.fn();
jest.mock('../integrations', () => ({
  backfillJiraOrderFields: (...args: unknown[]) => mockBackfillJiraOrderFields(...args),
  getPartnerApplicationId: (...args: unknown[]) => mockGetPartnerApplicationId(...args),
}));

import { repairOrderIntegrations } from '../integrations-repair';

beforeEach(() => {
  jobUpdates.length = 0;
  jest.clearAllMocks();
  fakeJob = {
    id: 'job-1',
    document_id: 'doc-1',
    jira_issue_key: 'WO-75',
    google_drive_folder_id: null,
    google_drive_folder_url: null,
    fulfillment_method: 'delivery',
    delivery_phone: '+7 701 799 5422',
    delivery_address: 'ул.Мынбаева 46, офис 511',
  };
  fakeDoc = { id: 'doc-1', file_key: 'documents/user/doc-1/original.pdf' };
  fakeTranslation = {
    translated_docx_key: 'documents/user/doc-1/translator_draft.docx',
    translated_preview_pdf_key: null,
  };
  mockIsDriveConfigured.mockReturnValue(true);
  mockBackfillJiraOrderFields.mockResolvedValue({ ok: true, updatedFields: ['documentsLink', 'deliveryPhone', 'deliveryAddress'], skippedFields: [] });
  mockGetPartnerApplicationId.mockResolvedValue(null); // no referral by default
});

describe('repairOrderIntegrations — dry run', () => {
  it('makes no Drive/R2/Jira write calls', async () => {
    const result = await repairOrderIntegrations('job-1', true);

    expect(mockCreateOrderFolder).not.toHaveBeenCalled();
    expect(mockUploadFileToDrive).not.toHaveBeenCalled();
    expect(mockBackfillJiraOrderFields).not.toHaveBeenCalled();
    expect(jobUpdates.length).toBe(0);

    expect(result.driveFolderCreated).toBe(true); // planned, not executed
    expect(result.filesUploaded.some((f) => f.includes('would upload'))).toBe(true);
    expect(result.jiraUpdatedFields.length).toBeGreaterThan(0);
  });

  it('reports missing Drive config without attempting anything', async () => {
    mockIsDriveConfigured.mockReturnValue(false);
    const result = await repairOrderIntegrations('job-1', true);
    expect(result.errors.some((e) => e.includes('not configured'))).toBe(true);
  });
});

describe('repairOrderIntegrations — apply', () => {
  it('creates the Drive folder, uploads files, and backfills Jira when nothing exists yet', async () => {
    mockCreateOrderFolder.mockResolvedValue({
      folderId: 'folder-1',
      folderUrl: 'https://drive.google.com/drive/folders/folder-1',
      subfolders: { source: 'src-1', aiDraft: 'ai-1', translatorResult: 't-1', signatureStamp: 's-1', notary: 'n-1', final: 'f-1' },
    });
    mockDownloadFile.mockResolvedValue(Buffer.from('fake'));
    mockUploadFileToDrive.mockResolvedValue('file-id');

    const result = await repairOrderIntegrations('job-1', false);

    expect(mockCreateOrderFolder).toHaveBeenCalledWith('job-1');
    expect(jobUpdates[0]).toMatchObject({ google_drive_folder_id: 'folder-1', google_drive_folder_url: 'https://drive.google.com/drive/folders/folder-1' });
    expect(result.filesUploaded).toContain('original');
    expect(result.filesUploaded).toContain('translator_draft.docx');
    expect(result.filesSkipped.some((f) => f.includes('preview.pdf'))).toBe(true); // no key on translation row
    expect(mockBackfillJiraOrderFields).toHaveBeenCalledWith('WO-75', {
      driveUrl: 'https://drive.google.com/drive/folders/folder-1',
      deliveryPhone: '+7 701 799 5422',
      deliveryAddress: 'ул.Мынбаева 46, офис 511',
      fulfillmentMethod: 'delivery',
      partnerApplicationId: null,
    });
  });

  it('backfills partnerApplicationId onto an existing issue when a referral resolves one', async () => {
    mockCreateOrderFolder.mockResolvedValue({
      folderId: 'folder-1',
      folderUrl: 'https://drive.google.com/drive/folders/folder-1',
      subfolders: { source: 'src-1', aiDraft: 'ai-1', translatorResult: 't-1', signatureStamp: 's-1', notary: 'n-1', final: 'f-1' },
    });
    mockDownloadFile.mockResolvedValue(Buffer.from('fake'));
    mockUploadFileToDrive.mockResolvedValue('file-id');
    mockGetPartnerApplicationId.mockResolvedValue('34c19be3-f501-4c24-894f-e46d22c229d9');

    await repairOrderIntegrations('job-1', false);

    expect(mockBackfillJiraOrderFields).toHaveBeenCalledWith('WO-75', expect.objectContaining({
      partnerApplicationId: '34c19be3-f501-4c24-894f-e46d22c229d9',
    }));
  });

  it('dry run reports partnerApplicationId as a field it would patch, without calling backfillJiraOrderFields', async () => {
    fakeJob.google_drive_folder_id = 'existing-folder';
    fakeJob.google_drive_folder_url = 'https://drive.google.com/drive/folders/existing-folder';
    mockGetSubfolderId.mockResolvedValue('existing-subfolder');
    mockGetPartnerApplicationId.mockResolvedValue('34c19be3-f501-4c24-894f-e46d22c229d9');

    const result = await repairOrderIntegrations('job-1', true);

    expect(mockBackfillJiraOrderFields).not.toHaveBeenCalled();
    expect(result.jiraUpdatedFields.some((f) => f.includes('partnerApplicationId'))).toBe(true);
  });

  it('is safe to rerun — skips folder creation when one already exists', async () => {
    fakeJob.google_drive_folder_id = 'existing-folder';
    fakeJob.google_drive_folder_url = 'https://drive.google.com/drive/folders/existing-folder';
    mockGetSubfolderId.mockResolvedValue('existing-subfolder');
    mockDownloadFile.mockResolvedValue(Buffer.from('fake'));
    mockUploadFileToDrive.mockResolvedValue('file-id');

    const result = await repairOrderIntegrations('job-1', false);

    expect(mockCreateOrderFolder).not.toHaveBeenCalled();
    expect(result.driveFolderAlreadyExisted).toBe(true);
    expect(jobUpdates.length).toBe(0); // no redundant DB write for the folder fields
  });

  it('does not crash when there is no jira_issue_key', async () => {
    fakeJob.jira_issue_key = null;
    mockCreateOrderFolder.mockResolvedValue({
      folderId: 'folder-1',
      folderUrl: 'https://drive.google.com/drive/folders/folder-1',
      subfolders: { source: 'src-1', aiDraft: 'ai-1', translatorResult: 't-1', signatureStamp: 's-1', notary: 'n-1', final: 'f-1' },
    });
    mockDownloadFile.mockResolvedValue(Buffer.from('fake'));
    mockUploadFileToDrive.mockResolvedValue('file-id');

    const result = await repairOrderIntegrations('job-1', false);
    expect(mockBackfillJiraOrderFields).not.toHaveBeenCalled();
    expect(result.errors.some((e) => e.includes('no jira_issue_key'))).toBe(true);
  });
});
