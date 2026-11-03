import {createHash,randomBytes} from 'node:crypto';
import {publicRequest} from './public-request.mjs';

export const channels={netease:{lx:'wy',name:'网易云音乐'},kugou:{lx:'kg',name:'酷狗音乐'},qq:{lx:'tx',name:'QQ 音乐'},kuwo:{lx:'kw',name:'酷我音乐'},migu:{lx:'mg',name:'咪咕音乐'}};
export const validTrackId=(source,id)=>typeof id==='string'&&Object.hasOwn(channels,source)&&(source==='kugou'?/^[a-f0-9]{32}$/i:source==='netease'||source==='kuwo'?/^\d{1,20}$/:/^[a-zA-Z0-9]{1,64}$/).test(id);
const clean=(value,max=200)=>String(value??'').replace(/<[^>]*>/g,'').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').trim().slice(0,max);
const singer=(rows)=>Array.isArray(rows)?rows.map(item=>clean(item.name||item.singerName)).filter(Boolean).join('、'):clean(rows);
const duration=value=>Math.max(0,Math.min(3600000,Math.round(Number(value)||0)));
const image=value=>{try{const url=new URL(String(value||'').replace('{size}','400'));return ['http:','https:'].includes(url.protocol)&&!url.username&&!url.password?url.href.replace(/^http:/,'https:'):'';}catch{return '';}};
const types=items=>items.filter(item=>['128k','320k','flac'].includes(item.type));
function row(source,id,name,artist,album,cover,durationMs,lx={}){
  id=String(id||'');if(!validTrackId(source,id)||!name)return null;if(source==='kugou')id=id.toUpperCase();
  const qualityTypes=types(lx.types||[]);return {source,id,key:`${source}:${id}`,name:clean(name),artist:clean(artist),album:clean(album),cover:image(cover),durationMs:duration(durationMs),albumId:String(lx.albumId||''),albumAudioId:String(lx.albumAudioId||''),lx:{...lx,source:channels[source].lx,types:qualityTypes,_types:Object.fromEntries(qualityTypes.map(item=>[item.type,item]))}};
}

export function normalizeCatalog(source,body,page,limit){
  let raw=[],total=0,items=[];
  if(source==='netease'){
    const result=body.result||body.data||{};raw=result.songs||result.resources?.map(x=>x.baseInfo?.simpleSongData)||[];total=result.songCount||result.totalCount||0;
    items=raw.map(item=>row(source,item.id,item.name,singer(item.ar||item.artists),item.al?.name||item.album?.name,item.al?.picUrl||item.album?.picUrl,item.dt||item.duration,{songmid:String(item.id),albumId:String(item.al?.id||item.album?.id||''),types:[{type:'128k'},...(item.h?[{type:'320k'}]:[]),...(item.sq?[{type:'flac'}]:[])]}));
  }else if(source==='kugou'){
    const data=body.data||{};raw=data.lists||data.info||[];total=data.total||0;
    items=raw.flatMap(item=>[item,...(Array.isArray(item.Grp)?item.Grp:[])]).map(item=>row(source,item.FileHash||item.hash,item.OriSongName||item.SongName||item.songname||String(item.FileName||item.filename||'').split(' - ').slice(1).join(' - '),singer(item.Singers)||item.SingerName||item.singername,item.AlbumName,item.Image||item.ImageUrl||item.imgurl,Number(item.Duration||item.duration)*1000,{hash:item.FileHash||item.hash,songmid:String(item.Audioid||item.audio_id||''),albumAudioId:String(item.MixSongID||item.mixsongid||''),albumId:String(item.AlbumID||item.album_id||''),types:[{type:'128k',hash:item.FileHash||item.hash},...(item.HQFileHash?[{type:'320k',hash:item.HQFileHash}]:[]),...(item.SQFileHash?[{type:'flac',hash:item.SQFileHash}]:[])]}));
  }else if(source==='qq'){
    const data=(body['music.search.SearchCgiService']||body.req)?.data||body.data||{};raw=data.body?.song?.list||data.song?.list||[];total=data.meta?.sum||data.song?.totalnum||0;
    items=raw.map(item=>row(source,item.mid||item.songmid,item.title||item.songname,singer(item.singer),item.album?.name||item.albumname,`https://y.gtimg.cn/music/photo_new/T002R500x500M000${item.album?.mid||item.albummid}.jpg`,Number(item.interval)*1000,{songmid:String(item.mid||item.songmid),songId:String(item.id||item.songid),strMediaMid:String(item.file?.media_mid||item.strMediaMid||item.mid||''),albumId:String(item.album?.mid||item.albummid||''),albumMid:String(item.album?.mid||item.albummid||''),types:[{type:'128k'},...(item.file?.size_320mp3?[{type:'320k'}]:[]),...(item.file?.size_flac?[{type:'flac'}]:[])]}));
  }else if(source==='kuwo'){
    raw=body.abslist||[];total=Number(body.TOTAL)||0;
    items=raw.map(item=>{const quality=String(item.N_MINFO||'');const list=[{type:'128k'},...(quality.includes('bitrate:320,')?[{type:'320k'}]:[]),...(quality.includes('bitrate:2000,')?[{type:'flac'}]:[])];const id=String(item.MUSICRID||item.RID||'').replace('MUSIC_','');return row(source,id,item.SONGNAME||item.NAME,clean(item.ARTIST).replace(/&/g,'、'),item.ALBUM,item.pic||'',Number(item.DURATION)*1000,{songmid:id,albumId:String(item.ALBUMID||''),types:list});});
  }else if(source==='migu'){
    const data=body.songResultData||{};raw=(data.resultList||[]).flat();total=Number(data.totalCount)||0;
    items=raw.map(item=>row(source,item.copyrightId,item.name,singer(item.singerList),item.album,((item.img3||item.img2||item.img1||'').startsWith('/')?'https://d.musicapp.migu.cn':'')+(item.img3||item.img2||item.img1||''),Number(item.duration)*1000,{songmid:String(item.songId),copyrightId:String(item.copyrightId),albumId:String(item.albumId||''),types:(item.audioFormats||[]).map(f=>({type:({PQ:'128k',HQ:'320k',SQ:'flac'})[f.formatType]}))}));
  }
  const seen=new Set();items=items.filter(item=>item&&!seen.has(item.key)&&seen.add(item.key)).slice(0,limit);
  return {source,items,total:Math.max(items.length,Math.min(1000000,Number(total)||0)),page,limit,hasMore:page<50&&page*limit<total};
}

