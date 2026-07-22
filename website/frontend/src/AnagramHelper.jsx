import { useState, useMemo } from 'react'

function shuffleArray(arr) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

export default function AnagramHelper({ direction, number, clue, wordCells, guesses, onClose }) {
  // wordCells: [{ row, col }]  — positions only, no answer
  // guesses:   snapshot of playerGuesses.current { "row,col": char }

  const answerLength = wordCells.length

  // Letters locked in from the grid (whatever the user typed, right or wrong)
  const lockedLetters = useMemo(() =>
    wordCells.map(cell => guesses[`${cell.row},${cell.col}`] || ''),
  [wordCells, guesses])

  const emptyCount = lockedLetters.filter(l => !l).length

  // The user's typed letters (raw input order)
  const [inputText, setInputText] = useState('')
  // Ordered/shuffled pool used for display (same letters as inputText, possibly reordered)
  const [pool, setPool] = useState([])

  const handleInputChange = (e) => {
    const val = e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, answerLength)
    setInputText(val)
    setPool(val.split(''))   // reset to typed order on every keystroke
  }

  const handleShuffle = () => setPool(prev => shuffleArray([...prev]))

  const handleClear = () => {
    setInputText('')
    setPool([])
  }

  // Remove pool letters that match a locked position (consume one per locked letter)
  // so the remaining letters fill only the genuinely empty positions
  const displayPool = useMemo(() => {
    const remaining = {}
    lockedLetters.forEach(l => { if (l) remaining[l] = (remaining[l] || 0) + 1 })
    const dp = []
    for (const letter of pool) {
      if ((remaining[letter] || 0) > 0) {
        remaining[letter]--  // consumed — this letter accounts for a locked position
      } else {
        dp.push(letter)      // goes into the empty display slots
      }
    }
    return dp
  }, [lockedLetters, pool])

  const overflowCount = Math.max(0, displayPool.length - emptyCount)

  // Build display boxes: locked letters fixed, displayPool fills the rest in order
  const displayBoxes = useMemo(() => {
    let poolIdx = 0
    return lockedLetters.map(locked => {
      if (locked) return { letter: locked, type: 'locked' }
      const letter = displayPool[poolIdx++] || ''
      return { letter, type: letter ? 'user' : 'empty' }
    })
  }, [lockedLetters, displayPool])
  const dirLabel = direction === 'across' ? 'Across' : 'Down'

  return (
    <div className="anagram-overlay" onMouseDown={onClose}>
      <div className="anagram-popup" onMouseDown={e => e.stopPropagation()}>

        <div className="anagram-popup-header">
          <div className="anagram-popup-meta">
            <span className="anagram-popup-num">{number} {dirLabel}</span>
            <span className="anagram-popup-clue">{clue}</span>
          </div>
          <button className="anagram-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        {/* Letter display boxes */}
        <div className="anagram-display">
          {displayBoxes.map((box, i) => (
            <div key={i} className={`anagram-box ${box.type}`}>
              {box.letter}
            </div>
          ))}
        </div>

        {overflowCount > 0 && (
          <p className="anagram-overflow">
            {overflowCount} letter{overflowCount > 1 ? 's' : ''} not shown
            (only {emptyCount} unfilled position{emptyCount !== 1 ? 's' : ''})
          </p>
        )}

        {/* Free letter entry */}
        <div className="anagram-input-row">
          <input
            className="anagram-input"
            type="text"
            value={inputText}
            onChange={handleInputChange}
            maxLength={answerLength}
            placeholder={`Type up to ${answerLength} letters…`}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            autoFocus
          />
          <span className="anagram-count">{inputText.length}/{answerLength}</span>
        </div>

        <div className="anagram-actions">
          <button onClick={handleShuffle} disabled={pool.length < 2}>Shuffle</button>
          <button onClick={handleClear}>Clear</button>
        </div>

        <p className="anagram-hint">
          {lockedLetters.some(Boolean)
            ? 'Amber = already in grid (fixed). Blue = your letters (shuffled into empty positions).'
            : 'Type letters, then Shuffle to rearrange them.'}
        </p>
      </div>
    </div>
  )
}


