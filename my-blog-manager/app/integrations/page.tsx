import PageHeader from '../../components/manager/PageHeader';
import IntegrationForm from '../../components/manager/IntegrationForm';
export default function IntegrationsPage() { return <><PageHeader eyebrow="External services" title="集成" description="配置 Bangumi、Giscus、图床和 AI。私密凭据仅保存在本机 workspace/config。" /><IntegrationForm /></>; }
