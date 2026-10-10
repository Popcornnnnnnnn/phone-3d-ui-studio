import { describe, expect, it } from 'vitest'
import { Quaternion, Vector3 } from 'three'
import { DEFAULT_PHONE_PROFILE, PHONE_PROFILES, parsePhoneProfileSelection, phoneProfileNotice, selectPhoneProfile } from './phoneGeometry.mjs'
import { CAMERA_FROM_BODY, cameraInBodyApprox, cameraToBody } from './spatialMath.mjs'
import { insideScreen, localToWorld, marbleGeometry, projectMarble } from './marbleMath.mjs'
import { DEFAULT_MARBLE_SETTINGS } from './marbleSettings.mjs'

describe('phone geometry selection and coordinate consistency', () => {
  it('keeps old clients on the reference dimensions and clearly identifies unknown hardware', () => {
    expect(selectPhoneProfile()).toMatchObject({ profileId: 'iphone-17', status: 'legacy-default', deviceModel: null })
    const unknown = selectPhoneProfile('iPhone99,1')
    expect(unknown).toMatchObject({ profileId: 'iphone-17', status: 'unrecognized', physicalValidation: 'pending' })
    expect(phoneProfileNotice(unknown)).toContain('fallback')
    expect(parsePhoneProfileSelection({ ...unknown, status: 'recognized' })).toBeNull()
  })
  it.each(Object.values(PHONE_PROFILES))('uses $name dimensions for body offset, finite screen and projection', (profile) => {
    const selection = selectPhoneProfile(profile.deviceModel)
    expect(selection.profileId).toBe(profile.id)
    expect(parsePhoneProfileSelection(selection)).toEqual(selection)
    const q = new Quaternion().setFromAxisAngle(new Vector3(1, 2, 3).normalize(), 1.2)
    const position = new Vector3(0.3, 0.8, -0.5)
    const sample = { positionMeters: position.clone().add(new Vector3(...cameraInBodyApprox(profile)).applyQuaternion(q)).toArray(),
      quaternion: q.clone().multiply(CAMERA_FROM_BODY.clone().invert()).toArray() }
    const body = cameraToBody(sample, profile)
    body.position.forEach((value, axis) => expect(value).toBeCloseTo(position.toArray()[axis], 8))
    expect(new Quaternion(...body.quaternion).angleTo(q)).toBeLessThan(1e-7)
    const g = marbleGeometry(DEFAULT_MARBLE_SETTINGS, profile)
    const rightEdge = { position: localToWorld([g.width / 2, 0, g.screenZ], body), quaternion: body.quaternion, radius: g.radius }
    expect(projectMarble(rightEdge, body, g).u).toBeCloseTo(1, 8)
    expect(insideScreen(g.width / 2 - 0.0001, 0, g)).toBe(true)
    expect(insideScreen(g.width / 2 + 0.0001, 0, g)).toBe(false)
    expect(g.screenZ).toBeGreaterThan(profile.bodyMm.depth / 2000)
  })
  it('does not shrink the Plus display to the iPhone 17 rectangle', () => {
    const g = marbleGeometry(DEFAULT_MARBLE_SETTINGS, PHONE_PROFILES['iphone-16-plus'])
    const reference = marbleGeometry(DEFAULT_MARBLE_SETTINGS, DEFAULT_PHONE_PROFILE)
    expect(g.width).toBeGreaterThan(reference.width)
    expect(g.height).toBeGreaterThan(reference.height)
    expect(insideScreen(reference.width / 2 + 0.001, 0, g)).toBe(true)
    expect(insideScreen(reference.width / 2 + 0.001, 0, reference)).toBe(false)
  })
})
