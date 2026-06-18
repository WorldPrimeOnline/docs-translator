/**
 * Deterministic heuristics to detect the effective document type when
 * the stored type is 'other' or 'generic_document'.
 * Does NOT modify documents.document_type in the database.
 */

interface HeuristicRule {
  type: string;
  patterns: RegExp[];
  minMatches: number;
}

const RULES: HeuristicRule[] = [
  {
    type: 'employment_document',
    patterns: [
      /employer|работодатель|работник|employee/i,
      /должность|position|title|job\s+title/i,
      /зарплата|salary|оклад|wage|income/i,
      /certificate of employment|справка.*работ|трудовой/i,
      /department|отдел|подразделение/i,
    ],
    minMatches: 2,
  },
  {
    type: 'diploma_transcript',
    patterns: [
      /диплом|diploma|degree|бакалавр|магистр|bachelor|master/i,
      /transcript|transcript|оценки|grades|credits|балл/i,
      /academic|академическ|qualification|квалификация/i,
      /institution|университет|college|university/i,
      /subject|предмет|discipline|дисциплина/i,
    ],
    minMatches: 2,
  },
  {
    type: 'bank_statement',
    patterns: [
      /account|счёт|счет|iban|расчётный|текущий счёт/i,
      /balance|баланс|остаток/i,
      /transaction|транзакция|операция|debit|credit/i,
      /bank|банк/i,
    ],
    minMatches: 2,
  },
  {
    type: 'contract',
    patterns: [
      /agreement|договор|контракт|соглашение/i,
      /parties|стороны|party|сторона/i,
      /clause|пункт|статья|article/i,
      /obligations|обязательства|права и обязанности/i,
    ],
    minMatches: 2,
  },
  {
    type: 'medical_document',
    patterns: [
      /diagnosis|диагноз|diagnos/i,
      /patient|пациент|больной/i,
      /лаборатор|laboratory|lab\s+result/i,
      /referenc.?range|норма|normal\s+range/i,
      /medication|лекарство|препарат/i,
    ],
    minMatches: 2,
  },
  {
    type: 'passport_id',
    patterns: [
      /passport|паспорт/i,
      /nationality|гражданство/i,
      /date of birth|дата рождения/i,
      /mrz|machine.readable|машиночитаемая/i,
      /document\s+number|номер документа/i,
    ],
    minMatches: 2,
  },
  {
    type: 'police_clearance',
    patterns: [
      /criminal|судимость|уголовн/i,
      /clearance|справка о несудимости/i,
      /police|полиция|mvd|мвд/i,
      /conviction|осуждение|приговор/i,
    ],
    minMatches: 2,
  },
];

/**
 * Detect effective document type from OCR markdown using keyword heuristics.
 * Returns the detected type, or 'generic_document' if no confident match.
 * Does NOT change documents.document_type in the DB.
 */
export function detectEffectiveDocumentType(ocrMarkdown: string): {
  effectiveType: string;
  confidence: 'high' | 'low';
} {
  let bestMatch: string | null = null;
  let bestScore = 0;

  for (const rule of RULES) {
    const matches = rule.patterns.filter(p => p.test(ocrMarkdown)).length;
    if (matches >= rule.minMatches && matches > bestScore) {
      bestScore = matches;
      bestMatch = rule.type;
    }
  }

  if (!bestMatch) {
    return { effectiveType: 'generic_document', confidence: 'low' };
  }

  return {
    effectiveType: bestMatch,
    confidence: bestScore >= 3 ? 'high' : 'low',
  };
}

/**
 * Resolve the effective document type for rendering.
 * Uses stored type unless it is 'other' or 'generic_document', in which case
 * heuristics are applied to the OCR text.
 */
export function resolveDocumentType(
  storedType: string,
  ocrMarkdown: string,
): string {
  if (storedType !== 'other' && storedType !== 'generic_document') {
    return storedType;
  }
  const { effectiveType } = detectEffectiveDocumentType(ocrMarkdown);
  return effectiveType;
}
