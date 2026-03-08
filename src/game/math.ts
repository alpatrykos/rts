import type { Vec2 } from "./types"

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

export function lerp(start: number, end: number, alpha: number) {
  return start + (end - start) * alpha
}

export function vec2(x = 0, z = 0): Vec2 {
  return { x, z }
}

export function add2(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, z: a.z + b.z }
}

export function subtract2(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, z: a.z - b.z }
}

export function scale2(vector: Vec2, scalar: number): Vec2 {
  return { x: vector.x * scalar, z: vector.z * scalar }
}

export function lengthSq2(vector: Vec2) {
  return vector.x * vector.x + vector.z * vector.z
}

export function length2(vector: Vec2) {
  return Math.sqrt(lengthSq2(vector))
}

export function distanceSq2(a: Vec2, b: Vec2) {
  return lengthSq2(subtract2(a, b))
}

export function distance2(a: Vec2, b: Vec2) {
  return Math.sqrt(distanceSq2(a, b))
}

export function normalize2(vector: Vec2): Vec2 {
  const length = length2(vector)
  if (length < 1e-5) {
    return vec2()
  }
  return scale2(vector, 1 / length)
}

export function limit2(vector: Vec2, maxLength: number): Vec2 {
  const length = length2(vector)
  if (length <= maxLength || length < 1e-5) {
    return vector
  }
  return scale2(vector, maxLength / length)
}

export function moveTowards2(current: Vec2, target: Vec2, maxDelta: number): Vec2 {
  const delta = subtract2(target, current)
  const distance = length2(delta)
  if (distance <= maxDelta || distance < 1e-5) {
    return { x: target.x, z: target.z }
  }
  const direction = scale2(delta, maxDelta / distance)
  return add2(current, direction)
}

export function rotate2(vector: Vec2, radians: number): Vec2 {
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  return {
    x: vector.x * cos - vector.z * sin,
    z: vector.x * sin + vector.z * cos,
  }
}

export function fromAngle(radians: number): Vec2 {
  return { x: Math.cos(radians), z: Math.sin(radians) }
}

export function angleOf(vector: Vec2) {
  return Math.atan2(vector.z, vector.x)
}

export function smoothstep(edge0: number, edge1: number, x: number) {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1)
  return t * t * (3 - 2 * t)
}
