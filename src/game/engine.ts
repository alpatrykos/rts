import * as THREE from 'three'
import {
  BASE_INCOME,
  CAPTURE_RADIUS,
  CAPTURE_RATE,
  ENEMY_BASE_POSITION,
  PLAYER_BASE_POSITION,
  POPULATION_CAP,
  RELAY_INCOME,
  RELAY_POSITIONS,
  TEAM_COLORS,
  UNIT_STATS,
  WAVE_INTERVAL,
  WORLD_EXTENT,
} from './config'
import {
  add2,
  angleOf,
  clamp,
  distance2,
  distanceSq2,
  fromAngle,
  lerp,
  limit2,
  normalize2,
  rotate2,
  scale2,
  subtract2,
  vec2,
} from './math'
import { TerrainField, createTerrainMesh } from './terrain'
import type {
  GameStatus,
  HudEvent,
  HudSnapshot,
  HudUnitSummary,
  Ownership,
  ProductionOption,
  RelayState,
  StructureState,
  Team,
  UnitState,
  UnitType,
  Vec2,
  WorldState,
} from './types'

interface GameCallbacks {
  onSnapshot: (snapshot: HudSnapshot) => void
}

interface UnitView {
  group: THREE.Group
  hitArea: THREE.Mesh
  selectionRing: THREE.Mesh
  healthFill: THREE.Mesh
  turret: THREE.Object3D | null
  hoverSeed: number
}

interface StructureView {
  group: THREE.Group
  hitArea: THREE.Mesh
  healthFill: THREE.Mesh
  pulse: THREE.Mesh
}

interface RelayView {
  group: THREE.Group
  crystal: THREE.Mesh
  ring: THREE.Mesh
  beam: THREE.Mesh
  ringMaterial: THREE.MeshBasicMaterial
  beamMaterial: THREE.MeshBasicMaterial
  crystalMaterial: THREE.MeshStandardMaterial
}

type EffectKind = 'tracer' | 'burst' | 'command'

interface EffectView {
  id: number
  kind: EffectKind
  age: number
  lifetime: number
  object: THREE.Object3D
  origin: THREE.Vector3
  target: THREE.Vector3
  material: THREE.Material
}

const CAMERA_NEAR = 1
const CAMERA_FAR = 220
const CAMERA_MIN_DISTANCE = 22
const CAMERA_MAX_DISTANCE = 62
const SNAPSHOT_RATE = 0.12
const QUEUE_LIMIT = 4
const Y_AXIS = new THREE.Vector3(0, 1, 0)
const HUD_EVENT_LIMIT = 5

function getStructureMaxHp(type: 'hq' | 'core') {
  return type === 'hq' ? 1100 : 1250
}

function getStructureRadius(type: 'hq' | 'core') {
  return type === 'hq' ? 6.2 : 6.8
}

function createRingMaterial(color: number) {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.85,
    toneMapped: false,
    side: THREE.DoubleSide,
    depthWrite: false,
  })
}

function createHealthMaterial(color: number) {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.96,
    toneMapped: false,
  })
}

function createInvisibleHitMaterial() {
  return new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.001,
    depthWrite: false,
  })
}

function hasMeshUserData(
  data: unknown,
): data is { kind: 'unit'; unitId: number } | { kind: 'structure'; structureId: string } {
  if (typeof data !== 'object' || data === null) {
    return false
  }
  return 'kind' in data
}

function formationOffsets(count: number, facing: Vec2) {
  const result: Vec2[] = []
  const right = rotate2(normalize2(facing), Math.PI / 2)
  const forward = normalize2(facing)
  const columns = Math.ceil(Math.sqrt(count))
  const spacing = 3.9
  for (let index = 0; index < count; index += 1) {
    const row = Math.floor(index / columns)
    const column = index % columns
    const centeredX = (column - (columns - 1) / 2) * spacing
    const centeredZ = -row * spacing
    const offset = add2(scale2(right, centeredX), scale2(forward, centeredZ))
    result.push(offset)
  }
  return result
}

function toneForOwner(owner: Ownership) {
  if (owner === 'player') {
    return TEAM_COLORS.player
  }
  if (owner === 'enemy') {
    return TEAM_COLORS.enemy
  }
  return TEAM_COLORS.neutral
}

function objectiveForState(
  status: GameStatus,
  playerRelayCount: number,
  queueLength: number,
): string {
  if (status === 'won') {
    return 'Enemy core neutralized. Relay valley secure.'
  }
  if (status === 'lost') {
    return 'HQ collapsed. Rebuild the defense line and try again.'
  }
  if (playerRelayCount === 0) {
    return 'Capture a relay to accelerate income before the first waves spike.'
  }
  if (playerRelayCount < 2) {
    return 'Hold at least two relays so your production can keep pace with enemy waves.'
  }
  if (queueLength > 0) {
    return 'Escort your reinforcements across the center lane and pressure the core.'
  }
  return 'Push the frontline while your relay network funds constant reinforcements.'
}

function summaryForUnit(unit: UnitState): HudUnitSummary {
  return {
    id: unit.id,
    type: unit.type,
    hp: unit.hp,
    maxHp: unit.maxHp,
    team: unit.team,
    x: unit.position.x,
    z: unit.position.z,
  }
}

export class RtsGame {
  private readonly mount: HTMLElement
  private readonly callbacks: GameCallbacks
  private readonly renderer: THREE.WebGLRenderer
  private readonly scene: THREE.Scene
  private readonly camera: THREE.PerspectiveCamera
  private readonly raycaster = new THREE.Raycaster()
  private readonly pointerNdc = new THREE.Vector2()
  private readonly terrain = new TerrainField(WORLD_EXTENT)
  private readonly terrainMesh: THREE.Mesh
  private readonly unitLayer = new THREE.Group()
  private readonly structureLayer = new THREE.Group()
  private readonly relayLayer = new THREE.Group()
  private readonly effectLayer = new THREE.Group()
  private readonly resizeObserver: ResizeObserver
  private readonly selectionEl: HTMLDivElement
  private readonly unitViews = new Map<number, UnitView>()
  private readonly structureViews = new Map<string, StructureView>()
  private readonly relayViews = new Map<string, RelayView>()
  private readonly effects: EffectView[] = []
  private readonly keys = new Set<string>()
  private readonly pointer = { x: 0, y: 0, inside: false }
  private readonly drag = {
    active: false,
    selecting: false,
    pointerId: -1,
    startX: 0,
    startY: 0,
    currentX: 0,
    currentY: 0,
  }
  private readonly events: HudEvent[] = []
  private world: WorldState
  private animationHandle = 0
  private snapshotTimer = 0
  private lastTick = performance.now()
  private nextUnitId = 1
  private nextEffectId = 1
  private cameraTarget = new THREE.Vector3(-10, 0, 10)
  private cameraDistance = 36
  private cameraYaw = Math.PI * 0.18
  private cameraPitch = 0.92

