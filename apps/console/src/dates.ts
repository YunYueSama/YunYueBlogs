export function normalizeStudioDate(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return `${value}T00:00:00+08:00`;
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(value)) return `${value.replace(' ', 'T')}+08:00`;
  return value;
}
export function studioDateTimeInput(value:string) {
  const normalized=normalizeStudioDate(value);
  if(!Number.isFinite(Date.parse(normalized)))return '';
  return new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(normalized)).replace(' ','T');
}
