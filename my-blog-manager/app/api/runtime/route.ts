import fs from 'node:fs/promises';
import path from 'node:path';

export const dynamic = 'force-dynamic';
export async function GET() {
  try {
    const root = process.env.YUNYUE_MANAGER_ROOT || process.cwd();
    const config = JSON.parse(await fs.readFile(path.join(/*turbopackIgnore: true*/ root, 'public', 'backend_config.json'), 'utf8'));
    return Response.json({ api_port: config.api_port }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json({ error: '请重启管理端' }, { status: 503 });
  }
}
