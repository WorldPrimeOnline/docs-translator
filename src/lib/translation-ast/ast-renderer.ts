import type {
  TranslationDocumentAst,
  TranslationBlock,
  ClauseBlock,
  ListItem,
  DocumentRenderLexicon,
  RenderingProfile,
} from './types';
import { getScriptRenderProfile, getCssFont } from './script-render-profile';

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function isMrzMarker(text: string, description?: string): boolean {
  const combined = `${text} ${description ?? ''}`.toLowerCase();
  return combined.includes('mrz') || combined.includes('machine-readable');
}

function renderListItems(items: ListItem[], ordered: boolean): string {
  const tag = ordered ? 'ol' : 'ul';
  const inner = items
    .map((item) => {
      const children = item.children?.length ? renderListItems(item.children, ordered) : '';
      return `<li>${esc(item.text)}${children}</li>`;
    })
    .join('');
  return `<${tag}>${inner}</${tag}>`;
}

function renderClause(clause: ClauseBlock, profile: RenderingProfile): string {
  const cls = profile === 'legal_document' ? 'clause legal-clause' : 'clause';
  const num = clause.number ? `<span class="clause-number">${esc(clause.number)}</span> ` : '';
  const title = clause.title ? `<strong>${esc(clause.title)}</strong> ` : '';
  const paras = clause.paragraphs.map((p) => `<p>${esc(p)}</p>`).join('');
  const children = clause.children?.length
    ? clause.children.map((c) => renderClause(c, profile)).join('')
    : '';
  return `<div class="${cls}">${num}${title}${paras}${children}</div>`;
}

