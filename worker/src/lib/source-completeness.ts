/**
 * Source-document completeness advisory checks.
 *
 * These warnings flag potential discrepancies in the source document itself —
 * NOT translation errors. They are advisory only and must never claim a
 * legal error as fact. All messages account for possible holidays, non-standard
 * schedules, and source document particularities.
 *
 * Never throws. Returns string[] of warning codes.
 */

export interface SourceWarning {
  code: string;
  message: string;
}

// ── Date parsing helpers ──────────────────────────────────────────────────────

/** Parse a date from common document formats: "17 June 2026", "June 17, 2026", "17.06.2026", "2026-06-17" */
function parseDocDate(text: string): Date | null {
  const MONTH_EN: Record<string, number> = {
    january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
    july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
  };
  const MONTH_RU: Record<string, number> = {
    января: 0, февраля: 1, марта: 2, апреля: 3, мая: 4, июня: 5,
    июля: 6, августа: 7, сентября: 8, октября: 9, ноября: 10, декабря: 11,
  };

  // ISO: 2026-06-17
  let m = text.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(+m[1]!, +m[2]! - 1, +m[3]!);

  // dd.mm.yyyy
  m = text.match(/(\d{2})\.(\d{2})\.(\d{4})/);
  if (m) return new Date(+m[3]!, +m[2]! - 1, +m[1]!);

  // "17 June 2026" or "17 июня 2026"
  m = text.match(/(\d{1,2})\s+([а-яёa-z]+)\s+(\d{4})/i);
  if (m) {
    const mo = (MONTH_EN[m[2]!.toLowerCase()] ?? MONTH_RU[m[2]!.toLowerCase()]);
    if (mo !== undefined) return new Date(+m[3]!, mo, +m[1]!);
  }

  // "June 17, 2026"
  m = text.match(/([a-zA-Z]+)\s+(\d{1,2}),?\s+(\d{4})/);
  if (m) {
    const mo = MONTH_EN[m[1]!.toLowerCase()];
    if (mo !== undefined) return new Date(+m[3]!, mo, +m[2]!);
  }

  return null;
}

/** Count inclusive calendar days between two dates (end - start + 1). */
function inclusiveCalendarDays(start: Date, end: Date): number {
  const ms = end.getTime() - start.getTime();
  return Math.round(ms / 86_400_000) + 1;
}

/** Count Mon–Fri working days between two dates (both inclusive). */
function approxWorkingDays(start: Date, end: Date): number {
  let count = 0;
  const d = new Date(start);
  while (d <= end) {
    const day = d.getDay();
    if (day !== 0 && day !== 6) count++;
    d.setDate(d.getDate() + 1);
  }
  return count;
}

// ── Source-level completeness checks ─────────────────────────────────────────

/**
 * Run advisory completeness checks on the OCR markdown.
 *
 * @param ocrMarkdown  Raw OCR output
 * @param ocrPageCount Page count returned by the OCR provider
 */
