import RAPIER from '@dimforge/rapier3d-compat'
import { Quaternion, Vector3 } from 'three'
import { MARBLE_GEOMETRY as G, insideScreen, localToWorld, worldToLocal, interpolateTransform } from '../shared/marbleMath.mjs'

let initialized
export const initMarblePhysics = () => initialized ??= RAPIER.init()
const vec = (a) => ({ x: a[0], y: a[1], z: a[2] })
const quat = (a) => ({ x: a[0], y: a[1], z: a[2], w: a[3] })
const xyz = (v) => [v.x, v.y, v.z]
const xyzw = (q) => [q.x, q.y, q.z, q.w]
export const PHYSICS_DT = 1 / 120

export class MarbleWorld {
  constructor(phone) {
    this.world = new RAPIER.World({ x: 0, y: -G.gravity, z: 0 })
    this.world.timestep = PHYSICS_DT
    this.world.integrationParameters.maxCcdSubsteps = 4
    this.phone = structuredClone(phone)
    this.previousTarget = this.phone
    this.target = this.phone
    this.targetProgress = 1
    this.catchTarget = localToWorld([0, 0, G.screenZ], phone)
    this.tray = this.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased()
      .setTranslation(...phone.position).setRotation(quat(phone.quaternion)))
    const floor = G.screenZ - G.radius
    const vertices = []
    const outline = []
    for (let corner = 0; corner < 4; corner++) {
      const sx = corner < 2 ? 1 : -1
      const sy = corner === 0 || corner === 3 ? 1 : -1
      const center = [sx * (G.width / 2 - G.cornerRadius), sy * (G.height / 2 - G.cornerRadius)]
      const start = [0, -Math.PI / 2, -Math.PI, -Math.PI * 1.5][corner]
      for (let n = 0; n <= 6; n++) {
        const angle = start + Math.PI / 2 - n * Math.PI / 12
        outline.push([center[0] + G.cornerRadius * Math.cos(angle), center[1] + G.cornerRadius * Math.sin(angle)])
      }
    }
    for (const p of outline) for (const z of [floor - 0.001, floor]) vertices.push(p[0], p[1], z)
    const floorShape = RAPIER.ColliderDesc.convexHull(new Float32Array(vertices))
    this.surface = this.world.createCollider(floorShape.setFriction(0.45).setRestitution(0.1), this.tray)
    // Straight rails and rounded corner rails; only the central right opening is omitted.
    for (let i = 0; i < outline.length; i++) {
      const a = outline[i], b = outline[(i + 1) % outline.length]
      const segments = a[0] > G.width / 2 - 0.0001 && b[0] > G.width / 2 - 0.0001
        ? [[a, [a[0], G.exitHalfWidth]], [[b[0], -G.exitHalfWidth], b]] : [[a, b]]
      for (const [p, q] of segments) {
        const dx = q[0] - p[0], dy = q[1] - p[1], length = Math.hypot(dx, dy)
        if (length < 0.0001) continue
        this.world.createCollider(RAPIER.ColliderDesc.cuboid(length / 2 + 0.0004, 0.001, G.wallHeight / 2)
          .setTranslation((p[0] + q[0]) / 2, (p[1] + q[1]) / 2, floor + G.wallHeight / 2)
          .setRotation(quat(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.atan2(dy, dx)).toArray()))
          .setFriction(0.35).setRestitution(0.15), this.tray)
      }
    }
    this.ground = this.world.createCollider(RAPIER.ColliderDesc.cuboid(0.6, 0.025, 0.6)
      .setTranslation(0, -0.025, 0).setFriction(0.65).setRestitution(0.1))
    this.ball = this.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setCcdEnabled(true)
      .setLinearDamping(0.08).setAngularDamping(0.6).setCanSleep(false))
    this.ballCollider = this.world.createCollider(RAPIER.ColliderDesc.ball(G.radius)
      .setMass(0.005).setFriction(0.45).setRestitution(0.1), this.ball)
    this.catchCount = 0
    this.steps = 0
    this.resetBall()
  }
  resetBall(phone) {
    if (phone) {
      this.phone = structuredClone(phone); this.target = this.phone; this.previousTarget = this.phone; this.targetProgress = 1
      this.tray.setTranslation(vec(phone.position), true); this.tray.setRotation(quat(phone.quaternion), true)
    }
    this.ball.setTranslation(vec(localToWorld([0, 0, G.screenZ + 0.0003], this.phone)), true)
    this.ball.setRotation(quat(this.phone.quaternion), true)
    this.ball.setLinvel(vec([0, 0, 0]), true); this.ball.setAngvel(vec([0, 0, 0]), true)
    this.region = 'phone'; this.returning = false; this.lost = false; this.groundStable = 0
    this.captureStable = 0; this.canReturn = false
  }
  setPhoneTarget(phone) {
    this.previousTarget = this.phone
    this.target = structuredClone(phone)
    this.targetProgress = 0
  }
  step() {
    this.targetProgress = Math.min(1, this.targetProgress + PHYSICS_DT * 60)
    this.phone = interpolateTransform(this.previousTarget, this.target, this.targetProgress)
    this.tray.setNextKinematicTranslation(vec(this.phone.position))
    this.tray.setNextKinematicRotation(quat(this.phone.quaternion))
    this.world.step()
    this.steps++
    const p = xyz(this.ball.translation()), v = xyz(this.ball.linvel())
    const local = worldToLocal(p, this.phone)
    const onSurface = insideScreen(local[0], local[1]) && Math.abs(local[2] - G.screenZ) < 0.002
    let surfaceContact = false, groundContact = false
    this.world.contactPair(this.ballCollider, this.surface, (manifold) => { if (manifold.numSolverContacts() > 0) surfaceContact = true })
    this.world.contactPair(this.ballCollider, this.ground, (manifold) => { if (manifold.numSolverContacts() > 0) groundContact = true })
    // Rapier may retain a separating manifold for a few frames after launch.
    groundContact &&= p[1] <= G.radius + 0.002 && v[1] < 0.05
    // A dissipative landing surface gives Return a repeatable resting state.
    // Forces remain continuous; never zero velocity just because a region changed.
    this.ball.setLinearDamping(groundContact ? 5 : this.returning ? 0 : 0.08)
    this.ball.setAngularDamping(groundContact ? 5 : 0.6)
    if (this.region === 'phone' && (!insideScreen(local[0], local[1]) || local[2] - G.screenZ > G.radius * 2)) this.region = 'world'
    if (this.region === 'world' && onSurface && surfaceContact) {
      this.captureStable += PHYSICS_DT
      if (this.captureStable >= 0.08) { this.region = 'phone'; this.returning = false; this.catchCount++; this.captureStable = 0 }
    } else this.captureStable = 0
    this.groundStable = groundContact && Math.hypot(...v) < 0.025 ? this.groundStable + PHYSICS_DT : 0
    this.canReturn = this.region === 'world' && this.groundStable >= 0.2
    if (this.canReturn) this.returning = false
    this.lost = p[1] < -0.3 || Math.abs(p[0]) > 0.8 || Math.abs(p[2]) > 0.8 || p[1] > 1.5
  }
  launchReturn() {
    if (!this.canReturn || this.lost) return false
    const p = xyz(this.ball.translation()), velocity = xyz(this.ball.linvel()), t = 1.5
    const desired = this.catchTarget.map((target, i) => (target - p[i]) / t + (i === 1 ? G.gravity * t / 2 : 0))
    // Air drag is disabled during flight so the fixed-target ballistic solution is exact.
    this.ball.setLinearDamping(0)
    this.ball.applyImpulse(vec(desired.map((value, i) => (value - velocity[i]) * this.ball.mass())), true)
    this.returning = true; this.canReturn = false; this.groundStable = 0
    return true
  }
  snapshot() {
    return { phone: structuredClone(this.phone), ball: { id: 'marble-1', position: xyz(this.ball.translation()),
      quaternion: xyzw(this.ball.rotation()), velocity: xyz(this.ball.linvel()), angularVelocity: xyz(this.ball.angvel()), radius: G.radius },
    region: this.returning ? 'returning' : this.region, canReturn: this.canReturn, catchCount: this.catchCount,
    catchTarget: [...this.catchTarget], lost: this.lost }
  }
  free() { this.world.free() }
}
