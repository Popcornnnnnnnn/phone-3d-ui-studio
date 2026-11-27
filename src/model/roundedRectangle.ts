import { Shape, ShapeGeometry } from 'three'

export function createRoundedRectangleShape(
  width: number,
  height: number,
  radius: number,
) {
  const left = -width / 2
  const right = width / 2
  const bottom = -height / 2
  const top = height / 2
  const safeRadius = Math.max(0, Math.min(radius, width / 2, height / 2))
  const shape = new Shape()

  if (safeRadius === 0) {
    shape.moveTo(left, bottom)
    shape.lineTo(right, bottom)
    shape.lineTo(right, top)
    shape.lineTo(left, top)
    shape.closePath()
    return shape
  }

  shape.moveTo(left + safeRadius, bottom)
  shape.lineTo(right - safeRadius, bottom)
  shape.absarc(
    right - safeRadius,
    bottom + safeRadius,
    safeRadius,
    -Math.PI / 2,
    0,
    false,
  )
  shape.lineTo(right, top - safeRadius)
  shape.absarc(
    right - safeRadius,
    top - safeRadius,
    safeRadius,
    0,
    Math.PI / 2,
    false,
  )
  shape.lineTo(left + safeRadius, top)
  shape.absarc(
    left + safeRadius,
    top - safeRadius,
    safeRadius,
    Math.PI / 2,
    Math.PI,
    false,
  )
  shape.lineTo(left, bottom + safeRadius)
  shape.absarc(
    left + safeRadius,
    bottom + safeRadius,
    safeRadius,
    Math.PI,
    Math.PI * 1.5,
    false,
  )
  shape.closePath()

  return shape
}

export function createRoundedRectangleGeometry(
  width: number,
  height: number,
  radius: number,
  curveSegments = 20,
) {
  const geometry = new ShapeGeometry(
    createRoundedRectangleShape(width, height, radius),
    curveSegments,
  )
  const positions = geometry.getAttribute('position')
  const uvs = geometry.getAttribute('uv')
  const left = -width / 2
  const bottom = -height / 2

  for (let index = 0; index < positions.count; index += 1) {
    uvs.setXY(
      index,
      (positions.getX(index) - left) / width,
      (positions.getY(index) - bottom) / height,
    )
  }

  uvs.needsUpdate = true
  return geometry
}
