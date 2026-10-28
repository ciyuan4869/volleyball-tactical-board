import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'

type PieceType = 'setter' | 'outsideHitter' | 'middleBlocker' | 'opposite' | 'libero' | 'ball'
type Team = 'home' | 'away'
type CourtMode = 'full' | 'single'
type ViewMode = '2d' | '3d'
type Piece = { id: string; type: PieceType; team: Team; x: number; y: number; number?: number }
type Score = { home: number; away: number; setsHome: number; setsAway: number; serving: Team; set: number; finished: boolean }
type Snapshot = { score: Score; pieces: Piece[] }
type Transform2D = { rotation: number; scale: number }
type Transform3D = { yaw: number; pitch: number; scale: number }
type Interaction = { kind: 'surface' | 'piece'; id?: string; pointerId: number; startX: number; startY: number; moved: boolean }

const labels: Record<PieceType, string> = { setter: 'S', outsideHitter: 'OH', middleBlocker: 'M', opposite: 'OP', libero: 'L', ball: '🏐' }
const names: Record<PieceType, string> = { setter: '二传手', outsideHitter: '主攻', middleBlocker: '副攻', opposite: '接应', libero: '自由人', ball: '排球' }
const types = Object.keys(labels) as PieceType[]
const makeId = () => crypto.randomUUID()
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

// FIVB positions: 1 right-back, 2 right-front, 3 middle-front, 4 left-front, 5 left-back, 6 middle-back.
const rotationSpots: Record<Team, { x: number; y: number }[]> = {
  home: [{ x: 25, y: 78 }, { x: 40, y: 78 }, { x: 40, y: 50 }, { x: 40, y: 22 }, { x: 25, y: 22 }, { x: 25, y: 50 }],
  away: [{ x: 75, y: 22 }, { x: 60, y: 22 }, { x: 60, y: 50 }, { x: 60, y: 78 }, { x: 75, y: 78 }, { x: 75, y: 50 }],
}
const initialScore: Score = { home: 0, away: 0, setsHome: 0, setsAway: 0, serving: 'home', set: 1, finished: false }
const defaultLineup: PieceType[] = ['setter', 'outsideHitter', 'middleBlocker', 'opposite', 'middleBlocker', 'outsideHitter']
const initialPieces = (): Piece[] => defaultLineup.map((type, index) => ({ id: makeId(), type, team: 'home', ...rotationSpots.home[index], number: index + 1 }))

function rotateTeam(pieces: Piece[], team: Team) {
  const players = pieces.filter((piece) => piece.team === team && piece.type !== 'ball').sort((a, b) => (a.number ?? 99) - (b.number ?? 99))
  if (players.length !== 6) return pieces
  const next = [...pieces]
  players.forEach((player, index) => {
    const nextIndex = (index + 5) % 6
    const itemIndex = next.findIndex((piece) => piece.id === player.id)
    next[itemIndex] = { ...next[itemIndex], ...rotationSpots[team][nextIndex], number: nextIndex + 1 }
  })
  return next
}

function toDisplayPoint(point: { x: number; y: number }, courtMode: CourtMode, team: Team) {
  if (courtMode === 'full') return point
  return { x: team === 'home' ? point.x * 2 : (point.x - 50) * 2, y: point.y }
}

function toCourtPoint(point: { x: number; y: number }, courtMode: CourtMode, team: Team) {
  if (courtMode === 'full') return point
  return { x: team === 'home' ? point.x / 2 : 50 + point.x / 2, y: point.y }
}

