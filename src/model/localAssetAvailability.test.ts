import { describe, expect, it } from 'vitest'
import { isLocalModelResponse } from './localAssetAvailability'

describe('optional local model', () => {
  it('uses the distributable fallback when an SPA serves HTML for the absent asset', () => {
    expect(isLocalModelResponse(new Response('', { headers: { 'content-type': 'text/html; charset=utf-8' } }))).toBe(false)
    expect(isLocalModelResponse(new Response('', { status: 404, headers: { 'content-type': 'model/gltf-binary' } }))).toBe(false)
    expect(isLocalModelResponse(new Response('', { headers: { 'content-type': 'model/gltf-binary' } }))).toBe(true)
    expect(isLocalModelResponse(new Response('', { headers: { 'content-type': 'application/octet-stream' } }))).toBe(true)
  })
})
