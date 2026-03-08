import * as THREE from 'three'
import { createNoise2D } from 'simplex-noise'
import { clamp, lerp, smoothstep } from './math'

function createSeededRandom(seed: number) {
  let value = seed >>> 0
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0
    return value / 0xffffffff
  }
}

export class TerrainField {
  readonly extent: number
  private readonly noiseA
  private readonly noiseB

  constructor(extent: number, seed = 9172) {
    this.extent = extent
    this.noiseA = createNoise2D(createSeededRandom(seed))
    this.noiseB = createNoise2D(createSeededRandom(seed * 7))
  }

  getHeight(x: number, z: number) {
    const broad = this.noiseA(x * 0.028, z * 0.028) * 5.8
    const detail = this.noiseB(x * 0.075 + 100, z * 0.075 - 40) * 2.1
    const radial = Math.sqrt((x * x + z * z) / (this.extent * this.extent))
    const basin = -smoothstep(0.5, 1.1, radial) * 3.2
    const ridge = Math.sin((x + z) * 0.045) * 0.85
    const lane = Math.exp(-Math.abs(x + z) * 0.03) * 1.4
    return broad + detail + basin + ridge + lane
  }

  getNormal(x: number, z: number) {
    const sample = 0.35
    const left = this.getHeight(x - sample, z)
    const right = this.getHeight(x + sample, z)
    const down = this.getHeight(x, z - sample)
    const up = this.getHeight(x, z + sample)
    return new THREE.Vector3(left - right, sample * 2, down - up).normalize()
  }
}

export function createTerrainMesh(field: TerrainField) {
  const segments = 180
  const geometry = new THREE.PlaneGeometry(
    field.extent * 2,
    field.extent * 2,
    segments,
    segments,
  )
  geometry.rotateX(-Math.PI / 2)

  const position = geometry.getAttribute('position')
  const colorArray = new Float32Array(position.count * 3)
  const color = new THREE.Color()
  const low = new THREE.Color('#1c3f36')
  const mid = new THREE.Color('#5f6d44')
  const high = new THREE.Color('#9b8d57')
  const peak = new THREE.Color('#d5cab1')

  for (let index = 0; index < position.count; index += 1) {
    const x = position.getX(index)
    const z = position.getZ(index)
    const y = field.getHeight(x, z)
    position.setY(index, y)

    const normalized = clamp((y + 8) / 16, 0, 1)
    if (normalized < 0.42) {
      color.lerpColors(low, mid, normalized / 0.42)
    } else if (normalized < 0.78) {
      color.lerpColors(mid, high, (normalized - 0.42) / 0.36)
    } else {
      color.lerpColors(high, peak, (normalized - 0.78) / 0.22)
    }

    const warmth = lerp(0.9, 1.06, Math.sin((x - z) * 0.04) * 0.5 + 0.5)
    colorArray[index * 3] = color.r * warmth
    colorArray[index * 3 + 1] = color.g * warmth
    colorArray[index * 3 + 2] = color.b * warmth
  }

  geometry.setAttribute('color', new THREE.BufferAttribute(colorArray, 3))
  geometry.computeVertexNormals()

  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.92,
    metalness: 0.08,
    flatShading: false,
  })

  const mesh = new THREE.Mesh(geometry, material)
  mesh.receiveShadow = true
  mesh.name = 'terrain'
  return mesh
}
