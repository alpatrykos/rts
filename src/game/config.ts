import type { HudSnapshot, UnitStats, UnitType, Vec2 } from './types'

export const WORLD_EXTENT = 58
export const POPULATION_CAP = 24
export const STARTING_ENERGY = 300
export const BASE_INCOME = 7
export const RELAY_INCOME = 4
export const WAVE_INTERVAL = 28
export const CAPTURE_RADIUS = 7
export const CAPTURE_RATE = 0.26
export const PLAYER_BASE_POSITION: Vec2 = { x: -38, z: 38 }
export const ENEMY_BASE_POSITION: Vec2 = { x: 38, z: -38 }
export const RELAY_POSITIONS: Vec2[] = [
  { x: -16, z: 10 },
  { x: 8, z: -6 },
  { x: 22, z: -28 },
]

export const TEAM_COLORS = {
  player: 0x51f0cf,
  enemy: 0xff725c,
  neutral: 0xd4b483,
}

export const UNIT_STATS: Record<UnitType, UnitStats> = {
  vanguard: {
    label: 'Vanguard',
    role: 'Frontline armor',
    cost: 95,
    buildTime: 8,
    maxHp: 180,
    speed: 6,
    radius: 1.4,
    attackRange: 7.5,
    attackDamage: 22,
    attackCooldown: 1.05,
    acquisitionRange: 13,
  },
  ranger: {
    label: 'Ranger',
    role: 'Long-range skirmisher',
    cost: 125,
    buildTime: 10,
    maxHp: 95,
    speed: 6.2,
    radius: 1.15,
    attackRange: 13.5,
    attackDamage: 18,
    attackCooldown: 0.7,
    acquisitionRange: 18,
  },
  striker: {
    label: 'Striker',
    role: 'Fast assault unit',
    cost: 80,
    buildTime: 7,
    maxHp: 78,
    speed: 9,
    radius: 1.05,
    attackRange: 9.5,
    attackDamage: 13,
    attackCooldown: 0.48,
    acquisitionRange: 14,
  },
}

export function createInitialSnapshot(): HudSnapshot {
  return {
    energy: STARTING_ENERGY,
    income: BASE_INCOME,
    wave: 0,
    nextWaveIn: WAVE_INTERVAL,
    population: 0,
    cap: POPULATION_CAP,
    status: 'running',
    hqHp: 1000,
    hqMaxHp: 1000,
    coreHp: 1200,
    coreMaxHp: 1200,
    playerRelayCount: 0,
    selected: [],
    queue: [],
    relays: RELAY_POSITIONS.map((position, index) => ({
      id: `relay-${index}`,
      owner: 'neutral',
      progress: 0,
      contested: false,
      x: position.x,
      z: position.z,
    })),
    units: [],
    structures: [],
    events: [],
    production: Object.entries(UNIT_STATS).map(([type, stats]) => ({
      type: type as UnitType,
      label: stats.label,
      role: stats.role,
      cost: stats.cost,
      buildTime: stats.buildTime,
      available: true,
    })),
    objective: 'Secure relays, reinforce from your HQ, and destroy the enemy command core.',
  }
}
