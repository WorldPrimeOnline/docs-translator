/**
 * @jest-environment node
 */

// Import the functions we can test without mocking 'marked'
// Since marked is async, we test the pure helper functions
import { wrapSections, classifyTables, wrapMarkersOfficial, wrapMarkersLegacy } from '../renderer-helpers';

// Tests for renderer helpers
describe('wrapSections', () => {
  it('wraps translator heading in certification-section class', () => {
    const html = '<p>Before</p><h2>Переводчик и исполнитель</h2><p>Content</p>';
    const result = wrapSections(html);
    expect(result).toContain('class="section certification-section"');
  });

  it('wraps visual elements heading in visual-elements-section class', () => {
    const html = '<p>Before</p><h2>Описание нетекстовых элементов оригинала</h2><p>Content</p>';
    const result = wrapSections(html);
    expect(result).toContain('class="section visual-elements-section"');
  });

  it('wraps verification heading in verification-section class', () => {
    const html = '<p>Before</p><h2>Electronic verification elements</h2><p>Content</p>';
    const result = wrapSections(html);
    expect(result).toContain('class="section verification-section"');
  });

  it('wraps generic h2 in default section class', () => {
    const html = '<p>Before</p><h2>Personal Details</h2><p>Content</p>';
    const result = wrapSections(html);
    expect(result).toContain('<section class="section">');
  });
});

describe('classifyTables', () => {
  it('2-column table gets kv-table class', () => {
    const html = '<table><thead><tr><th>Label</th><th>Value</th></tr></thead><tbody><tr><td>A</td><td>B</td></tr></tbody></table>';
    const result = classifyTables(html);
    expect(result).toContain('class="kv-table"');
  });

  it('9-column table gets wide-table class', () => {
    const cols = '<th>A</th>'.repeat(9);
    const html = `<table><thead><tr>${cols}</tr></thead><tbody><tr>${'<td>x</td>'.repeat(9)}</tr></tbody></table>`;
    const result = classifyTables(html);
    expect(result).toContain('wide-table');
  });

  it('4-column table gets data-table class (not wide)', () => {
    const cols = '<th>A</th>'.repeat(4);
    const html = `<table><thead><tr>${cols}</tr></thead><tbody><tr>${'<td>x</td>'.repeat(4)}</tr></tbody></table>`;
    const result = classifyTables(html);
    expect(result).toContain('data-table');
    expect(result).not.toContain('wide-table');
  });
});

describe('wrapMarkers mode', () => {
  it('official mode uses .visual-marker span not mark.marker', () => {
    const html = '<p>[round stamp]</p>';
    const official = wrapMarkersOfficial(html);
    const legacy = wrapMarkersLegacy(html);

    expect(official).toContain('<span class="visual-marker">');
    expect(official).not.toContain('<mark class="marker">');
    expect(legacy).toContain('<mark class="marker">');
    expect(legacy).not.toContain('<span class="visual-marker">');
  });
});
