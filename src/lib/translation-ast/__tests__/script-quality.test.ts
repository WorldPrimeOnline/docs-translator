import { assessOcrQuality } from '@/lib/translation-ast/script-quality';

const latinDoc = 'This is a properly scanned document with real content and multiple words present here.';
const russianDoc = 'Это нормальный документ с достаточным количеством слов и символов для прохождения проверки качества.';
// 50 Chinese characters — valid CJK content
const chineseDoc = '这是一份正式文件，包含充分的中文内容用于测试质量检测系统是否正确处理中文字符。';
const arabicDoc = 'هذه وثيقة رسمية تحتوي على محتوى كافٍ من النصوص العربية لاختبار نظام الجودة بشكل صحيح.';
const hebrewDoc = 'זהו מסמך רשמי המכיל תוכן עברי מספיק לבדיקת מערכת בקרת האיכות בצורה תקינה.';
const thaiDoc = 'นี่คือเอกสารราชการที่มีเนื้อหาภาษาไทยเพียงพอสำหรับการทดสอบระบบตรวจสอบคุณภาพอย่างถูกต้อง';
const devanagariDoc = 'यह एक आधिकारिक दस्तावेज़ है जिसमें हिंदी सामग्री पर्याप्त मात्रा में मौजूद है।';

describe('assessOcrQuality', () => {
  describe('Latin script', () => {
    it('passes valid Latin document', () => {
      const r = assessOcrQuality(latinDoc, 'en');
      expect(r.pass).toBe(true);
      expect(r.scriptProfile.name).toBe('latin');
    });
    it('fails empty string', () => {
      expect(assessOcrQuality('').pass).toBe(false);
    });
    it('fails too-short string', () => {
      expect(assessOcrQuality('Hi', 'en').pass).toBe(false);
    });
    it('fails junk-heavy content', () => {
      const junk = '�'.repeat(100) + ' word word word word word word';
      expect(assessOcrQuality(junk, 'en').pass).toBe(false);
    });
  });

  describe('Cyrillic script', () => {
    it('passes valid Russian document', () => {
      const r = assessOcrQuality(russianDoc, 'ru');
      expect(r.pass).toBe(true);
      expect(r.scriptProfile.name).toBe('cyrillic');
    });
  });

  describe('CJK script — no false rejection', () => {
    it('passes Chinese document with charCount-based word estimate', () => {
      const r = assessOcrQuality(chineseDoc, 'zh');
      expect(r.pass).toBe(true);
      expect(r.scriptProfile.hasWordSpaces).toBe(false);
      // wordCountEstimate must be > 5
      expect(r.wordCountEstimate).toBeGreaterThan(5);
    });
    it('does NOT count Chinese chars as junk', () => {
      const r = assessOcrQuality(chineseDoc, 'zh');
      expect(r.junkRatio).toBeLessThan(0.01);
    });
    it('auto-detects Chinese without explicit lang hint', () => {
      const r = assessOcrQuality(chineseDoc);
      expect(r.scriptProfile.name).toBe('chinese');
    });
  });

  describe('Arabic script — no false rejection', () => {
    it('passes Arabic document', () => {
      const r = assessOcrQuality(arabicDoc, 'ar');
      expect(r.pass).toBe(true);
      expect(r.scriptProfile.direction).toBe('rtl');
    });
    it('does NOT count Arabic chars as junk', () => {
      const r = assessOcrQuality(arabicDoc, 'ar');
      expect(r.junkRatio).toBeLessThan(0.01);
    });
  });

  describe('Hebrew script — no false rejection', () => {
    it('passes Hebrew document', () => {
      const r = assessOcrQuality(hebrewDoc, 'he');
      expect(r.pass).toBe(true);
      expect(r.scriptProfile.direction).toBe('rtl');
    });
  });

  describe('Thai script — no false rejection', () => {
    it('passes Thai document', () => {
      const r = assessOcrQuality(thaiDoc, 'th');
      expect(r.pass).toBe(true);
      expect(r.scriptProfile.hasWordSpaces).toBe(false);
    });
    it('does NOT count Thai chars as junk', () => {
      const r = assessOcrQuality(thaiDoc, 'th');
      expect(r.junkRatio).toBeLessThan(0.01);
    });
  });

  describe('Devanagari script', () => {
    it('passes Hindi document', () => {
      const r = assessOcrQuality(devanagariDoc, 'hi');
      expect(r.pass).toBe(true);
      expect(r.scriptProfile.name).toBe('devanagari');
    });
  });

  describe('auto-detection without lang hint', () => {
    it('detects Arabic without hint', () => {
      expect(assessOcrQuality(arabicDoc).scriptProfile.name).toBe('arabic');
    });
    it('detects Hebrew without hint', () => {
      expect(assessOcrQuality(hebrewDoc).scriptProfile.name).toBe('hebrew');
    });
    it('detects Cyrillic without hint', () => {
      expect(assessOcrQuality(russianDoc).scriptProfile.name).toBe('cyrillic');
    });
  });

  describe('word count estimation', () => {
    it('uses char-based estimation for no-word-space scripts', () => {
      const r = assessOcrQuality(chineseDoc, 'zh');
      // chars / 2 for Chinese
      const expectedMin = Math.ceil((chineseDoc.replace(/\s+/g, '').length) / 2);
      expect(r.wordCountEstimate).toBeGreaterThanOrEqual(expectedMin - 1);
    });
    it('uses space-split for Latin', () => {
      const r = assessOcrQuality('one two three four five six seven', 'en');
      expect(r.wordCountEstimate).toBe(7);
    });
  });
});
