import test from 'node:test';
import assert from 'node:assert/strict';
import { earnTiers } from '../web/earn-apr.js';
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} != ${expected}`);
test('tier bonus is added only to the eligible portion, including the exact cap', () => {
  const tiers = earnTiers(.021717, [{ range: '0-10000USDC', bonusApr: .07 }], 'USDC');
  near(tiers[0].apr, .091717);
  near(tiers[1].apr, .021717);
});
test('multiple unordered tiers and gaps use the correct marginal rates', () => {
  const tiers = earnTiers(.02, [{ range: '200-400USDT', bonusApr: .03 }, { range: '0-100USDT', bonusApr: .08 }], 'USDT');
  assert.deepEqual(tiers.map(t => [t.from, t.to]), [[0,100],[100,200],[200,400],[400,Infinity]]);
  [.10,.02,.05,.02].forEach((rate, i) => near(tiers[i].apr, rate));
});
test('missing or ambiguous bounds are not presented as a complete APR', () => {
  for (const ranges of [undefined, [{ range: 'unknown', bonusApr: .07 }], [{ range: '0-100USDT', bonusApr: .07 }],
    [{ range: '100-100USDC', bonusApr: .07 }], [{ range: '0-100USDC', bonusApr: null }],
    [{ range: '0-100USDC', bonusApr: .07 }, { range: '50-200USDC', bonusApr: .05 }]]) {
    assert.throws(() => earnTiers(.02, ranges, 'USDC'), /invalid_tiers/);
  }
});