  constructor(mount: HTMLElement, callbacks: GameCallbacks) {
    this.mount = mount
    this.callbacks = callbacks

    this.scene = new THREE.Scene()
    this.scene.background = new THREE.Color('#081117')
    this.scene.fog = new THREE.Fog('#081117', 58, 130)

    this.camera = new THREE.PerspectiveCamera(50, 1, CAMERA_NEAR, CAMERA_FAR)

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFShadowMap
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.15

    this.mount.append(this.renderer.domElement)

    this.terrainMesh = createTerrainMesh(this.terrain)
    this.scene.add(this.terrainMesh)
    this.scene.add(this.unitLayer, this.structureLayer, this.relayLayer, this.effectLayer)

    this.world = {
      energy: 300,
      wave: 0,
      waveTimer: WAVE_INTERVAL,
      status: 'running',
      units: [],
      structures: [],
      relays: RELAY_POSITIONS.map((position, index) => ({
        id: `relay-${index + 1}`,
        position,
        control: 0,
        owner: 'neutral',
        contested: false,
      })),
      selectedIds: new Set<number>(),
      queue: [],
      eventCounter: 1,
    }

    this.selectionEl = document.createElement('div')
    this.selectionEl.className = 'selection-rect'
    this.selectionEl.hidden = true
    this.mount.append(this.selectionEl)

    this.setupLights()
    this.setupAtmosphere()
    this.setupBattlefield()
    this.bindEvents()

    this.resizeObserver = new ResizeObserver(() => {
      this.resize()
    })
    this.resizeObserver.observe(this.mount)
    this.resize()

    this.pushEvent('Relay valley online. Establish the frontline.', 'neutral')
    this.emitSnapshot()
    this.frame()
  }

  dispose() {
    cancelAnimationFrame(this.animationHandle)
    this.resizeObserver.disconnect()
    this.unbindEvents()
    this.renderer.dispose()
    this.mount.innerHTML = ''
  }

  trainUnit(type: UnitType) {
    if (this.world.status !== 'running') {
      return
    }

    const stats = UNIT_STATS[type]
    const queuedPopulation = this.world.queue.length
    const currentPopulation = this.world.units.filter((unit) => unit.team === 'player').length
    if (this.world.queue.length >= QUEUE_LIMIT) {
      this.pushEvent('Production bay saturated. Deploy current queue first.', 'bad')
      return
    }
    if (currentPopulation + queuedPopulation >= POPULATION_CAP) {
      this.pushEvent('Population cap reached. Trade units before adding more.', 'bad')
      return
    }
    if (this.world.energy < stats.cost) {
      this.pushEvent('Insufficient energy. Capture relays or wait for income.', 'bad')
      return
    }

    this.world.energy -= stats.cost
    this.world.queue.push({
      type,
      remaining: stats.buildTime,
      total: stats.buildTime,
    })
    this.pushEvent(`${stats.label} queued at HQ fabrication bay.`, 'good')
    this.emitSnapshot()
  }

  centerCamera() {
    const selectedUnits = this.world.units.filter((unit) => this.world.selectedIds.has(unit.id))
    if (selectedUnits.length > 0) {
      const center = selectedUnits.reduce(
        (sum, unit) => add2(sum, unit.position),
        vec2(),
      )
      this.cameraTarget.x = center.x / selectedUnits.length
      this.cameraTarget.z = center.z / selectedUnits.length
      return
    }

    this.cameraTarget.x = PLAYER_BASE_POSITION.x
    this.cameraTarget.z = PLAYER_BASE_POSITION.z
  }

  private setupLights() {
    const hemisphere = new THREE.HemisphereLight('#7fd3ff', '#513319', 0.95)
    this.scene.add(hemisphere)

    const sun = new THREE.DirectionalLight('#ffe1a6', 2.4)
    sun.position.set(-34, 52, 20)
    sun.castShadow = true
    sun.shadow.mapSize.setScalar(2048)
    sun.shadow.camera.left = -70
    sun.shadow.camera.right = 70
    sun.shadow.camera.top = 70
    sun.shadow.camera.bottom = -70
    sun.shadow.camera.near = 5
    sun.shadow.camera.far = 140
    sun.shadow.bias = -0.00018
    this.scene.add(sun)

    const playerGlow = new THREE.PointLight('#5ef0d0', 18, 32, 2)
    playerGlow.position.set(PLAYER_BASE_POSITION.x, this.sampleHeight(PLAYER_BASE_POSITION) + 8, PLAYER_BASE_POSITION.z)
    this.scene.add(playerGlow)

    const enemyGlow = new THREE.PointLight('#ff7d66', 19, 35, 2)
    enemyGlow.position.set(ENEMY_BASE_POSITION.x, this.sampleHeight(ENEMY_BASE_POSITION) + 9, ENEMY_BASE_POSITION.z)
    this.scene.add(enemyGlow)
  }

  private setupAtmosphere() {
    const grid = new THREE.GridHelper(WORLD_EXTENT * 2.15, 24, '#45807a', '#16343a')
    grid.position.y = 0.08
    if (Array.isArray(grid.material)) {
      grid.material.forEach((material: THREE.Material) => {
        material.transparent = true
        material.opacity = 0.22
      })
    } else {
      grid.material.transparent = true
      grid.material.opacity = 0.22
    }
    this.scene.add(grid)

    const vignetteGeometry = new THREE.RingGeometry(WORLD_EXTENT * 1.16, WORLD_EXTENT * 1.34, 64)
    vignetteGeometry.rotateX(-Math.PI / 2)
    const vignette = new THREE.Mesh(
      vignetteGeometry,
      new THREE.MeshBasicMaterial({
        color: '#051015',
        transparent: true,
        opacity: 0.9,
        toneMapped: false,
        side: THREE.DoubleSide,
      }),
    )
    vignette.position.y = 0.2
    this.scene.add(vignette)
  }

  private setupBattlefield() {
    this.world.structures.push(
      {
        id: 'hq',
        team: 'player',
        type: 'hq',
        position: { ...PLAYER_BASE_POSITION },
        hp: getStructureMaxHp('hq'),
        maxHp: getStructureMaxHp('hq'),
        attackCooldown: 0,
        radius: getStructureRadius('hq'),
      },
      {
        id: 'core',
        team: 'enemy',
        type: 'core',
        position: { ...ENEMY_BASE_POSITION },
        hp: getStructureMaxHp('core'),
        maxHp: getStructureMaxHp('core'),
        attackCooldown: 0,
        radius: getStructureRadius('core'),
      },
    )

    this.spawnUnit('player', 'vanguard', add2(PLAYER_BASE_POSITION, { x: 4, z: -2 }))
    this.spawnUnit('player', 'vanguard', add2(PLAYER_BASE_POSITION, { x: 1, z: -5 }))
    this.spawnUnit('player', 'ranger', add2(PLAYER_BASE_POSITION, { x: 6, z: -7 }))
    this.spawnUnit('player', 'striker', add2(PLAYER_BASE_POSITION, { x: 0, z: -9 }))
    this.spawnUnit('player', 'striker', add2(PLAYER_BASE_POSITION, { x: -4, z: -6 }))

    this.spawnUnit('enemy', 'vanguard', add2(ENEMY_BASE_POSITION, { x: -4, z: 3 }))
    this.spawnUnit('enemy', 'ranger', add2(ENEMY_BASE_POSITION, { x: -1, z: 6 }))
    this.spawnUnit('enemy', 'striker', add2(ENEMY_BASE_POSITION, { x: 4, z: 4 }))

    this.updateViews(true)
  }

  private bindEvents() {
    this.onPointerDown = this.onPointerDown.bind(this)
    this.onPointerMove = this.onPointerMove.bind(this)
    this.onPointerUp = this.onPointerUp.bind(this)
    this.onContextMenu = this.onContextMenu.bind(this)
    this.onWheel = this.onWheel.bind(this)
    this.onMouseEnter = this.onMouseEnter.bind(this)
    this.onMouseLeave = this.onMouseLeave.bind(this)
    this.onKeyDown = this.onKeyDown.bind(this)
    this.onKeyUp = this.onKeyUp.bind(this)

    this.renderer.domElement.addEventListener('pointerdown', this.onPointerDown)
    window.addEventListener('pointermove', this.onPointerMove)
    window.addEventListener('pointerup', this.onPointerUp)
    this.renderer.domElement.addEventListener('contextmenu', this.onContextMenu)
    this.renderer.domElement.addEventListener('wheel', this.onWheel, { passive: false })
    this.renderer.domElement.addEventListener('mouseenter', this.onMouseEnter)
    this.renderer.domElement.addEventListener('mouseleave', this.onMouseLeave)
    window.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('keyup', this.onKeyUp)
  }

