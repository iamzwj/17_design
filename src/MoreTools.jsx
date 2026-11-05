import PleaseDayAvatarStudio from './PleaseDayAvatarStudio.jsx'
import QrBatchStudio from './QrBatchStudio.jsx'

export default function MoreTools({ tool }) {
  return tool === 'qr' ? <QrBatchStudio/> : <PleaseDayAvatarStudio/>
}
