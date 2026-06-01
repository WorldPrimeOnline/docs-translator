import type { DocumentType } from './types';

export const DOCUMENT_TYPE_PROMPTS: Record<DocumentType, string> = {
  passport_id: `DOCUMENT TYPE: Passport / ID Card

Additional rules:
1. Prioritize exact preservation of: full name, surname, given names, patronymic/middle name, date of birth, place of birth, nationality, citizenship, sex/gender, document number, personal identification number, issuing authority, date of issue, date of expiry.
2. Transliterate names using passport-style transliteration where possible. Do not translate names semantically.
3. Preserve MRZ lines exactly if present.
4. Preserve all Latin-script names exactly as written.
5. For fields, use a key-value table.
6. If there is a photo, mark it as [photo].
7. Do not create a document that resembles a replacement identity card. This is a translation layout only.

Preferred output structure:
- Document title
- Personal details (key-value table)
- Document details (key-value table)
- Issuing authority
- Validity
- Machine-readable zone if present
- Notes about photo / signature / stamps`,

  diploma_transcript: `DOCUMENT TYPE: Diploma / Transcript / Academic Record

Additional rules:
1. Preserve: student full name, institution name, faculty/school/department, degree title, specialization/major, academic program, dates of study, graduation date, diploma number, registration number, grades, credits, GPA, academic hours.
2. Translate academic terms accurately and formally.
3. If an institution name has no official equivalent, transliterate it and keep the original in parentheses.
4. Do not convert grades to another grading system.
5. Do not interpret GPA or provide equivalency statements.
6. Preserve all tables with subjects, credits, grades, and hours.
7. If a grade scale is present, translate it without changing values.
8. Preserve honors/distinction wording carefully.
9. Mark signatures and stamps: [signature of Rector], [signature of Dean], [stamp of institution].
10. Do not state that the diploma is equivalent to any foreign degree.

Preferred output structure:
- Institution
- Student information
- Program / degree information
- Academic results table
- Grade scale if present
- Document issue details
- Signatures and stamps`,

  contract: `DOCUMENT TYPE: Contract / Agreement

Additional rules:
1. Preserve legal structure exactly: title, parties, recitals, definitions, numbered clauses, subclauses, annexes, signatures.
2. Translate legal terms formally and consistently.
3. Do not simplify legal language.
4. Do not summarize clauses.
5. Do not remove repeated legal wording.
6. Preserve all obligations, rights, deadlines, penalties, amounts, payment terms, governing law, jurisdiction, addresses, and signatures.
7. If a term is defined with capitalization, maintain capitalization consistency throughout.
8. Do not provide legal interpretation.
9. If a clause wording is unclear, translate literally and add [unclear wording] only if necessary.
10. Preserve annex references exactly.
11. Do not alter liability, payment, termination, confidentiality, or dispute resolution clauses.

Preferred output structure:
- Contract title
- Parties
- Definitions
- Clauses (numbered)
- Annexes
- Signature block`,

  bank_statement: `DOCUMENT TYPE: Bank Statement / Financial Statement

Additional rules:
1. Preserve all financial data exactly: account holder name, bank name, account number, IBAN, SWIFT/BIC, statement period, opening balance, closing balance, transaction dates, transaction descriptions, debit amounts, credit amounts, currencies, fees, reference numbers.
2. Do not convert currencies.
3. Do not recalculate balances.
4. Do not correct arithmetic.
5. Preserve transaction tables as tables.
6. Translate transaction descriptions only where they are natural language. Preserve merchant names, reference codes, and abbreviations.
7. Keep negative amounts, plus signs, decimal separators, and currency symbols exactly as they appear.
8. Mark bank stamps, QR codes, and digital signatures with neutral markers.
9. Do not provide financial advice.
10. Do not infer source of funds or account status.

Preferred output structure:
- Bank details
- Account holder details
- Statement period
- Account summary (opening/closing balance)
- Transaction table
- Stamps / signatures / QR codes`,

  medical_document: `DOCUMENT TYPE: Medical Certificate / Medical Record

Additional rules:
1. Preserve: patient full name, date of birth, ID/passport number, clinic/hospital name, doctor name, diagnosis, symptoms, test results, medications, dosage, dates, medical codes, certificate number.
2. Translate medical terminology accurately and neutrally.
3. Do not add explanations to diagnoses.
4. Do not interpret test results.
5. Do not provide medical advice.
6. Preserve Latin medical terms where appropriate.
7. Preserve medication names exactly; translate dosage instructions only.
8. Preserve units exactly: mg, ml, mmol/L, g/L, IU, %, etc.
9. If handwriting is unreadable, mark [illegible].
10. Mark doctor signatures and stamps with neutral markers.

Preferred output structure:
- Medical institution
- Patient information
- Medical findings / diagnosis
- Test results
- Treatment / recommendations if present
- Issue details
- Doctor signature and stamp`,

  employment_document: `DOCUMENT TYPE: Employment Contract / Employment Record / Labor Book

Additional rules:
1. Preserve: employee full name, employer name, position/job title, department, employment start date, employment end date, salary/compensation, work schedule, duties, order numbers, HR record numbers, dismissal reason, legal references.
2. Translate job titles formally.
3. Do not reinterpret seniority, employment status, or legal grounds.
4. Preserve all dates and order numbers.
5. Preserve tables in labor book records.
6. Translate official HR wording carefully and literally where needed.
7. Mark stamps and signatures with neutral markers.
8. Do not provide legal advice about employment status.
9. If the document is a labor book, preserve the chronological record order exactly.

Preferred output structure:
- Employee information
- Employer information
- Employment details
- Position and duties
- Salary / compensation if present
- HR orders / labor book records
- Signatures and stamps`,

  police_clearance: `DOCUMENT TYPE: Police Clearance Certificate / Criminal Record Certificate

Additional rules:
1. Preserve: full name, date of birth, place of birth, citizenship, ID/passport number, certificate number, issuing authority, issue date, validity period if present, criminal record status wording.
2. Translate the result/status wording with extreme care. Do not soften or strengthen the meaning.
3. If the certificate states "no criminal record", translate exactly.
4. If the certificate states "not registered", "not convicted", "no information found", or similar, preserve the exact legal meaning.
5. Do not infer criminal history.
6. Preserve official authority names.
7. Mark stamps, QR codes, and signatures with neutral markers.
8. Keep the translation suitable for visa and immigration workflows.

Preferred output structure:
- Certificate title
- Person information (key-value table)
- Certificate statement
- Issuing authority
- Date and reference number
- Verification elements (stamps, QR codes, signatures)`,

  driver_license: `DOCUMENT TYPE: Driver's License

Additional rules:
1. Preserve: full name, date of birth, place of birth, license number, issuing authority, issue date, expiry date, vehicle categories, restrictions, country/region.
2. Preserve license categories exactly: A, A1, B, B1, C, C1, D, D1, BE, CE, DE, etc.
3. Do not reinterpret driving rights.
4. Do not convert categories into another country's system.
5. Use a key-value table for fields.
6. Mark photo, signature, stamps, and QR/barcode with neutral markers.
7. Preserve all numeric codes and restriction codes.
8. Do not imply international driving validity.

Preferred output structure:
- Driver information (key-value table)
- License details
- Vehicle categories
- Restrictions
- Validity
- Photo / signature / stamps`,

  presentation: `DOCUMENT TYPE: Presentation / PowerPoint / Pitch Deck

Additional rules:
1. Translate slide-by-slide. Preserve slide order exactly.
2. Preserve: slide titles, subtitles, bullets, captions, chart labels, axis labels, legends, table content, speaker notes if provided.
3. Keep translated text concise. Presentations require natural, readable wording — not heavy literal translation.
4. Preserve brand names, product names, slogans, metrics, numbers, percentages, dates, and financial figures exactly.
5. Do not change business meaning.
6. Do not invent missing context.
7. For marketing slogans, translate naturally while preserving intent.
8. For investor decks, keep business terminology professional and concise.
9. For chart labels and table content, preserve the original structure.
10. For images, diagrams, icons, or screenshots, describe only if OCR extracted visible text from them; otherwise mark [image].
11. Do not translate company names unless there is an official localized name.
12. Keep slide text short enough to fit visually into a slide. If a translated phrase becomes too long, provide a concise version.
13. Preserve tone: formal for business decks, persuasive for sales decks, educational for training decks, neutral for internal presentations.

OUTPUT FORMAT for presentations:
Return the translation in this exact structure:

# Slide 1
## Title
[translated title]

## Body
[translated body text]

## Notes
[translated speaker notes if present, otherwise omit this section]

# Slide 2
...

If a slide contains a table, output the translated table under the appropriate section.
If a slide contains chart labels, output them under "## Chart labels".
If text is unreadable, mark [illegible].`,

  other: `DOCUMENT TYPE: Generic Official Document / Other

Additional rules:
1. Preserve the document structure as closely as possible.
2. Identify the apparent document type from the content if possible, but do not guess if uncertain.
3. Translate all visible text accurately.
4. Preserve: names, dates, numbers, addresses, monetary values, official references, tables, stamps, signatures.
5. Use neutral official language.
6. Do not summarize.
7. Do not add legal, immigration, financial, or medical advice.
8. If the document contains mixed content, preserve section order.
9. If any part is unclear, mark [illegible] or [unclear].
10. Keep the output suitable for human translator review.

Preferred output structure:
- Document title if identifiable
- Main content
- Tables / key-value fields
- Notes on signatures, stamps, images`,
};
