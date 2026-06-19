/**
 * @jest-environment node
 */

import { extractProtectedValues, restoreProtectedValues } from '../protected-values';

// ── round-trip helper ──────────────────────────────────────────────────────────

function roundTrip(text: string): string {
  const { protected: prot, entries } = extractProtectedValues(text);
  return restoreProtectedValues(prot, entries);
}

// ── BIC / SWIFT ────────────────────────────────────────────────────────────────

describe('BIC / SWIFT protection', () => {
  it('protects KCJBKZKX and restores it exactly', () => {
    const input = '| BIC | KCJBKZKX |';
    const { protected: prot, entries } = extractProtectedValues(input);
    expect(prot).not.toContain('KCJBKZKX');
    expect(entries).toHaveLength(1);
    expect(entries[0]!.value).toBe('KCJBKZKX');

    const restored = restoreProtectedValues(prot, entries);
    expect(restored).toContain('KCJBKZKX');
    expect(restored).not.toContain('KCJBKZKH');
  });

  it('simulates LLM corruption and still restores correctly', () => {
    const input = '| BIC | KCJBKZKX |';
    const { protected: prot, entries } = extractProtectedValues(input);

    // Simulate LLM "correcting" — it never sees the real value
    const corrupted = prot.replace('KCJBKZKX', 'KCJBKZKH');

    const restored = restoreProtectedValues(corrupted, entries);
    expect(restored).toContain('KCJBKZKX');
    expect(restored).not.toContain('KCJBKZKH');
  });

  it('round-trips a generic BIC code', () => {
    expect(roundTrip('SWIFT code: DEUTDEDB')).toContain('DEUTDEDB');
    expect(roundTrip('BIC: AAAABBCC123')).toContain('AAAABBCC123');
  });

  it('does not match short ISO country codes', () => {
    const { entries } = extractProtectedValues('Country: KAZ, Code: RU');
    // KAZ is 3 chars, RU is 2 — neither matches 8-char BIC pattern
    expect(entries.map(e => e.value)).not.toContain('KAZ');
    expect(entries.map(e => e.value)).not.toContain('RU');
  });
});

// ── IBAN / IIK ─────────────────────────────────────────────────────────────────

describe('IBAN / IIK protection', () => {
  it('protects and restores KZ IBAN', () => {
    expect(roundTrip('IIK: KZ559876543210123456')).toContain('KZ559876543210123456');
  });

  it('protects other IBAN formats', () => {
    expect(roundTrip('IBAN: DE89370400440532013000')).toContain('DE89370400440532013000');
  });
});

// ── IIN / BIN / digit sequences ────────────────────────────────────────────────

describe('IIN / BIN digit sequence protection', () => {
  it('protects 9-digit BIN', () => {
    expect(roundTrip('BIN: 047291638')).toContain('047291638');
  });

  it('protects 12-digit IIN (201240012345)', () => {
    expect(roundTrip('IIN: 201240012345')).toContain('201240012345');
  });

  it('protects 12-digit cert number (930208450176)', () => {
    expect(roundTrip('Cert: 930208450176')).toContain('930208450176');
  });

  it('does not protect short amounts', () => {
    const { entries } = extractProtectedValues('Amount: 500000 KZT');
    expect(entries.map(e => e.value)).not.toContain('500000');
  });
});

// ── Passport / ID numbers ──────────────────────────────────────────────────────

describe('Passport / ID number protection', () => {
  it('protects N-prefix passport number', () => {
    expect(roundTrip('Passport: N14720583')).toContain('N14720583');
  });
});

// ── Reference / verification codes ────────────────────────────────────────────

describe('Reference code protection', () => {
  it('protects SML order reference', () => {
    expect(roundTrip('Order: SML-2026-06-17-071')).toContain('SML-2026-06-17-071');
  });

  it('protects mixed verification code', () => {
    expect(roundTrip('Verification: SML-74-KZ-170626-Q8X5')).toContain('SML-74-KZ-170626-Q8X5');
  });

  it('protects Cyrillic-prefixed contract number', () => {
    expect(roundTrip('Договор: ТД-2020/0914-38')).toContain('ТД-2020/0914-38');
  });
});

// ── Full fixture round-trip ────────────────────────────────────────────────────

describe('Full fixture — all 9 protected values', () => {
  const FIXTURE = `
# Employment Certificate

| Field | Value |
|---|---|
| Order | SML-2026-06-17-071 |
| IIN | 201240012345 |
| IIK | KZ559876543210123456 |
| BIC | KCJBKZKX |
| BIN | 047291638 |
| Passport | N14720583 |
| Certificate | 930208450176 |
| Contract | ТД-2020/0914-38 |
| Verification | SML-74-KZ-170626-Q8X5 |
`;

  const EXPECTED_VALUES = [
    'SML-2026-06-17-071',
    '201240012345',
    'KZ559876543210123456',
    'KCJBKZKX',
    '047291638',
    'N14720583',
    '930208450176',
    'ТД-2020/0914-38',
    'SML-74-KZ-170626-Q8X5',
  ];

  it('extracts all 9 values as protected entries', () => {
    const { entries } = extractProtectedValues(FIXTURE);
    const values = entries.map(e => e.value);
    for (const expected of EXPECTED_VALUES) {
      expect(values).toContain(expected);
    }
  });

  it('replaces all values with tokens (no raw values in protected text)', () => {
    const { protected: prot, entries } = extractProtectedValues(FIXTURE);
    for (const { value } of entries) {
      expect(prot).not.toContain(value);
    }
  });

  it('restores all 9 values exactly', () => {
    const restored = roundTrip(FIXTURE);
    for (const expected of EXPECTED_VALUES) {
      expect(restored).toContain(expected);
    }
  });

  it('KCJBKZKX is preserved, KCJBKZKH never appears', () => {
    const restored = roundTrip(FIXTURE);
    expect(restored).toContain('KCJBKZKX');
    expect(restored).not.toContain('KCJBKZKH');
  });

  it('token count matches unique value count', () => {
    const { entries } = extractProtectedValues(FIXTURE);
    const tokens = new Set(entries.map(e => e.token));
    expect(tokens.size).toBe(entries.length);
  });
});

// ── Deduplication ──────────────────────────────────────────────────────────────

describe('Deduplication', () => {
  it('reuses the same token for repeated values', () => {
    const input = 'BIC: KCJBKZKX and again KCJBKZKX';
    const { protected: prot, entries } = extractProtectedValues(input);
    expect(entries).toHaveLength(1);
    // Both occurrences replaced with same token
    const token = entries[0]!.token;
    expect(prot.split(token).length - 1).toBe(2);
    expect(restoreProtectedValues(prot, entries)).toBe(input);
  });
});

// ── No false positives in typical prose ───────────────────────────────────────

describe('No false positives in typical document prose', () => {
  it('does not protect short ISO codes or country names', () => {
    const { entries } = extractProtectedValues(
      'Translation from Russian to Italian. Country: Kazakhstan (KAZ). Status: Valid.',
    );
    const values = entries.map(e => e.value);
    expect(values).not.toContain('KAZ');
    expect(values).not.toContain('Valid');
  });

  it('does not protect 6-digit amounts', () => {
    const { entries } = extractProtectedValues('Amount: 500000 KZT, tax: 55000 KZT');
    expect(entries).toHaveLength(0);
  });
});
