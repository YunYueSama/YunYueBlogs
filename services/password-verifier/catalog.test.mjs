import {test} from 'node:test';
import assert from 'node:assert/strict';
import {channels,validTrackId,normalizeCatalog,searchCatalog} from './lib/music-catalog.mjs';
import {resolveLx} from './lib/lx-source.mjs';

test('音源声明五渠道，搜索结果保留对应取源标识与质量',async()=>{
  const manifest=await resolveLx(`lx.send('inited',{sources:${JSON.stringify(Object.fromEntries(Object.values(channels).map(c=>[c.lx,{actions:['musicUrl'],qualitys:['128k','320k','flac']}])))} });`,null);
  assert.equal(Object.keys(manifest.sources).length,5);
  const fixtures={netease:{result:{songs:[{id:123,name:'云 月',ar:[{name:'歌手'}],al:{id:5,name:'专辑'},h:{},sq:{}}],songCount:16}},kugou:{data:{lists:[{FileHash:'A'.repeat(32),OriSongName:'云 月',SingerName:'歌手',HQFileHash:'B'.repeat(32),SQFileHash:'C'.repeat(32),MixSongID:456}],total:17}},qq:{req:{data:{body:{song:{list:[{id:77,mid:'songMid',title:'云 月',file:{media_mid:'mediaMid',size_320mp3:1,size_flac:2},singer:[{name:'歌手'}],album:{mid:'albumMid',name:'专辑'}}]}},meta:{sum:18}}}},kuwo:{abslist:[{MUSICRID:'MUSIC_123',NAME:'云 月',N_MINFO:'bitrate:320,bitrate:2000,'}],TOTAL:'19'},migu:{songResultData:{resultList:[[{copyrightId:'600123',songId:987,name:'云 月',audioFormats:[{formatType:'HQ'},{formatType:'SQ'}]}]],totalCount:20}}};
  for(const [source,body] of Object.entries(fixtures)){
    const result=normalizeCatalog(source,body,1,15);assert.equal(result.items.length,1);assert.ok(validTrackId(source,result.items[0].id));assert.equal(result.items[0].lx.source,channels[source].lx);assert.ok(result.items[0].lx._types.flac);assert.equal(result.hasMore,true);
  }
  assert.equal(normalizeCatalog('qq',fixtures.qq,1,15).items[0].lx.strMediaMid,'mediaMid');
  assert.equal(normalizeCatalog('migu',fixtures.migu,1,15).items[0].lx.songmid,'987');
  assert.equal(validTrackId('constructor','abc'),false);assert.equal(validTrackId('netease','bad'),false);
});
test('模糊关键词分页、同请求合并与短期缓存，失败不缓存',async()=>{
  let calls=0;const query='partial '+Date.now();
  const call=async(_source,action,args)=>{calls++;assert.equal(action,'cloudsearch');assert.equal(args.keywords,query);assert.equal(args.limit,15);assert.equal(args.offset,15);await new Promise(r=>setTimeout(r,10));return {body:{code:200,result:{songs:[],songCount:0}}};};
  const input={channel:'netease',query,page:2};await Promise.all([searchCatalog(input,call),searchCatalog(input,call)]);await searchCatalog(input,call);assert.equal(calls,1);
  const failure={channel:'netease',query:'error '+Date.now()};let failures=0;const fail=async()=>{failures++;return {body:{code:500}}};
  await assert.rejects(searchCatalog(failure,fail),/search_unavailable/);await assert.rejects(searchCatalog(failure,fail),/search_unavailable/);assert.equal(failures,2);
  for(const input of [{channel:'invalid',query:'a'},{channel:'qq',query:'x'.repeat(101)},{channel:'kuwo',query:'a',page:51}])await assert.rejects(searchCatalog(input,call),/invalid_search/);
  await assert.rejects(searchCatalog({channel:'qq',query:'nested failure '+Date.now()},null,async()=>({body:{code:0,req:{code:401}}})),/search_unavailable/);
});
test('检索并发有界，繁忙时不自动重试',async()=>{
  let release;const wait=new Promise(r=>release=r);const call=async()=>{await wait;return {body:{code:200,result:{songs:[]}}};};
  const pending=Array.from({length:4},(_,i)=>searchCatalog({channel:'netease',query:`busy-${Date.now()}-${i}`},call));
  await assert.rejects(searchCatalog({channel:'netease',query:'overflow'},call),/search_busy/);release();await Promise.all(pending);
});
