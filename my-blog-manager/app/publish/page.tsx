import PageHeader from '../../components/manager/PageHeader';
import PublishClient from '../../components/manager/PublishClient';
export default function PublishPage() { return <><PageHeader eyebrow="Safe delivery" title="发布" description="先预览差异，再原子同步，最后使用中文提交推送 GitHub。任何无关改动都会阻止操作。" /><PublishClient /></>; }
