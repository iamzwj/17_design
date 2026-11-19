import { useRef } from 'react'
import PleaseDayAvatarStudio from './PleaseDayAvatarStudio.jsx'
import QrBatchStudio from './QrBatchStudio.jsx'
import PulinReport from './PulinReport.jsx'

export default function MoreTools({ tool, user, onLogin, conversation, onSave }) {
  const taskId = useRef(conversation?.id || crypto.randomUUID())
  if (tool === 'pulin-report') return <PulinReport user={user} onLogin={onLogin} taskId={taskId.current} onSave={onSave}/>
  return tool === 'qr' ? <QrBatchStudio/> : <PleaseDayAvatarStudio/>
}
