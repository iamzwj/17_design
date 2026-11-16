import { availableLanguageModels, requestAvailableLanguageModel } from './languageModels.js'
import { filmImageJpeg } from './filmFrameReferences.js'
/** Try independent vision providers and validate evidence before accepting a review. */
export async function reviewFilmImages(api, parts, { timeout = 60_000, budget = Infinity } = {}) {
  const models = availableLanguageModels();
  if (!models.length) throw Error('所有视觉模型处于故障冷却中');
  const failures = [];
  const content = await Promise.all(parts.map(async part => {
    if (part.text) return {type:'text',text:part.text};
    const image = await filmImageJpeg(part.file, part.maxEdge);
    return {type:'image_url',image_url:{url:`data:image/jpeg;base64,${image.toString('base64')}`}};
  }));
  const deadline = Date.now() + budget;
  for (const model of models) {
    if (!availableLanguageModels().includes(model)) continue;
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    try {
      const result = await requestAvailableLanguageModel(api, '/v1/chat/completions', {
        model, response_format:{type:'json_object'},
        messages:[{role:'user',content}],
      }, Math.min(timeout, remaining));
      const raw = result.choices?.[0]?.message?.content;
      const review = JSON.parse(String(raw).trim().replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,''));
      if (!['pass','repair','review'].includes(review.status) || !['high','low'].includes(review.confidence) || typeof review.summary !== 'string' || !review.summary.trim()) throw Error('审核缺少有效图像证据');
      if (review.confidence !== 'high') review.status = 'review';
      return {...review, model};
    } catch (error) {
      const message = error.name === 'TimeoutError' || /timeout|timed out/i.test(error.message)
        ? '审核请求超时' : error.message;
      failures.push(model + '：' + message);
    }
  }
  throw Error('视觉审核服务均未完成。' + (failures.join('；') || '可用模型已进入故障冷却'));
}
