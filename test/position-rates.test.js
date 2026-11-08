import test from 'node:test';
import assert from 'node:assert/strict';
import { weightedApr, binancePositionRate, bitgetPositionRate, bitgetLoanApr } from '../worker/position-rates.js';
import { positionRate } from '../web/positions.js';
const near = (a,b)=>assert.ok(Math.abs(a-b)<1e-12,`${a} != ${b}`);
test('held Earn APR weights actual tiers and does not extend missing coverage',()=>{
 const tiers=[{from:0,to:1000,apr:.1},{from:1000,to:10000,apr:.02}];
 near(weightedApr(tiers,2000),.06); near(weightedApr(tiers,1000),.1);
 assert.equal(weightedApr(tiers,10001),null); assert.equal(weightedApr(tiers,0),null);
 assert.equal(weightedApr([{from:100,to:1000,apr:.1}],200),null);
});
test('Binance holdings use position bonuses and base-only collateral, and retain APY labels',()=>{
 const row={asset:'USDT',totalAmount:'2000',collateralAmount:'0',latestAnnualPercentageRate:'0.02',tierAnnualPercentageRate:{'0-1000USDT':'.08'}};
 near(binancePositionRate(row).positionRate,.06);
 near(binancePositionRate({...row,totalAmount:'0',collateralAmount:'0.05'}).positionRate,.02);
 near(binancePositionRate({...row,totalAmount:'1000',collateralAmount:'1000'}).positionRate,.06);
 assert.equal(binancePositionRate({...row,latestAnnualPercentageRate:''}).positionRate,null);
 assert.equal(binancePositionRate({...row,tierAnnualPercentageRate:undefined}).positionRate,null);
 assert.deepEqual(binancePositionRate({APY:'0.23'},true),{positionRate:.23,positionRateLabel:'APY'});
});
test('Bitget uses held-product APY bands and annualizes hourly loan percentage',()=>{
 const row={holdAmount:'2000',apy:[{minApy:'0',maxApy:'1000',currentApy:'10'},{minApy:'1000',maxApy:'100000',currentApy:'2'}]};
 near(bitgetPositionRate(row).positionRate,.06);
 assert.equal(bitgetPositionRate({...row,apy:undefined}).positionRate,null);
 assert.equal(bitgetPositionRate({...row,holdAmount:'100001'}).positionRate,null);
 near(bitgetLoanApr({hourInterestRate:'0.000425'}),.03723);
 assert.equal(bitgetLoanApr({}),null);
 assert.equal(bitgetLoanApr({hourInterestRate:''}),null);
});
test('loan APR fallback matches exact asset, collateral and platform without using Earn maxima',()=>{
 const section={platform:'Binance',product:'Flexible Loan'};
 const row={asset:'USDC',collateral:'BTC'};
 const quote={platform:'Binance',kind:'loan',asset:'USDC',collateral:'BTC',status:'ok',apr:.05};
 assert.deepEqual(positionRate(row,section,[quote]),{value:.05,label:'APR'});
 assert.equal(positionRate(row,section,[{...quote,asset:'USDT'}]),null);
 assert.equal(positionRate(row,section,[{...quote,status:'error'}]),null);
 assert.equal(positionRate(row,section,[quote,quote]),null);
 assert.equal(positionRate(row,{platform:'Bitget',product:'Savings'},[quote]),null);
 assert.deepEqual(positionRate({...row,positionRate:0,positionRateLabel:'APR'},section,[]),{value:0,label:'APR'});
});
