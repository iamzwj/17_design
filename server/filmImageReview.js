import { LANGUAGE_MODELS } from './languageModels.js'
import sharp from 'sharp'
/** Try independent vision providers and validate evidence before accepting a review. */
export async function reviewFilmImages(api, parts) {
  const failures = [];
  const content = await Promise.all(parts.map(async part => {
    if (part.text) return {type:'text',text:part.text};
    const image = await sharp(Buffer.from(part.inline_data.data, 'base64'))
      .rotate().resize(1536, 1536, {fit:'inside', withoutEnlargement:true})
      .flatten({background:'#ffffff'}).jpeg({quality:85}).toBuffer();
    return {type:'image_url',image_url:{url:`data:image/jpeg;base64,${image.toString('base64')}`}};
  }));
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