  private unbindEvents() {
    this.renderer.domElement.removeEventListener('pointerdown', this.onPointerDown)
    window.removeEventListener('pointermove', this.onPointerMove)
    window.removeEventListener('pointerup', this.onPointerUp)
    this.renderer.domElement.removeEventListener('contextmenu', this.onContextMenu)
    this.renderer.domElement.removeEventListener('wheel', this.onWheel)
    this.renderer.domElement.removeEventListener('mouseenter', this.onMouseEnter)
    this.renderer.domElement.removeEventListener('mouseleave', this.onMouseLeave)
    window.removeEventListener('keydown', this.onKeyDown)
    window.removeEventListener('keyup', this.onKeyUp)
  }

  private onPointerDown(event: PointerEvent) {
    if (this.world.status !== 'running') {
      return
    }

    this.updatePointer(event)
    if (event.button === 0) {
      this.drag.active = true
      this.drag.selecting = false
      this.drag.pointerId = event.pointerId
      this.drag.startX = event.clientX
      this.drag.startY = event.clientY
      this.drag.currentX = event.clientX
      this.drag.currentY = event.clientY
      this.renderer.domElement.setPointerCapture(event.pointerId)
      return
    }

    if (event.button === 2) {
      event.preventDefault()
      this.handleCommand(event.clientX, event.clientY)
    }
  }

  private onPointerMove(event: PointerEvent) {
    this.updatePointer(event)

    if (!this.drag.active || this.drag.pointerId !== event.pointerId) {
      return
    }

    this.drag.currentX = event.clientX
    this.drag.currentY = event.clientY

    const moved =
      Math.abs(this.drag.currentX - this.drag.startX) > 6 ||
      Math.abs(this.drag.currentY - this.drag.startY) > 6
    this.drag.selecting = moved
    if (moved) {
      this.updateSelectionRect()
    }
  }

  private onPointerUp(event: PointerEvent) {
    if (!this.drag.active || this.drag.pointerId !== event.pointerId) {
      return
    }

    this.drag.currentX = event.clientX
    this.drag.currentY = event.clientY
    this.renderer.domElement.releasePointerCapture(event.pointerId)

    if (this.drag.selecting) {
      this.selectUnitsInRect(event.shiftKey)
    } else {
      this.selectSingle(event.clientX, event.clientY, event.shiftKey)
    }

    this.drag.active = false
    this.drag.selecting = false
    this.selectionEl.hidden = true
  }

  private onContextMenu(event: MouseEvent) {
    event.preventDefault()
  }

  private onWheel(event: WheelEvent) {
    event.preventDefault()
    this.cameraDistance = clamp(
      this.cameraDistance + event.deltaY * 0.018,
      CAMERA_MIN_DISTANCE,
      CAMERA_MAX_DISTANCE,
    )
  }

  private onMouseEnter(event: MouseEvent) {
    this.pointer.inside = true
    this.pointer.x = event.clientX
    this.pointer.y = event.clientY
  }

  private onMouseLeave() {
    this.pointer.inside = false
  }

  private onKeyDown(event: KeyboardEvent) {
    this.keys.add(event.key.toLowerCase())
    if (event.key === ' ') {
      event.preventDefault()
      this.centerCamera()
    }
  }

  private onKeyUp(event: KeyboardEvent) {
    this.keys.delete(event.key.toLowerCase())
  }

  private updatePointer(event: MouseEvent | PointerEvent) {
    this.pointer.x = event.clientX
    this.pointer.y = event.clientY
  }

  private updateSelectionRect() {
    const rect = this.mount.getBoundingClientRect()
    const left = Math.min(this.drag.startX, this.drag.currentX) - rect.left
    const top = Math.min(this.drag.startY, this.drag.currentY) - rect.top
    const width = Math.abs(this.drag.currentX - this.drag.startX)
    const height = Math.abs(this.drag.currentY - this.drag.startY)
    this.selectionEl.hidden = false
    this.selectionEl.style.left = `${left}px`
    this.selectionEl.style.top = `${top}px`
    this.selectionEl.style.width = `${width}px`
    this.selectionEl.style.height = `${height}px`
  }

  private selectSingle(clientX: number, clientY: number, additive: boolean) {
    const hit = this.pickObject(clientX, clientY)
    if (!additive) {
      this.world.selectedIds.clear()
    }

    if (hit?.kind === 'unit') {
      const unit = this.world.units.find((candidate) => candidate.id === hit.unitId)
      if (unit?.team === 'player') {
        if (additive && this.world.selectedIds.has(unit.id)) {
          this.world.selectedIds.delete(unit.id)
        } else {
          this.world.selectedIds.add(unit.id)
        }
      }
    }

    this.emitSnapshot()
  }

  private selectUnitsInRect(additive: boolean) {
    if (!additive) {
      this.world.selectedIds.clear()
    }

    const rect = this.mount.getBoundingClientRect()
    const left = Math.min(this.drag.startX, this.drag.currentX) - rect.left
    const right = Math.max(this.drag.startX, this.drag.currentX) - rect.left
    const top = Math.min(this.drag.startY, this.drag.currentY) - rect.top
    const bottom = Math.max(this.drag.startY, this.drag.currentY) - rect.top

    const projected = new THREE.Vector3()
    for (const unit of this.world.units) {
      if (unit.team !== 'player') {
        continue
      }
      projected.set(unit.position.x, this.sampleHeight(unit.position) + 1.8, unit.position.z)
      projected.project(this.camera)
      const screenX = (projected.x * 0.5 + 0.5) * rect.width
      const screenY = (-projected.y * 0.5 + 0.5) * rect.height
      if (screenX >= left && screenX <= right && screenY >= top && screenY <= bottom) {
        this.world.selectedIds.add(unit.id)
      }
    }

    this.emitSnapshot()
  }

  private handleCommand(clientX: number, clientY: number) {
    const selected = this.world.units.filter(
      (unit) => unit.team === 'player' && this.world.selectedIds.has(unit.id),
    )
    if (selected.length === 0) {
      return
    }

    const hit = this.pickObject(clientX, clientY)
    if (hit?.kind === 'unit') {
      const target = this.world.units.find((unit) => unit.id === hit.unitId)
      if (target && target.team === 'enemy') {
        for (const unit of selected) {
          unit.focusUnitId = target.id
          unit.focusStructureId = null
          unit.moveTarget = null
        }
        this.spawnCommandMarker(target.position, TEAM_COLORS.enemy)
        return
      }
    }

    if (hit?.kind === 'structure') {
      const target = this.world.structures.find((structure) => structure.id === hit.structureId)
      if (target && target.team === 'enemy') {
        for (const unit of selected) {
          unit.focusUnitId = null
          unit.focusStructureId = target.id
          unit.moveTarget = null
        }
        this.spawnCommandMarker(target.position, TEAM_COLORS.enemy)
        return
      }
    }

    const ground = this.pickGround(clientX, clientY)
    if (!ground) {
      return
    }

    const average = selected.reduce((sum, unit) => add2(sum, unit.position), vec2())
    const center = scale2(average, 1 / selected.length)
    const facing = subtract2(ground, center)
    const offsets = formationOffsets(selected.length, lengthSq(facing) > 0.25 ? facing : { x: 1, z: 0 })
    selected
      .sort((left, right) => left.id - right.id)
      .forEach((unit, index) => {
        unit.moveTarget = add2(ground, offsets[index])
        unit.focusUnitId = null
        unit.focusStructureId = null
      })

    this.spawnCommandMarker(ground, TEAM_COLORS.player)
  }

