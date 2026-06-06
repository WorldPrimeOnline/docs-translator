/**
 * Pure helper functions extracted from renderer.ts for testability.
 * These functions have no I/O or async dependencies.
 */

/**
 * Wrap bracket markers with visual-marker span (official/review mode).
 */
export function wrapMarkersOfficial(html: string): string {
  return html.replace(/\[([^\]]{1,80})\]/g, '<span class="visual-marker">[$1]</span>');
}

/**
 * Wrap bracket markers with legacy mark.marker (translation_only / debug mode).
 */
export function wrapMarkersLegacy(html: string): string {
  return html.replace(/\[([^\]]{1,80})\]/g, '<mark class="marker">[$1]</mark>');
}

/**
 * Wrap h2 sections in <section> with appropriate classes.
 */
export function wrapSections(html: string): string {
  const parts = html.split(/(?=<h2[^>]*>)/i);
  if (parts.length <= 1) return html;

  const result: string[] = [];
  for (const part of parts) {
    if (!/<h2/i.test(part)) {
      result.push(part);
      continue;
    }

    const h2TextMatch = /<h2[^>]*>([\s\S]*?)<\/h2>/i.exec(part);
    const h2Text = h2TextMatch ? h2TextMatch[1].replace(/<[^>]+>/g, '').toLowerCase() : '';

    let sectionClass = 'section';
    if (
      h2Text.includes('переводчик') ||
      h2Text.includes('translator') ||
      h2Text.includes('исполнитель') ||
      h2Text.includes('сведения о переводчике')
    ) {
      sectionClass = 'section certification-section';
    } else if (
      h2Text.includes('нетекстовых') ||
      h2Text.includes('non-text elements') ||
      h2Text.includes('visual elements')
    ) {
      sectionClass = 'section visual-elements-section';
    } else if (
      h2Text.includes('проверки') ||
      h2Text.includes('verification') ||
      h2Text.includes('электронной проверки')
    ) {
      sectionClass = 'section verification-section';
    }

    result.push(`<section class="${sectionClass}">${part}</section>`);
  }

  return result.join('');
}

/**
 * Classify tables by column count, adding appropriate CSS classes.
 */
export function classifyTables(html: string): string {
  return html.replace(/<table>([\s\S]*?)<\/table>/gi, (_match, inner: string) => {
    const firstRowMatch = /<tr[^>]*>([\s\S]*?)<\/tr>/i.exec(inner);
    if (!firstRowMatch) return `<table>${inner}</table>`;
    const firstRowCells = (firstRowMatch[1].match(/<t[dh][^>]*>/gi) ?? []).length;

    let tableClass = '';
    if (firstRowCells <= 2) {
      tableClass = 'kv-table';
    } else if (firstRowCells <= 6) {
      tableClass = 'data-table';
    } else {
      tableClass = 'data-table wide-table';
    }

    return `<table class="${tableClass}">${inner}</table>`;
  });
}
