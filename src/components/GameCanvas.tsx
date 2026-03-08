import {
  forwardRef,
  useEffect,
  useEffectEvent,
  useImperativeHandle,
  useRef,
} from 'react'
import { RtsGame } from '../game/engine'
import type { HudSnapshot, UnitType } from '../game/types'

export interface GameHandle {
  centerCamera: () => void
  trainUnit: (type: UnitType) => void
}

interface GameCanvasProps {
  onSnapshot: (snapshot: HudSnapshot) => void
}

const GameCanvas = forwardRef<GameHandle, GameCanvasProps>(function GameCanvas(
  { onSnapshot },
  ref,
) {
  const mountRef = useRef<HTMLDivElement | null>(null)
  const gameRef = useRef<RtsGame | null>(null)

  const emitSnapshot = useEffectEvent((snapshot: HudSnapshot) => {
    onSnapshot(snapshot)
  })

  useEffect(() => {
    if (!mountRef.current) {
      return undefined
    }

    const game = new RtsGame(mountRef.current, {
      onSnapshot: emitSnapshot,
    })
    gameRef.current = game

    return () => {
      gameRef.current = null
      game.dispose()
    }
  }, [])

  useImperativeHandle(
    ref,
    () => ({
      centerCamera: () => {
        gameRef.current?.centerCamera()
      },
      trainUnit: (type: UnitType) => {
        gameRef.current?.trainUnit(type)
      },
    }),
    [],
  )

  return <div className="battlefield" ref={mountRef} />
})

export default GameCanvas