  private frame = () => {
    const now = performance.now()
    const dt = Math.min(0.05, (now - this.lastTick) / 1000)
    this.lastTick = now

    this.updateCamera(dt)
    this.simulate(dt)
    this.updateEffects(dt)
    this.updateViews(false)
    this.renderer.render(this.scene, this.camera)

    this.snapshotTimer -= dt
    if (this.snapshotTimer <= 0) {
      this.snapshotTimer = SNAPSHOT_RATE
      this.emitSnapshot()
    }

    this.animationHandle = requestAnimationFrame(this.frame)
  }

  private updateCamera(dt: number) {
    const panX =
      (this.keys.has('d') || this.keys.has('arrowright') ? 1 : 0) -
      (this.keys.has('a') || this.keys.has('arrowleft') ? 1 : 0)
    const panZ =
      (this.keys.has('w') || this.keys.has('arrowup') ? 1 : 0) -
      (this.keys.has('s') || this.keys.has('arrowdown') ? 1 : 0)

    let edgePanX = 0
    let edgePanZ = 0
    if (this.pointer.inside) {
      const rect = this.mount.getBoundingClientRect()
      const threshold = 42
      edgePanX = this.pointer.x < rect.left + threshold ? -1 : this.pointer.x > rect.right - threshold ? 1 : 0
      edgePanZ = this.pointer.y < rect.top + threshold ? 1 : this.pointer.y > rect.bottom - threshold ? -1 : 0
    }

    const yawDelta =
      (this.keys.has('e') ? 1 : 0) -
      (this.keys.has('q') ? 1 : 0)
    this.cameraYaw += yawDelta * dt * 1.25

    const movement = normalize2({ x: panX + edgePanX, z: panZ + edgePanZ })
    const forward = { x: Math.sin(this.cameraYaw), z: Math.cos(this.cameraYaw) }
    const right = rotate2(forward, -Math.PI / 2)
    const worldMove = add2(scale2(right, movement.x), scale2(forward, movement.z))
    const speed = lerp(18, 36, (this.cameraDistance - CAMERA_MIN_DISTANCE) / (CAMERA_MAX_DISTANCE - CAMERA_MIN_DISTANCE))
    this.cameraTarget.x = clamp(this.cameraTarget.x + worldMove.x * speed * dt, -WORLD_EXTENT + 10, WORLD_EXTENT - 10)
    this.cameraTarget.z = clamp(this.cameraTarget.z + worldMove.z * speed * dt, -WORLD_EXTENT + 10, WORLD_EXTENT - 10)

    const targetY = this.terrain.getHeight(this.cameraTarget.x, this.cameraTarget.z) * 0.22 + 2.4
    const radius = Math.cos(this.cameraPitch) * this.cameraDistance
    const vertical = Math.sin(this.cameraPitch) * this.cameraDistance
    this.camera.position.set(
      this.cameraTarget.x + Math.sin(this.cameraYaw) * radius,
      targetY + vertical,
      this.cameraTarget.z + Math.cos(this.cameraYaw) * radius,
    )
    this.camera.lookAt(this.cameraTarget.x, targetY - 1, this.cameraTarget.z)
  }

  private simulate(dt: number) {
    if (this.world.status !== 'running') {
      return
    }

    this.world.energy += dt * this.currentIncome()
    this.world.waveTimer -= dt
    if (this.world.waveTimer <= 0) {
      this.world.waveTimer += WAVE_INTERVAL
      this.world.wave += 1
      this.spawnEnemyWave(this.world.wave)
    }

    this.updateQueue(dt)
    this.updateRelayControl(dt)
    this.updateStructures(dt)
    this.updateUnits(dt)
    this.cleanupDestroyed()
  }

  private updateQueue(dt: number) {
    const [current] = this.world.queue
    if (!current) {
      return
    }

    current.remaining -= dt
    if (current.remaining > 0) {
      return
    }

    this.world.queue.shift()
    const spawnOffset = rotate2({ x: 0, z: -8 }, Math.random() * 0.7 - 0.35)
    const spawnPosition = add2(PLAYER_BASE_POSITION, spawnOffset)
    this.spawnUnit('player', current.type, spawnPosition)
    this.pushEvent(`${UNIT_STATS[current.type].label} deployed from HQ.`, 'good')
  }

  private updateRelayControl(dt: number) {
    for (const relay of this.world.relays) {
      let playerCount = 0
      let enemyCount = 0
      for (const unit of this.world.units) {
        const distance = distance2(unit.position, relay.position)
        if (distance > CAPTURE_RADIUS) {
          continue
        }
        if (unit.team === 'player') {
          playerCount += 1
        } else {
          enemyCount += 1
        }
      }

      relay.contested = playerCount > 0 && enemyCount > 0
      if (relay.contested || (playerCount === 0 && enemyCount === 0)) {
        continue
      }

      const beforeOwner = relay.owner
      const direction = playerCount > 0 ? 1 : -1
      const momentum = 1 + Math.max(playerCount, enemyCount) * 0.08
      relay.control = clamp(relay.control + direction * dt * CAPTURE_RATE * momentum, -1, 1)

      if (relay.control > 0.9) {
        relay.owner = 'player'
      } else if (relay.control < -0.9) {
        relay.owner = 'enemy'
      } else {
        relay.owner = 'neutral'
      }

      if (relay.owner !== beforeOwner) {
        if (relay.owner === 'player') {
          this.pushEvent(`${relay.id.toUpperCase()} secured. Income increased.`, 'good')
          this.spawnBurst(relay.position, TEAM_COLORS.player, 4.2)
        } else if (relay.owner === 'enemy') {
          this.pushEvent(`${relay.id.toUpperCase()} lost to enemy forces.`, 'bad')
          this.spawnBurst(relay.position, TEAM_COLORS.enemy, 4.2)
        }
      }
    }
  }

  private updateStructures(dt: number) {
    for (const structure of this.world.structures) {
      structure.attackCooldown = Math.max(0, structure.attackCooldown - dt)
      const target = this.findNearestEnemyUnit(structure.team, structure.position, 16)
      if (!target || structure.attackCooldown > 0) {
        continue
      }

      structure.attackCooldown = structure.type === 'hq' ? 0.9 : 0.75
      const origin = this.toWorldVector(structure.position, 4.4)
      const targetPoint = this.toWorldVector(target.position, 1.8)
      this.spawnTracer(origin, targetPoint, structure.team)
      target.hp -= structure.type === 'hq' ? 22 : 26
    }
  }

