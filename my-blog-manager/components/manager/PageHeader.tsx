export default function PageHeader({ eyebrow, title, description, actions }: { eyebrow: string; title: string; description: string; actions?: React.ReactNode }) {
  return <header className="console-page-header"><div><p>{eyebrow}</p><h1>{title}</h1><span>{description}</span></div>{actions && <div className="console-page-actions">{actions}</div>}</header>;
}
