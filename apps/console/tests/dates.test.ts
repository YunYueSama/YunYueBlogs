import { expect,it } from 'vitest';
import { normalizeStudioDate,studioDateTimeInput } from '../src/dates';
it('内容与编辑器统一使用北京时间，不将 UTC 字符串直接截成表单时间',()=>{
  expect(studioDateTimeInput('2026-11-02T09:10:00.000Z')).toBe('2026-11-02T17:10');
  expect(studioDateTimeInput('2026-07-07 15:25:21')).toBe('2026-07-07T15:25');
  expect(normalizeStudioDate('2026-11-02')).toBe('2026-11-02T00:00:00+08:00');
});