  private updateUnits(dt: number) {
    for (const unit of this.world.units) {
      if (unit.hp <= 0) {
        continue
      }

      const stats = UNIT_STATS[unit.type]
      unit.attackCooldown = Math.max(0, unit.attackCooldown - dt)
      unit.retargetTimer = Math.max(0, unit.retargetTimer - dt)

      let focusUnit = unit.focusUnitId !== null ? this.findUnit(unit.focusUnitId) : null
      let focusStructure =
        unit.focusStructureId !== null ? this.findStructure(unit.focusStructureId) : null

      if (focusUnit && focusUnit.team === unit.team) {
        focusUnit = null
      }
      if (focusStructure && focusStructure.team === unit.team) {
        focusStructure = null
      }

      if (!focusUnit && !focusStructure) {
        unit.focusUnitId = null
        unit.focusStructureId = null
      }

      if (!focusUnit && !focusStructure && unit.retargetTimer <= 0) {
        const target = this.findNearestHostile(unit, stats.acquisitionRange)
        if (target?.kind === 'unit') {
          focusUnit = target.unit
        } else if (target?.kind === 'structure') {
          focusStructure = target.structure
        }
        unit.retargetTimer = 0.25 + Math.random() * 0.15
      }

      if (unit.team === 'enemy' && !focusUnit && !focusStructure && !unit.moveTarget) {
        unit.moveTarget = this.enemyObjective()
      }

      let desiredVelocity = vec2()
      const activeTargetPosition = focusUnit?.position ?? focusStructure?.position ?? null
      const activeTargetRadius = focusUnit?.radius ?? focusStructure?.radius ?? 0
      const attackRange = stats.attackRange + unit.radius + activeTargetRadius

      if (activeTargetPosition) {
        const toTarget = subtract2(activeTargetPosition, unit.position)
        const distance = distance2(activeTargetPosition, unit.position)
        if (distance <= attackRange) {
          unit.moveTarget = null
          desiredVelocity = vec2()
          if (distance > 0.1) {
            unit.facing = angleOf(toTarget)
          }
          if (unit.attackCooldown <= 0) {
            unit.attackCooldown = stats.attackCooldown
            const origin = this.toWorldVector(unit.position, 1.6)
            const target = this.toWorldVector(activeTargetPosition, focusStructure ? 4.2 : 1.5)
            this.spawnTracer(origin, target, unit.team)
            if (focusUnit) {
              focusUnit.hp -= stats.attackDamage
            }
            if (focusStructure) {
              focusStructure.hp -= stats.attackDamage
            }
          }
        } else {
          desiredVelocity = scale2(normalize2(toTarget), stats.speed)
          unit.facing = angleOf(desiredVelocity)
        }
      } else if (unit.moveTarget) {
        const toMoveTarget = subtract2(unit.moveTarget, unit.position)
        const distance = distance2(unit.moveTarget, unit.position)
        if (distance < 1.4) {
          unit.moveTarget = null
        } else {
          desiredVelocity = scale2(normalize2(toMoveTarget), stats.speed)
          unit.facing = angleOf(desiredVelocity)
        }
      }

      const separation = this.computeSeparation(unit)
      desiredVelocity = add2(desiredVelocity, scale2(separation, stats.speed * 0.92))
      desiredVelocity = limit2(desiredVelocity, stats.speed)

      const blend = clamp(dt * 6.2, 0, 1)
      unit.velocity = {
        x: lerp(unit.velocity.x, desiredVelocity.x, blend),
        z: lerp(unit.velocity.z, desiredVelocity.z, blend),
      }
      unit.position = add2(unit.position, scale2(unit.velocity, dt))
      unit.position.x = clamp(unit.position.x, -WORLD_EXTENT + 3, WORLD_EXTENT - 3)
      unit.position.z = clamp(unit.position.z, -WORLD_EXTENT + 3, WORLD_EXTENT - 3)
    }
  }

  private cleanupDestroyed() {
    const destroyedUnits = this.world.units.filter((unit) => unit.hp <= 0)
    for (const unit of destroyedUnits) {
      this.world.selectedIds.delete(unit.id)
      this.spawnBurst(unit.position, unit.team === 'player' ? TEAM_COLORS.player : TEAM_COLORS.enemy, 2.6)
    }
    this.world.units = this.world.units.filter((unit) => unit.hp > 0)

    const destroyedStructures = this.world.structures.filter((structure) => structure.hp <= 0)
    for (const structure of destroyedStructures) {
      this.spawnBurst(structure.position, structure.team === 'player' ? TEAM_COLORS.enemy : TEAM_COLORS.player, 7.8)
      if (structure.type === 'hq') {
        this.world.status = 'lost'
        this.pushEvent('HQ destroyed. The valley is lost.', 'bad')
      } else {
        this.world.status = 'won'
        this.pushEvent('Enemy command core destroyed. Mission complete.', 'good')
      }
    }
    this.world.structures = this.world.structures.filter((structure) => structure.hp > 0)
  }

  private currentIncome() {
    const playerRelays = this.world.relays.filter((relay) => relay.owner === 'player').length
    return BASE_INCOME + playerRelays * RELAY_INCOME
  }

  private enemyObjective() {
    const playerRelays = this.world.relays.filter((relay) => relay.owner === 'player')
    if (playerRelays.length === 0) {
      return { ...PLAYER_BASE_POSITION }
    }

    const randomRelay = playerRelays[Math.floor(Math.random() * playerRelays.length)]
    return { ...randomRelay.position }
  }

  private findNearestEnemyUnit(team: Team, position: Vec2, range: number) {
    let best: UnitState | null = null
    let bestDistanceSq = range * range
    for (const unit of this.world.units) {
      if (unit.team === team || unit.hp <= 0) {
        continue
      }
      const distanceSq = distanceSq2(unit.position, position)
      if (distanceSq < bestDistanceSq) {
        best = unit
        bestDistanceSq = distanceSq
      }
    }
    return best
  }

  private findNearestHostile(unit: UnitState, range: number) {
    let bestUnit: UnitState | null = null
    let bestStructure: StructureState | null = null
    let bestDistanceSq = range * range

    for (const candidate of this.world.units) {
      if (candidate.team === unit.team || candidate.hp <= 0) {
        continue
      }
      const distanceSq = distanceSq2(unit.position, candidate.position)
      if (distanceSq < bestDistanceSq) {
        bestDistanceSq = distanceSq
        bestUnit = candidate
        bestStructure = null
      }
    }

    for (const structure of this.world.structures) {
      if (structure.team === unit.team || structure.hp <= 0) {
        continue
      }
      const distanceSq = distanceSq2(unit.position, structure.position)
      if (distanceSq < bestDistanceSq) {
        bestDistanceSq = distanceSq
        bestUnit = null
        bestStructure = structure
      }
    }

    if (bestUnit) {
      return { kind: 'unit' as const, unit: bestUnit }
    }
    if (bestStructure) {
      return { kind: 'structure' as const, structure: bestStructure }
    }
    return null
  }

  private computeSeparation(unit: UnitState) {
    let force = vec2()
    for (const other of this.world.units) {
      if (other.id === unit.id) {
        continue
      }
      const delta = subtract2(unit.position, other.position)
      const distanceSq = delta.x * delta.x + delta.z * delta.z
      const threshold = (unit.radius + other.radius + 1.3) ** 2
      if (distanceSq <= 0.001 || distanceSq > threshold) {
        continue
      }
      const distance = Math.sqrt(distanceSq)
      const push = (Math.sqrt(threshold) - distance) / Math.sqrt(threshold)
      force = add2(force, scale2(delta, push / distance))
    }

    for (const structure of this.world.structures) {
      const delta = subtract2(unit.position, structure.position)
      const limit = unit.radius + structure.radius + 1.2
      const distanceSq = delta.x * delta.x + delta.z * delta.z
      if (distanceSq <= 0.001 || distanceSq > limit * limit) {
        continue
      }
      const distance = Math.sqrt(distanceSq)
      const push = (limit - distance) / limit
      force = add2(force, scale2(delta, push / distance))
    }

    return force
  }

