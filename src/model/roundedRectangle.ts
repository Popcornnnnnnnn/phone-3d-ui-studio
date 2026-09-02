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
  const safeRadius = Math.min(radius, width / 2, height / 2)
  const shape = new Shape()

  shape.moveTo(left + safeRadius, bottom)
  shape.lineTo(right - safeRadius, bottom)
  shape.quadraticCurveTo(right, bottom, right, bottom + safeRadius)
  shape.lineTo(right, top - safeRadius)
  shape.quadraticCurveTo(right, top, right - safeRadius, top)
  shape.lineTo(left + safeRadius, top)
  shape.quadraticCurveTo(left, top, left, top - safeRadius)
  shape.lineTo(left, bottom + safeRadius)
  shape.quadraticCurveTo(left, bottom, left + safeRadius, bottom)

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
