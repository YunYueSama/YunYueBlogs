import {expect,it} from 'vitest';
import {Miniflare,Response as WorkerResponse,convertV4MiniflareOptions} from 'miniflare';
import {build} from 'esbuild';
import {resolve} from 'node:path';
import {decodeMusicInput} from './mock-integrations.mjs';

it('首次引用缺失只补传一次压缩源码，随后仅发哈希；上游失败不重复解析',async()=>{
  const script='/** @name 引用验收源 */\n'+'const sample="bounded script";\n'.repeat(400);
  const bundle=await build({stdin:{contents:`import {musicService} from './worker/integrations';export default {async fetch(r,env){try{return Response.json(await musicService(env,await r.json()));}catch{return new Response('failed',{status:502});}}};`,resolveDir:resolve('.'),sourcefile:'music-protocol.ts'},bundle:true,write:false,format:'esm',platform:'browser'});
  const sent:Record<string,unknown>[]=[],decoded:string[]=[];
  const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-11-03',bindings:{PASSWORD_SERVICE_URL:'https://internal.test/api/password',PASSWORD_SERVICE_KEY:'test'},outboundService:async request=>{
    const body=await request.json() as Record<string,unknown>;sent.push(body);
    if(body.operation==='failure')return WorkerResponse.json({error:'upstream_unavailable'},{status:502});
    try{const input=decodeMusicInput(body);decoded.push(String(input.script));return WorkerResponse.json({available:true});}
    catch(error){if(error instanceof Error&&error.message==='source_cache_miss')return WorkerResponse.json({error:'source_cache_miss'},{status:409});throw error;}
  }}));
  const call=(operation='resolve')=>mf.dispatchFetch('https://worker.test',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({source:'netease',operation,script})});
  try{
    expect((await call()).status).toBe(200);expect(sent).toHaveLength(2);
    expect(sent[0].scriptSha256).toMatch(/^[a-f0-9]{64}$/);expect(sent[0].script).toBeUndefined();
    expect(typeof sent[1].scriptGzip).toBe('string');expect(JSON.stringify(sent[1]).length).toBeLessThan(script.length/2);
    expect(decoded[0]).toBe(script);
    expect((await call()).status).toBe(200);expect(sent).toHaveLength(3);expect(sent[2].scriptGzip).toBeUndefined();expect(decoded[1]).toBe(script);
    expect((await call('failure')).status).toBe(502);expect(sent).toHaveLength(4);
  }finally{await mf.dispose();}
});
