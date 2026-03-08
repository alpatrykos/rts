import { WORLD_EXTENT } from '../game/config'
import type {
  GameStatus,
  HudEvent,
  HudSnapshot,
  HudStructureSummary,
  HudUnitSummary,
  Ownership,
  UnitType,
} from '../game/types'

interface HudProps {
  snapshot: HudSnapshot
  onCenterCamera: () => void
  onTrain: (type: UnitType) => void
}

function formatSeconds(value: number) {
  return `${Math.max(0, Math.ceil(value))}s`
}

function formatOwner(owner: Ownership) {
  if (owner === 'player') {
    return 'Alliance'
  }
  if (owner === 'enemy') {
    return 'Hostile'
  }
  return 'Neutral'
}

function statusLabel(status: GameStatus) {
  if (status === 'won') {
    return 'Victory'
  }
  if (status === 'lost') {
    return 'Defeat'
  }
  return 'Engaged'
}

function healthPercent(current: number, max: number) {
  if (max <= 0) {
    return 0
  }
  return Math.max(0, Math.min(100, (current / max) * 100))
}

function minimapCoordinate(value: number) {
  return ((value + WORLD_EXTENT) / (WORLD_EXTENT * 2)) * 100
}

function toneClass(tone: HudEvent['tone']) {
  if (tone === 'good') {
    return 'good'
  }
  if (tone === 'bad') {
    return 'bad'
  }
  return 'neutral'
}

function teamClass(team: Ownership) {
  if (team === 'player') {
    return 'friendly'
  }
  if (team === 'enemy') {
    return 'hostile'
  }
  return 'neutral'
}

function SelectedUnits({ units }: { units: HudUnitSummary[] }) {
  if (units.length === 0) {
    return (
      <div className="empty-state">
        <p>No units selected.</p>
        <span>Drag to box-select. Right click issues move or attack orders.</span>
      </div>
    )
  }

  return (
    <div className="selected-grid">
      {units.map((unit) => (
        <article className="selected-card" key={unit.id}>
          <div className="selected-card__title">
            <strong>{unit.type}</strong>
            <span>#{unit.id}</span>
          </div>
          <div className="meter meter--compact">
            <div
              className="meter__fill"
              style={{ width: `${healthPercent(unit.hp, unit.maxHp)}%` }}
            />
          </div>
          <span>
            {Math.round(unit.hp)} / {unit.maxHp} hull
          </span>
        </article>
      ))}
    </div>
  )
}

function RelayStatus({ snapshot }: { snapshot: HudSnapshot }) {
  return (
    <div className="relay-list">
      {snapshot.relays.map((relay) => (
        <article className="relay-card" key={relay.id}>
          <div className="relay-card__header">
            <strong>{relay.id.toUpperCase()}</strong>
            <span className={`status-chip ${teamClass(relay.owner)}`}>
              {relay.contested ? 'Contested' : formatOwner(relay.owner)}
            </span>
          </div>
          <div className="meter meter--relay">
            <div
              className={`meter__fill meter__fill--${teamClass(relay.owner)}`}
              style={{ width: `${Math.abs(relay.progress) * 100}%` }}
            />
          </div>
        </article>
      ))}
    </div>
  )
}

function QueuePanel({ snapshot }: { snapshot: HudSnapshot }) {
  if (snapshot.queue.length === 0) {
    return (
      <div className="empty-state">
        <p>Production queue empty.</p>
        <span>Spend energy on mixed squads before the next wave hits.</span>
      </div>
    )
  }

  return (
    <div className="queue-list">
      {snapshot.queue.map((item, index) => {
        const width = healthPercent(item.total - item.remaining, item.total)
        return (
          <article className="queue-card" key={`${item.type}-${index}`}>
            <div className="queue-card__header">
              <strong>{item.type}</strong>
              <span>{formatSeconds(item.remaining)}</span>
            </div>
            <div className="meter meter--compact">
              <div className="meter__fill" style={{ width: `${width}%` }} />
            </div>
          </article>
        )
      })}
    </div>
  )
}

