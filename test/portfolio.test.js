import test from 'node:test';
import assert from 'node:assert/strict';
import { portfolioSummary } from '../web/positions.js';
const section = (product, rows, status = 'ok') => ({ platform: 'Bitget', product, status, rows });
test('portfolio weights rates by balances and deducts borrowing costs', () => {
  const result = portfolioSummary([
    section('Flexible Loan', [{collateral:'BTC',collateralAmount:'0.1',asset:'USDC',loan:'4800',interest:'0',currentLtvPercent:'60',positionRate:0.04415}]),
    section('Savings', [{asset:'USDT',amount:'1000',positionRate:0.1168},{asset:'USDC',amount:'3000',positionRate:0.103}] )
  ], []);
  assert.equal(result.debt,4800); assert.equal(result.earn,4000);
  assert.equal(result.collateralUsd,8000);
  assert.ok(Math.abs(result.netAnnual - 213.88) < 1e-9);
  assert.ok(Math.abs(result.earningApr - 0.10645) < 1e-9);
  assert.ok(Math.abs(result.spread - 0.0623) < 1e-9);
  assert.equal(result.netApr, result.netAnnual / 4000);
});
test('collateral Earn is not counted again and interest is included once', () => {
  const result=portfolioSummary([
    section('Flexible Loan',[{asset:'USDC',collateral:'BTC',collateralAmount:'0.05',debt:'2001',loan:null,interest:null,currentLtvPercent:'50',positionRate:0.05}]),
    section('Savings',[{asset:'BTC',amount:'0',collateralAmount:'0.05',positionRate:0.0002},{asset:'USDT',amount:'1000',positionRate:0.1}],'partial')
  ],[]);
  assert.deepEqual(result.collateral,[['BTC',0.05]]);assert.equal(result.debt,2001);
  assert.equal(result.earn,1000);assert.equal(result.partial,true);
  assert.ok(result.netAnnual<0);
});
test('unknown APR, APY, unsupported assets and missing LTV are not zero-filled',()=>{
  const loans=section('Flexible Loan',[{asset:'USDC',collateral:'BTC',collateralAmount:'0.1',loan:'1000',interest:'1'}]);
  let result=portfolioSummary([loans,section('Savings',[{asset:'USDT',amount:'1000',positionRate:0.1}])],[]);
  assert.equal(result.borrowingApr,null);assert.equal(result.netAnnual,null);assert.equal(result.collateralUsd,null);
  result=portfolioSummary([section('Savings',[{asset:'BTC',amount:'1',positionRate:0.02}])],[]);
  assert.equal(result.netAnnual,null);assert.equal(result.supported,false);
  result=portfolioSummary([section('Savings',[{asset:'USDT',amount:'1000',positionRate:0.1,positionRateLabel:'APY'}])],[]);
  assert.equal(result.earningApr,null);assert.equal(result.netAnnual,null);
});
test('failed sources do not become zero balances or a complete net projection',()=>{
  const result=portfolioSummary([section('Flexible Loan',[],'error'),section('Savings',[{asset:'USDT',amount:'1000',positionRate:0.1}])],[]);
  assert.equal(result.debt,null);assert.equal(result.collateralUsd,null);assert.equal(result.netAnnual,null);assert.equal(result.partial,true);
});
test('portfolio uses the same OKX tier estimate for weighted APR and projections', () => {
 const okx = {platform:'OKX',product:'Flexible Earn',status:'ok',rows:[{asset:'USDC',amount:'1000',positionRate:null}]};
 const quote = {platform:'OKX',kind:'earn',asset:'USDC',status:'ok',apr:.03,tiers:[],bonusStatus:'ok',bonus:{limit:500,apr:.1}};
 const result = portfolioSummary([section('Flexible Loan',[], 'ok'),okx],[quote]);
 assert.equal(result.earningApr,.065);assert.equal(result.netAnnual,65);
 assert.equal(portfolioSummary([okx],[{...quote,bonusStatus:'error'}]).earningApr,null);
});
