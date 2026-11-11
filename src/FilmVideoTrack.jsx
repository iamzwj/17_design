import { useRef, useState } from 'react';
import FilmMedia from './FilmMedia.jsx';
import './filmVideoTrack.css';

const MIN_CLIP = 0.2;
const MAX_CLIPS = 80;
const SCALE = 40;
const round = seconds => Math.round(seconds * 1000) / 1000;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export default function FilmVideoTrack({ project, clips, onChange, onSelect }) {
  const [selected, setSelected] = useState(0);
  const [position, setPosition] = useState(0);
  const [preview, setPreview] = useState(null);
  const drag = useRef(null);
  const track = useRef(null);
  const visible = preview || clips;
  const shots = new Map(project.shots.map(shot => [shot.id, shot]));
  let total = 0;
  const entries = visible.map(clip => {
    const start = total;
    total = round(total + Number(clip.duration));
    return { clip, start, end: total };
  });
  const playhead = clamp(position, 0, total);
  const entry = entries[selected];
  const offset = entry ? round(playhead - entry.start) : 0;
  const canSplit = !preview && entry && clips.length < MAX_CLIPS &&
    offset >= MIN_CLIP && round(entry.clip.duration - offset) >= MIN_CLIP;

  function seek(event) {
    const time = round(clamp((event.clientX - track.current.getBoundingClientRect().left) / SCALE, 0, total));
    setPosition(time);
    const index = entries.findIndex(item => time >= item.start && time < item.end);
    setSelected(index < 0 ? entries.length - 1 : index);
  }

  function trim(source, index, edge, delta) {
    const clip = source[index];
    const shot = shots.get(clip.shotId);
    const input = Number(clip.trimIn);
    const end = round(input + Number(clip.duration));
    const measured = shot?.audio?.source && shot.audio.source === shot.video?.file ? shot.audio.duration : null;
    const limit = Math.max(end, Number(measured || shot?.duration) || end);
    const start = edge === 'start' ? round(clamp(input + delta, Math.max(0, end - 15), Math.min(120, end - MIN_CLIP))) : input;
    const out = edge === 'end' ? round(clamp(end + delta, input + MIN_CLIP, Math.min(limit, input + 15))) : end;
    return source.map((item, i) => i === index ? { ...clip, trimIn: start, duration: round(out - start) } : item);
  }

  function beginTrim(event, index, edge) {
    if (event.button !== 0 || drag.current) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { pointer: event.pointerId, x: event.clientX, clips, index, edge };
    setSelected(index);
  }

  function updateTrim(event, commit) {
    const gesture = drag.current;
    if (!gesture || gesture.pointer !== event.pointerId) return;
    const delta = Math.round((event.clientX - gesture.x) / SCALE * 10) / 10;
    const next = trim(gesture.clips, gesture.index, gesture.edge, delta);
    if (commit) {
      drag.current = null;
      setPreview(null);
      const previous = gesture.clips[gesture.index];
      const changed = next[gesture.index];
      if (changed.trimIn !== previous.trimIn || changed.duration !== previous.duration) onChange(next);
    } else {
      setPreview(next);
    }
  }

  function cancelTrim() {
    drag.current = null;
    setPreview(null);
  }

  function split() {
    if (!canSplit) return;
    const clip = clips[selected];
    const right = { ...clip, trimIn: round(Number(clip.trimIn) + offset), duration: round(clip.duration - offset) };
    onChange([...clips.slice(0, selected), { ...clip, duration: offset }, right, ...clips.slice(selected + 1)]);
    setSelected(selected + 1);
  }

  function move(direction) {
    const target = selected + direction;
    if (!entry || target < 0 || target >= clips.length) return;
    const next = [...clips];
    [next[selected], next[target]] = [next[target], next[selected]];
    onChange(next);
    setSelected(target);
    setPosition(entries[Math.min(selected, target)].start + (direction > 0 ? Number(next[selected].duration) : 0));
  }

  const tickStep = total > 120 ? 10 : 5;
  return <section className="film-video-lane" aria-label="视频轨道">
    <div className="film-video-tools">
      <output aria-label="播放头时间">{playhead.toFixed(1)} 秒</output>
      <button type="button" onClick={split} disabled={!canSplit}>切开</button>
      <button type="button" disabled={!entry || clips.length < 2 || !!preview} onClick={() => {
        onChange(clips.filter((_, index) => index !== selected));
        setSelected(Math.min(selected, clips.length - 2));
        setPosition(entry.start);
      }}>删除片段</button>
      <button type="button" disabled={!entry || selected === 0 || !!preview} onClick={() => move(-1)}>前移</button>
      <button type="button" disabled={!entry || selected === clips.length - 1 || !!preview} onClick={() => move(1)}>后移</button>
      <button type="button" disabled={!entry} onClick={() => onSelect(entry.clip.shotId)}>查看镜头</button>
    </div>
    <div className="film-video-scroll" tabIndex={0} aria-label="横向滚动视频轨道">
      <div className="film-video-strip" ref={track} style={{ width: total * SCALE }}>
        <div className="film-video-ruler">
          {Array.from({ length: Math.floor(total / tickStep) + 1 }, (_, i) =>
            <span key={i} style={{ left: i * tickStep * SCALE }}>{i * tickStep}秒</span>)}
          <input type="range" aria-label="播放头位置" min={0} max={total} step=".001" value={playhead}
            onPointerDown={event => { event.preventDefault(); event.currentTarget.focus(); seek(event); }}
            onChange={event => {
              const time = Number(event.target.value);
              setPosition(time);
              setSelected(entries.findIndex(item => time >= item.start && (time < item.end || item.end === total)));
            }}/>
        </div>
        <div className="film-video-clips">
          {entries.map(({ clip, start, end }, index) => {
            const shot = shots.get(clip.shotId);
            const number = project.shots.indexOf(shot) + 1;
            return <div key={index} className="film-video-clip" data-selected={index === selected} style={{ width: Number(clip.duration) * SCALE }}>
              <button type="button" className="film-video-select" aria-pressed={index === selected}
                aria-label={`镜头 ${number}，${start.toFixed(1)} 到 ${end.toFixed(1)} 秒`}
                onClick={event => {
                  setSelected(index);
                  setPosition(event.detail ? round(clamp((event.clientX - track.current.getBoundingClientRect().left) / SCALE, start, end)) : start);
                }}>
                <span className="film-video-label">镜头 {number} · {Number(clip.duration).toFixed(1)}秒</span>
              </button>
                {shot?.frame?.file && <div className="film-video-thumbnail" aria-hidden="true"><FilmMedia project={project.id} file={shot.frame.file}/></div>}
              {['start', 'end'].map(edge => <button type="button" key={edge} className={`film-video-handle is-${edge}`}
                aria-label={`片段 ${index + 1} ${edge === 'start' ? '左' : '右'}侧裁剪`}
                onPointerDown={event => beginTrim(event, index, edge)}
                onPointerMove={event => updateTrim(event, false)}
                onPointerUp={event => updateTrim(event, true)}
                onPointerCancel={cancelTrim} onLostPointerCapture={cancelTrim}
                onKeyDown={event => {
                  if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
                  event.preventDefault();
                  setSelected(index);
                  onChange(trim(clips, index, edge, (event.key === 'ArrowLeft' ? -1 : 1) * (event.shiftKey ? 1 : 0.1)));
                }}/>)}
            </div>;
          })}
        </div>
        {total > 0 && <div className="film-video-playhead" aria-hidden="true" style={{ left: playhead * SCALE }}/>}
      </div>
    </div>
    {entry && <p className="film-video-time">素材入点 {Number(entry.clip.trimIn).toFixed(1)} 秒 · 片段 {Number(entry.clip.duration).toFixed(1)} 秒</p>}
  </section>;
}
