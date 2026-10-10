import PageHeader from '../../components/manager/PageHeader';
import IntegrationForm from '../../components/manager/IntegrationForm';
export default function IntegrationsPage() { return <><PageHeader eyebrow="External services" title="集成" description="配置 Bangumi、图床和 Robin。Robin 固定使用 DeepSeek-V4.1-Flash，可在这里安全配置密钥并同步到 Vercel。" /><IntegrationForm /></>; }