function kvTableClass(profile: RenderingProfile): string {
  return profile === 'identity_document' ? 'kv-table kv-compact' : 'kv-table';
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function renderBlock(block: TranslationBlock, lex: DocumentRenderLexicon, profile: RenderingProfile, _isRtl: boolean): string {
  switch (block.type) {
    case 'heading': {
      const tag = `h${block.level}`;
      return `<${tag}>${esc(block.text)}</${tag}>`;
    }

    case 'paragraph':
      return `<p>${esc(block.text)}</p>`;

    case 'key_value': {
      const title = block.title ? `<h3>${esc(block.title)}</h3>` : '';
      const rows = block.fields
        .map((f) => {
          const valClass = f.preserveExactly ? 'cert-value ltr-iso' : 'cert-value';
          return `<tr><th>${esc(f.label)}</th><td class="${valClass}">${esc(f.value)}</td></tr>`;
        })
        .join('');
      return `${title}<table class="${kvTableClass(profile)}"><tbody>${rows}</tbody></table>`;
    }

    case 'table': {
      const title = block.title ? `<h3>${esc(block.title)}</h3>` : '';
      const isFinancial = profile === 'financial_document';
      const headers = block.columns
        .map((c) => `<th>${esc(c.header)}</th>`)
        .join('');
      const rows = block.rows
        .map((row) => {
          const cells = block.columns
            .map((c) => {
              const isNum = c.semanticType === 'money' || c.semanticType === 'number' || c.semanticType === 'percentage';
              const isCode = c.semanticType === 'code';
              const cellClass = isFinancial && isNum ? 'num-cell' : isCode ? 'code-cell' : '';
              const cellAttrs = cellClass ? ` class="${cellClass}"` : '';
              return `<td${cellAttrs}>${esc(row.cells[c.id] ?? '')}</td>`;
            })
            .join('');
          return `<tr>${cells}</tr>`;
        })
        .join('');
      const repeatHeader = profile === 'academic_document' ? ' data-repeat-header="true"' : '';
      return `${title}<table class="data-table"${repeatHeader}><thead><tr>${headers}</tr></thead><tbody>${rows}</tbody></table>`;
    }

    case 'list':
      return renderListItems(block.items, block.ordered);

    case 'clause':
      return renderClause(block as ClauseBlock, profile);

    case 'signature': {
      const marker = block.visualMarker || lex.visualMarkers.signature || '';
      const role = block.role ? `<div class="sig-role">${esc(block.role)}</div>` : '';
      const name = block.name ? `<div class="sig-name">${esc(block.name)}</div>` : '';
      const org = block.organization ? `<div class="sig-org">${esc(block.organization)}</div>` : '';
      const date = block.date ? `<div class="sig-date ltr-iso">${esc(block.date)}</div>` : '';
      return `<div class="signature-block">
        <span class="visual-marker">${esc(marker)}</span>${role}${name}${org}${date}
      </div>`;
    }

    case 'visual_marker': {
      const isMrz = isMrzMarker(block.markerText, block.description);
      const cls = isMrz ? 'visual-marker mrz-block' : 'visual-marker';
      const desc = block.description ? ` <span class="vm-desc">${esc(block.description)}</span>` : '';
      return `<span class="${cls}">${esc(block.markerText)}${desc}</span>`;
    }

    case 'note': {
      const cls = block.noteType === 'translator' ? 'translator-note' : 'note';
      return `<div class="${cls}">${esc(block.text)}</div>`;
    }

    case 'page_break':
      return `<hr class="page-break" data-source-page="${block.afterSourcePage}" />`;

    default:
      return '';
  }
}

function renderVisualSection(ast: TranslationDocumentAst): string {
  if (!ast.visualElements.length && !ast.verificationItems.length) return '';
  const lex = ast.renderLexicon;

  const elemRows = ast.visualElements
    .map(
      (el) =>
        `<tr>
      <td><span class="visual-marker">${esc(el.markerText)}</span></td>
      <td>${esc(el.description ?? '')}</td>
      <td class="ltr-iso">${el.sourcePage != null ? String(el.sourcePage) : ''}</td>
    </tr>`,
    )
    .join('');

  const verRows = ast.verificationItems
    .map((vi) => `<tr><td>${esc(vi.label)}</td><td><code class="ltr-iso">${esc(vi.value)}</code></td></tr>`)
    .join('');

  return `<section class="section visual-elements-section">
    <h2>${esc(lex.visualElementsHeading)}</h2>
    ${
      elemRows
        ? `<table class="data-table"><thead><tr>
      <th>${esc(lex.elementLabel)}</th>
      <th>${esc(lex.representationLabel)}</th>
      <th>${esc(lex.originalPageLabel)}</th>
    </tr></thead><tbody>${elemRows}</tbody></table>`
        : ''
    }
    ${verRows ? `<table class="kv-table"><tbody>${verRows}</tbody></table>` : ''}
  </section>`;
}

function renderTranslatorBlock(lex: DocumentRenderLexicon): string {
  const BLANK = '_______________';
  return `<div class="translator-block">
  <div class="translator-heading">${esc(lex.translatorBlockHeading)}</div>
  <table class="cert-table"><tbody>
    <tr><td class="cert-label">${esc(lex.translatorNameLabel)}</td><td class="cert-value">${BLANK}</td></tr>
    <tr><td class="cert-label">${esc(lex.translatorQualificationLabel)}</td><td class="cert-value">${BLANK}</td></tr>
    <tr><td class="cert-label">${esc(lex.translatorSignatureLabel)}</td><td class="cert-value">${BLANK}</td></tr>
    <tr><td class="cert-label">${esc(lex.translationDateLabel)}</td><td class="cert-value">${BLANK}</td></tr>
    <tr><td class="cert-label">${esc(lex.providerStampPlaceholder)}</td><td class="cert-value">${BLANK}</td></tr>
  </tbody></table>
</div>`;
}

export interface AstRenderOptions {
  translatedAt?: string;
  filename?: string;
  serviceLevel?: string;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function renderHtmlFromAst(ast: TranslationDocumentAst, _opts: AstRenderOptions = {}): string {
  const lex = ast.renderLexicon;
  const dir = ast.targetLanguage.direction;
  const isRtl = dir === 'rtl';
  const langCode = esc(ast.targetLanguage.normalizedCode);
  const profile = ast.renderingProfile;
  const isPresentation = profile === 'presentation';

  const scriptProfile = getScriptRenderProfile(ast.targetLanguage.script);
  const fontFamily = getCssFont(scriptProfile);
  const lineHeight = scriptProfile.lineHeightMultiplier;
  const fontSize = `${scriptProfile.defaultFontSizePt}pt`;
  const wordBreakCss = scriptProfile.supportsWordBreaking
    ? 'word-break: normal; overflow-wrap: anywhere;'
    : 'word-break: break-all; overflow-wrap: anywhere; hyphens: none;';

  const blocksHtml = ast.blocks.map((b) => renderBlock(b, lex, profile, isRtl)).join('\n');
  const visualSectionHtml = renderVisualSection(ast);
  const translatorBlockHtml = isPresentation ? '' : renderTranslatorBlock(lex);

  const rtlBodyCss = isRtl
    ? `body { direction: rtl; text-align: start; }
  table { direction: rtl; }
  th, td { text-align: start; }`
    : '';

  const pageCss = `@page { @bottom-center { content: "${esc(lex.pageLabel)} " counter(page) " ${esc(lex.pageOfLabel)} " counter(pages); font-family: serif; font-size: 9pt; color: #888; } }`;

  const presentationCss = isPresentation
    ? `.content > * { page-break-before: always; }
  .content > *:first-child { page-break-before: auto; }
  h2 { font-size: 18pt; margin-bottom: 12pt; }`
    : '';

  return `<!DOCTYPE html>
<html lang="${langCode}" dir="${dir}">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(lex.translationHeading)}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  @page { size: A4; margin: 20mm 15mm 25mm 15mm; }
  ${pageCss}
  body {
    font-family: ${fontFamily};
    font-size: ${fontSize};
    line-height: ${lineHeight};
    color: #111;
    max-width: 780px;
    margin: 0 auto;
    padding: 24px 40px;
    ${wordBreakCss}
  }
  ${rtlBodyCss}
  img { display: none; }
  h1 { font-size: 14pt; margin: 18px 0 10px; text-transform: uppercase; letter-spacing: 0.03em; break-after: avoid-page; }
  h2 { font-size: 12pt; margin: 16px 0 8px; break-after: avoid-page; }
  h3 { font-size: 11pt; margin: 12px 0 6px; break-after: avoid-page; }
  p  { margin: 5px 0; }
  ul, ol { margin: 6px 0 6px 22px; }
  li { margin: 3px 0; }
  table { border-collapse: collapse; width: 100%; margin: 10px 0; table-layout: fixed; }
  thead { display: table-header-group; }
  tr { break-inside: avoid-page; page-break-inside: avoid; }
  th, td { border: 1px solid #bbb; padding: 5px 10px; vertical-align: top; }
  th { background: #f5f5f5; font-weight: 600; }
  .kv-table th { width: 40%; text-align: start; }
  .kv-table td { width: 60%; }
  .kv-compact th, .kv-compact td { padding: 3px 6px; font-size: 10pt; }
  .data-table { break-inside: auto; page-break-inside: auto; }
  .num-cell { text-align: end; font-variant-numeric: tabular-nums; font-family: "Liberation Mono", monospace; }
  .code-cell { font-family: "Liberation Mono", monospace; unicode-bidi: isolate; direction: ltr; }
  .ltr-iso { unicode-bidi: isolate; direction: ltr; display: inline-block; }
  .visual-marker { font-style: italic; color: #333; }
  .mrz-block { font-family: "Liberation Mono", "Courier New", monospace; font-size: 9pt; unicode-bidi: isolate; direction: ltr; letter-spacing: 0.05em; display: block; margin: 4px 0; background: #f8f8f8; padding: 2px 4px; }
  .signature-block { margin: 8px 0; border-inline-start: 2px solid #bbb; padding-inline-start: 12px; }
  .sig-role { font-weight: 600; margin-top: 4px; }
  .clause { margin: 6px 0 6px 12px; }
  .clause-number { font-weight: bold; }
  .legal-clause { margin-inline-start: 16px; }
  .translator-note { margin-top: 8px; font-style: italic; color: #666; border-inline-start: 3px solid #bbb; padding-inline-start: 8px; }
  .note { margin: 4px 0; font-style: italic; color: #555; }
  hr.page-break { border: none; border-top: 1px dashed #ccc; margin: 16px 0; }
  .bureau-header { margin-bottom: 28px; padding-bottom: 14px; border-bottom: 2px solid #222; }
  .translation-title { font-size: 13pt; font-weight: 700; letter-spacing: 0.05em; margin-bottom: 4px; }
  .doc-type-label { font-size: 10pt; color: #444; margin-bottom: 4px; }
  .section { margin-bottom: 10pt; }
  .visual-elements-section { break-inside: avoid-page; page-break-inside: avoid; }
  .translator-block { margin-top: 40px; padding-top: 16px; border-top: 2px solid #222; break-inside: avoid-page; }
  .translator-heading { font-size: 11pt; font-weight: 700; margin-bottom: 12px; letter-spacing: 0.03em; }
  .cert-table { border-collapse: collapse; width: 100%; }
  .cert-table td { padding: 5px 8px; border: 1px solid #bbb; font-size: 10pt; vertical-align: top; }
  .cert-label { width: 45%; font-weight: 600; background: #f9f9f9; text-align: start; }
  .cert-value { width: 55%; }
  ${presentationCss}
  @media print { body { padding: 0; max-width: 100%; } }
</style>
</head>
<body>
  ${
    !isPresentation
      ? `<div class="bureau-header">
    <div class="translation-title">${esc(lex.translationHeading)}</div>
    ${ast.documentTitle ? `<div class="doc-type-label">${esc(ast.documentTitle)}</div>` : ''}
  </div>`
      : ''
  }
  <div class="content">${blocksHtml}</div>
  ${visualSectionHtml}
  ${translatorBlockHtml}
</body>
</html>`;
}

/**
 * Generate legacy Markdown from AST for backward compatibility with existing renderers.
 * This is a best-effort flattening — the AST is the source of truth.
 */
export function astToMarkdown(ast: TranslationDocumentAst): string {
  const lex = ast.renderLexicon;
  const lines: string[] = [];

  for (const block of ast.blocks) {
    switch (block.type) {
      case 'heading':
        lines.push(`${'#'.repeat(block.level)} ${block.text}`);
        break;
      case 'paragraph':
        lines.push(block.text);
        break;
      case 'key_value': {
        if (block.title) lines.push(`## ${block.title}`);
        for (const f of block.fields) {
          lines.push(`| ${f.label} | ${f.value} |`);
        }
        break;
      }
      case 'table': {
        if (block.title) lines.push(`## ${block.title}`);
        const headers = block.columns.map((c) => c.header).join(' | ');
        const sep = block.columns.map(() => '---').join(' | ');
        lines.push(`| ${headers} |`, `| ${sep} |`);
        for (const row of block.rows) {
          const cells = block.columns.map((c) => row.cells[c.id] ?? '').join(' | ');
          lines.push(`| ${cells} |`);
        }
        break;
      }
      case 'list': {
        const renderItems = (items: ListItem[], depth: number) => {
          for (const item of items) {
            const prefix = block.ordered ? `${' '.repeat(depth * 2)}1.` : `${' '.repeat(depth * 2)}-`;
            lines.push(`${prefix} ${item.text}`);
            if (item.children?.length) renderItems(item.children, depth + 1);
          }
        };
        renderItems(block.items, 0);
        break;
      }
      case 'clause': {
        const renderClauseMd = (c: ClauseBlock, depth: number) => {
          const prefix = c.number ? `${c.number} ` : '';
          const title = c.title ? `**${c.title}**` : '';
          if (prefix || title) lines.push(`${'#'.repeat(Math.min(depth + 2, 6))} ${prefix}${title}`);
          for (const p of c.paragraphs) lines.push(p);
          if (c.children?.length) c.children.forEach((ch) => renderClauseMd(ch, depth + 1));
        };
        renderClauseMd(block as ClauseBlock, 0);
        break;
      }
      case 'signature':
        lines.push(block.visualMarker || (lex.visualMarkers.signature ?? '[signature]'));
        if (block.name) lines.push(block.name);
        if (block.role) lines.push(block.role);
        break;
      case 'visual_marker':
        lines.push(block.markerText);
        break;
      case 'note':
        lines.push(block.text);
        break;
      case 'page_break':
        lines.push('---');
        break;
    }
    lines.push('');
  }

  // Visual elements section
  if (ast.visualElements.length || ast.verificationItems.length) {
    lines.push(`## ${lex.visualElementsHeading}`);
    for (const el of ast.visualElements) {
      lines.push(`- ${el.markerText}${el.description ? ': ' + el.description : ''}`);
    }
    for (const vi of ast.verificationItems) {
      lines.push(`- ${vi.label}: \`${vi.value}\``);
    }
    lines.push('');
  }

  return lines.join('\n');
}
