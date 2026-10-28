import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { create } from 'zustand';
const require = createRequire(import.meta.url);
function compile(file, mocks, extra = {}) {
 const exports = {};
 const code = ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 vm.runInNewContext(code, {exports,Error,...extra,require:id=>id in mocks?mocks[id]:require(id)});
 return exports;
}
function store(getStocks) {
 return compile('../store/market-store.ts', {'zustand':{create},'@/services':{getStocks,getTrendingStocks:async()=>[],getMarketOpportunities:async()=>[]}}).useMarketStore;
}
const page = (ids, hasMore) => ({items:ids.map(assetId=>({assetId})),pagination:{hasMore}});

test('pagination preserves rows and retries the failed page without skipping or duplicating stocks', async()=>{
 const calls=[]; let fail=true;
 const market=store(async p=>{calls.push(p);if(p===1)return page(['a','mcd'],true);if(fail){fail=false;throw new Error('offline');}return page(['mcd','next'],false);});
 await market.getState().loadMarkets();
 await market.getState().loadNextStocks();
 assert.deepEqual(market.getState().stocks.map(s=>s.assetId),['a','mcd']);
 assert.equal(market.getState().nextPage,2);
 assert.equal(market.getState().isLoadingMore,false);
 assert.equal(market.getState().loadMoreError,'offline');
 await market.getState().loadNextStocks();
 assert.deepEqual(calls,[1,2,2]);
 assert.deepEqual(Array.from(market.getState().stocks,s=>s.assetId),['a','mcd','next']);
 assert.equal(market.getState().hasMore,false);
 assert.equal(market.getState().loadMoreError,undefined);
});

test('simultaneous scroll callbacks request the next page only once', async()=>{
 let release,calls=0;
 const market=store(async()=>{calls++;return new Promise(resolve=>{release=resolve;});});
 const pending=market.getState().loadNextStocks();
 await market.getState().loadNextStocks(); assert.equal(calls,1);
 release(page(['a'],true)); await pending;
});

test('scroll observer attaches after initial rows mount and rearms for subsequent pages', ()=>{
 const slots=[], effects=[], observers=[];
 let cursor=0,loads=0;
 const state={stocks:[],trending:[],opportunities:[],searchResults:[],isLoading:true,isLoadingMore:false,isSearching:false,hasMore:true,loadMarkets(){},search(){},loadNextStocks(){loads++;}};
 const react={
  useState:initial=>[initial,()=>{}], useMemo:fn=>fn(),
  useRef(initial){const i=cursor++;return slots[i]??=( {current:initial} );},
  useEffect(fn,deps){const i=cursor++;if(!slots[i]||deps.some((d,j)=>!Object.is(d,slots[i].deps[j])))effects.push(()=>{slots[i]?.cleanup?.();slots[i]={deps,cleanup:fn()};});},
 };
 class Observer {
  constructor(callback){this.callback=callback;this.disconnected=false;observers.push(this);}
  observe(target){this.target=target;}
  disconnect(){this.disconnected=true;}
 }
 const {MarketsOverview}=compile('../components/markets/markets-overview.tsx',{
  react,'@/store':{useMarketStore:select=>select(state)},'@/services':{},'@/components/ui':{cn:()=>'',formatCurrency:()=>'',formatPercent:()=>''},
  'next/link':{default:'a'},'@hugeicons/react':{},'@hugeicons/core-free-icons':{},
 },{IntersectionObserver:Observer,window:{}});
 const render=()=>{cursor=0;MarketsOverview();while(effects.length)effects.shift()();};
 render(); assert.equal(observers.length,0);
 const sentinel={}; slots[0].current=sentinel;
 state.isLoading=false;state.stocks=[{assetId:'mcd'}];render();
 assert.equal(observers.length,1);assert.equal(observers[0].target,sentinel);
 observers[0].callback([{isIntersecting:true}]);assert.equal(loads,1);
 state.isLoadingMore=true;render();assert.equal(observers[0].disconnected,true);
 state.isLoadingMore=false;state.stocks.push({assetId:'next'});render();assert.equal(observers.length,2);
 state.loadMoreError='offline';render();assert.equal(observers[1].disconnected,true);
 state.loadMoreError=undefined;render();assert.equal(observers.length,3);
 state.hasMore=false;render();assert.equal(observers[2].disconnected,true);
});
