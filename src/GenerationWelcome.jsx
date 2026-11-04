import { Icon } from './icons.jsx'

export default function GenerationWelcome({ video = false }) {
  return <div className="welcome">
    <div className="welcome-art" aria-hidden="true">
      <div className="art-card back"><span/><span/><span/></div>
      <div className="art-card front"><Icon name={video ? 'video' : 'image'} size={34}/><i/><b/></div>
      <div className="art-spark one">✦</div><div className="art-spark two">✦</div>
    </div>
    <h1>{video ? '让脑海里的故事，' : '把脑海里的画面，'}<em>{video ? '动起来。' : '带到眼前。'}</em></h1>
    <p>{video ? '描述你的想法，或上传参考图片、视频。选择参考方式，让你的创意成为生动的画面。' : '描述你的想法，或上传参考图片。你可以像聊天一样不断调整，直到它真正符合你的想象。'}</p>
  </div>
}
