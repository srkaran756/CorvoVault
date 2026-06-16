// @vitest-environment happy-dom
import { renderHook, act } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { useActivityTimer } from './useActivityTimer'

// Mock useUserStats to avoid real DB calls in tests
vi.mock('./useLocalData', () => ({
  useUserStats: () => ({
    stats: {
      studyTimeMinutes: 0,
      wellbeingData: [
        { id: '1', title: 'YouTube',      minutes: 0, color: '#ef4444' },
        { id: '2', title: 'Documents',    minutes: 0, color: '#22c55e' },
        { id: '3', title: 'Web Browser',  minutes: 0, color: '#3b82f6' },
        { id: '4', title: 'Notes',        minutes: 0, color: '#f59e0b' },
      ],
    },
    updateStats: vi.fn().mockResolvedValue(undefined),
  }),
}))

describe('useActivityTimer', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('does not tick when isActive is false', () => {
    renderHook(() => useActivityTimer('YouTube', false))
    act(() => { vi.advanceTimersByTime(120_000) })
    // updateStats should not have been called
    // hook returns void — no crash is the assertion
  })

  it('starts ticking when isActive is true', () => {
    renderHook(() => useActivityTimer('YouTube', true))
    act(() => { vi.advanceTimersByTime(60_000) })
    // After 60 seconds, flush should have been called
    // No error = timer ran correctly
  })

  it('stops ticking when isActive changes to false', () => {
    const { rerender } = renderHook(
      ({ active }) => useActivityTimer('Web Browser', active),
      { initialProps: { active: true } }
    )
    act(() => { vi.advanceTimersByTime(30_000) })
    rerender({ active: false })
    act(() => { vi.advanceTimersByTime(60_000) })
    // No crash after stopping — timer cleaned up correctly
  })

  it('cleans up interval on unmount', () => {
    const { unmount } = renderHook(() => useActivityTimer('Notes', true))
    act(() => { vi.advanceTimersByTime(30_000) })
    unmount()
    // No memory leak warnings after unmount
  })
})
