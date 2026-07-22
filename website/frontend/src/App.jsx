import { useState, useCallback, useRef, useContext, useEffect } from 'react'
import { CrosswordProvider, CrosswordGrid, DirectionClues, CrosswordContext } from '@jaredreisinger/react-crossword'
import { io } from 'socket.io-client'
import AnagramHelper from './AnagramHelper'
import PlayerOverlay from './PlayerOverlay'
import './App.css'

const socket = io({ autoConnect: true })

const CROSSWORD_TYPES = ['quiptic', 'cryptic', 'quick-cryptic', 'quick', 'prize', 'everyman']

function getPlayerId() {
  let id = localStorage.getItem('playerId')
  if (!id) { id = crypto.randomUUID(); localStorage.setItem('playerId', id) }
  return id
}

function SelectionWatcher({ onSelectionChange }) {
  const { selectedDirection, selectedNumber } = useContext(CrosswordContext)
  useEffect(() => {
    if (selectedDirection != null && selectedNumber != null) {
      onSelectionChange(selectedDirection, String(selectedNumber))
    }
  }, [selectedDirection, selectedNumber, onSelectionChange])
  return null
}

export default function App() {
  const [type, setType] = useState('quiptic')
  const [number, setNumber] = useState('')
  const [data, setData] = useState(null)
  const [title, setTitle] = useState('')
  const [author, setAuthor] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const crosswordRef = useRef()
  const [selectedDir, setSelectedDir] = useState(null)
  const [selectedNum, setSelectedNum] = useState(null)
  const [anagramOpen, setAnagramOpen] = useState(false)
  const playerGuesses = useRef({})
  const [feedback, setFeedback] = useState(null)
  const feedbackTimer = useRef(null)
  const currentRoom = useRef(null)   // { game_id }
  const playerId = useRef(getPlayerId())
  const [gameId, setGameId] = useState(null)
  const [myPlayerId, setMyPlayerId] = useState(null)
  const [players, setPlayers] = useState({})       // { player_id: { name, color } }
  const [cellOwners, setCellOwners] = useState({}) // { "row,col": player_id }
  const gridSize = useRef({ width: 15, height: 15 })
  const pendingState = useRef(null)
  const suppressEmit = useRef(false)

  const showFeedback = useCallback((kind, msg) => {
    if (feedbackTimer.current) clearTimeout(feedbackTimer.current)
    setFeedback({ kind, msg })
    feedbackTimer.current = setTimeout(() => setFeedback(null), 3000)
  }, [])

  const loadPuzzle = useCallback(async (puzzleType, puzzleNumber, existingGameId = null) => {
    setLoading(true)
    setError(null)
    setData(null)
    setFeedback(null)
    setSelectedDir(null)
    setSelectedNum(null)
    setGameId(null)
    setMyPlayerId(null)
    setPlayers({})
    setCellOwners({})
    playerGuesses.current = {}
    pendingState.current = null
    try {
      const res = await fetch(`/api/crossword/${puzzleType}/${puzzleNumber}`)
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
      const json = await res.json()
      setTitle(json.title)
      setAuthor(json.author)
      setData({ across: json.across, down: json.down })
      gridSize.current = { width: json.width || 15, height: json.height || 15 }
      let game_id = existingGameId
      if (!game_id) {
        const gameRes = await fetch('/api/game', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: puzzleType, number: puzzleNumber }),
        })
        if (!gameRes.ok) throw new Error('Failed to create game session')
        game_id = (await gameRes.json()).game_id
        history.pushState({}, '', `/game/${game_id}`)
      }
      setGameId(game_id)
      currentRoom.current = { game_id }
      socket.emit('join_game', { game_id, player_id: playerId.current })
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchCrossword = useCallback(() => {
    if (!number) return
    loadPuzzle(type, number)
  }, [type, number, loadPuzzle])

  // Auto-join from URL on first mount
  useEffect(() => {
    const match = window.location.pathname.match(/^\/game\/([0-9a-f-]+)/i)
    if (!match) return
    const game_id = match[1]
    fetch(`/api/game/${game_id}`)
      .then(r => r.ok ? r.json() : Promise.reject('not found'))
      .then(({ type: t, number: n }) => {
        setType(t)
        setNumber(String(n))
        loadPuzzle(t, n, game_id)
      })
      .catch(() => setError('Game not found. It may have expired.'))
  }, [loadPuzzle])

  // Re-join on socket reconnect
  useEffect(() => {
    function onConnect() {
      if (currentRoom.current?.game_id) {
        socket.emit('join_game', { game_id: currentRoom.current.game_id, player_id: playerId.current })
      }
    }
    socket.on('connect', onConnect)
    return () => socket.off('connect', onConnect)
  }, [])

  // Socket event handlers
  useEffect(() => {
    function onCurrentState(payload) {
      if (!crosswordRef.current) { pendingState.current = payload; return }
      applyServerState(payload)
    }
    function applyServerState({ cells, cellOwners: co, players: p, myPlayerId: myId }) {
      suppressEmit.current = true
      Object.entries(cells).forEach(([key, char]) => {
        const [row, col] = key.split(',').map(Number)
        crosswordRef.current.setGuess(row, col, char)
        playerGuesses.current[key] = char
      })
      suppressEmit.current = false
      setCellOwners(co || {})
      setPlayers(p || {})
      setMyPlayerId(myId || null)
    }
    function onCellChange({ game_id, row, col, char, player_id }) {
      if (!crosswordRef.current) return
      if (!currentRoom.current || game_id !== currentRoom.current.game_id) return
      suppressEmit.current = true
      crosswordRef.current.setGuess(row, col, char)
      suppressEmit.current = false
      const key = `${row},${col}`
      if (char) {
        playerGuesses.current[key] = char
        setCellOwners(prev => ({ ...prev, [key]: player_id }))
      } else {
        delete playerGuesses.current[key]
        setCellOwners(prev => { const n = { ...prev }; delete n[key]; return n })
      }
    }
    function onClearAll({ game_id }) {
      if (!currentRoom.current || game_id !== currentRoom.current.game_id) return
      if (crosswordRef.current) crosswordRef.current.reset()
      playerGuesses.current = {}
      setCellOwners({})
    }
    function onPlayerList({ players: p }) { setPlayers(p) }
    socket.on('current_state', onCurrentState)
    socket.on('cell_change', onCellChange)
    socket.on('clear_all', onClearAll)
    socket.on('player_list', onPlayerList)
    return () => {
      socket.off('current_state', onCurrentState)
      socket.off('cell_change', onCellChange)
      socket.off('clear_all', onClearAll)
      socket.off('player_list', onPlayerList)
    }
  }, [])

  // Apply buffered state once grid mounts (race condition fix)
  useEffect(() => {
    if (!data || !crosswordRef.current || !pendingState.current) return
    const payload = pendingState.current
    pendingState.current = null
    suppressEmit.current = true
    Object.entries(payload.cells).forEach(([key, char]) => {
      const [row, col] = key.split(',').map(Number)
      crosswordRef.current.setGuess(row, col, char)
      playerGuesses.current[key] = char
    })
    suppressEmit.current = false
    setCellOwners(payload.cellOwners || {})
    setPlayers(payload.players || {})
    setMyPlayerId(payload.myPlayerId || null)
  }, [data])

  const handleSubmit = (e) => {
    e.preventDefault()
    fetchCrossword()
  }

  const emitCell = useCallback((row, col, char) => {
    if (!currentRoom.current || suppressEmit.current) return
    socket.emit('cell_change', { game_id: currentRoom.current.game_id, player_id: playerId.current, row, col, char })
    setCellOwners(prev => {
      const next = { ...prev }
      if (char) next[`${row},${col}`] = playerId.current
      else delete next[`${row},${col}`]
      return next
    })
  }, [])

  const handleCellChange = useCallback((row, col, char) => {
    const upper = char ? char.toUpperCase() : ''
    if (upper) playerGuesses.current[`${row},${col}`] = upper
    else delete playerGuesses.current[`${row},${col}`]
    emitCell(row, col, upper)
  }, [emitCell])

  const handleClueSelected = useCallback((direction, num) => {
    setSelectedDir(direction)
    setSelectedNum(String(num))
  }, [])

  const getWordCells = useCallback((direction, num) => {
    if (!data || !data[direction]?.[num]) return []
    const { row, col, answer } = data[direction][num]
    return Array.from(answer).map((letter, i) => ({
      row: direction === 'across' ? row : row + i,
      col: direction === 'across' ? col + i : col,
      letter: letter.toUpperCase(),
    }))
  }, [data])

  const checkWord = useCallback(() => {
    if (!selectedDir || !selectedNum || !crosswordRef.current) {
      showFeedback('info', 'Select a clue first')
      return
    }
    const cells = getWordCells(selectedDir, selectedNum)
    if (!cells.length) return
    let removed = 0
    cells.forEach(({ row, col, letter }) => {
      const key = `${row},${col}`
      const guess = playerGuesses.current[key]
      if (guess && guess !== letter) {
        crosswordRef.current.setGuess(row, col, '')
        delete playerGuesses.current[key]
        emitCell(row, col, '')
        removed++
      }
    })
    if (removed === 0) {
      showFeedback('correct', 'No mistakes!')
    } else {
      showFeedback('wrong', `${removed} incorrect letter${removed > 1 ? 's' : ''} removed`)
    }
  }, [selectedDir, selectedNum, getWordCells, showFeedback, emitCell])

  const revealWord = useCallback(() => {
    if (!selectedDir || !selectedNum || !crosswordRef.current) {
      showFeedback('info', 'Select a clue first')
      return
    }
    getWordCells(selectedDir, selectedNum).forEach(({ row, col, letter }) => {
      crosswordRef.current.setGuess(row, col, letter)
      playerGuesses.current[`${row},${col}`] = letter
      emitCell(row, col, letter)
    })
  }, [selectedDir, selectedNum, getWordCells, emitCell])

  const clearWord = useCallback(() => {
    if (!selectedDir || !selectedNum || !crosswordRef.current) {
      showFeedback('info', 'Select a clue first')
      return
    }
    getWordCells(selectedDir, selectedNum).forEach(({ row, col }) => {
      crosswordRef.current.setGuess(row, col, '')
      delete playerGuesses.current[`${row},${col}`]
      emitCell(row, col, '')
    })
  }, [selectedDir, selectedNum, getWordCells, emitCell])

  const checkAll = useCallback(() => {
    if (!crosswordRef.current || !data) return
    let removed = 0
    for (const dir of ['across', 'down']) {
      for (const num of Object.keys(data[dir])) {
        getWordCells(dir, num).forEach(({ row, col, letter }) => {
          const key = `${row},${col}`
          const guess = playerGuesses.current[key]
          if (guess && guess !== letter) {
            crosswordRef.current.setGuess(row, col, '')
            delete playerGuesses.current[key]
            emitCell(row, col, '')
            removed++
          }
        })
      }
    }
    if (removed === 0) {
      showFeedback('correct', 'All correct so far!')
    } else {
      showFeedback('wrong', `${removed} incorrect letter${removed > 1 ? 's' : ''} removed`)
    }
  }, [data, getWordCells, showFeedback, emitCell])

  const revealAll = useCallback(() => {
    if (!crosswordRef.current || !data) return
    crosswordRef.current.fillAllAnswers()
    for (const dir of ['across', 'down']) {
      for (const num of Object.keys(data[dir])) {
        getWordCells(dir, num).forEach(({ row, col, letter }) => {
          playerGuesses.current[`${row},${col}`] = letter
          emitCell(row, col, letter)
        })
      }
    }
  }, [data, getWordCells, emitCell])

  const clearAll = useCallback(() => {
    if (!crosswordRef.current) return
    crosswordRef.current.reset()
    playerGuesses.current = {}
    setCellOwners({})
    if (currentRoom.current) socket.emit('clear_all', { game_id: currentRoom.current.game_id })
  }, [])

  const copyGameLink = useCallback(() => {
    navigator.clipboard.writeText(window.location.href)
      .then(() => showFeedback('correct', 'Link copied!'))
      .catch(() => showFeedback('info', window.location.href))
  }, [showFeedback])

  return (
    <div className="app">
      <header>
        <h1>Guardian Crosswords</h1>
        <form onSubmit={handleSubmit} className="picker">
          <select value={type} onChange={e => setType(e.target.value)}>
            {CROSSWORD_TYPES.map(t => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          <input
            type="number"
            placeholder="Number"
            value={number}
            onChange={e => setNumber(e.target.value)}
            min="1"
            required
          />
          <button type="submit" disabled={loading}>
            {loading ? 'Loading...' : 'Load'}
          </button>
        </form>
      </header>

      {gameId && (
        <div className="game-bar">
          <div className="game-id-row">
            <span className="game-id-label">Game:</span>
            <code className="game-id-code">{gameId.slice(0, 8)}…</code>
            <button className="btn-copy-link" onClick={copyGameLink}>Copy link</button>
          </div>
          {Object.keys(players).length > 0 && (
            <div className="players-row">
              {Object.entries(players).map(([pid, p]) => (
                <span key={pid} className="player-entry">
                  <span className="player-dot" style={{ backgroundColor: p.color }} />
                  {p.name}{pid === myPlayerId ? ' (you)' : ''}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {error && <p className="error">Error: {error}</p>}

      {feedback && (
        <div className={`feedback feedback-${feedback.kind}`}>{feedback.msg}</div>
      )}

      {data && (
        <main>
          <div className="puzzle-header">
            <h2>{title}</h2>
            <p>{author}</p>
          </div>

          <div className="controls">
            <div className="control-group">
              <span className="control-label">Word:</span>
              <button onClick={checkWord} className="btn-check">Check</button>
              <button onClick={revealWord} className="btn-reveal">Reveal</button>
              <button onClick={clearWord} className="btn-clear">Clear</button>
              <button
                onClick={() => setAnagramOpen(true)}
                className="btn-anagram"
                disabled={!selectedDir || !selectedNum}
              >
                Anagram
              </button>
            </div>
            <div className="control-group">
              <span className="control-label">All:</span>
              <button onClick={checkAll} className="btn-check">Check</button>
              <button onClick={revealAll} className="btn-reveal">Reveal</button>
              <button onClick={clearAll} className="btn-clear">Clear</button>
            </div>
          </div>

          <div className="active-clue">
            {selectedDir && selectedNum && data[selectedDir]?.[selectedNum] ? (
              <>
                <span className="active-clue-label">
                  {selectedNum} {selectedDir === 'across' ? 'Across' : 'Down'}:
                </span>
                {' '}{data[selectedDir][selectedNum].clue}
              </>
            ) : <span className="active-clue-placeholder">Select a clue to begin</span>}
          </div>

          <div className="crossword-wrapper">
            <CrosswordProvider
              ref={crosswordRef}
              data={data}
              theme={{ columnBreakpoint: '9999px' }}
              onCellChange={handleCellChange}
            >
              <SelectionWatcher onSelectionChange={handleClueSelected} />
              <div style={{ position: 'relative', flex: '1 1 auto', minWidth: 0, minHeight: 0 }}>
                <CrosswordGrid />
                <PlayerOverlay
                  cellOwners={cellOwners}
                  players={players}
                  myPlayerId={myPlayerId}
                  gridWidth={gridSize.current.width}
                  gridHeight={gridSize.current.height}
                />
              </div>
              <div className="clues-panel">
                <DirectionClues direction="across" />
                <DirectionClues direction="down" />
              </div>
            </CrosswordProvider>
          </div>
        </main>
      )}

      {anagramOpen && selectedDir && selectedNum && data?.[selectedDir]?.[selectedNum] && (
        <AnagramHelper
          key={`${selectedDir}-${selectedNum}`}
          direction={selectedDir}
          number={selectedNum}
          clue={data[selectedDir][selectedNum].clue}
          wordCells={getWordCells(selectedDir, selectedNum)}
          guesses={{ ...playerGuesses.current }}
          onClose={() => setAnagramOpen(false)}
        />
      )}
    </div>
  )
}
