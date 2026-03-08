export const UNIT_TYPES = ['vanguard', 'ranger', 'striker'] as const

export type Team = 'player' | 'enemy'
export type Ownership = Team | 'neutral'
export type UnitType = (typeof UNIT_TYPES)[number]
export type StructureType = 'hq' | 'core'
export type GameStatus = 'running' | 'won' | 'lost'

export interface Vec2 {
  x: number
  z: number
}

export interface UnitStats {
  label: string
  role: string
  cost: number
  buildTime: number
  maxHp: number
  speed: number
  radius: number
  attackRange: number
  attackDamage: number
  attackCooldown: number
  acquisitionRange: number
}

export interface UnitState {
  id: number
  team: Team
  type: UnitType
  position: Vec2
  velocity: Vec2
  facing: number
  hp: number
  maxHp: number
  radius: number
  moveTarget: Vec2 | null
  focusUnitId: number | null
  focusStructureId: string | null
  attackCooldown: number
  retargetTimer: number
}

export interface StructureState {
  id: string
  team: Team
  type: StructureType
  position: Vec2
  hp: number
  maxHp: number
  attackCooldown: number
  radius: number
}

export interface RelayState {
  id: string
  position: Vec2
  control: number
  owner: Ownership
  contested: boolean
}

export interface QueueItem {
  type: UnitType
  remaining: number
  total: number
}

export interface HudEvent {
  id: number
  text: string
  tone: 'neutral' | 'good' | 'bad'
}

export interface HudUnitSummary {
  id: number
  type: UnitType
  hp: number
  maxHp: number
  team: Team
  x: number
  z: number
}

export interface HudStructureSummary {
  id: string
  type: StructureType
  hp: number
  maxHp: number
  team: Team
  x: number
  z: number
}

export interface HudRelaySummary {
  id: string
  owner: Ownership
  progress: number
  contested: boolean
  x: number
  z: number
}

export interface ProductionOption {
  type: UnitType
  label: string
  role: string
  cost: number
  buildTime: number
  available: boolean
}

export interface HudSnapshot {
  energy: number
  income: number
  wave: number
  nextWaveIn: number
  population: number
  cap: number
  status: GameStatus
  hqHp: number
  hqMaxHp: number
  coreHp: number
  coreMaxHp: number
  playerRelayCount: number
  selected: HudUnitSummary[]
  queue: QueueItem[]
  relays: HudRelaySummary[]
  units: HudUnitSummary[]
  structures: HudStructureSummary[]
  events: HudEvent[]
  production: ProductionOption[]
  objective: string
}

export interface WorldState {
  energy: number
  wave: number
  waveTimer: number
  status: GameStatus
  units: UnitState[]
  structures: StructureState[]
  relays: RelayState[]
  selectedIds: Set<number>
  queue: QueueItem[]
  eventCounter: number
}