export default function App() {
  const [mode, setMode] = useState<'board' | 'match'>('board')
  const [view, setView] = useState<ViewMode>('2d')
  const [courtMode, setCourtMode] = useState<CourtMode>('full')
  const [team, setTeam] = useState<Team>('home')
  const [tool, setTool] = useState<PieceType>('setter')
  const [pieces, setPieces] = useState<Piece[]>(initialPieces)
  const [score, setScore] = useState<Score>(initialScore)
  const [history, setHistory] = useState<Snapshot[]>([])
  const [msg, setMsg] = useState('按 1–6 号位顺序放置球员')
  const [transform2d, setTransform2d] = useState<Transform2D>({ rotation: 0, scale: 1 })
  const [transform3d, setTransform3d] = useState<Transform3D>({ yaw: 0, pitch: 48, scale: 1 })
  const [actionId, setActionId] = useState<string | null>(null)
  const [replaceOpen, setReplaceOpen] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [portrait, setPortrait] = useState(false)
  const shellRef = useRef<HTMLDivElement>(null)
  const interaction = useRef<Interaction | null>(null)
  const longPress = useRef<number | undefined>(undefined)
  const pointerMap = useRef(new Map<number, { x: number; y: number }>())
  const pinchDistance = useRef<number | null>(null)
  const pinchStartScale = useRef(1)
  const transformStart = useRef({ x: 0, y: 0, rotation: 0, yaw: 0, pitch: 48 })

  useEffect(() => {
    const saved = localStorage.getItem('vb')
    if (!saved) return
    try {
      const data = JSON.parse(saved)
      if (Array.isArray(data.pieces) && data.score) {
        setPieces(data.pieces)
        setScore({ ...initialScore, ...data.score })
      }
      if (data.courtMode === 'single' || data.courtMode === 'full') setCourtMode(data.courtMode)
    } catch {
      // Ignore malformed local data and keep the safe default lineup.
    }
  }, [])

  useEffect(() => {
    localStorage.setItem('vb', JSON.stringify({ schema: 3, pieces, score, courtMode }))
  }, [pieces, score, courtMode])

  useEffect(() => {
    const onFullscreen = () => {
      const active = Boolean(document.fullscreenElement)
      setFullscreen(active)
      if (!active) setSidebarOpen(false)
    }
    document.addEventListener('fullscreenchange', onFullscreen)
    return () => document.removeEventListener('fullscreenchange', onFullscreen)
  }, [])

  useEffect(() => {
    const media = window.matchMedia('(orientation: portrait)')
    const update = () => setPortrait(media.matches)
    update()
    media.addEventListener?.('change', update)
    return () => media.removeEventListener?.('change', update)
  }, [])

  const count = pieces.filter((piece) => piece.team === team && piece.type !== 'ball').length
  const visiblePieces = useMemo(() => pieces.filter((piece) => courtMode === 'full' || piece.team === team), [pieces, courtMode, team])
  const lineup = useMemo(() => pieces.filter((piece) => piece.team === team && piece.type !== 'ball').sort((a, b) => (a.number ?? 99) - (b.number ?? 99)), [pieces, team])

  const pointFromEvent = (event: { clientX: number; clientY: number }) => {
    const shell = shellRef.current
    if (!shell) return { x: 50, y: 50 }
    const rect = shell.getBoundingClientRect()
    const centerX = rect.left + rect.width / 2
    const centerY = rect.top + rect.height / 2
    let dx = event.clientX - centerX
    let dy = event.clientY - centerY
    if (view === '2d') {
      const radians = -transform2d.rotation * Math.PI / 180
      const unscaledX = (dx * Math.cos(radians) - dy * Math.sin(radians)) / transform2d.scale
      const unscaledY = (dx * Math.sin(radians) + dy * Math.cos(radians)) / transform2d.scale
      dx = unscaledX
      dy = unscaledY
    } else {
      const yaw = transform3d.yaw * Math.PI / 180
      const pitch = transform3d.pitch * Math.PI / 180
      const localX = dx / (transform3d.scale * Math.max(0.25, Math.cos(yaw)))
      const localY = (dy / transform3d.scale + Math.sin(pitch) * Math.sin(yaw) * localX) / Math.max(0.25, Math.cos(pitch))
      dx = localX
      dy = localY
    }
    return {
      x: clamp((dx + rect.width / 2) / rect.width * 100, 2, 98),
      y: clamp((dy + rect.height / 2) / rect.height * 100, 4, 96),
    }
  }

  const fullPointFromEvent = (event: { clientX: number; clientY: number }) => toCourtPoint(pointFromEvent(event), courtMode, team)

  const clearLongPress = () => {
    if (longPress.current !== undefined) {
      window.clearTimeout(longPress.current)
      longPress.current = undefined
    }
  }

  const add = (event: { clientX: number; clientY: number }) => {
    if (tool !== 'ball' && count >= 6) {
      setMsg(`${team === 'home' ? '蓝方' : '橙方'}已达到 6 名球员上限`)
      return
    }
    const clicked = fullPointFromEvent(event)
    const location = tool !== 'ball' && count < 6 ? rotationSpots[team][count] : clicked
    setPieces((current) => [...current, { id: makeId(), type: tool, team, ...location, number: tool === 'ball' ? undefined : count + 1 }])
    setMsg(`${names[tool]}已放置在${tool === 'ball' ? '指定位置' : `${count + 1}号位`}`)
  }

  const movePiece = (event: { clientX: number; clientY: number }, pieceId: string) => {
    const piece = pieces.find((item) => item.id === pieceId)
    if (!piece) return
    const raw = fullPointFromEvent(event)
    const location = piece.type !== 'ball'
      ? { x: piece.team === 'home' ? clamp(raw.x, 3, 48) : clamp(raw.x, 52, 97), y: clamp(raw.y, 4, 96) }
      : { x: clamp(raw.x, 2, 98), y: clamp(raw.y, 4, 96) }
    setPieces((current) => current.map((item) => item.id === pieceId ? { ...item, ...location } : item))
  }

  const beginPiece = (event: React.PointerEvent, piece: Piece) => {
    event.stopPropagation()
    pointerMap.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    event.currentTarget.setPointerCapture?.(event.pointerId)
    interaction.current = { kind: 'piece', id: piece.id, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, moved: false }
    clearLongPress()
    longPress.current = window.setTimeout(() => {
      if (interaction.current?.kind === 'piece' && !interaction.current.moved) {
        interaction.current = null
        setActionId(piece.id)
        setReplaceOpen(false)
        setMsg('请选择棋子操作')
      }
    }, 550)
  }

  const beginSurface = (event: React.PointerEvent) => {
    if ((event.target as HTMLElement).closest('.action-menu')) return
    pointerMap.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    event.currentTarget.setPointerCapture?.(event.pointerId)
    if (pointerMap.current.size === 1) {
      transformStart.current = { x: event.clientX, y: event.clientY, rotation: transform2d.rotation, yaw: transform3d.yaw, pitch: transform3d.pitch }
      interaction.current = { kind: 'surface', pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, moved: false }
    }
    if (pointerMap.current.size === 2) {
      const values = [...pointerMap.current.values()]
      pinchDistance.current = Math.hypot(values[0].x - values[1].x, values[0].y - values[1].y)
      pinchStartScale.current = view === '3d' ? transform3d.scale : transform2d.scale
      if (interaction.current) interaction.current.moved = true
    }
  }

  const handlePointerMove = (event: React.PointerEvent) => {
    pointerMap.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    const active = interaction.current
    if (!active) return
    if (pointerMap.current.size >= 2 && pinchDistance.current) {
      const values = [...pointerMap.current.values()]
      const distance = Math.hypot(values[0].x - values[1].x, values[0].y - values[1].y)
      const nextScale = clamp(pinchStartScale.current * distance / pinchDistance.current, 0.65, 1.55)
      if (view === '3d') setTransform3d((current) => ({ ...current, scale: nextScale }))
      else setTransform2d((current) => ({ ...current, scale: nextScale }))
      active.moved = true
      clearLongPress()
      return
    }
    const dx = event.clientX - active.startX
    const dy = event.clientY - active.startY
    if (Math.abs(dx) + Math.abs(dy) > 6) {
      active.moved = true
      clearLongPress()
    }
    if (active.kind === 'piece' && active.id && active.moved) {
      movePiece(event, active.id)
      return
    }
    if (active.kind === 'surface' && active.moved) {
      if (view === '3d') {
        setTransform3d((current) => ({
          ...current,
          yaw: clamp(transformStart.current.yaw + dx * 0.35, -90, 90),
          pitch: clamp(transformStart.current.pitch - dy * 0.28, 18, 82),
        }))
      } else {
        setTransform2d((current) => ({ ...current, rotation: transformStart.current.rotation + dx * 0.45 }))
      }
    }
  }

  const finishPointer = (event: React.PointerEvent) => {
    const active = interaction.current
    clearLongPress()
    pointerMap.current.delete(event.pointerId)
    if (pointerMap.current.size > 0) return
    pinchDistance.current = null
    if (active?.kind === 'surface' && !active.moved) {
      if (actionId) setActionId(null)
      else add(event)
    }
    if (active?.kind === 'piece' && active.moved) setMsg('棋子位置已更新')
    interaction.current = null
  }

  const replacePiece = (type: PieceType) => {
    if (!actionId) return
    setPieces((current) => current.map((piece) => piece.id === actionId ? { ...piece, type, number: type === 'ball' ? undefined : piece.number } : piece))
    setActionId(null)
    setReplaceOpen(false)
    setMsg(`棋子已更换为${names[type]}`)
  }

  const scorePoint = (winner: Team) => {
    if (score.finished) return
    setHistory((current) => [...current, { score, pieces }])
    const receiving = score.serving !== winner
    const nextPieces = receiving ? rotateTeam(pieces, winner) : pieces
    const next = { ...score, [winner]: score[winner] + 1, serving: winner } as Score
    const target = next.set >= 5 ? 15 : 25
    const loser: Team = winner === 'home' ? 'away' : 'home'
    const wonSet = next[winner] >= target && next[winner] - next[loser] >= 2
    if (wonSet) {
      const setsHome = next.setsHome + (winner === 'home' ? 1 : 0)
      const setsAway = next.setsAway + (winner === 'away' ? 1 : 0)
      const finished = setsHome >= 3 || setsAway >= 3
      setScore({ ...next, home: 0, away: 0, setsHome, setsAway, set: next.set + 1, finished })
      setPieces(nextPieces)
      setMsg(finished ? `${winner === 'home' ? '蓝方' : '橙方'}赢得比赛` : `${winner === 'home' ? '蓝方' : '橙方'}赢下第 ${next.set} 局，进入下一局`)
    } else {
      setScore(next)
      setPieces(nextPieces)
      setMsg(receiving ? `${winner === 'home' ? '蓝方' : '橙方'}得分并完成顺时针轮转` : `${winner === 'home' ? '蓝方' : '橙方'}得分，保持发球`)
    }
    setMode('match')
    setCourtMode('full')
  }

  const exportJson = () => {
    const file = new Blob([JSON.stringify({ schema: 3, pieces, score, courtMode }, null, 2)], { type: 'application/json' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(file)
    link.download = '排球战术方案.json'
    link.click()
    URL.revokeObjectURL(link.href)
  }

  const toggleFullscreen = async () => {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen?.()
        setSidebarOpen(false)
      } else {
        await document.exitFullscreen?.()
      }
    } catch {
      setMsg('浏览器未允许全屏，请使用浏览器菜单进入全屏')
    }
  }

  const courtTransform = view === '3d'
    ? { transform: `perspective(1400px) rotateX(${transform3d.pitch}deg) rotateY(${transform3d.yaw}deg) scale(${transform3d.scale})` }
    : { transform: `rotateZ(${transform2d.rotation}deg) scale(${transform2d.scale})` }
  const courtClass = courtMode === 'single' ? `single ${team}` : 'full'

  return <div className={`app ${fullscreen ? 'fullscreen' : ''}`}>
    <header>
      <b>✦ VOLLEYBOARD</b>
      <nav><button className={mode === 'board' ? 'on' : ''} onClick={() => setMode('board')}>战术板</button><button className={mode === 'match' ? 'on' : ''} onClick={() => { setMode('match'); setCourtMode('full') }}>比赛模式</button></nav>
      <div className="header-actions"><button onClick={toggleFullscreen}>{fullscreen ? '退出全屏' : '全屏模式'}</button><button onClick={exportJson}>导出 JSON</button></div>
    </header>
    {fullscreen && <button className="sidebar-toggle" aria-label="打开侧边栏" onClick={() => setSidebarOpen((open) => !open)}>☰</button>}
    <main>
      <aside className={`sidebar ${fullscreen ? 'drawer' : ''} ${sidebarOpen ? 'open' : ''}`}>
        <h4>棋子工具</h4>
        <div className="teams"><button className={team === 'home' ? 'on' : ''} onClick={() => setTeam('home')}>蓝方</button><button className={team === 'away' ? 'on orange' : ''} onClick={() => setTeam('away')}>橙方</button></div>
        <div className="tools">{types.map((type) => <button key={type} className={tool === type ? 'sel' : ''} onClick={() => setTool(type)}><i className={type}>{labels[type]}</i>{names[type]}</button>)}</div>
        <p>点击放置 · 拖动移动<br />长按打开操作菜单</p>
        <h4>显示</h4>
        <button className={view === '2d' ? 'wide on' : 'wide'} onClick={() => setView('2d')}>2D 平面</button><button className={view === '3d' ? 'wide on' : 'wide'} onClick={() => setView('3d')}>3D 预览</button>
        {mode === 'board' && <><h4>战术板范围</h4><div className="court-mode"><button className={courtMode === 'full' ? 'on' : ''} onClick={() => setCourtMode('full')}>完整球场</button><button className={courtMode === 'single' ? 'on' : ''} onClick={() => setCourtMode('single')}>单边半场</button></div></>}
      </aside>
      <section>
        <div className="intro"><div><small>{mode === 'match' ? 'MATCH CENTER' : 'TACTICAL BOARD'}</small><h1>{mode === 'match' ? (score.finished ? '比赛已结束' : `第 ${Math.min(score.set, 5)} 局进行中`) : '准备你的下一套战术'}</h1><p>{msg}</p></div><div className="scoreboard" aria-label="比赛计分板"><div className={`score-team home ${score.serving === 'home' ? 'serving' : ''}`}><span className="score-team-name">蓝方</span><strong>{score.home}</strong><small>局分 {score.setsHome}</small>{score.serving === 'home' && <em>● 发球</em>}</div><div className="score-center"><small>第 {Math.min(score.set, 5)} 局</small><b>VS</b></div><div className={`score-team away ${score.serving === 'away' ? 'serving' : ''}`}><span className="score-team-name">橙方</span><strong>{score.away}</strong><small>局分 {score.setsAway}</small>{score.serving === 'away' && <em>● 发球</em>}</div></div></div>
        {mode === 'match' && <div className="controls"><button className="blue" disabled={score.finished} onClick={() => scorePoint('home')}>蓝方得分 +1</button><button disabled={!history.length} onClick={() => { const previous = history.at(-1); if (previous) { setScore(previous.score); setPieces(previous.pieces); setHistory(history.slice(0, -1)); setMsg('已撤销上一球，比分和站位已恢复') } }}>撤销上一球</button><button className="orange" disabled={score.finished} onClick={() => scorePoint('away')}>橙方得分 +1</button></div>}
        <div className="rotation-rail" aria-label="六个轮转站位">{[1, 2, 3, 4, 5, 6].map((number) => { const player = lineup.find((piece) => piece.number === number); return <div key={number} className={player ? 'filled' : ''}><b>{number}</b><span>{player ? labels[player.type] : '—'}</span></div> })}</div>
        <div className={`stage-shell ${courtMode}`} ref={shellRef}>
          <div className={`stage ${view === '3d' ? 'view-3d' : 'view-2d'} ${courtClass}`} style={courtTransform} onPointerDown={beginSurface} onPointerMove={handlePointerMove} onPointerUp={finishPointer} onPointerCancel={finishPointer} onWheel={(event) => { event.preventDefault(); if (view === '3d') setTransform3d((current) => ({ ...current, scale: clamp(current.scale - event.deltaY * 0.001, 0.65, 1.55) })); else setTransform2d((current) => ({ ...current, scale: clamp(current.scale - event.deltaY * 0.001, 0.65, 1.55) })) }}>
            <div className="court"><div className="court-floor" /><div className="half a" /><div className="half b" /><div className="end-label home-label">发球区</div><div className="end-label away-label">发球区</div><div className="net"><span className="net-mesh" /><b className="net-top" /><span className="net-name">球网</span><i className="net-post left" /><i className="net-post right" /><i className="net-base left" /><i className="net-base right" /></div><div className="attack one"><span>3米线</span></div><div className="attack two"><span>3米线</span></div><div className="service-line one" /><div className="service-line two" />
              {visiblePieces.map((piece) => { const display = toDisplayPoint(piece, courtMode, team); return <button key={piece.id} className={`token ${piece.team} ${piece.type}`} style={{ left: `${display.x}%`, top: `${display.y}%` }} onPointerDown={(event) => beginPiece(event, piece)} onPointerUp={finishPointer} onPointerCancel={finishPointer}>
                <span className="token-glyph">{piece.type === 'ball' ? <span className="ball-model"><i /><b>🏐</b></span> : <span className="player-model"><i className="model-shadow" /><i className="model-head" /><i className="model-neck" /><i className="model-torso">{labels[piece.type]}</i><i className="model-arm left" /><i className="model-arm right" /><i className="model-leg left" /><i className="model-leg right" /><i className="model-shoe left" /><i className="model-shoe right" /><i className="model-badge">{piece.number}</i></span>}</span>
              </button> })}
            </div>
            {actionId && <div className="action-menu" onPointerDown={(event) => event.stopPropagation()}><strong>棋子操作</strong><button onClick={() => { setPieces((current) => current.filter((piece) => piece.id !== actionId)); setActionId(null); setMsg('棋子已删除') }}>删除当前棋子</button><button onClick={() => setReplaceOpen((open) => !open)}>更换棋子</button>{replaceOpen && <div className="replace-list">{types.map((type) => <button key={type} onClick={() => replacePiece(type)}><i className={type}>{labels[type]}</i>{names[type]}</button>)}</div>}<button className="cancel" onClick={() => { setActionId(null); setReplaceOpen(false) }}>取消</button></div>}
          </div>
        </div>
        {fullscreen && portrait && <div className="orientation-hint">请将设备横向旋转，以获得完整球场视图</div>}
        <div className="legend">蓝方 {pieces.filter((piece) => piece.team === 'home' && piece.type !== 'ball').length}/6　橙方 {pieces.filter((piece) => piece.team === 'away' && piece.type !== 'ball').length}/6　发球权：{score.serving === 'home' ? '蓝方' : '橙方'}<button onClick={() => setPieces([])}>清空场地</button></div>
      </section>
    </main>
    <footer>VOLLEYBOARD MVP · 原创战术工具</footer>
  </div>
}
