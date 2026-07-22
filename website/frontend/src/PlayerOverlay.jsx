export default function PlayerOverlay({ cellOwners, players, myPlayerId, gridWidth, gridHeight }) {
  const entries = Object.entries(cellOwners).filter(([, owner]) => owner !== myPlayerId)
  if (!entries.length) return null

  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
      {entries.map(([key, owner]) => {
        const [row, col] = key.split(',').map(Number)
        const color = players[owner]?.color || '#999999'
        return (
          <div
            key={key}
            style={{
              position: 'absolute',
              left: `${(col / gridWidth) * 100}%`,
              top: `${(row / gridHeight) * 100}%`,
              width: `${100 / gridWidth}%`,
              height: `${100 / gridHeight}%`,
              backgroundColor: color,
              opacity: 0.28,
            }}
          />
        )
      })}
    </div>
  )
}