  private spawnEnemyWave(wave: number) {
    const spawnTable: UnitType[] = []
    for (let index = 0; index < 2 + Math.floor(wave * 0.7); index += 1) {
      spawnTable.push('striker')
    }
    for (let index = 0; index < 1 + Math.floor(wave * 0.45); index += 1) {
      spawnTable.push('vanguard')
    }
    for (let index = 0; index < Math.floor(wave * 0.35); index += 1) {
      spawnTable.push('ranger')
    }

    spawnTable.forEach((type, index) => {
      const angle = -Math.PI * 0.45 + index * 0.32
      const offset = scale2(fromAngle(angle), 8 + (index % 3) * 1.5)
      const position = add2(ENEMY_BASE_POSITION, offset)
      this.spawnUnit('enemy', type, position)
    })

    this.pushEvent(`Enemy wave ${wave} breaching from the north ridge.`, 'bad')
    this.spawnBurst(ENEMY_BASE_POSITION, TEAM_COLORS.enemy, 6.6)
  }

  private spawnUnit(team: Team, type: UnitType, position: Vec2) {
    const stats = UNIT_STATS[type]
    this.world.units.push({
      id: this.nextUnitId,
      team,
      type,
      position,
      velocity: vec2(),
      facing: team === 'player' ? -Math.PI / 2 : Math.PI / 2,
      hp: stats.maxHp,
      maxHp: stats.maxHp,
      radius: stats.radius,
      moveTarget: null,
      focusUnitId: null,
      focusStructureId: null,
      attackCooldown: Math.random() * stats.attackCooldown * 0.25,
      retargetTimer: Math.random() * 0.2,
    })
    this.nextUnitId += 1
  }

  private findUnit(id: number) {
    return this.world.units.find((unit) => unit.id === id) ?? null
  }

  private findStructure(id: string) {
    return this.world.structures.find((structure) => structure.id === id) ?? null
  }

  private pickGround(clientX: number, clientY: number) {
    const rect = this.mount.getBoundingClientRect()
    this.pointerNdc.x = ((clientX - rect.left) / rect.width) * 2 - 1
    this.pointerNdc.y = -((clientY - rect.top) / rect.height) * 2 + 1
    this.raycaster.setFromCamera(this.pointerNdc, this.camera)
    const [hit] = this.raycaster.intersectObject(this.terrainMesh, false)
    if (!hit) {
      return null
    }
    return { x: hit.point.x, z: hit.point.z }
  }

  private pickObject(clientX: number, clientY: number) {
    const rect = this.mount.getBoundingClientRect()
    this.pointerNdc.x = ((clientX - rect.left) / rect.width) * 2 - 1
    this.pointerNdc.y = -((clientY - rect.top) / rect.height) * 2 + 1
    this.raycaster.setFromCamera(this.pointerNdc, this.camera)
    const hitAreas = [
      ...Array.from(this.unitViews.values(), (view) => view.hitArea),
      ...Array.from(this.structureViews.values(), (view) => view.hitArea),
    ]
    const intersections = this.raycaster.intersectObjects(hitAreas, false)
    for (const intersection of intersections) {
      if (hasMeshUserData(intersection.object.userData)) {
        return intersection.object.userData
      }
    }
    return null
  }

  private resize() {
    const width = Math.max(1, this.mount.clientWidth)
    const height = Math.max(1, this.mount.clientHeight)
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(width, height, false)
  }

  private updateViews(force: boolean) {
    for (const unit of this.world.units) {
      const view = this.unitViews.get(unit.id) ?? this.createUnitView(unit)
      const groundY = this.sampleHeight(unit.position)
      view.group.position.set(unit.position.x, groundY + 0.4, unit.position.z)
      view.group.rotation.y = -unit.facing + Math.PI * 0.5
      view.group.position.y += Math.sin((performance.now() * 0.0016) + view.hoverSeed) * 0.05
      view.selectionRing.visible = this.world.selectedIds.has(unit.id)
      view.selectionRing.scale.setScalar(1 + Math.sin(performance.now() * 0.006 + unit.id) * 0.04)
      const hpRatio = clamp(unit.hp / unit.maxHp, 0, 1)
      view.healthFill.scale.x = Math.max(0.001, hpRatio)
      view.healthFill.position.x = -(1 - hpRatio) * 0.62
      if (view.turret) {
        const wobble = unit.type === 'ranger' ? Math.sin(performance.now() * 0.003 + unit.id) * 0.05 : 0
        view.turret.rotation.y = wobble
      }
    }

    for (const [id, view] of this.unitViews) {
      if (!this.world.units.some((unit) => unit.id === id)) {
        this.disposeView(view.group)
        this.unitViews.delete(id)
      }
    }

    for (const structure of this.world.structures) {
      const view = this.structureViews.get(structure.id) ?? this.createStructureView(structure)
      const groundY = this.sampleHeight(structure.position)
      view.group.position.set(structure.position.x, groundY, structure.position.z)
      const hpRatio = clamp(structure.hp / structure.maxHp, 0, 1)
      view.healthFill.scale.x = Math.max(0.001, hpRatio)
      view.healthFill.position.x = -(1 - hpRatio) * 1.3
      const pulseScale = 1 + Math.sin(performance.now() * 0.002) * 0.06
      view.pulse.scale.setScalar(pulseScale)
    }

    for (const [id, view] of this.structureViews) {
      if (!this.world.structures.some((structure) => structure.id === id)) {
        this.disposeView(view.group)
        this.structureViews.delete(id)
      }
    }

    for (const relay of this.world.relays) {
      const view = this.relayViews.get(relay.id) ?? this.createRelayView(relay)
      const groundY = this.sampleHeight(relay.position)
      view.group.position.set(relay.position.x, groundY + 0.1, relay.position.z)
      view.crystal.rotation.y += 0.02
      view.crystal.position.y = 3.4 + Math.sin(performance.now() * 0.0025 + relay.control * Math.PI) * 0.18
      view.ringMaterial.color.setHex(toneForOwner(relay.owner))
      view.ringMaterial.opacity = relay.contested ? 0.52 + Math.sin(performance.now() * 0.02) * 0.18 : 0.78
      view.ring.scale.setScalar(1 + Math.abs(relay.control) * 0.12)
      view.beamMaterial.color.setHex(toneForOwner(relay.owner))
      view.beamMaterial.opacity = 0.12 + Math.abs(relay.control) * 0.16
      view.crystalMaterial.emissive.setHex(toneForOwner(relay.owner))
    }

    if (force) {
      this.emitSnapshot()
    }
  }

