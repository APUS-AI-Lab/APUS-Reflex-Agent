import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { system3AppIdentity } from '../src/main/system3-identity'

const appData = path.resolve('fixture-app-data')

describe('System3 installation identity', () => {
  it('keeps production and development data away from upstream Desktop state', () => {
    expect(system3AppIdentity(appData, false)).toEqual({ name: 'APUS Reflex', userData: path.join(appData, 'xdan-system3') })
    expect(system3AppIdentity(appData, true)).toEqual({ name: 'APUS Reflex Dev', userData: path.join(appData, 'xdan-system3-dev') })
  })
  it('accepts an explicit isolated acceptance directory', () => {
    const override = path.resolve('fixture-acceptance')
    expect(system3AppIdentity(appData, false, override).userData).toBe(override)
  })
  it('rejects relative and empty overrides before launching a process', () => {
    expect(() => system3AppIdentity(appData, false, 'relative')).toThrow('absolute path')
    expect(() => system3AppIdentity(appData, false, '')).toThrow('absolute path')
  })
})
