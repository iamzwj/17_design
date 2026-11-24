export default function WorkspaceLoading({children='正在加载内容…',fluid=false}) {
 return <div className={`workspace-loading${fluid?' is-fluid':''}`} role="status" aria-live="polite"><span className="workspace-loading-copy"><i aria-hidden="true"/>{children}</span></div>;
}
