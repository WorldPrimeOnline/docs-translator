import { runAllFixtures } from '../fixtures';

describe('pricing:fixtures — approved WPO worked examples', () => {
  it('all fixtures (6 original presets + 2026-07-21 A/C/D/E) pass against calculatePrice() directly', () => {
    const outcomes = runAllFixtures();
    expect(outcomes).toHaveLength(11);
    for (const { fixture, ok, failures } of outcomes) {
      expect({ id: fixture.id, ok, failures }).toEqual({ id: fixture.id, ok: true, failures: [] });
    }
  });

});
