import { startTransition, useDeferredValue, useEffectEvent, useRef, useState } from 'react'
import './App.css'
import GameCanvas, { type GameHandle } from './components/GameCanvas'
import { Hud } from './components/Hud'
import { createInitialSnapshot } from './game/config'
import type { HudSnapshot, UnitType } from './game/types'

function App() {
  const gameRef = useRef<GameHandle | null>(null)
  const [snapshot, setSnapshot] = useState(createInitialSnapshot)
  const deferredSnapshot = useDeferredValue(snapshot)

  const handleSnapshot = useEffectEvent((nextSnapshot: HudSnapshot) => {
    startTransition(() => {
      setSnapshot(nextSnapshot)
    })
  })

  const handleTrain = (type: UnitType) => {
    gameRef.current?.trainUnit(type)
  }

  return (
    <div className="app-shell">
      <GameCanvas onSnapshot={handleSnapshot} ref={gameRef} />
      <Hud
        onCenterCamera={() => {
          gameRef.current?.centerCamera()
        }}
        onTrain={handleTrain}
        snapshot={deferredSnapshot}
      />
    </div>
  )
}

export default App
