import test from 'node:test';
import assert from 'node:assert/strict';
import { earnTiers, effectiveApr } from '../web/earn-apr.js';
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} != ${expected}`);
test('tier bonus is added only to the eligible portion, including the exact cap', () => {
  const tiers = earnTiers(.021717, [{ range: '0-10000USDC', bonusApr: .07 }], 'USDC');
  near(tiers[0].apr, .091717);
  near(tiers[1].apr, .021717);
  near(effectiveApr(tiers, 5000), .091717);
  near(effectiveApr(tiers, 10000), .091717);
  near(effectiveApr(tiers, 20000), .056717);
  near(effectiveApr(tiers, 10001), (.091717 * 10000 + .021717) / 10001);
});
test('multiple unordered tiers and gaps use the correct marginal rates', () => {
  const tiers = earnTiers(.02, [{ range: '200-400USDT', bonusApr: .03 }, { range: '0-100USDT', bonusApr: .08 }], 'USDT');
  near(effectiveApr(tiers, 500), (100 * .10 + 100 * .02 + 200 * .05 + 100 * .02) / 500);
  near(effectiveApr(earnTiers(.02, [], 'USDC'), .5), .02);
  near(effectiveApr(earnTiers(0, [], 'USDC'), 100), 0);
});
test('missing or ambiguous bounds are not presented as a complete APR', () => {
  for (const ranges of [undefined, [{ range: 'unknown', bonusApr: .07 }], [{ range: '0-100USDT', bonusApr: .07 }],
    [{ range: '100-100USDC', bonusApr: .07 }], [{ range: '0-100USDC', bonusApr: null }],
    [{ range: '0-100USDC', bonusApr: .07 }, { range: '50-200USDC', bonusApr: .05 }]]) {
    assert.throws(() => earnTiers(.02, ranges, 'USDC'), /invalid_tiers/);
  }
});
test('empty, zero, negative and non-finite deposits have no effective APR', () => {
  const tiers = earnTiers(.02, [], 'USDC');
  for (const amount of [null, '', '100', 0, -1, NaN, Infinity]) assert.equal(effectiveApr(tiers, amount), null);
});
