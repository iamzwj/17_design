export const MAX_CHAT_HTML_CHARACTERS = 200_000
export const MAX_CHAT_MESSAGE_CHARACTERS = 240_000

export function validateChatMessageLength(content) {
  if (content.length <= MAX_CHAT_MESSAGE_CHARACTERS) return content
  throw Object.assign(new Error('单条聊天消息的正文和附件合计超过 240,000 字符，请分批发送'), { status: 400 })
}
