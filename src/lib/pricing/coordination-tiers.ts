/**
 * Progressive WPO coordination on the translation portion for Official/Notary orders
 * (2026-08-04 pricing feature) — large orders no longer pay the flat 30% WPO
 * coordination rate on every page; pages beyond the first 5/10 are coordinated at a
 * lower rate, since coordinating a 20-page order isn't 4x the effort of a 5-page one.
 *
 * Only the WPO coordination fee (W) changes. Translation amount (T), OCR (O), notary
 * fee (N), courier (C), translator/notary/courier PAYOUTS, gross-up, channel reserve,
 * client discount, partner commission, and every other reserve are completely
 * untouched by this module — it only decides how W's translation-portion component is
 * split, never any other line item.
 *
 * Config lives in pricing_versions.metadata (existing JSONB column) — no new table,
 * no new migration for this alone. A version with no coordinationVolumeTiers (or a
 * malformed one) must price EXACTLY like before: parseCoordinationConfig() returns
 * null for tiers in that case, and the calculator's caller falls back to the flat
 * wpoCoordinationRate — see calculator.ts step 10.
 */
import { toDecimal, applyRate, roundToKopeks } from './money';

export interface CoordinationVolumeTier {
  fromPage: number;
  /** null = open-ended (the last tier). */
  upToPage: number | null;
  rate: number;
}

export interface CoordinationConfig {
  /** null when absent/malformed in metadata — caller must fall back to the flat rate. */
  translationTiers: CoordinationVolumeTier[] | null;
  notaryCoordinationRate: number | null;
  courierCoordinationRate: number | null;
}

export interface TranslationTierBreakdownEntry {
  fromPage: number;
  upToPage: number | null;
  pages: number;
  rate: number;
  ratePerPageKzt: number;
  translationAmountKzt: number;
  coordinationAmountKzt: number;
}

export interface TranslationCoordinationResult {
  totalKzt: number;
  /** Only tiers with pages > 0 — a small order never shows "0 pages @ 20%" noise. */
  tiers: TranslationTierBreakdownEntry[];
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Validates one tier entry from JSON. Never throws — returns null on anything
 * malformed so a bad metadata edit degrades to "no tiers" (flat-rate fallback),
 * never a crashed quote.
 */
function parseTier(raw: unknown): CoordinationVolumeTier | null {
  if (!isPlainObject(raw)) return null;
  const { fromPage, upToPage, rate } = raw;
  if (typeof fromPage !== 'number' || !Number.isFinite(fromPage) || fromPage < 0) return null;
  if (upToPage !== null && (typeof upToPage !== 'number' || !Number.isFinite(upToPage))) return null;
  if (typeof rate !== 'number' || !Number.isFinite(rate) || rate < 0 || rate > 1) return null;
  if (upToPage !== null && upToPage <= fromPage) return null;
  return { fromPage, upToPage, rate };
}

/**
 * Reads coordinationVolumeTiers / notaryCoordinationRate / courierCoordinationRate from
 * a pricing_versions.metadata object. Tiers must be sorted by fromPage ascending, start
 * at 0, be contiguous (each tier's fromPage === the previous tier's upToPage), and only
 * the LAST tier may have upToPage=null — any violation is treated as "no config" rather
 * than guessing a repair, so a malformed edit never silently misprices.
 */
export function parseCoordinationConfig(metadata: Record<string, unknown> | null | undefined): CoordinationConfig {
  const result: CoordinationConfig = { translationTiers: null, notaryCoordinationRate: null, courierCoordinationRate: null };
  if (!metadata) return result;

  const rawTiers = metadata.coordinationVolumeTiers;
  if (Array.isArray(rawTiers) && rawTiers.length > 0) {
    const parsed = rawTiers.map(parseTier);
    const allValid = parsed.every((t): t is CoordinationVolumeTier => t !== null);
    if (allValid) {
      const tiers = parsed as CoordinationVolumeTier[];
      const sorted = [...tiers].sort((a, b) => a.fromPage - b.fromPage);
      let contiguous = sorted[0]!.fromPage === 0;
      for (let i = 0; i < sorted.length - 1; i++) {
        if (sorted[i]!.upToPage !== sorted[i + 1]!.fromPage) { contiguous = false; break; }
      }
      const onlyLastIsOpenEnded = sorted.slice(0, -1).every((t) => t.upToPage !== null) && sorted[sorted.length - 1]!.upToPage === null;
      if (contiguous && onlyLastIsOpenEnded) {
        result.translationTiers = sorted;
      }
    }
  }

  const notaryRate = metadata.notaryCoordinationRate;
  if (typeof notaryRate === 'number' && Number.isFinite(notaryRate) && notaryRate >= 0 && notaryRate <= 1) {
    result.notaryCoordinationRate = notaryRate;
  }
  const courierRate = metadata.courierCoordinationRate;
  if (typeof courierRate === 'number' && Number.isFinite(courierRate) && courierRate >= 0 && courierRate <= 1) {
    result.courierCoordinationRate = courierRate;
  }

  return result;
}

/**
 * Slices `totalPages` across the configured tiers and applies each tier's own rate to
 * ITS slice of the translation amount (pagesInTier * ratePerPage), never to the whole
 * order. A tier's pages = clamp(min(totalPages, tier.upToPage ?? Infinity) - tier.fromPage, 0, ...)
 * — this is what correctly gives a 10.1-page order "5 @ 30% + 5 @ 25% + 0.1 @ 20%", and
 * what makes a 5.0-page order land in tier 1 ONLY (0 pages in tier 2/3), matching the
 * flat old-formula price exactly at and below the first tier boundary.
 */
export function computeTranslationCoordination(
  totalPages: number,
  ratePerPageKzt: number,
  tiers: CoordinationVolumeTier[],
): TranslationCoordinationResult {
  const entries: TranslationTierBreakdownEntry[] = [];
  let totalKzt = 0;

  for (const tier of tiers) {
    const upper = tier.upToPage ?? Infinity;
    const pages = Math.max(0, Math.min(totalPages, upper) - tier.fromPage);
    if (pages <= 0) continue;

    const translationAmountKzt = roundToKopeks(toDecimal(pages).times(ratePerPageKzt));
    const coordinationAmountKzt = applyRate(translationAmountKzt, tier.rate);
    totalKzt = toDecimal(totalKzt).plus(coordinationAmountKzt).toNumber();

    entries.push({
      fromPage: tier.fromPage,
      upToPage: tier.upToPage,
      pages,
      rate: tier.rate,
      ratePerPageKzt,
      translationAmountKzt,
      coordinationAmountKzt,
    });
  }

  return { totalKzt: roundToKopeks(totalKzt), tiers: entries };
}
