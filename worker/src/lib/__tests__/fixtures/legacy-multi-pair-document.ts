/**
 * Sanitized regression fixture for the legacy official pipeline.
 * Exercises 4-column key-value normalization and data-table preservation.
 *
 * This file belongs to tests only. Labels and values here must NOT
 * be referenced in any production logic.
 */

export const MULTI_PAIR_FIXTURE_MARKDOWN = `
# CERTIFICATE OF EMPLOYMENT

## EMPLOYER

| Employer name | LLP "Severny Most Logistik" | Certificate number | № SML-2026-06-17-071 |
|---|---|---|---|
| BIN | 201240012345 | Date of issue | June 17, 2026 |
| Legal address | Republic of Kazakhstan, Almaty | Basis for issuance | employee application |
| Telephone | +7 (727) 333-45-67 | Purpose | for submission upon request |
| Email | info@sml.kz | Number of pages | 2 (two) |
| Valid until | July 17, 2026 |  |  |

## EMPLOYEE

| Last name | Nurtayeva | Identity document | № 047291638 |
|---|---|---|---|
| First name | Adelia | Foreign passport number | N14720583 |
| Patronymic | Maratovna | Residential address | Almaty |
| Latin spelling | NURTAYEVA ADELIA |  |  |

## EMPLOYMENT

| Position | Lead Specialist | Contract type | Open-ended employment contract |
|---|---|---|---|
| Department | International Logistics | Work schedule | Full-time |
| Start date | September 14, 2020 | Work format | Combined |
| Contract number | ТД-2020/0914-38 | Employee status | Active employee |

## LEAVE

| First day | August 3, 2026 | Declared city of stay | Milan |
|---|---|---|---|
| Last day | August 21, 2026 | Departure date | August 2, 2026 |
| Calendar days | 19 | Return date | August 22, 2026 |
| Working days | 13 | First working day | August 24, 2026 |
| Country | Italian Republic |  |  |

## SALARY

| Calculation period | Base salary | Bonus | Compensation | Total gross amount | Amount payable |
|--------------------|-------------|-------|--------------|-------------------|----------------|
| March 2026 | 865 000,00 KZT | 95 000,00 KZT | 28 500,00 KZT | 988 500,00 KZT | 801 472,35 KZT |
| April 2026 | 865 000,00 KZT | 0,00 KZT | 28 500,00 KZT | 893 500,00 KZT | 724 618,10 KZT |
| May 2026 | 865 000,00 KZT | 127 500,00 KZT | 34 750,00 KZT | 1 027 250,00 KZT | 832 906,44 KZT |
`;

/** All values that MUST be present after normalization */
export const REQUIRED_VALUES = [
  'LLP "Severny Most Logistik"',
  'SML-2026-06-17-071',
  '047291638',
  'N14720583',
  '201240012345',
  'ТД-2020/0914-38',
  'Milan',
  'August 3, 2026',
  'July 17, 2026',
];

/** All labels that MUST be present after normalization */
export const REQUIRED_LABELS = [
  'Certificate number',
  'Identity document',
  'Contract type',
  'Declared city of stay',
];

/** Visual elements table fixture (4 columns — must NOT be normalized) */
export const VISUAL_TABLE_FIXTURE = `
| Source page | Element | Position | Representation in translation |
|---|---|---|---|
| 1 | Logo | header | Company logo |
| 1 | Watermark | centre | Watermark: "TRAINING SAMPLE" |
| 1 | Signature | lower left | Handwritten signature |
| 1 | Signature | lower right | Handwritten signature |
| 1 | Stamp/Seal | lower centre | Round company stamp |
| 1 | QR code | lower right | QR code |
`;

/** Expected column counts per table */
export const EXPECTED_TABLE_SHAPES = [
  { sectionName: 'EMPLOYER',    columns: 2, minDataRows: 6 },
  { sectionName: 'EMPLOYEE',    columns: 2, minDataRows: 4 },
  { sectionName: 'EMPLOYMENT',  columns: 2, minDataRows: 4 },
  { sectionName: 'LEAVE',       columns: 2, minDataRows: 5 },
  { sectionName: 'SALARY',      columns: 6, minDataRows: 3 },
];
