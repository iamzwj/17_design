export const SEEDANCE_MODELS = [
  { value: 'doubao-seedance-2-5-260628', label: 'Seedance 2.5', resolutions: ['480p', '720p', '1080p'], maximum: 30, seedance25: true },
  { value: 'doubao-seedance-2-0-260128', label: 'Seedance 2.0', resolutions: ['480p', '720p', '1080p', '4k'], maximum: 15 },
  { value: 'doubao-seedance-2-0-fast-260128', label: 'Seedance 2.0 Fast', resolutions: ['480p', '720p'], maximum: 15 },
  { value: 'doubao-seedance-2-0-mini-260615', label: 'Seedance 2.0 Mini', resolutions: ['480p', '720p'], maximum: 15 },
]

export const FILM_VIDEO_MODELS = [
  { value: 'minimax-h3', label: 'MiniMax H3', resolutions: ['480p', '768p', '1080p'] },
  { value: 'wan-3.0', label: 'Wan 3.0', resolutions: ['480p', '720p', '1080p'] },
  ...SEEDANCE_MODELS,
]

export function filmVideoResolutions(model) {
  return FILM_VIDEO_MODELS.find((option) => option.value === model)?.resolutions || []
}

export function filmVideoResolution(model, resolution) {
  const choices = filmVideoResolutions(model)
  return choices.includes(resolution) ? resolution : choices[0]
}

export function filmOutputDimensions(project) {
  const shortEdge = project.videoResolution === '4k' ? 2160 : Number.parseInt(project.videoResolution, 10) || 720
  const longEdge = Math.round(shortEdge * 8 / 9) * 2
  return project.ratio === '16:9' ? [longEdge, shortEdge] : [shortEdge, longEdge]
}
