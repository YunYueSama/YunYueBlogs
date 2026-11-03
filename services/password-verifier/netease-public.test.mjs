import {test} from 'node:test';
import assert from 'node:assert/strict';
import {publicNetease} from './lib/netease-public.mjs';
import {musicOperation} from './api/music.mjs';
const raw=Buffer.alloc(4096);raw.set([255,251,224,0]);
const request=async()=>({statusCode:206,headers:{'content-range':'bytes 0-4095/6400000'},raw});
const track={source:'netease',id:'17',durationMs:160000};
const row={id:17,url:'https://m7.music.126.net/test.mp3',br:320000,time:160000,freeTrialInfo:null};
test('匿名完整高品质地址可用，试听、较低音质及无损不足不能冒充完整高品质',async()=>{
  const lookup=async()=>({body:{data:[row]}});
  assert.equal((await publicNetease(track,'320k',{lookup,request})).quality,'320 kbps');
  for(const [i,change] of [{freeTrialInfo:{start:0,end:45000}},{time:45000},{br:128000}].entries()){
    const id=String(50+i);assert.equal(await publicNetease({...track,id},'320k',{lookup:async()=>({body:{data:[{...row,...change,id:Number(id)}]}}),request}),undefined);
  }
  assert.equal(await publicNetease(track,'lossless',{lookup,request}),undefined);
});
test('公开快线路不绕过候选音源测试，私人试听仍实际执行所选脚本',async()=>{
  const script=`/**\n * @name 当前音源\n */\nlx.send('inited',{sources:{wy:{actions:['musicUrl'],qualitys:['320k']}}});lx.on('request',()=> 'https://m7.music.126.net/test.mp3');`;
  let lookedUp=0;const measurement={request,publicLookup:async()=>{lookedUp++;return {body:{data:[row]}};}};
  const input={source:'netease',operation:'resolve',track,script,preference:'320k'};
  assert.equal((await musicOperation(input,undefined,measurement)).adapter,'当前音源');assert.equal(lookedUp,0);
  assert.equal((await musicOperation({...input,purpose:'published'},undefined,measurement)).adapter,'网易云公开直连');assert.equal(lookedUp,1);
});
