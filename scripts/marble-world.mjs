import { randomUUID } from 'node:crypto'
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
const groups = { active: (1 << 16) | 2 | 4, tray: (2 << 16) | 1, ground: (4 << 16) | 1 | 8, spent: (8 << 16) | 4 }
export const isTrayUp = (phone) => new Vector3(0, 0, 1).applyQuaternion(new Quaternion(...phone.quaternion)).y >= Math.cos(35 * Math.PI / 180)
const material = (collider, restitution, collisionGroups) => collider.setRestitution(restitution)
  .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Min).setCollisionGroups(collisionGroups)

export class MarbleWorld {
  constructor(phone) {
    this.world = new RAPIER.World({ x: 0, y: -G.gravity, z: 0 })
    this.world.timestep = PHYSICS_DT
    this.world.integrationParameters.maxCcdSubsteps = 4
    this.phone = structuredClone(phone)
    this.previousTarget = this.phone
    this.target = this.phone
    this.targetProgress = 1
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
    this.surface = this.world.createCollider(material(floorShape.setFriction(0.45), 0.5, groups.tray), this.tray)
    // Straight rails and rounded corner rails; only the central right opening is omitted.
    for (let i = 0; i < outline.length; i++) {
      const a = outline[i], b = outline[(i + 1) % outline.length]
      const segments = a[0] > G.width / 2 - 0.0001 && b[0] > G.width / 2 - 0.0001
        ? [[a, [a[0], G.exitHalfWidth]], [[b[0], -G.exitHalfWidth], b]] : [[a, b]]
      for (const [p, q] of segments) {
        const dx = q[0] - p[0], dy = q[1] - p[1], length = Math.hypot(dx, dy)
        if (length < 0.0001) continue
        this.world.createCollider(material(RAPIER.ColliderDesc.cuboid(length / 2 + 0.0004, 0.001, G.wallHeight / 2)
          .setTranslation((p[0] + q[0]) / 2, (p[1] + q[1]) / 2, floor + G.wallHeight / 2)
          .setRotation(quat(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.atan2(dy, dx)).toArray()))
          .setFriction(0.35), 0.2, groups.tray), this.tray)
      }
    }
    this.ground = this.world.createCollider(material(RAPIER.ColliderDesc.cuboid(0.6, 0.025, 0.6)
      .setTranslation(0, -0.025, 0).setFriction(0.65), 0.1, groups.ground))
    this.balls = []; this.activeBallId = null; this.hitCount = 0; this.lastImpact = null
    this.steps = 0; this.region = 'needs-ball'; this.lastOutcome = ''
    this.addBall()
  }
  get activeBall() { return this.balls.find((b) => b.id === this.activeBallId) }
  get canAddBall() { return this.activeBallId === null && isTrayUp(this.phone) }
  addBall() {
    if (!this.canAddBall) return false
    if (this.balls.length >= 5) this.removeBall(this.balls[0])
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setCcdEnabled(true)
      .setTranslation(...localToWorld([0, 0, G.screenZ + 0.0003], this.phone)).setRotation(quat(this.phone.quaternion))
      .setLinearDamping(0.08).setAngularDamping(0.6).setCanSleep(false))
    const collider = this.world.createCollider(material(RAPIER.ColliderDesc.ball(G.radius).setMass(0.005).setFriction(0.45), 0.5, groups.active), body)
    const ball = { id: 'ball-' + randomUUID(), body, collider, state: 'active', restTime: 0, airTime: 0, armed: false }
    this.balls.push(ball); this.activeBallId = ball.id; this.region = 'tray'; this.lastOutcome = ''
    return true
  }
  removeBall(ball) {
    if (ball.body) this.world.removeRigidBody(ball.body)
    this.balls = this.balls.filter((b) => b !== ball)
    if (this.activeBallId === ball.id) { this.activeBallId = null; this.region = 'needs-ball' }
  }
  setPhoneTarget(phone) {
    this.previousTarget = this.phone
    this.target = structuredClone(phone)
    this.targetProgress = 0
  }
  contact(a, b) {
    let contact = false
    this.world.contactPair(a, b, (manifold) => { if (manifold.numSolverContacts() > 0) contact = true })
    return contact
  }
  ballState(ball) {
    return ball.body ? { id: ball.id, state: ball.state, position: xyz(ball.body.translation()), quaternion: xyzw(ball.body.rotation()),
      velocity: xyz(ball.body.linvel()), angularVelocity: xyz(ball.body.angvel()), radius: G.radius } : ball.final
  }
  step(atMs = this.steps * PHYSICS_DT * 1000) {
    this.targetProgress = Math.min(1, this.targetProgress + PHYSICS_DT * 60)
    this.phone = interpolateTransform(this.previousTarget, this.target, this.targetProgress)
    this.tray.setNextKinematicTranslation(vec(this.phone.position))
    this.tray.setNextKinematicRotation(quat(this.phone.quaternion))
    this.world.step(); this.steps++
    for (const ball of [...this.balls]) {
      if (!ball.body) continue
      const p = xyz(ball.body.translation()), v = xyz(ball.body.linvel())
      if (p[1] < -0.3 || Math.abs(p[0]) > 0.8 || Math.abs(p[2]) > 0.8 || p[1] > 1.5) {
        if (ball.id === this.activeBallId) this.lastOutcome = 'Ball left the workspace. Add a new ball on your phone.'
        this.removeBall(ball); continue
      }
      const groundContact = p[1] <= G.radius + 0.003 && this.contact(ball.collider, this.ground)
      if (ball.state === 'active') {
        if (groundContact) {
          ball.state = 'settling'; this.activeBallId = null; this.region = 'needs-ball'
          this.lastOutcome = 'Landed. Tap Add ball on your phone when ready.'
          // A spent ball only collides with the ground while settling, never another ball or the tray.
          ball.collider.setCollisionGroups(groups.spent)
          ball.body.setLinearDamping(5); ball.body.setAngularDamping(5)
        } else {
          const local = worldToLocal(p, this.phone), depth = local[2] - G.screenZ
          const frontContact = depth >= -0.002 && depth <= G.radius && insideScreen(local[0], local[1]) && this.contact(ball.collider, this.surface)
          if (frontContact) {
            if (ball.armed) {
              this.hitCount++; this.lastImpact = { sequence: this.hitCount, ballId: ball.id, atMs }
              ball.armed = false
            }
            ball.airTime = 0; this.region = 'tray'
          } else {
            ball.airTime += PHYSICS_DT
            if (ball.airTime >= 0.04) ball.armed = true
            this.region = 'air'
          }
        }
      }
      if (ball.state === 'settling') {
        ball.restTime = groundContact && Math.hypot(...v) < 0.02 && Math.hypot(...xyz(ball.body.angvel())) < 0.2 ? ball.restTime + PHYSICS_DT : 0
        if (ball.restTime >= 0.3) {
          ball.state = 'rested'; ball.final = { ...this.ballState(ball), velocity: [0, 0, 0], angularVelocity: [0, 0, 0] }
          this.world.removeRigidBody(ball.body); ball.body = null; ball.collider = null
        }
      }
    }
  }
  snapshot() {
    return { phone: structuredClone(this.phone), balls: this.balls.map((b) => this.ballState(b)), activeBallId: this.activeBallId,
      hitCount: this.hitCount, lastImpact: this.lastImpact ? { ...this.lastImpact } : null,
      region: this.region, canAddBall: this.canAddBall }
  }
  free() { this.world.free() }
}