export function checkSourceCompleteness(
  ocrMarkdown: string,
  ocrPageCount: number,
): SourceWarning[] {
  const warnings: SourceWarning[] = [];

  // ── 1. Stated page count vs OCR page count ──────────────────────────────────
  // "Page X of Y" or "Страница X из Y" or "Количество страниц: N"
  const pageOfRe = /(?:page|страница)\s+\d+\s+(?:of|из)\s+(\d+)/i;
  const pageOfMatch = ocrMarkdown.match(pageOfRe);
  if (pageOfMatch) {
    const stated = parseInt(pageOfMatch[1]!, 10);
    if (!isNaN(stated) && stated !== ocrPageCount) {
      warnings.push({
        code: 'PAGE_COUNT_MISMATCH',
        message:
          `Document states ${stated} page(s) but OCR extracted ${ocrPageCount} page(s). ` +
          `The last page(s) may be missing from the scan.`,
      });
    }
  }

  // "Количество страниц: N" or "Number of pages: N"
  const pageCountRe = /(?:количество страниц|number of pages)[:\s]+(\d+)/i;
  const pageCountMatch = ocrMarkdown.match(pageCountRe);
  if (pageCountMatch) {
    const stated = parseInt(pageCountMatch[1]!, 10);
    if (!isNaN(stated) && stated !== ocrPageCount) {
      warnings.push({
        code: 'STATED_PAGE_COUNT_MISMATCH',
        message:
          `Document field states ${stated} page(s); OCR extracted ${ocrPageCount} page(s). ` +
          `Verify the upload includes all pages.`,
      });
    }
  }

  // ── 2. Validity date before travel date ────────────────────────────────────
  // Look for "Valid until: <date>" and "Departure date: <date>" / "First day: <date>"
  const validUntilRe = /(?:valid until|действителен до|срок действия)[:\s]+([^\n|;]+)/i;
  const departureDateRe = /(?:departure date|дата отъезда|first day|первый день)[:\s]+([^\n|;]+)/i;
  const validUntilMatch = ocrMarkdown.match(validUntilRe);
  const departureDateMatch = ocrMarkdown.match(departureDateRe);
  if (validUntilMatch && departureDateMatch) {
    const validUntil = parseDocDate(validUntilMatch[1]!.trim());
    const departureDate = parseDocDate(departureDateMatch[1]!.trim());
    if (validUntil && departureDate && validUntil < departureDate) {
      warnings.push({
        code: 'VALIDITY_BEFORE_DEPARTURE',
        message:
          `Document validity (${validUntilMatch[1]!.trim()}) appears to end before the declared ` +
          `departure date (${departureDateMatch[1]!.trim()}). This may be intentional depending on ` +
          `the document type and local requirements.`,
      });
    }
  }

  // ── 3. Calendar-day count vs. inclusive date range ─────────────────────────
  // Look for "First day: <date>", "Last day: <date>", "Calendar days: N"
  const firstDayRe = /(?:first day|первый день)[:\s]+([^\n|;]+)/i;
  const lastDayRe = /(?:last day|последний день)[:\s]+([^\n|;]+)/i;
  const calDaysRe = /(?:calendar days|календарных дней)[:\s]+(\d+)/i;

  const firstDayMatch = ocrMarkdown.match(firstDayRe);
  const lastDayMatch = ocrMarkdown.match(lastDayRe);
  const calDaysMatch = ocrMarkdown.match(calDaysRe);

  if (firstDayMatch && lastDayMatch && calDaysMatch) {
    const firstDay = parseDocDate(firstDayMatch[1]!.trim());
    const lastDay = parseDocDate(lastDayMatch[1]!.trim());
    const statedDays = parseInt(calDaysMatch[1]!, 10);
    if (firstDay && lastDay && !isNaN(statedDays)) {
      const computed = inclusiveCalendarDays(firstDay, lastDay);
      if (Math.abs(computed - statedDays) > 1) {
        warnings.push({
          code: 'CALENDAR_DAYS_MISMATCH',
          message:
            `Document states ${statedDays} calendar day(s), but the inclusive range ` +
            `${firstDayMatch[1]!.trim()} – ${lastDayMatch[1]!.trim()} ` +
            `spans ${computed} day(s). This may reflect a different counting convention ` +
            `(exclusive end, travel days excluded, etc.).`,
        });
      }
    }
  }

  // ── 4. Working-day count vs. Mon–Fri heuristic ─────────────────────────────
  const workDaysRe = /(?:working days|рабочих дней)[:\s]+(\d+)/i;
  const workDaysMatch = ocrMarkdown.match(workDaysRe);

  if (firstDayMatch && lastDayMatch && workDaysMatch) {
    const firstDay = parseDocDate(firstDayMatch[1]!.trim());
    const lastDay = parseDocDate(lastDayMatch[1]!.trim());
    const statedWork = parseInt(workDaysMatch[1]!, 10);
    if (firstDay && lastDay && !isNaN(statedWork)) {
      const approx = approxWorkingDays(firstDay, lastDay);
      // Allow ±3 days to accommodate holidays, half-days, regional schedules
      if (Math.abs(approx - statedWork) > 3) {
        warnings.push({
          code: 'WORKING_DAYS_DISCREPANCY',
          message:
            `Document states ${statedWork} working day(s); simple Mon–Fri count gives ~${approx}. ` +
            `Difference may be due to public holidays, individual schedule, or departure/return days.`,
        });
      }
    }
  }

  return warnings;
}
