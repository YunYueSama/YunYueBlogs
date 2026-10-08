import ProjectsBoard from './ProjectsBoard';
import { readWorkspaceJson } from '../../lib/workspaceData';
import type { ProjectRecord } from '../../lib/operationTypes';

export const metadata = {
  title: '项目档案',
  description: '管理公开项目、技术栈与仓库地址。',
};

export default async function ProjectsPage() {
  const projects = await readWorkspaceJson<ProjectRecord[]>('projects', []);
  return <ProjectsBoard initialProjects={projects} />;
}
