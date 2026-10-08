import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';
import { connection } from 'next/server';
import { cache } from 'react';

const managerRoot = process.env.YUNYUE_MANAGER_ROOT
  ? path.resolve(process.env.YUNYUE_MANAGER_ROOT)
  : process.cwd();
const workspaceRoot = path.join(/*turbopackIgnore: true*/ managerRoot, 'workspace');

const prepareWorkspace = cache(async () => {
  await connection();
  const port = JSON.parse(fs.readFileSync(path.join(/*turbopackIgnore: true*/ managerRoot, 'public/backend_config.json'), 'utf8')).api_port;
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('后台连接配置无效，请重启控制台');
  const response = await fetch(`http://127.0.0.1:${port}/api/cloud/refresh`, { cache: 'no-store', signal: AbortSignal.timeout(60_000) });
  const result = await response.json();
  if (!response.ok || !result.ok) throw new Error(result.error?.message || '无法同步服务器内容，请稍后重试');
});

const contentPaths = {
  posts: path.join(workspaceRoot, 'content', 'posts'),
  chatters: path.join(workspaceRoot, 'content', 'chatters'),
  moments: path.join(workspaceRoot, 'content', 'moments'),
} as const;
const dataPaths = {
  albums: path.join(workspaceRoot, 'data', 'albums.json'),
  friends: path.join(workspaceRoot, 'data', 'friends.json'),
  projects: path.join(workspaceRoot, 'data', 'projects.json'),
  site: path.join(workspaceRoot, 'data', 'site.json'),
} as const;

export function contentDirectory(type: 'posts' | 'chatters' | 'moments') {
  return contentPaths[type];
}

export async function contentCounts() {
  await prepareWorkspace();
  return Object.fromEntries((['posts', 'chatters', 'moments'] as const).map((type) => {
    const directory = contentDirectory(type);
    const count = fs.existsSync(directory) ? fs.readdirSync(directory).filter((name) => name.endsWith('.md')).length : 0;
    return [type, count];
  })) as Record<'posts' | 'chatters' | 'moments', number>;
}

export async function listDocuments(type: 'posts' | 'chatters') {
  await prepareWorkspace();
  const directory = contentDirectory(type);
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory).filter((name) => name.endsWith('.md')).map((name) => {
    const source = fs.readFileSync(path.join(directory, name), 'utf8');
    const parsed = matter(source);
    return { id: name.replace(/\.md$/, ''), type: type === 'posts' ? 'post' : 'chatter', title: String(parsed.data.title || '无标题'), date: String(parsed.data.date || ''), description: String(parsed.data.description || ''), tags: Array.isArray(parsed.data.tags) ? parsed.data.tags.map(String) : [] };
  }).sort((a, b) => b.date.localeCompare(a.date));
}

export interface WorkspaceMoment {
  id: string;
  date: string;
  location: string;
  images: string[];
  content: string;
}

export async function listMoments(): Promise<WorkspaceMoment[]> {
  await prepareWorkspace();
  const directory = contentDirectory('moments');
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory).filter((name) => name.endsWith('.md')).map((name) => {
    const parsed = matter(fs.readFileSync(path.join(directory, name), 'utf8'));
    return {
      id: name.replace(/\.md$/, ''),
      date: String(parsed.data.date || '1970-01-01'),
      location: String(parsed.data.location || ''),
      images: Array.isArray(parsed.data.images) ? parsed.data.images.map(String) : [],
      content: parsed.content.trim(),
    };
  }).sort((a, b) => b.date.localeCompare(a.date));
}

export async function readWorkspaceJson<T>(name: keyof typeof dataPaths, fallback: T): Promise<T> {
  await prepareWorkspace();
  const file = dataPaths[name];
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) as T; } catch { return fallback; }
}

export function readDeployConfig() {
  try { return JSON.parse(fs.readFileSync(path.join(workspaceRoot, 'config', 'deploy.json'), 'utf8')) as { blogPath?: string; remote?: string; branch?: string }; } catch { return {}; }
}
