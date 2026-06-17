import { classifyVerificationItem } from '@/lib/translation-ast/verification-classifier';

describe('classifyVerificationItem', () => {
  it('empty string → unknown', () => {
    expect(classifyVerificationItem('')).toBe('unknown');
  });

  describe('URLs', () => {
    it('verification URL → verification_url', () => {
      expect(classifyVerificationItem('https://gov.kz/verify/doc/AB123')).toBe('verification_url');
    });
    it('URL with /check → verification_url', () => {
      expect(classifyVerificationItem('https://example.com/check/status')).toBe('verification_url');
    });
    it('URL with /auth → verification_url', () => {
      expect(classifyVerificationItem('https://portal.kz/auth/token')).toBe('verification_url');
    });
    it('plain URL → contact_url', () => {
      expect(classifyVerificationItem('https://www.ministry.gov.kz/contacts')).toBe('contact_url');
    });
    it('http URL → contact_url', () => {
      expect(classifyVerificationItem('http://example.com/about')).toBe('contact_url');
    });
  });

  describe('email', () => {
    it('valid email → email', () => {
      expect(classifyVerificationItem('info@ministry.gov.kz')).toBe('email');
    });
    it('email with subdomain → email', () => {
      expect(classifyVerificationItem('user@mail.example.co.uk')).toBe('email');
    });
  });

  describe('phone', () => {
    it('E.164 format → phone', () => {
      expect(classifyVerificationItem('+77011234567')).toBe('phone');
    });
    it('formatted phone → phone', () => {
      expect(classifyVerificationItem('+7 701 123-45-67')).toBe('phone');
    });
  });

  describe('IBAN', () => {
    it('German IBAN → iban', () => {
      expect(classifyVerificationItem('DE89370400440532013000')).toBe('iban');
    });
    it('KZ IBAN → iban', () => {
      expect(classifyVerificationItem('KZ75125KZT0000140996')).toBe('iban');
    });
  });

  describe('SWIFT/BIC', () => {
    it('8-char BIC → swift_bic', () => {
      expect(classifyVerificationItem('COBADEFF')).toBe('swift_bic');
    });
    it('11-char BIC → swift_bic', () => {
      expect(classifyVerificationItem('COBADEFFXXX')).toBe('swift_bic');
    });
  });

  describe('MRZ', () => {
    it('two MRZ lines → mrz', () => {
      const mrzTwoLines = 'P<KAZIVANOVA<<ANASTASIA<<<<<<<<<<<<<<<<<<<<<<\nAB1234567KAZ8501017F2601014<<<<<<<<<<<<<<<6';
      expect(classifyVerificationItem(mrzTwoLines)).toBe('mrz');
    });
    it('single long MRZ line → mrz', () => {
      expect(classifyVerificationItem('P<KAZIVANOVA<<ANASTASIA<<<<<<<<<<<<<<<<<<<<<<')).toBe('mrz');
    });
  });

  describe('document_number', () => {
    it('AB1234567 → document_number', () => {
      expect(classifyVerificationItem('AB1234567')).toBe('document_number');
    });
    it('KZ12345678 → document_number', () => {
      expect(classifyVerificationItem('KZ12345678')).toBe('document_number');
    });
  });

  describe('verification_code', () => {
    it('4-char alphanumeric code → verification_code', () => {
      expect(classifyVerificationItem('A1B2')).toBe('verification_code');
    });
    it('8-char code → verification_code', () => {
      expect(classifyVerificationItem('ABCD1234')).toBe('verification_code');
    });
  });

  describe('qr_payload', () => {
    it('long opaque string (>40 chars, no spaces) → qr_payload', () => {
      const payload = 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0';
      expect(classifyVerificationItem(payload)).toBe('qr_payload');
    });
  });

  describe('unknown', () => {
    it('random short text → unknown', () => {
      expect(classifyVerificationItem('hello world')).toBe('unknown');
    });
  });
});
