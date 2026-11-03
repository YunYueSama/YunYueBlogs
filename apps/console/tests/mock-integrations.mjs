import {createHash} from 'node:crypto';

// 自动化验收专用，不调用音乐平台、不产生真实扫码会话或上传记录。
export async function mockMusicOperation(input) {
  const channels=[['netease','网易云音乐'],['kugou','酷狗音乐'],['qq','QQ 音乐'],['kuwo','酷我音乐'],['migu','咪咕音乐']].map(([id,name])=>({id,name,qualities:['128k','320k','flac']}));
  if(input.operation==='source-info')return {channels};
  if(input.operation==='source-import')return {script:input.script,name:'验收音源',version:'1',author:'test',sha256:createHash('sha256').update(input.script||'').digest('hex'),channels:input.script?.includes('SINGLE_CHANNEL')?channels.slice(0,1):channels};
  if(input.operation==='catalog-search'){
    const source=input.channel,page=input.page||1;
    const items=Array.from({length:15},(_,i)=>{const id=source==='kugou'?String(page*100+i).padStart(32,'A'):String(page*100+i);return {source,id,key:`${source}:${id}`,name:`${input.query} · ${source} 第${page}页 ${i+1}`,artist:'验收歌手',album:'关键词匹配专辑',durationMs:215000,lx:{songmid:id,types:[{type:'320k'},{type:'flac'}]}};});
    return {source,items,total:45,page,limit:15,hasMore:page<3};
  }
  if(input.operation==='resolve')return {url:`https://${({netease:'m1.music.126.net',kugou:'fsandroid.tx.kugou.com',qq:'dl.stream.qqmusic.qq.com',kuwo:'car-er.kuwo.cn',migu:'freetyst.nf.migu.cn'})[input.source]}/acceptance.mp3`,quality:'320 kbps',mime:'audio/mpeg',size:400000,adapter:'test'};
  throw new Error('unsupported_mock_operation');
}
