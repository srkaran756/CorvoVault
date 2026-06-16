import { useEffect, useRef, useCallback } from 'react'
import { useUserStats } from './useLocalData'

// The four categories that exist in wellbeingData
export type WellbeingCategory = 'YouTube' | 'Documents' | 'Web Browser' | 'Notes'

const DEFAULT_WELLBEING = [
  { id: '1', title: 'YouTube', type: 'Video', minutes: 0, color: '#ef4444' },
  { id: '2', title: 'Documents', type: 'Reading', minutes: 0, color: '#22c55e' },
  { id: '3', title: 'Web Browser', type: 'Research', minutes: 0, color: '#3b82f6' },
  { id: '4', title: 'Notes', type: 'Writing', minutes: 0, color: '#f59e0b' },
]

/**
 * Tracks real time spent in a category with millisecond precision.
 *
 * Design decisions:
 * - Uses Date.now() deltas so timer drift is impossible.
 * - Keeps ALL refs stable. The isActive effect only depends on [isActive]
 *   so switching active/inactive never resets accumulated time.
 * - flush() reads from refs, never from stale closures.
 * - If stats are null when flush fires, we skip (stats not yet loaded).
 *   The periodic flush interval compensates for this.
 *
 * @param category - One of the four wellbeing categories
 * @param isActive - Whether the user is currently in this activity
 */
export function useActivityTimer(
  category: WellbeingCategory,
  isActive: boolean
): void {
  const { stats, updateStats } = useUserStats()

  // Refs — never stale, always point to current values
  const statsRef        = useRef(stats)
  const updateStatsRef  = useRef(updateStats)
  const categoryRef     = useRef(category)
  const isActiveRef     = useRef(isActive)

  // Keep all refs in sync on every render
  useEffect(() => { statsRef.current = stats },           [stats])
  useEffect(() => { updateStatsRef.current = updateStats }, [updateStats])
  useEffect(() => { categoryRef.current = category },      [category])
  useEffect(() => { isActiveRef.current = isActive },      [isActive])

  // Accumulated milliseconds since last flush
  const accumulatedMs        = useRef(0)
  // Timestamp of when the current active segment started
  const segmentStartMs       = useRef<number | null>(null)
  // Interval handle for periodic flushing
  const intervalRef          = useRef<ReturnType<typeof setInterval> | null>(null)

  /**
   * Core flush — drains accumulatedMs into the database.
   * Safe to call at any time; exits silently if there is nothing to save.
   */
  const flushRef = useRef(async () => {
    const currentStats = statsRef.current
    if (!currentStats) return
    if (accumulatedMs.current <= 0) return

    const ms     = accumulatedMs.current
    accumulatedMs.current = 0

    const minutesToAdd  = ms / 60_000          // exact float, no rounding
    const cat           = categoryRef.current

    const wellbeing     = (currentStats.wellbeingData?.length)
      ? currentStats.wellbeingData
      : DEFAULT_WELLBEING

    const updatedWellbeing = wellbeing.map(entry =>
      entry.title === cat
        ? { ...entry, minutes: entry.minutes + minutesToAdd }
        : entry
    )

    await updateStatsRef.current({
      studyTimeMinutes: currentStats.studyTimeMinutes + minutesToAdd,
      wellbeingData: updatedWellbeing,
    })
  })

  // ── Start / Stop effect — only re-runs when isActive flips ──────────────
  useEffect(() => {
    if (isActive) {
      // Record segment start
      segmentStartMs.current = Date.now()

      // Periodic flush every 10 s so data is written even during long sessions
      intervalRef.current = setInterval(() => {
        if (segmentStartMs.current !== null) {
          const now = Date.now()
          accumulatedMs.current += now - segmentStartMs.current
          segmentStartMs.current = now
        }
        flushRef.current()
      }, 10_000)

    } else {
      // Stop interval
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }

      // Drain the current segment
      if (segmentStartMs.current !== null) {
        accumulatedMs.current += Date.now() - segmentStartMs.current
        segmentStartMs.current = null
      }

      // Flush synchronously (async in the background)
      flushRef.current().catch(e => console.warn('[ActivityTimer] Flush failed:', e));
    }

    // Cleanup on unmount
    return () => {
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }

      if (segmentStartMs.current !== null) {
        accumulatedMs.current += Date.now() - segmentStartMs.current
        segmentStartMs.current = null
      }

      flushRef.current().catch(e => console.warn('[ActivityTimer] Final flush failed:', e));
    }
  }, [isActive])   // ← ONLY isActive — flush is in a stable ref, never a dep
}
