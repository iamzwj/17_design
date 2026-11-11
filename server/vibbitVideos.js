import { SEEDANCE_MODELS } from '../shared/filmVideoModels.js'
import { vibbitApi, normalizeVibbitTask } from './vibbitImages.js'

export async function submitSeedanceShot({ model, prompt, images, tailFrameImageUrl, duration, resolution, aspectRatio }) {
  const info = SEEDANCE_MODELS.find((entry) => entry.value === model)
  const input = {
    model,
    prompt,
    duration_seconds: Math.min(info.maximum, Math.max(4, duration)),
    resolution,
    aspect_ratio: aspectRatio,
    generate_audio: true,
  }
  if (tailFrameImageUrl && images[0]) {
    input.first_frame_image_url = images[0]
    input.last_frame_image_url = tailFrameImageUrl
    input.aspect_ratio = 'adaptive'
  } else if (images.length === 1) {
    input.first_frame_image_url = images[0]
    input.aspect_ratio = 'adaptive'
  } else if (images.length > 1) {
    input.reference_image_urls = images
    if (info.seedance25) input.omni_reference_task_type = 'reference'
  }
  const task = await vibbitApi('/tasks', {
    method: 'POST',
    body: JSON.stringify({ task_type: 'SEEDANCE_VIDEO_GENERATION', input_info: { input: JSON.stringify(input) } }),
  })
  return { id: task.task_id }
}

export async function pollSeedanceShot(id) {
  const task = await vibbitApi(`/tasks/${encodeURIComponent(id)}`)
  return normalizeVibbitTask(task, id, 'video_url')
}
