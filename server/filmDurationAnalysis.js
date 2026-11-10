export function validateFilmDurationAnalysis(parsed) {
  if (!Array.isArray(parsed.beats) || parsed.beats.length < 2) throw Error('缺少故事事件拆分')
  const beats = parsed.beats.map((beat) => {
    if (typeof beat.id !== 'string' || !beat.id.trim() || typeof beat.description !== 'string' || !beat.description.trim() || typeof beat.dialogue !== 'string') throw Error('故事事件格式无效')
    return beat
  })
  if (new Set(beats.map((beat) => beat.id)).size !== beats.length) throw Error('故事事件编号重复')
  const options = ['compact', 'normal', 'slow'].map((pace) => {
    const option = parsed.options?.find((item) => item.pace === pace)
    if (!Array.isArray(option?.segments) || option.segments.length !== beats.length || typeof option.reason !== 'string' || !option.reason.trim()) throw Error('节奏方案缺少分场或说明')
    let duration = 0
    for (const beat of beats) {
      const matches = option.segments.filter((segment) => segment.beatId === beat.id)
      const seconds = Number(matches[0]?.seconds)
      const speechCharacters = Array.from(beat.dialogue.replace(/[\s\p{P}\p{S}]/gu, '')).length
      if (matches.length !== 1 || !Number.isInteger(seconds) || seconds < Math.max(3, Math.ceil(speechCharacters / 3))) throw Error('分场时长无法容纳动作或对白')
      duration += seconds
    }
    if (duration < 15 || duration > 600) throw Error('总时长超出支持范围')
    return { pace, duration, reason: option.reason.trim().slice(0, 300), segments: option.segments }
  })
  for (const beat of beats.filter((item) => item.dialogue.trim())) {
    const compact = options[0].segments.find((segment) => segment.beatId === beat.id)
    const normal = options[1].segments.find((segment) => segment.beatId === beat.id)
    if (compact.seconds < normal.seconds) throw Error('紧凑版本对白场景不能快于正常版本')
  }
  if (options[0].duration >= options[1].duration || options[1].duration >= options[2].duration) throw Error('三个节奏的时长顺序无效')
  return { options, duration: options[1].duration, reason: options[1].reason, beats }
}
