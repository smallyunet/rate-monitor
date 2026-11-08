import test from 'node:test';
import assert from 'node:assert/strict';
import { rateHighlights } from '../web/earn-apr.js';
test('rate badges compare Loan minimum and Earn first-band maximum, preserving ties', () => {
 const loan = (id, apr, status='ok') => ({id,kind:'loan',apr,status});
 const earn = (id, first, later) => ({id,kind:'earn',status:'ok',rateTiers:[{from:0,to:100,apr:first},{from:100,to:1000,apr:later}]});
 const result = rateHighlights([loan('low',.03),loan('tie',.03),loan('high',.05),loan('error',0,'error'),loan('missing',null),earn('first',.11,.01),earn('later',.04,.5),earn('broken',NaN,.2)]);
 assert.deepEqual([...result.min],['low','tie']); assert.deepEqual([...result.max],['first']);
 assert.equal(rateHighlights([]).min.size,0); assert.equal(rateHighlights([]).max.size,0);
});
