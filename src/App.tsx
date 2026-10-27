import { useEffect, useRef, useState } from 'react'
import './App.css'

type PieceType = 'setter' | 'outsideHitter' | 'middleBlocker' | 'opposite' | 'libero' | 'ball'
type Team = 'home' | 'away'
type Piece = { id: string; type: PieceType; team: Team; x: number; y: number; number?: number }
type Score = { home: number; away: number; setsHome: number; setsAway: number; serving: Team; set: number; finished: boolean }
type Snapshot = { score: Score; pieces: Piece[] }

const labels: Record<PieceType, string> = { setter: 'S', outsideHitter: 'OH', middleBlocker: 'M', opposite: 'OP', libero: 'L', ball: '🏐' }
const names: Record<PieceType, string> = { setter: '二传手', outsideHitter: '主攻', middleBlocker: '副攻', opposite: '接应', libero: '自由人', ball: '排球' }
const types = Object.keys(labels) as PieceType[]
const id = () => crypto.randomUUID()
// 1号位到6号位：右后、右前、中前、左前、左后、中后。蓝方在左半场，橙方镜像在右半场。
const rotationSpots: Record<Team, { x: number; y: number }[]> = {
  home: [{ x: 25, y: 78 }, { x: 40, y: 78 }, { x: 40, y: 50 }, { x: 40, y: 22 }, { x: 25, y: 22 }, { x: 25, y: 50 }],
  away: [{ x: 75, y: 22 }, { x: 60, y: 22 }, { x: 60, y: 50 }, { x: 60, y: 78 }, { x: 75, y: 78 }, { x: 75, y: 50 }],
}
const initialScore: Score = { home: 0, away: 0, setsHome: 0, setsAway: 0, serving: 'home', set: 1, finished: false }
const initialPieces = (): Piece[] => [{ id: id(), type: 'setter', team: 'home', ...rotationSpots.home[0], number: 1 }]

function rotateTeam(pieces: Piece[], team: Team) {
  const players = pieces.filter(p => p.team === team && p.type !== 'ball').sort((a, b) => (a.number ?? 99) - (b.number ?? 99))
  if (players.length !== 6) return pieces
  const next = [...pieces]
  players.forEach((player, index) => {
    const target = rotationSpots[team][(index + 5) % 6]
    const i = next.findIndex(p => p.id === player.id)
    next[i] = { ...next[i], ...target, number: ((index + 5) % 6) + 1 }
  })
  return next
}