// QQ 签名算法参考 LX Music Desktop（Apache-2.0），见 THIRD_PARTY_NOTICES.md。
function qqSign(text){const hash=createHash('sha1').update(text).digest('hex'),pick=ids=>ids.map(i=>hash[i]).join('');const mask=[89,39,179,150,218,82,58,252,177,52,186,123,120,64,242,133,143,161,121,179];const body=Buffer.from(mask.map((n,i)=>n^parseInt(hash.slice(i*2,i*2+2),16))).toString('base64').replace(/[\/+=]/g,'');return `zzc${pick([23,14,6,36,16,40,7,19])}${body}${pick([16,1,32,12,19,27,8,5])}`.toLowerCase();}
const pending=new Map();let inFlight=0;
export async function searchCatalog(input,call,request=publicRequest){
  const source=input.channel,query=typeof input.query==='string'?input.query.normalize('NFKC').trim().replace(/\s+/g,' '):'',page=Number(input.page||1),limit=15;
  if(!channels[source]||!query||query.length>100||/[\u0000-\u001f]/.test(query)||!Number.isInteger(page)||page<1||page>50)throw new Error('invalid_search');
  const key=JSON.stringify([source,query.toLocaleLowerCase(),page]);const cached=pending.get(key);if(cached&&cached.until>Date.now())return cached.promise;
  if(inFlight>=4)throw new Error('search_busy');
  for(const [id,item] of pending)if(item.until<=Date.now())pending.delete(id);if(pending.size>=128)pending.delete(pending.keys().next().value);
  const promise=(async()=>{
    inFlight++;try{
      let body;
      if(source==='netease')body=(await call(source,'cloudsearch',{keywords:query,type:1,limit,offset:(page-1)*limit})).body;
      else if(source==='kugou')body=(await call(source,'search',{keywords:query,page,pagesize:limit})).body;
      else if(source==='qq'){
        const data={comm:{ct:19,cv:2151,uin:'0',tmeAppID:'qqmusic',tmeLoginType:0},'music.search.SearchCgiService':{module:'music.search.SearchCgiService',method:'DoSearchForQQMusicDesktop',param:{grp:1,num_per_page:limit,page_num:page,query,remoteplace:'txt.newclient.top',search_type:0,searchid:randomBytes(16).toString('hex').toUpperCase()+'00001'}}};
        body=(await request(`https://u.y.qq.com/cgi-bin/musics.fcg?sign=${qqSign(JSON.stringify(data))}`,{method:'POST',body:data,headers:{'User-Agent':'QQMusic 14090508(android 12)'},timeout:8000})).body;
      }else if(source==='kuwo'){
        const url='http://search.kuwo.cn/r.s?'+new URLSearchParams({client:'kt',all:query,pn:String(page-1),rn:String(limit),ver:'kwplayer_ar_9.2.2.1',vipver:'1',show_copyright_off:'1',newver:'1',ft:'music',cluster:'0',strategy:'2012',encoding:'utf8',rformat:'json',vermerge:'1',mobi:'1'});
        body=(await request(url,{timeout:8000})).body;
      }else{
        const time=String(Date.now()),device='963B7AA0D21511ED807EE5846EC87D20';const sign=createHash('md5').update(`${query}6cdc72a439cef99a3418d2a78aa28c73yyapp2d16148780a1dcc7408e06336b98cfd50${device}${time}`).digest('hex');
        body=(await request('https://jadeite.migu.cn/music_search/v3/search/searchAll?'+new URLSearchParams({isCorrect:'0',isCopyright:'1',searchSwitch:JSON.stringify({song:1,album:0,singer:0,tagSong:1,mvSong:0,bestShow:1,songlist:0,lyricSong:0}),pageSize:String(limit),text:query,pageNo:String(page),sort:'0',sid:'USS'}),{headers:{uiVersion:'A_music_3.6.1',deviceId:device,timestamp:time,sign,channel:'0146921','User-Agent':'Mozilla/5.0 (Linux; Android 11) AppleWebKit/537.36 Mobile Safari/537.36'},timeout:8000})).body;
      }
      if(!body||typeof body!=='object'||source==='qq'&&(body.code!==0||(body['music.search.SearchCgiService']||body.req)?.code!==0)||source==='migu'&&body.code!=='000000'||source==='netease'&&body.code!==200||source==='kugou'&&(Number(body.error_code||0)!==0||body.status===0)||source==='kuwo'&&!Object.hasOwn(body,'TOTAL'))throw new Error('search_unavailable');
      return normalizeCatalog(source,body,page,limit);
    }finally{inFlight--;}
  })();pending.set(key,{promise,until:Date.now()+300000});promise.catch(()=>{if(pending.get(key)?.promise===promise)pending.delete(key);});return promise;
}
