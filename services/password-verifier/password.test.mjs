import test from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword } from './api/password.mjs';

test('随机盐、密码核验和不可信哈希参数', async () => {
  const password = 'test-only / unusual 中文 password';
  const a = await hashPassword(password);
  const b = await hashPassword(password);
  assert.notEqual(a, b);
  assert.equal(await verifyPassword(password, a), true);
  assert.equal(await verifyPassword('wrong-password', a), false);
  assert.equal(await verifyPassword(password, 'scrypt$999999999$8$1$bad$bad'), false);
});
