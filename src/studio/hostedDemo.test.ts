import { describe, expect, it } from 'vitest'
import { isHostedStaticDemo } from './hostedDemo'

describe('isHostedStaticDemo', () => {
  it('returns true on HTTPS non-local origins such as GitHub Pages', () => {
    expect(
      isHostedStaticDemo({
        protocol: 'https:',
        hostname: 'popcornnnnnnnn.github.io',
        search: '',
      }),
    ).toBe(true)
  })

  it('returns false when an explicit bridge override is provided', () => {
    expect(
      isHostedStaticDemo({
        protocol: 'https:',
        hostname: 'popcornnnnnnnn.github.io',
        search: '?bridge=wss://studio.example.com:4319',
      }),
    ).toBe(false)
  })

  it('returns false on localhost and loopback development hosts', () => {
    expect(
      isHostedStaticDemo({
        protocol: 'http:',
        hostname: '127.0.0.1',
        search: '',
      }),
    ).toBe(false)
    expect(
      isHostedStaticDemo({
        protocol: 'http:',
        hostname: 'localhost',
        search: '',
      }),
    ).toBe(false)
    expect(
      isHostedStaticDemo({
        protocol: 'https:',
        hostname: 'localhost',
        search: '',
      }),
    ).toBe(false)
  })
})
