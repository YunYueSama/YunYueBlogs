import {expect,it} from 'vitest';
import {musicAddressExpiry} from '../worker/music-expiry';
it('网易云地址按北京时间签名截止时间预留一分钟，最长缓存十五分钟，降级地址缩短复用时间',()=>{
  const now=Date.UTC(2026,10,3,13);
  expect(musicAddressExpiry('https://m7.music.126.net/20261103212000/token/song.mp3',now)).toBe(now+900000);
  expect(musicAddressExpiry('https://m7.music.126.net/20261103211000/token/song.mp3',now)).toBe(now+540000);
  expect(musicAddressExpiry('https://m7.music.126.net/20261103212000/token/song.mp3',now,60000)).toBe(now+60000);
  expect(musicAddressExpiry('https://m7.music.126.net/20261103210200/token/song.mp3',now)).toBe(now+60000);
  expect(musicAddressExpiry('https://m7.music.126.net/20261103210000/token/song.mp3',now)).toBe(now);
  expect(musicAddressExpiry('https://dl.stream.qqmusic.qq.com/song.mp3',now)).toBe(now+120000);
});