  private createUnitView(unit: UnitState) {
    const color = unit.team === 'player' ? TEAM_COLORS.player : TEAM_COLORS.enemy
    const group = new THREE.Group()
    const chassisMaterial = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.46,
      metalness: 0.35,
      emissive: new THREE.Color(color).multiplyScalar(0.12),
    })
    const accentMaterial = new THREE.MeshStandardMaterial({
      color: unit.team === 'player' ? '#d9ffef' : '#ffd0c8',
      roughness: 0.2,
      metalness: 0.55,
      emissive: new THREE.Color(color).multiplyScalar(0.18),
    })

    let turret: THREE.Object3D | null = null
    if (unit.type === 'vanguard') {
      const base = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.35, 0.75, 6), chassisMaterial)
      base.castShadow = true
      base.receiveShadow = true
      group.add(base)

      turret = new THREE.Group()
      const dome = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.95, 0.45, 8), accentMaterial)
      dome.position.y = 0.45
      dome.castShadow = true
      const cannon = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 1.8, 10), accentMaterial)
      cannon.rotation.z = Math.PI / 2
      cannon.position.set(0.95, 0.45, 0)
      cannon.castShadow = true
      turret.add(dome, cannon)
      group.add(turret)
    } else if (unit.type === 'ranger') {
      const hull = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.45, 1.2), chassisMaterial)
      hull.castShadow = true
      hull.receiveShadow = true
      group.add(hull)

      turret = new THREE.Group()
      const pod = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.35, 0.85), accentMaterial)
      pod.position.y = 0.52
      pod.castShadow = true
      const barrelLeft = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 1.8, 8), accentMaterial)
      barrelLeft.rotation.z = Math.PI / 2
      barrelLeft.position.set(1.04, 0.56, -0.18)
      barrelLeft.castShadow = true
      const barrelRight = barrelLeft.clone()
      barrelRight.position.z = 0.18
      turret.add(pod, barrelLeft, barrelRight)
      group.add(turret)
    } else {
      const body = new THREE.Mesh(new THREE.OctahedronGeometry(0.92, 0), chassisMaterial)
      body.scale.set(1.2, 0.7, 1.05)
      body.castShadow = true
      body.receiveShadow = true
      group.add(body)

      const finMaterial = accentMaterial
      const finLeft = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.12, 0.28), finMaterial)
      finLeft.rotation.z = 0.38
      finLeft.position.set(0.1, 0.22, -0.56)
      finLeft.castShadow = true
      const finRight = finLeft.clone()
      finRight.position.z = 0.56
      finRight.rotation.z = -0.38
      group.add(finLeft, finRight)
    }

    const selectionRing = new THREE.Mesh(
      new THREE.RingGeometry(unit.radius + 0.38, unit.radius + 0.68, 40),
      createRingMaterial(TEAM_COLORS.player),
    )
    selectionRing.rotation.x = -Math.PI / 2
    selectionRing.position.y = -0.28
    selectionRing.visible = false
    group.add(selectionRing)

    const healthGroup = new THREE.Group()
    healthGroup.position.set(0, 2.4, 0)
    const healthBack = new THREE.Mesh(
      new THREE.PlaneGeometry(1.24, 0.14),
      createHealthMaterial(0x111315),
    )
    const healthFill = new THREE.Mesh(
      new THREE.PlaneGeometry(1.24, 0.1),
      createHealthMaterial(unit.team === 'player' ? 0x60ffd9 : 0xff8a76),
    )
    healthFill.position.z = 0.001
    healthGroup.add(healthBack, healthFill)
    group.add(healthGroup)

    const hitArea = new THREE.Mesh(
      new THREE.CylinderGeometry(unit.radius + 0.9, unit.radius + 0.9, 3.6, 8),
      createInvisibleHitMaterial(),
    )
    hitArea.position.y = 1.25
    hitArea.userData = { kind: 'unit', unitId: unit.id }
    group.add(hitArea)

    group.traverse((object: THREE.Object3D) => {
      if (object instanceof THREE.Mesh) {
        object.castShadow = true
        object.receiveShadow = object !== selectionRing
      }
    })

    this.unitViews.set(unit.id, {
      group,
      hitArea,
      selectionRing,
      healthFill,
      turret,
      hoverSeed: Math.random() * Math.PI * 2,
    })
    this.unitLayer.add(group)
    return this.unitViews.get(unit.id)!
  }

  private createStructureView(structure: StructureState) {
    const color = structure.team === 'player' ? TEAM_COLORS.player : TEAM_COLORS.enemy
    const group = new THREE.Group()

    const bodyMaterial = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.52,
      metalness: 0.22,
      emissive: new THREE.Color(color).multiplyScalar(0.08),
    })
    const trimMaterial = new THREE.MeshStandardMaterial({
      color: structure.team === 'player' ? '#d7fff4' : '#ffcec5',
      roughness: 0.26,
      metalness: 0.55,
      emissive: new THREE.Color(color).multiplyScalar(0.16),
    })

    const baseHeight = structure.type === 'hq' ? 4.2 : 4.8
    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(structure.radius, structure.radius * 1.14, baseHeight, 6),
      bodyMaterial,
    )
    base.position.y = baseHeight / 2
    group.add(base)

    const spire = new THREE.Mesh(
      new THREE.CylinderGeometry(structure.radius * 0.42, structure.radius * 0.62, 4.8, 6),
      trimMaterial,
    )
    spire.position.y = baseHeight + 1.9
    group.add(spire)

    const crown = new THREE.Mesh(
      new THREE.OctahedronGeometry(structure.type === 'hq' ? 1.3 : 1.6, 0),
      trimMaterial,
    )
    crown.position.y = baseHeight + 4.4
    group.add(crown)

    const pulse = new THREE.Mesh(
      new THREE.RingGeometry(structure.radius * 1.04, structure.radius * 1.25, 48),
      createRingMaterial(color),
    )
    pulse.rotation.x = -Math.PI / 2
    pulse.position.y = 0.18
    group.add(pulse)

    const healthGroup = new THREE.Group()
    healthGroup.position.set(0, baseHeight + 5.8, 0)
    const healthBack = new THREE.Mesh(
      new THREE.PlaneGeometry(2.6, 0.18),
      createHealthMaterial(0x101215),
    )
    const healthFill = new THREE.Mesh(
      new THREE.PlaneGeometry(2.6, 0.13),
      createHealthMaterial(structure.team === 'player' ? 0x60ffd9 : 0xff8a76),
    )
    healthFill.position.z = 0.001
    healthGroup.add(healthBack, healthFill)
    group.add(healthGroup)

    const hitArea = new THREE.Mesh(
      new THREE.CylinderGeometry(structure.radius + 0.6, structure.radius + 0.6, baseHeight + 7, 8),
      createInvisibleHitMaterial(),
    )
    hitArea.position.y = (baseHeight + 7) / 2
    hitArea.userData = { kind: 'structure', structureId: structure.id }
    group.add(hitArea)

    group.traverse((object: THREE.Object3D) => {
      if (object instanceof THREE.Mesh) {
        object.castShadow = true
        object.receiveShadow = true
      }
    })

    this.structureViews.set(structure.id, { group, hitArea, healthFill, pulse })
    this.structureLayer.add(group)
    return this.structureViews.get(structure.id)!
  }

  private createRelayView(relay: RelayState) {
    const group = new THREE.Group()
    const pedestal = new THREE.Mesh(
      new THREE.CylinderGeometry(2.2, 2.6, 0.85, 6),
      new THREE.MeshStandardMaterial({
        color: '#4b4332',
        roughness: 0.82,
        metalness: 0.08,
      }),
    )
    pedestal.receiveShadow = true
    pedestal.castShadow = true

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(2.7, 3.4, 40),
      createRingMaterial(TEAM_COLORS.neutral),
    )
    ring.rotation.x = -Math.PI / 2
    ring.position.y = 0.14

    const crystalMaterial = new THREE.MeshStandardMaterial({
      color: '#f7efcc',
      emissive: new THREE.Color(TEAM_COLORS.neutral).multiplyScalar(0.35),
      roughness: 0.15,
      metalness: 0.62,
    })
    const crystal = new THREE.Mesh(
      new THREE.OctahedronGeometry(1.25, 0),
      crystalMaterial,
    )
    crystal.castShadow = true
    crystal.position.y = 3.4

    const beamMaterial = new THREE.MeshBasicMaterial({
      color: TEAM_COLORS.neutral,
      transparent: true,
      opacity: 0.18,
      side: THREE.DoubleSide,
      depthWrite: false,
      toneMapped: false,
    })
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.6, 1.4, 8.4, 14, 1, true),
      beamMaterial,
    )
    beam.position.y = 4.2

    group.add(pedestal, ring, crystal, beam)
    this.relayViews.set(relay.id, {
      group,
      crystal,
      ring,
      beam,
      ringMaterial: ring.material as THREE.MeshBasicMaterial,
      beamMaterial,
      crystalMaterial,
    })
    this.relayLayer.add(group)
    return this.relayViews.get(relay.id)!
  }

  private updateEffects(dt: number) {
    for (const effect of this.effects) {
      effect.age += dt
      const progress = clamp(effect.age / effect.lifetime, 0, 1)
      if (effect.kind === 'command') {
        const mesh = effect.object as THREE.Mesh
        mesh.scale.setScalar(1 + progress * 3.2)
        ;(effect.material as THREE.MeshBasicMaterial).opacity = 0.75 * (1 - progress)
      }

      if (effect.kind === 'burst') {
        const mesh = effect.object as THREE.Mesh
        mesh.scale.setScalar(1 + progress * 2.6)
        ;(effect.material as THREE.MeshBasicMaterial).opacity = 0.6 * (1 - progress)
      }

      if (effect.kind === 'tracer') {
        const mesh = effect.object as THREE.Mesh
        const start = effect.origin.clone().lerp(effect.target, progress * 0.48)
        const end = effect.origin.clone().lerp(effect.target, clamp(progress * 1.45, 0, 1))
        const direction = end.clone().sub(start)
        const distance = Math.max(0.01, direction.length())
        mesh.position.copy(start.clone().lerp(end, 0.5))
        mesh.scale.set(1, distance, 1)
        mesh.quaternion.setFromUnitVectors(Y_AXIS, direction.normalize())
        ;(effect.material as THREE.MeshBasicMaterial).opacity = 0.85 * (1 - progress)
      }
    }

    for (let index = this.effects.length - 1; index >= 0; index -= 1) {
      const effect = this.effects[index]
      if (effect.age < effect.lifetime) {
        continue
      }
      this.disposeView(effect.object)
      this.effects.splice(index, 1)
    }
  }

  private spawnTracer(origin: THREE.Vector3, target: THREE.Vector3, team: Team) {
    const material = new THREE.MeshBasicMaterial({
      color: team === 'player' ? TEAM_COLORS.player : TEAM_COLORS.enemy,
      transparent: true,
      opacity: 0.9,
      toneMapped: false,
      depthWrite: false,
    })
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 1, 8), material)
    this.effectLayer.add(mesh)
    this.effects.push({
      id: this.nextEffectId,
      kind: 'tracer',
      age: 0,
      lifetime: 0.18,
      object: mesh,
      origin,
      target,
      material,
    })
    this.nextEffectId += 1
  }

  private spawnBurst(position: Vec2, color: number, radius: number) {
    const material = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.5,
      toneMapped: false,
      side: THREE.DoubleSide,
      depthWrite: false,
    })
    const mesh = new THREE.Mesh(new THREE.RingGeometry(radius * 0.32, radius * 0.48, 40), material)
    mesh.rotation.x = -Math.PI / 2
    mesh.position.copy(this.toWorldVector(position, 0.3))
    this.effectLayer.add(mesh)
    this.effects.push({
      id: this.nextEffectId,
      kind: 'burst',
      age: 0,
      lifetime: 0.5,
      object: mesh,
      origin: mesh.position.clone(),
      target: mesh.position.clone(),
      material,
    })
    this.nextEffectId += 1
  }

  private spawnCommandMarker(position: Vec2, color: number) {
    const material = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.7,
      toneMapped: false,
      side: THREE.DoubleSide,
      depthWrite: false,
    })
    const mesh = new THREE.Mesh(new THREE.RingGeometry(1.2, 1.75, 36), material)
    mesh.rotation.x = -Math.PI / 2
    mesh.position.copy(this.toWorldVector(position, 0.18))
    this.effectLayer.add(mesh)
    this.effects.push({
      id: this.nextEffectId,
      kind: 'command',
      age: 0,
      lifetime: 0.75,
      object: mesh,
      origin: mesh.position.clone(),
      target: mesh.position.clone(),
      material,
    })
    this.nextEffectId += 1
  }

  private toWorldVector(position: Vec2, extraY = 0) {
    return new THREE.Vector3(position.x, this.sampleHeight(position) + extraY, position.z)
  }

  private sampleHeight(position: Vec2) {
    return this.terrain.getHeight(position.x, position.z)
  }

  private emitSnapshot() {
    const hq = this.world.structures.find((structure) => structure.id === 'hq')
    const core = this.world.structures.find((structure) => structure.id === 'core')
    const selected = this.world.units
      .filter((unit) => unit.team === 'player' && this.world.selectedIds.has(unit.id))
      .map(summaryForUnit)
    const playerRelayCount = this.world.relays.filter((relay) => relay.owner === 'player').length
    const population = this.world.units.filter((unit) => unit.team === 'player').length
    const production: ProductionOption[] = Object.entries(UNIT_STATS).map(([type, stats]) => ({
      type: type as UnitType,
      label: stats.label,
      role: stats.role,
      cost: stats.cost,
      buildTime: stats.buildTime,
      available:
        this.world.status === 'running' &&
        this.world.energy >= stats.cost &&
        this.world.queue.length < QUEUE_LIMIT &&
        population + this.world.queue.length < POPULATION_CAP,
    }))

    const snapshot: HudSnapshot = {
      energy: Math.floor(this.world.energy),
      income: this.currentIncome(),
      wave: this.world.wave,
      nextWaveIn: Math.max(0, this.world.waveTimer),
      population,
      cap: POPULATION_CAP,
      status: this.world.status,
      hqHp: hq?.hp ?? 0,
      hqMaxHp: hq?.maxHp ?? getStructureMaxHp('hq'),
      coreHp: core?.hp ?? 0,
      coreMaxHp: core?.maxHp ?? getStructureMaxHp('core'),
      playerRelayCount,
      selected,
      queue: this.world.queue.map((item) => ({ ...item })),
      relays: this.world.relays.map((relay) => ({
        id: relay.id,
        owner: relay.owner,
        progress: relay.control,
        contested: relay.contested,
        x: relay.position.x,
        z: relay.position.z,
      })),
      units: this.world.units.map(summaryForUnit),
      structures: this.world.structures.map((structure) => ({
        id: structure.id,
        type: structure.type,
        hp: structure.hp,
        maxHp: structure.maxHp,
        team: structure.team,
        x: structure.position.x,
        z: structure.position.z,
      })),
      events: [...this.events].reverse(),
      production,
      objective: objectiveForState(this.world.status, playerRelayCount, this.world.queue.length),
    }

    this.callbacks.onSnapshot(snapshot)
  }

  private pushEvent(text: string, tone: HudEvent['tone']) {
    this.events.push({
      id: this.world.eventCounter,
      text,
      tone,
    })
    this.world.eventCounter += 1
    if (this.events.length > HUD_EVENT_LIMIT) {
      this.events.shift()
    }
  }

  private disposeView(object: THREE.Object3D) {
    object.traverse((child: THREE.Object3D) => {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose()
        if (Array.isArray(child.material)) {
          child.material.forEach((material: THREE.Material) => material.dispose())
        } else {
          child.material.dispose()
        }
      }
    })
    object.removeFromParent()
  }
}

function lengthSq(vector: Vec2) {
  return vector.x * vector.x + vector.z * vector.z
}