function ProductionPanel({
  snapshot,
  onTrain,
}: {
  snapshot: HudSnapshot
  onTrain: (type: UnitType) => void
}) {
  return (
    <div className="production-grid">
      {snapshot.production.map((option) => (
        <button
          className="production-card"
          disabled={!option.available}
          key={option.type}
          onClick={() => onTrain(option.type)}
          type="button"
        >
          <div className="production-card__header">
            <strong>{option.label}</strong>
            <span>{option.cost}E</span>
          </div>
          <span>{option.role}</span>
          <small>{option.buildTime}s build time</small>
        </button>
      ))}
    </div>
  )
}

function EventFeed({ events }: { events: HudEvent[] }) {
  return (
    <div className="event-feed">
      {events.map((event) => (
        <article className={`event-pill event-pill--${toneClass(event.tone)}`} key={event.id}>
          {event.text}
        </article>
      ))}
    </div>
  )
}

function MiniMap({
  relays,
  structures,
  units,
  selected,
}: {
  relays: HudSnapshot['relays']
  structures: HudStructureSummary[]
  units: HudUnitSummary[]
  selected: HudUnitSummary[]
}) {
  const selectedSet = new Set(selected.map((unit) => unit.id))
  return (
    <svg className="minimap" viewBox="0 0 100 100" role="img">
      <defs>
        <linearGradient id="grid-fade" x1="0%" x2="100%" y1="0%" y2="100%">
          <stop offset="0%" stopColor="rgba(96,255,217,0.25)" />
          <stop offset="100%" stopColor="rgba(255,136,112,0.05)" />
        </linearGradient>
      </defs>
      <rect fill="rgba(6,17,24,0.92)" height="100" rx="8" width="100" x="0" y="0" />
      <path
        d="M10 10 L90 90 M20 10 L90 80 M10 20 L80 90"
        stroke="url(#grid-fade)"
        strokeWidth="0.6"
      />
      {relays.map((relay) => (
        <circle
          className={`minimap__relay minimap__relay--${teamClass(relay.owner)}`}
          cx={minimapCoordinate(relay.x)}
          cy={100 - minimapCoordinate(relay.z)}
          key={relay.id}
          r="4.4"
        />
      ))}
      {structures.map((structure) => (
        <rect
          className={`minimap__structure minimap__structure--${teamClass(structure.team)}`}
          height="6"
          key={structure.id}
          rx="1.5"
          width="6"
          x={minimapCoordinate(structure.x) - 3}
          y={100 - minimapCoordinate(structure.z) - 3}
        />
      ))}
      {units.map((unit) => (
        <circle
          className={`minimap__unit minimap__unit--${teamClass(unit.team)}${
            selectedSet.has(unit.id) ? ' minimap__unit--selected' : ''
          }`}
          cx={minimapCoordinate(unit.x)}
          cy={100 - minimapCoordinate(unit.z)}
          key={unit.id}
          r={selectedSet.has(unit.id) ? 2.5 : 1.8}
        />
      ))}
    </svg>
  )
}

