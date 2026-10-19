import { useEffect, useRef, useState } from 'react';
import { Check, Copy, Download, Loader2, Maximize2, Minimize2, MoreHorizontal, Pause, PictureInPicture2, Play, Volume2, VolumeX } from 'lucide-react';
import { Menu } from '@base-ui/react/menu';
import { mediaType } from '@shared/file-media';
import { rpc } from '@renderer/lib/ipc';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@renderer/lib/ui/menu';
import type { FileBuffer } from '../file-buffer';
import { saveFileCopy } from '../file-actions';
import { openMediaResource } from './resource';
import { clearMediaElement, MEDIA_RATES, mediaDuration, mediaFailure, MediaSeekDrag, mediaTime } from './model';
import './style.css';

export function FileMediaPreview({ buffer }: { buffer: FileBuffer }) {
  const file = buffer.file, kind = mediaType(file.name)!.kind;
  const media = useRef<HTMLMediaElement | null>(null), host = useRef<HTMLDivElement>(null), generation = useRef(0), drag = useRef(new MediaSeekDrag());
  const [attempt, setAttempt] = useState(0), [phase, setPhase] = useState<'loading' | 'ready' | 'buffering' | 'error'>('loading');
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [actionError, setActionError] = useState('');
  const [playing, setPlaying] = useState(false), [duration, setDuration] = useState(0), [position, setPosition] = useState(0);
  const [volume, setVolume] = useState(1), [muted, setMuted] = useState(false), [rate, setRate] = useState(1);
  const [hasSource, setHasSource] = useState(false), [pip, setPip] = useState(false), [fullscreen, setFullscreen] = useState(false);
  const [canPip, setCanPip] = useState(false), [canFullscreen, setCanFullscreen] = useState(false);
  useEffect(() => {
    const element = media.current!, container = host.current!, abort = new AbortController();
    let alive = true, failed = false, source: Awaited<ReturnType<typeof openMediaResource>> | null = null;
    generation.current++; drag.current.reset();
    setPhase('loading'); setError(''); setActionError(''); setNotice(''); setPlaying(false); setDuration(0); setPosition(0); setHasSource(false); setRate(1); setVolume(1); setMuted(false);
    element.volume = 1; element.muted = false; element.playbackRate = 1;
    setCanPip(kind === 'video' && Boolean(document.pictureInPictureEnabled && typeof (element as HTMLVideoElement).requestPictureInPicture === 'function'));
    setCanFullscreen(kind === 'video' && Boolean(document.fullscreenEnabled && typeof container.requestFullscreen === 'function'));
    let timer: ReturnType<typeof setTimeout> | undefined;
    const fail = (message: string) => {
      if (!alive || failed) return; failed = true; clearTimeout(timer); setPhase('error'); setError(message); setHasSource(false); setPlaying(false);
      abort.abort(); clearMediaElement(element); source?.release();
    };
    const deadline = () => { clearTimeout(timer); timer = setTimeout(() => fail('媒体加载超时，请重新读取'), 15_000); };
    const sync = () => { if (!alive || failed) return; setDuration(mediaDuration(element.duration)); setPosition(mediaDuration(element.currentTime)); setPlaying(!element.paused && !element.ended); };
    const ready = () => {
      if (!alive || failed) return;
      // Chromium may decode a supported audio track while silently dropping
      // the video's unsupported codec. canplay then fires with zero video size.
      // Do not expose a working-looking player that can only play the audio.
      if (kind === 'video' && (!(element as HTMLVideoElement).videoWidth || !(element as HTMLVideoElement).videoHeight)) {
        fail('无法播放此视频，视频编码不受支持或没有可解码的视频轨道'); return;
      }
      clearTimeout(timer); setPhase('ready'); sync();
    };
    const waiting = () => { if (!alive || failed) return; setPhase(element.readyState >= 1 ? 'buffering' : 'loading'); deadline(); };
    const problem = () => fail(mediaFailure(element.error?.code));
    const volumeChanged = () => { setVolume(element.volume); setMuted(element.muted); };
    const rateChanged = () => setRate(element.playbackRate);
    const pipChanged = () => setPip(document.pictureInPictureElement === element);
    const fullChanged = () => setFullscreen(document.fullscreenElement === container);
    const events: Record<string, EventListener> = { loadedmetadata: sync, durationchange: sync, timeupdate: sync, play: sync, pause: sync, ended: sync, canplay: ready, playing: ready, waiting, stalled: waiting, error: problem, volumechange: volumeChanged, ratechange: rateChanged, enterpictureinpicture: pipChanged, leavepictureinpicture: pipChanged };
    Object.entries(events).forEach(([name, listener]) => element.addEventListener(name, listener)); document.addEventListener('fullscreenchange', fullChanged);
    deadline();
    void openMediaResource(file, rpc.files, abort.signal).then((value) => {
      if (!alive || abort.signal.aborted) { value.release(); return; }
      source = value; element.src = value.url; element.dataset.mediaTransport = value.transport; setHasSource(true); element.load();
    }).catch((failure) => { if (!abort.signal.aborted) fail(failure instanceof Error ? failure.message : String(failure)); });
    return () => {
      alive = false; generation.current++; clearTimeout(timer); drag.current.reset();
      Object.entries(events).forEach(([name, listener]) => element.removeEventListener(name, listener)); document.removeEventListener('fullscreenchange', fullChanged);
      if (document.pictureInPictureElement === element) void document.exitPictureInPicture().catch(() => undefined);
      if (document.fullscreenElement === container) void document.exitFullscreen().catch(() => undefined);
      clearMediaElement(element); abort.abort(); source?.release();
    };
  }, [file.ref.id, file.revision.hash, attempt, kind]);
  const action = (work: () => Promise<unknown>) => {
    const current = generation.current; setActionError(''); setNotice('');
    void work().then((result) => { if (generation.current === current && result && typeof result === 'object' && 'state' in result && result.state === 'saved' && 'path' in result) setNotice(`副本已保存到 ${result.path}`); }).catch((failure) => { if (generation.current === current) setActionError(failure instanceof Error ? failure.message : String(failure)); });
  };
  const play = () => action(async () => { const element = media.current!; if (element.ended) element.currentTime = 0; await element.play(); });
  const toggle = () => { if (phase === 'error' || !hasSource) return; if (media.current!.paused) play(); else media.current!.pause(); };
  const endSeek = (pointer: number) => { if (drag.current.end(pointer)) play(); };
  const seek = (value: string) => { const next = Number(value); if (!duration || !Number.isFinite(next)) return; try { media.current!.currentTime = Math.min(duration, Math.max(0, next)); setPosition(media.current!.currentTime); } catch { setActionError('当前媒体无法定位播放位置'); } };
  return <div ref={host} className={`fw-media-view fw-media-kind-${kind}`} aria-label={kind === 'video' ? '视频播放器' : '音频播放器'}>
    {kind === 'video' ? <video ref={(node) => { media.current = node; }} className="fw-media-video" playsInline preload="metadata" tabIndex={0} aria-label="视频画面" onKeyDown={(event) => {
      if (event.nativeEvent.isComposing || event.keyCode === 229 || ![' ', 'Enter'].includes(event.key)) return;
      event.preventDefault(); if (!event.repeat) toggle();
    }} /> : <><audio ref={(node) => { media.current = node; }} hidden preload="metadata" /><strong className="fw-media-name" title={file.name}>{file.name}</strong></>}
    <div className="fw-media-controls">
      <button type="button" className="fw-icon" aria-label={playing ? '暂停' : '播放'} disabled={!hasSource || phase === 'error' || phase === 'loading'} onClick={toggle}>{playing ? <Pause size={17} /> : <Play size={17} />}</button>
      <input className="fw-media-seek" aria-label="播放进度" type="range" min={0} max={duration || 0} step={.1} value={Math.min(position, duration)} disabled={!hasSource || !duration || phase === 'error'} onChange={(event) => seek(event.target.value)} onPointerDown={(event) => { if (event.button !== 0) return; drag.current.begin(event.pointerId, !media.current!.paused && !media.current!.ended); media.current!.pause(); event.currentTarget.setPointerCapture(event.pointerId); }} onPointerUp={(event) => endSeek(event.pointerId)} onPointerCancel={(event) => endSeek(event.pointerId)} onLostPointerCapture={(event) => endSeek(event.pointerId)} />
      <span className="fw-media-time">{mediaTime(position)} / {mediaTime(duration)}</span>
      {kind === 'video' && <>
        <DropdownMenu><DropdownMenuTrigger className="fw-icon" aria-label="视频音量">{muted || volume === 0 ? <VolumeX size={17} /> : <Volume2 size={17} />}</DropdownMenuTrigger><DropdownMenuContent className="fw-file-menu fw-media-volume" align="end"><button aria-label={muted ? '取消静音' : '静音'} onClick={() => { const next = !media.current!.muted; media.current!.muted = next; setMuted(next); }}>{muted ? <VolumeX size={17} /> : <Volume2 size={17} />}</button><input aria-label="音量" type="range" min={0} max={1} step={.01} value={muted ? 0 : volume} onChange={(event) => { const next = Number(event.target.value); media.current!.volume = next; media.current!.muted = false; setVolume(next); setMuted(false); }} /></DropdownMenuContent></DropdownMenu>
        {canPip && <button className="fw-icon" aria-label={pip ? '退出画中画' : '画中画'} disabled={!hasSource || phase === 'error' || phase === 'loading'} onClick={() => action(async () => { if (document.pictureInPictureElement === media.current) await document.exitPictureInPicture(); else await (media.current as HTMLVideoElement).requestPictureInPicture(); })}><PictureInPicture2 size={17} /></button>}
        {canFullscreen && <button className="fw-icon" aria-label={fullscreen ? '退出全屏' : '全屏'} onClick={() => action(async () => { if (document.fullscreenElement === host.current) await document.exitFullscreen(); else await host.current!.requestFullscreen(); })}>{fullscreen ? <Minimize2 size={17} /> : <Maximize2 size={17} />}</button>}
      </>}
      <DropdownMenu><DropdownMenuTrigger className="fw-icon" aria-label="媒体菜单"><MoreHorizontal size={17} /></DropdownMenuTrigger><DropdownMenuContent className="fw-file-menu" align="end">
        {kind === 'audio' && !file.absolutePath.startsWith('data:') && <DropdownMenuItem onClick={() => action(() => navigator.clipboard.writeText(file.absolutePath))}><Copy />复制路径</DropdownMenuItem>}
        {hasSource && <DropdownMenuItem onClick={() => action(() => saveFileCopy({ kind: 'document', ref: file.ref }))}><Download />{kind === 'video' ? '视频另存为…' : '另存副本…'}</DropdownMenuItem>}
        {kind === 'video' && <><DropdownMenuSeparator /><div className="fw-media-speed-label">播放速度</div><Menu.RadioGroup value={String(rate)} onValueChange={(value) => { media.current!.playbackRate = Number(value); }} aria-label="播放速度">{MEDIA_RATES.map((value) => <Menu.RadioItem key={value} value={String(value)} className="fw-media-speed"><span className="fw-media-check">{rate === value && <Check size={13} />}</span>{value}×</Menu.RadioItem>)}</Menu.RadioGroup></>}
      </DropdownMenuContent></DropdownMenu>
    </div>
    {(phase === 'loading' || phase === 'buffering') && <div className="fw-media-message" role="status"><Loader2 size={14} className="animate-spin" />{phase === 'loading' ? '正在加载媒体…' : '正在缓冲…'}</div>}
    {error && <div className="fw-media-message" role="alert"><span>{error}</span><button onClick={() => setAttempt((value) => value + 1)}>重新读取</button></div>}
    {actionError && <div className="fw-media-message" role="alert">操作未完成：{actionError}</div>}
    {notice && <div className="fw-media-message" role="status">{notice}</div>}
  </div>;
}
