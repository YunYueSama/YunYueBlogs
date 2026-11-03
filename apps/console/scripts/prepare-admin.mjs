import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { hashPassword } from '../../../services/password-verifier/api/password.mjs';

const username=process.env.CONSOLE_ADMIN_USERNAME;
const password=process.env.CONSOLE_INITIAL_PASSWORD;
if(!username||!password||!process.argv[2]) throw new Error('请通过进程环境注入账号和初始密码，并传入被忽略的输出文件。不要把凭据写入源码或命令记录。');
const stamp=new Date().toISOString();const id=randomUUID();
const activationToken=randomBytes(32).toString('hex');
const entry={sql:'INSERT INTO admin_users(id,username,password_hash,must_change_password,bootstrap_hash,bootstrap_expires,created_at,updated_at) VALUES (?,?,?,1,?,?,?,?)',params:[id,username,await hashPassword(password),createHash('sha256').update(activationToken).digest('hex'),Math.floor(Date.now()/1000)+86400,stamp,stamp]};
await writeFile(resolve(process.argv[2]),JSON.stringify([entry]),{encoding:'utf8',flag:'wx'});
await writeFile(resolve(process.argv[2])+'.activation.json',JSON.stringify({activationToken,expiresAt:new Date(Date.now()+86400000).toISOString()}),{encoding:'utf8',flag:'wx'});
console.log('初始化批次已生成；仅包含带盐哈希，未写入数据库。重复执行不会覆盖既有文件。');
