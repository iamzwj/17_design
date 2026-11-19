import PleaseDayAvatarStudio from './PleaseDayAvatarStudio.jsx'
import QrBatchStudio from './QrBatchStudio.jsx'
import PulinReport from './PulinReport.jsx'

export default function MoreTools({ tool, user, onLogin }) {
  if (tool === 'pulin-report') return <PulinReport user={user} onLogin={onLogin}/>
  return tool === 'qr' ? <QrBatchStudio/> : <PleaseDayAvatarStudio/>
}
