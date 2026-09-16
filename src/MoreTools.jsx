import PleaseDayAvatarStudio from './PleaseDayAvatarStudio.jsx'
import QrBatchStudio from './QrBatchStudio.jsx'
import LogoTool from './LogoTool.jsx'

export default function MoreTools({ tool }) {
  if (tool === 'logo') return <LogoTool/>
  return tool === 'qr' ? <QrBatchStudio/> : <PleaseDayAvatarStudio/>
}
