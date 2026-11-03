import { describe, expect, it } from 'vitest';
import { publicFiles, validateDocument } from '../worker/content';
import type { ContentDocument } from '../src/contracts';
const doc:ContentDocument={id:'test',kind:'post',slug:'中文文章',title:'测试文章',body:'正文',metadata:{date:'2026-11-02T12:00:00+08:00'},publish:true,archived:false,revision:1,createdAt:'2026-11-02',updatedAt:'2026-11-02'};
describe('公开投影',()=>{
  it('只导出被标记的公开版本，私密正文不会进入任何输出',()=>{
    const output=publicFiles([doc,{...doc,id:'private',slug:'private',body:'PRIVATE-CONTENT-MUST-NOT-LEAK',publish:false}], 'release-test','hash');
    expect(Object.keys(output)).toEqual(['posts/中文文章.md','public/release.json']);
    expect(JSON.stringify(output)).not.toContain('PRIVATE-CONTENT');
  });
  it('私有附件不能被当作公开媒体导出',()=>{expect(()=>publicFiles([{...doc,body:'![private](/api/media/secret)'}],'r','h')).toThrow();});
  it('导出使用 JSON 引号，特殊标题不能注入 frontmatter 字段',()=>{const files=publicFiles([{...doc,title:'正文\nsecret: true'}],'r','h');expect(files['posts/中文文章.md']).toContain('"title": "正文\\nsecret: true"');});
  it('校验内容类型、路径和站点配置结构',()=>{expect(()=>validateDocument({kind:'post',slug:'../../secret',title:'bad'})).toThrow();expect(()=>validateDocument({kind:'site',slug:'site',title:'站点',body:'{}'})).not.toThrow();});
  it('公开配置拒绝凭据、重复歌单和越界歌词，保留合法公开 sitekey',()=>{
    const config=(kind:string,value:unknown)=>({kind,slug:kind,title:'配置',body:JSON.stringify(value)});
    expect(()=>validateDocument(config('site',{turnstile:{sitekey:'public-key'}}))).not.toThrow();
    expect(()=>validateDocument(config('site',{music:{cookie:'secret'}}))).toThrow('凭据');
    const track={key:'netease:1',source:'netease',id:'1',name:'歌曲'};
    expect(()=>validateDocument(config('site',{musicTracks:[track,track]}))).toThrow('重复');
    expect(()=>validateDocument(config('music',{version:1,tracks:{'netease:1':{offsetMs:5001}}}))).toThrow('偏移');
  });
});