export function Hud({ snapshot, onCenterCamera, onTrain }: HudProps) {
  const status = statusLabel(snapshot.status)
  return (
    <div className="hud">
      <header className="topbar panel">
        <div className="topbar__brand">
          <span className="kicker">Three.js RTS</span>
          <h1>Frontline Relay</h1>
        </div>
        <div className="topbar__stats">
          <div className="metric">
            <span>Energy</span>
            <strong>{snapshot.energy}</strong>
            <small>+{snapshot.income}/s</small>
          </div>
          <div className="metric">
            <span>Population</span>
            <strong>
              {snapshot.population}/{snapshot.cap}
            </strong>
            <small>{snapshot.playerRelayCount} relays</small>
          </div>
          <div className="metric">
            <span>Threat</span>
            <strong>{status}</strong>
            <small>
              Wave {snapshot.wave + 1} in {formatSeconds(snapshot.nextWaveIn)}
            </small>
          </div>
          <button className="command-button" onClick={onCenterCamera} type="button">
            Center Camera
          </button>
        </div>
      </header>

      <section className="side-column side-column--left">
        <article className="panel panel--stacked">
          <div className="panel__heading">
            <span className="kicker">Mission</span>
            <strong>{snapshot.objective}</strong>
          </div>
          <div className="health-section">
            <div>
              <div className="health-row">
                <span>HQ Integrity</span>
                <strong>{Math.round(snapshot.hqHp)}</strong>
              </div>
              <div className="meter">
                <div
                  className="meter__fill meter__fill--friendly"
                  style={{ width: `${healthPercent(snapshot.hqHp, snapshot.hqMaxHp)}%` }}
                />
              </div>
            </div>
            <div>
              <div className="health-row">
                <span>Enemy Core</span>
                <strong>{Math.round(snapshot.coreHp)}</strong>
              </div>
              <div className="meter">
                <div
                  className="meter__fill meter__fill--hostile"
                  style={{ width: `${healthPercent(snapshot.coreHp, snapshot.coreMaxHp)}%` }}
                />
              </div>
            </div>
          </div>
        </article>

        <article className="panel panel--stacked">
          <div className="panel__heading">
            <span className="kicker">Selection</span>
            <strong>{snapshot.selected.length} units under command</strong>
          </div>
          <SelectedUnits units={snapshot.selected} />
        </article>

        <article className="panel panel--stacked">
          <div className="panel__heading">
            <span className="kicker">Relay Network</span>
            <strong>Income lines and capture pressure</strong>
          </div>
          <RelayStatus snapshot={snapshot} />
        </article>
      </section>

      <section className="side-column side-column--right">
        <article className="panel panel--stacked">
          <div className="panel__heading">
            <span className="kicker">Production</span>
            <strong>Fabricate reinforcements at the HQ</strong>
          </div>
          <ProductionPanel onTrain={onTrain} snapshot={snapshot} />
        </article>

        <article className="panel panel--stacked">
          <div className="panel__heading">
            <span className="kicker">Queue</span>
            <strong>{snapshot.queue.length}/4 slots active</strong>
          </div>
          <QueuePanel snapshot={snapshot} />
        </article>

        <article className="panel panel--stacked">
          <div className="panel__heading">
            <span className="kicker">Tactical Map</span>
            <strong>Alliance and hostile signatures</strong>
          </div>
          <MiniMap
            relays={snapshot.relays}
            selected={snapshot.selected}
            structures={snapshot.structures}
            units={snapshot.units}
          />
        </article>
      </section>

      <footer className="bottombar">
        <article className="panel panel--stacked panel--events">
          <div className="panel__heading">
            <span className="kicker">Field Feed</span>
            <strong>Realtime command updates</strong>
          </div>
          <EventFeed events={snapshot.events} />
        </article>
        <article className="panel panel--stacked panel--controls">
          <div className="panel__heading">
            <span className="kicker">Controls</span>
            <strong>Desktop-first tactical camera</strong>
          </div>
          <div className="control-grid">
            <span>WASD or screen edge</span>
            <strong>Pan</strong>
            <span>Mouse wheel</span>
            <strong>Zoom</strong>
            <span>Q / E</span>
            <strong>Rotate</strong>
            <span>Drag left mouse</span>
            <strong>Select</strong>
            <span>Right click</span>
            <strong>Move / attack</strong>
            <span>Space</span>
            <strong>Recenter</strong>
          </div>
        </article>
      </footer>

      {snapshot.status !== 'running' ? (
        <div className="overlay">
          <article className="overlay__card panel">
            <span className="kicker">Battle Report</span>
            <h2>{status}</h2>
            <p>{snapshot.objective}</p>
          </article>
        </div>
      ) : null}
    </div>
  )
}
