import { LANGUAGE_MODELS } from './languageModels.js'
/** Try independent vision providers and validate evidence before accepting a review. */
export async function reviewFilmImages(api, parts) {
  const failures = [];
  const content = parts.map(part => part.text ? {type:'text',text:part.text} : {
    type:'image_url',image_url:{url:`data:${part.inline_data.mime_type};base64,${part.inline_data.data}`},
  });
  for (const model of LANGUAGE_MODELS) {
    try {
      const result = await api('/v1/chat/completions', {
        model, response_format:{type:'json_object'},
        messages:[{role:'user',content}],
      }, 60000);
      const raw = result.choices?.[0]?.message?.content;
      const review = JSON.parse(String(raw).trim().replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,''));
      if (!['pass','repair','review'].includes(review.status) || !['high','low'].includes(review.confidence) || typeof review.summary !== 'string' || !review.summary.trim()) throw Error('审核缺少有效图像证据');
      if (review.confidence !== 'high') review.status = 'review';
      return {...review, model};
    } catch (error) {
      failures.push(model + '：' + error.message);
    }
  }
  throw Error('视觉审核服务均未完成。' + failures.join('；'));
}
