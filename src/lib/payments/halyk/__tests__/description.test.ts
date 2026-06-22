import { buildPaymentDescription } from '../description';

describe('buildPaymentDescription', () => {
  it('includes the order ID', () => {
    const desc = buildPaymentDescription('abc-123');
    expect(desc).toContain('abc-123');
  });

  it('does not exceed 125 UTF-8 bytes', () => {
    const longId = 'a'.repeat(200);
    const desc = buildPaymentDescription(longId);
    const byteLength = new TextEncoder().encode(desc).length;
    expect(byteLength).toBeLessThanOrEqual(125);
  });

  it('fits within 125 bytes for a normal UUID order ID', () => {
    const desc = buildPaymentDescription('550e8400-e29b-41d4-a716-446655440000');
    const byteLength = new TextEncoder().encode(desc).length;
    expect(byteLength).toBeLessThanOrEqual(125);
  });

  it('handles multibyte characters without exceeding byte limit', () => {
    // Simulate an edge case with multi-byte characters
    const desc = buildPaymentDescription('тест-заказ-123');
    const byteLength = new TextEncoder().encode(desc).length;
    expect(byteLength).toBeLessThanOrEqual(125);
  });
});