export default function App() {
  const [mode, setMode] = useState<'board' | 'match'>('board')
  const [view, setView] = useState<'2d' | '3d'>('2d')
  const [team, setTeam] = useState<Team>('home')
  const [tool, setTool] = useState<PieceType>('setter')
  const [pieces, setPieces] = useState<Piece[]>(initialPieces)
  const [score, setScore] = useState<Score>(initialScore)
  const [history, setHistory] = useState<Snapshot[]>([])
  const [drag, setDrag] = useState<string | null>(null)
  const [msg, setMsg] = useState('按 1–6 号位顺序放置球员')
  const [rotX, setRotX] = useState(55)
  const [rotY, setRotY] = useState(-12)
  const [zoom, setZoom] = useState(1)
  const [orbit, setOrbit] = useState(false)
  const [actionId, setActionId] = useState<string | null>(null)
  const [replaceOpen, setReplaceOpen] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const boardRef = useRef<HTMLDivElement>(null)
  const orbitStart = useRef({ x: 0, y: 0, rotX: 55, rotY: -12 })
  const press = useRef<number | undefined>(undefined)

  useEffect(() => {
    const saved = localStorage.getItem('vb')
    if (!saved) return
    try {
      const data = JSON.parse(saved)
      if (Array.isArray(data.pieces) && data.score) { setPieces(data.pieces); setScore({ ...initialScore, ...data.score }) }
    } catch { /* ignore malformed local data */ }
  }, [])
  useEffect(() => { localStorage.setItem('vb', JSON.stringify({ schema: 2, pieces, score })) }, [pieces, score])

  const count = pieces.filter(p => p.team === team && p.type !== 'ball').length
  const point = (e: React.PointerEvent) => { const r = boardRef.current?.getBoundingClientRect(); if (!r) return { x: 50, y: 50 }; return { x: Math.max(3, Math.min(97, (e.clientX - r.left) / r.width * 100)), y: Math.max(4, Math.min(96, (e.clientY - r.top) / r.height * 100)) } }
  const add = (e: React.PointerEvent) => {
    if (tool !== 'ball' && count >= 6) { setMsg(`${team === 'home' ? '蓝方' : '橙方'}已达到 6 名球员上限`); return }
    const location = tool !== 'ball' && count < 6 ? rotationSpots[team][count] : point(e)
    setPieces(xs => [...xs, { id: id(), type: tool, team, ...location, number: tool === 'ball' ? undefined : count + 1 }])
    setMsg(`${names[tool]}已放置在${tool === 'ball' ? '指定位置' : `${count + 1}号位`}`)
  }
  const move = (e: React.PointerEvent) => {
    if (!drag) return
    const raw = point(e)
    const active = pieces.find(p => p.id === drag)
    const location = active && active.type !== 'ball' ? { x: active.team === 'home' ? Math.min(47, raw.x) : Math.max(53, raw.x), y: raw.y } : raw
    setPieces(xs => xs.map(p => p.id === drag ? { ...p, ...location } : p))
  }
  const stopDrag = () => { if (press.current !== undefined) { clearTimeout(press.current); press.current = undefined }; setDrag(null) }
  const replacePiece = (type: PieceType) => { if (!actionId) return; setPieces(xs => xs.map(p => p.id === actionId ? { ...p, type, number: type === 'ball' ? undefined : p.number } : p)); setActionId(null); setReplaceOpen(false); setMsg(`棋子已更换为${names[type]}`) }

  const scorePoint = (winner: Team) => {
    if (score.finished) return
    setHistory(h => [...h, { score, pieces }])
    let nextPieces = pieces
    const receiving = score.serving !== winner
    if (receiving) nextPieces = rotateTeam(pieces, winner)
    const next = { ...score, [winner]: score[winner] + 1, serving: winner } as Score
    const target = next.set >= 5 ? 15 : 25
    const wonSet = next[winner] >= target && next[winner] - next[winner === 'home' ? 'away' : 'home'] >= 2
    if (wonSet) {
      const nextSetsHome = next.setsHome + (winner === 'home' ? 1 : 0)
      const nextSetsAway = next.setsAway + (winner === 'away' ? 1 : 0)
      const matchFinished = nextSetsHome >= 3 || nextSetsAway >= 3
      setScore({ ...next, home: 0, away: 0, setsHome: nextSetsHome, setsAway: nextSetsAway, set: next.set + 1, finished: matchFinished })
      setPieces(nextPieces)
      setMsg(matchFinished ? `${winner === 'home' ? '蓝方' : '橙方'}赢得比赛` : `${winner === 'home' ? '蓝方' : '橙方'}赢下第 ${next.set} 局，进入下一局`)
    } else {
      setScore(next); setPieces(nextPieces); setMsg(receiving ? `${winner === 'home' ? '蓝方' : '橙方'}得分并完成顺时针轮转` : `${winner === 'home' ? '蓝方' : '橙方'}得分，保持发球`)
    }
    setMode('match')
  }

  const exportJson = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify({ schema: 2, pieces, score }, null, 2)], { type: 'application/json' })); a.download = '排球战术方案.json'; a.click() }
  const toggleFullscreen = async () => { if (!document.fullscreenElement) { await document.documentElement.requestFullscreen?.(); setFullscreen(true) } else { await document.exitFullscreen?.(); setFullscreen(false) } }
  useEffect(() => { const onFull = () => setFullscreen(Boolean(document.fullscreenElement)); document.addEventListener('fullscreenchange', onFull); return () => document.removeEventListener('fullscreenchange', onFull) }, [])
  const courtStyle = view === '3d' ? { transform: `perspective(1200px) rotateX(${rotX}deg) rotateY(${rotY}deg) scale(${zoom})` } : undefined

  return <div className={'app '+(fullscreen?'fullscreen':'')} onPointerMove={move} onPointerUp={stopDrag}>
    <header><b>✦ VOLLEYBOARD</b><nav><button className={mode === 'board' ? 'on' : ''} onClick={() => setMode('board')}>战术板</button><button className={mode === 'match' ? 'on' : ''} onClick={() => setMode('match')}>比赛模式</button></nav><div className='header-actions'><button onClick={toggleFullscreen}>{fullscreen ? '退出全屏' : '全屏模式'}</button><button onClick={exportJson}>导出 JSON</button></div></header>
    <main><aside><h4>棋子工具</h4><div className='teams'><button className={team === 'home' ? 'on' : ''} onClick={() => setTeam('home')}>蓝方</button><button className={team === 'away' ? 'on orange' : ''} onClick={() => setTeam('away')}>橙方</button></div><div className='tools'>{types.map(t => <button key={t} className={tool === t ? 'sel' : ''} onClick={() => setTool(t)}><i className={t}>{labels[t]}</i>{names[t]}</button>)}</div><p>点击放置 · 拖动移动<br />长按打开操作菜单</p><h4>显示</h4><button className={view === '2d' ? 'wide on' : 'wide'} onClick={() => setView('2d')}>2D 平面</button><button className={view === '3d' ? 'wide on' : 'wide'} onClick={() => setView('3d')}>3D 预览</button></aside>
      <section><div className='intro'><div><small>{mode === 'match' ? 'MATCH CENTER' : 'TACTICAL BOARD'}</small><h1>{mode === 'match' ? (score.finished ? '比赛已结束' : `第 ${Math.min(score.set, 5)} 局进行中`) : '准备你的下一套战术'}</h1><p>{msg}</p></div><div className='score'><span>蓝方 <b>{score.home}</b><small>局 {score.setsHome}</small></span><em>:</em><span>橙方 <b>{score.away}</b><small>局 {score.setsAway}</small></span></div></div>
        {mode === 'match' && <div className='controls'><button className='blue' disabled={score.finished} onClick={() => scorePoint('home')}>蓝方得分 +1</button><button disabled={!history.length} onClick={() => { const previous = history.at(-1); if (previous) { setScore(previous.score); setPieces(previous.pieces); setHistory(history.slice(0, -1)); setMsg('已撤销上一球，比分和站位已恢复') } }}>撤销上一球</button><button className='orange' disabled={score.finished} onClick={() => scorePoint('away')}>橙方得分 +1</button></div>}
        <div className={'stage ' + view} style={courtStyle} onPointerDown={e => { if (view === '3d' && !(e.target as HTMLElement).closest('.token')) { setOrbit(true); orbitStart.current = { x: e.clientX, y: e.clientY, rotX, rotY }; (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId) } }} onPointerMove={e => { if (view === '3d' && orbit) { setRotY(((orbitStart.current.rotY + (e.clientX - orbitStart.current.x) * .35) % 360 + 360) % 360); setRotX(Math.max(25, Math.min(75, orbitStart.current.rotX - (e.clientY - orbitStart.current.y) * .25))) } }} onPointerUp={() => setOrbit(false)} onPointerCancel={() => setOrbit(false)} onWheel={e => { if (view === '3d') { e.preventDefault(); setZoom(z => Math.max(.65, Math.min(1.45, z - e.deltaY * .001))) } }}>
          <div className='court' ref={boardRef} onPointerDown={e => { e.stopPropagation(); if (view === '3d' && !(e.target as HTMLElement).closest('.token')) { setOrbit(true); orbitStart.current = { x: e.clientX, y: e.clientY, rotX, rotY }; (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId) } else if (view === '2d' && !(e.target as HTMLElement).closest('.token')) add(e) }}><div className='court-floor' /><div className='half a' /><div className='half b' /><div className='end-label home-label'>发球区</div><div className='end-label away-label'>发球区</div><div className='net'><span>球网</span><i /><i /></div><div className='attack one'><span>3米线</span></div><div className='attack two'><span>3米线</span></div><div className='service-line one' /><div className='service-line two' />{pieces.map(p => <button key={p.id} className={'token ' + p.team + ' ' + p.type} style={{ left: `${p.x}%`, top: `${p.y}%` }} onPointerDown={e => { e.stopPropagation(); (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId); setDrag(p.id); press.current = window.setTimeout(() => { setDrag(null); setActionId(p.id); setMsg('请选择棋子操作') }, 550) }} onPointerUp={e => { e.stopPropagation(); stopDrag() }}><span className='token-glyph'>{p.type === 'ball' ? <span className='ball-model'><i/><b>🏐</b></span> : <span className='player-model'><i className='model-head'/><i className='model-torso'>{labels[p.type]}</i><i className='model-arm left'/><i className='model-arm right'/><i className='model-leg left'/><i className='model-leg right'/><i className='model-shoe left'/><i className='model-shoe right'/><i className='model-base'>{p.number}</i></span>}</span></button>)}</div>
          {actionId && <div className='action-menu' onPointerDown={e => e.stopPropagation()}><strong>棋子操作</strong><button onClick={() => { setPieces(x => x.filter(a => a.id !== actionId)); setActionId(null); setMsg('棋子已删除') }}>删除当前棋子</button><button onClick={() => setReplaceOpen(!replaceOpen)}>更换棋子</button>{replaceOpen && <div className='replace-list'>{types.map(t => <button key={t} onClick={() => replacePiece(t)}><i className={t}>{labels[t]}</i>{names[t]}</button>)}</div>}<button className='cancel' onClick={() => { setActionId(null); setReplaceOpen(false) }}>取消</button></div>}
        </div><div className='legend'>蓝方 {pieces.filter(p => p.team === 'home' && p.type !== 'ball').length}/6　橙方 {pieces.filter(p => p.team === 'away' && p.type !== 'ball').length}/6　发球权：{score.serving === 'home' ? '蓝方' : '橙方'}<button onClick={() => setPieces([])}>清空场地</button></div></section>
    </main><footer>VOLLEYBOARD MVP · 原创战术工具</footer>
  </div>
}





