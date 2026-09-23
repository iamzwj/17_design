import PleaseDayAvatarStudio from './PleaseDayAvatarStudio.jsx'
import QrBatchStudio from './QrBatchStudio.jsx'
import LogoTool from './LogoTool.jsx'
import PulinTitleStudio from './PulinTitleStudio.jsx'

export default function MoreTools({ tool, onUserUpdate, onRequireLogin }) {
  if (tool === 'pulin-title') return <PulinTitleStudio onUserUpdate={onUserUpdate} onRequireLogin={onRequireLogin}/>
  if (tool === 'logo') return <LogoTool/>
  return tool === 'qr' ? <QrBatchStudio/> : <PleaseDayAvatarStudio/>
}
