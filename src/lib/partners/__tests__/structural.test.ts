/**
 * Structural correctness tests for the partner program MVP.
 *
 * Verifies:
 * 1. Footer legal section does NOT contain the partnerProgram link
 * 2. Header/Navbar DOES contain a Partners link
 * 3. RU partners.json does NOT use "бюро переводов" positioning
 * 4. RU partners.json DOES use "цифровая платформа" positioning
 * 5. partner-client.ts hardcodes project key WPO and issue type Partnership
 * 6. partner-client.ts does NOT reference JIRA_PARTNER_PROJECT_KEY or JIRA_PARTNER_ISSUE_TYPE env vars
 * 7. All 13 navigation.json files have nav.partners key
 */

import * as path from 'path';
import * as fs from 'fs';

const ROOT = path.resolve(__dirname, '../../../../');
const MESSAGES_DIR = path.join(ROOT, 'messages');
const LOCALES = ['en', 'ru', 'kk', 'zh', 'ko', 'tj', 'uz', 'tk', 'mn', 'ky', 'de', 'tr', 'es'];

// ── 1. Footer legal section must NOT contain partnerProgram link ──────────────

describe('layout.tsx — footer placement', () => {
  const layoutSource = fs.readFileSync(
    path.join(ROOT, 'src/app/[locale]/layout.tsx'),
    'utf-8',
  );

  it('legal docs section does not contain /partners href', () => {
    // Extract content between the legal nav opening tag and its closing tag
    const legalNavMatch = layoutSource.match(/footerHeading[\s\S]*?<\/nav>/);
    expect(legalNavMatch).not.toBeNull();
    const legalSection = legalNavMatch![0];
    expect(legalSection).not.toContain('href="/partners"');
    expect(legalSection).not.toContain("href='/partners'");
  });

  it('layout contains /partners link outside the legal nav (in Col 1)', () => {
    expect(layoutSource).toContain('href="/partners"');
  });
});

// ── 2. Navbar DOES contain partners link ──────────────────────────────────────

describe('navbar.tsx — partner program link', () => {
  const navbarSource = fs.readFileSync(
    path.join(ROOT, 'src/components/navbar.tsx'),
    'utf-8',
  );

  it('desktop nav contains /partners href', () => {
    expect(navbarSource).toContain('href="/partners"');
  });

  it('uses t("partners") for the partner link label', () => {
    expect(navbarSource).toContain("t('partners')");
  });
});

// ── 3 & 4. RU partners.json positioning copy ──────────────────────────────────

describe('messages/ru/partners.json — positioning copy', () => {
  const ruPartners = JSON.parse(
    fs.readFileSync(path.join(MESSAGES_DIR, 'ru', 'partners.json'), 'utf-8'),
  ) as { partnersPage: { hero: { subtitle: string } } };
  const subtitle = ruPartners.partnersPage.hero.subtitle;

  it('does NOT contain "бюро переводов"', () => {
    expect(subtitle.toLowerCase()).not.toContain('бюро переводов');
  });

  it('does NOT contain "бюро" in the hero subtitle', () => {
    expect(subtitle.toLowerCase()).not.toContain('бюро');
  });

  it('contains "цифровой платформы"', () => {
    expect(subtitle).toContain('цифровой платформы');
  });
});

// ── 5 & 6. partner-client.ts — hardcoded Jira constants ─────────────────────

describe('partner-client.ts — hardcoded Jira constants', () => {
  const clientSource = fs.readFileSync(
    path.join(ROOT, 'src/lib/jira/partner-client.ts'),
    'utf-8',
  );

  it('hardcodes PARTNER_JIRA_PROJECT_KEY = "WPO"', () => {
    expect(clientSource).toContain("PARTNER_JIRA_PROJECT_KEY = 'WPO'");
  });

  it('hardcodes PARTNER_JIRA_ISSUE_TYPE = "Partnership"', () => {
    expect(clientSource).toContain("PARTNER_JIRA_ISSUE_TYPE = 'Partnership'");
  });

  it('does NOT reference JIRA_PARTNER_PROJECT_KEY env var', () => {
    expect(clientSource).not.toContain('JIRA_PARTNER_PROJECT_KEY');
  });

  it('does NOT reference JIRA_PARTNER_ISSUE_TYPE env var', () => {
    expect(clientSource).not.toContain('JIRA_PARTNER_ISSUE_TYPE');
  });

  it('uses PARTNER_JIRA_PROJECT_KEY constant (not a literal "WO")', () => {
    // Ensure the old default fallback 'WO' is gone
    expect(clientSource).not.toContain("?? 'WO'");
  });
});

// ── 7. All 13 navigation.json files have nav.partners ────────────────────────

describe('navigation.json — nav.partners key in all locales', () => {
  for (const locale of LOCALES) {
    it(`${locale}/navigation.json has nav.partners`, () => {
      const filepath = path.join(MESSAGES_DIR, locale, 'navigation.json');
      const data = JSON.parse(fs.readFileSync(filepath, 'utf-8')) as {
        nav: Record<string, string | undefined>;
      };
      expect(typeof data.nav['partners']).toBe('string');
      expect((data.nav['partners'] ?? '').length).toBeGreaterThan(0);
    });
  }
});

// ── 8. No "bureau"/"бюро" in hero subtitles across any locale ────────────────

describe('partners.json — no "bureau" positioning in hero subtitles', () => {
  const BUREAU_PATTERNS = [/бюро переводов/i, /translation bureau/i, /Übersetzungsbüro/i, /бюрои/i, /бюросу/i];

  for (const locale of LOCALES) {
    it(`${locale}: hero.subtitle does not contain bureau language`, () => {
      const data = JSON.parse(
        fs.readFileSync(path.join(MESSAGES_DIR, locale, 'partners.json'), 'utf-8'),
      ) as { partnersPage: { hero: { subtitle: string } } };
      const subtitle = data.partnersPage.hero.subtitle;
      for (const pattern of BUREAU_PATTERNS) {
        expect(subtitle).not.toMatch(pattern);
      }
    });
  }
});
