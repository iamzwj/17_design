export default function ToolPageHeader({ eyebrow, title, description = '' }) {
  return <header className="tool-page-header">
    <span>{eyebrow}</span>
    <h1>{title}</h1>
    <p className={description ? '' : 'is-placeholder'}>{description || '\u00a0'}</p>
  </header>
}
