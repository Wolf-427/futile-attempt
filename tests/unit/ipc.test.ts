import { describe, expect, it } from 'vitest'
import { IPC_CHANNELS, isIpcChannel } from '@shared/ipc'

describe('IPC contract', () => {
  it('lists every channel exactly once', () => {
    expect(new Set(IPC_CHANNELS).size).toBe(IPC_CHANNELS.length)
  })

  it('namespaces every channel as area:action', () => {
    for (const channel of IPC_CHANNELS) expect(channel).toMatch(/^[a-z]+:[a-zA-Z]+$/)
  })

  it('accepts known channels and rejects everything else', () => {
    expect(isIpcChannel('app:getInfo')).toBe(true)
    expect(isIpcChannel('fs:write')).toBe(false)
    expect(isIpcChannel(42)).toBe(false)
  })
})
