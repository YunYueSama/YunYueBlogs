export const musicChannels={netease:{name:'网易云音乐',lx:'wy'},kugou:{name:'酷狗音乐',lx:'kg'},qq:{name:'QQ 音乐',lx:'tx'},kuwo:{name:'酷我音乐',lx:'kw'},migu:{name:'咪咕音乐',lx:'mg'}};
export type MusicChannel=keyof typeof musicChannels;
export type ChannelInfo={id:MusicChannel;name:string;qualities:string[]};
export const validMusicId=(source:string,id:unknown):id is string=>typeof id==='string'&&Object.hasOwn(musicChannels,source)&&(source==='kugou'?/^[a-f0-9]{32}$/i:source==='netease'||source==='kuwo'?/^\d{1,20}$/:/^[a-zA-Z0-9]{1,64}$/).test(id);
export type MusicTrack={key:string;source:MusicChannel;id:string;name:string;artist?:string;album?:string;cover?:string;durationMs?:number;albumId?:string;albumAudioId?:string;lx?:Record<string,unknown>;[key:string]:unknown};

// 只保留公开取源标识，类型 Hash 表由受限字段重建，不能注入任意地址或脚本参数。
export function safeLxMetadata(value:unknown):Record<string,unknown>|undefined {
  if(!value||typeof value!=='object'||Array.isArray(value))return;
  const input=value as Record<string,unknown>,out:Record<string,unknown>={};
  for(const key of ['songmid','songId','strMediaMid','copyrightId','albumMid'])if(/^[a-zA-Z0-9]{1,64}$/.test(String(input[key]||'')))out[key]=String(input[key]);
  const types=Array.isArray(input.types)?input.types.filter((row):row is Record<string,unknown>=>!!row&&typeof row==='object'&&!Array.isArray(row)).filter(row=>['128k','320k','flac'].includes(String(row.type))).slice(0,3).map(row=>({type:row.type,...(/^[a-f0-9]{32}$/i.test(String(row.hash||''))?{hash:row.hash}:{})})):[];
  return {...out,types,_types:Object.fromEntries(types.map(row=>[String(row.type),row]))};
}
