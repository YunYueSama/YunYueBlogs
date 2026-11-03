// 地址缓存不能超过上游签名的有效期；无法识别期限的渠道采用较短窗口。
export function musicAddressExpiry(raw:string,now=Date.now(),maximum=900000){
  const url=new URL(raw),stamp=url.hostname.endsWith('.music.126.net')&&url.pathname.match(/^\/(20\d{12})\//)?.[1];
  if(!stamp)return now+Math.min(120000,maximum);
  const expiry=Date.UTC(Number(stamp.slice(0,4)),Number(stamp.slice(4,6))-1,Number(stamp.slice(6,8)),Number(stamp.slice(8,10))-8,Number(stamp.slice(10,12)),Number(stamp.slice(12,14)));
  return Math.max(now,Math.min(now+maximum,expiry-60000));
}
