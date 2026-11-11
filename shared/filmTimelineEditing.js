export function filmClipDuration(shot) {
  return Number(shot?.audio?.source === shot?.video?.file && shot?.audio?.duration) || Number(shot?.duration) || .2;
}

function spans(clips) {
  let position = 0;
  return clips.map(clip => {
    const result = { ...clip, start: position, end: position + Number(clip.duration) };
    position = result.end;
    return result;
  });
}

/** Keep annotations attached to the source footage when video is cut or moved. */
export function editFilmClips(timeline, clips) {
  const before = spans(timeline.clips);
  const after = spans(clips);
  const captions = [];
  for (const caption of timeline.captions || []) {
    for (const old of before) {
      const start = Math.max(caption.start, old.start);
      const end = Math.min(caption.end, old.end);
      if (end <= start) continue;
      const sourceStart = Number(old.trimIn) + start - old.start;
      const sourceEnd = Number(old.trimIn) + end - old.start;
      for (const clip of after.filter(item => item.shotId === old.shotId)) {
        const from = Math.max(sourceStart, Number(clip.trimIn));
        const to = Math.min(sourceEnd, Number(clip.trimIn) + Number(clip.duration));
        if (to > from) captions.push({ ...caption, start: clip.start + from - clip.trimIn, end: clip.start + to - clip.trimIn });
      }
    }
  }
  const tracks = (timeline.tracks || []).flatMap(track => {
    if (track.kind === 'music' && track.loop) return [track];
    const old = before.find(clip => track.start >= clip.start && track.start < clip.end);
    if (!old) return [track];
    const source = Number(old.trimIn) + track.start - old.start;
    const next = after.find(clip => clip.shotId === old.shotId && source >= clip.trimIn && source < Number(clip.trimIn) + Number(clip.duration));
    return next ? [{ ...track, start: next.start + source - next.trimIn }] : [];
  });
  return { ...timeline, clips, tracks, captions: captions.sort((a,b) => a.start - b.start) };
}
