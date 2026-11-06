'use strict'

/**
 * Difficulty-based curriculum allocation
 *
 * Allocates weekly class periods to subjects based on difficulty weights,
 * with min/max constraints and support for admin manual edits.
 */

const DIFFICULTY_WEIGHTS = {
  easy: 1,
  medium: 2,
  difficult: 3
}

/**
 * Allocate periods to subjects based on difficulty
 *
 * @param {Array} subjects - Array of subjects with { id, name, difficult, minPerWeek, maxPerWeek, locked, manualCount }
 * @param {number} totalSlots - Total available teaching slots per week (days × periods)
 * @returns {{ allocations: Array, changes: Array, error: string|null }}
 */
function allocateByDifficulty(subjects, totalSlots) {
  const allocations = []
  const changes = []
  let remainingSlots = totalSlots

  // Validate subjects have required fields
  for (const s of subjects) {
    const weight = DIFFICULTY_WEIGHTS[s.difficult] || 2
    const min = s.minPerWeek !== undefined ? Math.max(0, s.minPerWeek) : 0
    const max = s.maxPerWeek !== undefined ? Math.max(min, s.maxPerWeek) : totalSlots
    const locked = s.locked || false
    const manualCount = s.manualCount !== undefined ? s.manualCount : null

    allocations.push({
      id: s.id,
      name: s.name,
      difficult: s.difficult,
      weight,
      min,
      max,
      locked,
      manualCount,
      allocated: locked ? (manualCount || 0) : 0
    })
  }

  // Check if sum of minimums exceeds total slots
  const sumMins = allocations.reduce((sum, s) => sum + s.min, 0)
  if (sumMins > totalSlots) {
    return {
      allocations,
      changes: [],
      error: `Impossible: minimum periods required (${sumMins}) exceeds available slots (${totalSlots}). Reduce some subject minimums.`
    }
  }

  // Phase 1: Give each subject its minimum
  for (const s of allocations) {
    if (!s.locked) {
      s.allocated = s.min
      remainingSlots -= s.min
    }
  }

  // Phase 2: Distribute remaining slots by difficulty weight (largest remainder method)
  if (remainingSlots > 0) {
    const unlocked = allocations.filter(s => !s.locked)
    const totalWeight = unlocked.reduce((sum, s) => sum + s.weight, 0)

    if (totalWeight > 0) {
      // Calculate fair shares
      const shares = unlocked.map(s => ({
        subject: s,
        fairShare: (s.weight / totalWeight) * remainingSlots,
        floor: Math.floor((s.weight / totalWeight) * remainingSlots)
      }))

      // Distribute floor values first
      let distributed = 0
      for (const share of shares) {
        const increase = Math.min(share.floor, share.subject.max - share.subject.allocated)
        share.subject.allocated += increase
        distributed += increase
      }

      // Distribute remainders to subjects with largest fractional parts
      const remainder = remainingSlots - distributed
      const withRemainder = shares
        .map(s => ({
          ...s,
          remainder: s.fairShare - s.floor
        }))
        .sort((a, b) => b.remainder - a.remainder)

      for (let i = 0; i < remainder && i < withRemainder.length; i++) {
        const s = withRemainder[i].subject
        if (s.allocated < s.max) {
          s.allocated += 1
          changes.push({
            subjectId: s.id,
            subjectName: s.name,
            type: 'allocation',
            from: s.allocated - 1,
            to: s.allocated,
            reason: 'Difficulty-based distribution'
          })
        }
      }
    }
  }

  // Phase 3: Handle subjects that hit their max, redistribute to others
  let needRedistribution = false
  for (const s of allocations) {
    if (s.allocated > s.max) {
      needRedistribution = true
      const excess = s.allocated - s.max
      s.allocated = s.max
      remainingSlots += excess
      changes.push({
        subjectId: s.id,
        subjectName: s.name,
        type: 'cap',
        from: s.max + excess,
        to: s.max,
        reason: `Hit maximum (${s.max})`
      })
    }
  }

  if (needRedistribution && remainingSlots > 0) {
    const unlocked = allocations.filter(s => !s.locked && s.allocated < s.max)
    const totalWeight = unlocked.reduce((sum, s) => sum + s.weight, 0)

    if (totalWeight > 0) {
      for (const s of unlocked) {
        if (remainingSlots <= 0) break
        const canTake = s.max - s.allocated
        if (canTake > 0) {
          const take = Math.min(canTake, Math.ceil((s.weight / totalWeight) * remainingSlots))
          s.allocated += take
          remainingSlots -= take
          changes.push({
            subjectId: s.id,
            subjectName: s.name,
            type: 'redistribution',
            from: s.allocated - take,
            to: s.allocated,
            reason: 'Received from capped subjects'
          })
        }
      }
    }
  }

  return {
    allocations: allocations.map(s => ({
      id: s.id,
      name: s.name,
      difficult: s.difficult,
      min: s.min,
      max: s.max,
      locked: s.locked,
      allocated: s.allocated
    })),
    changes,
    error: null
  }
}

/**
 * Rebalance allocations when admin edits break the total
 *
 * @param {Array} allocations - Current allocations with { id, allocated, min, max, locked }
 * @param {number} targetTotal - Target total slots (should equal days × periods)
 * @returns {{ allocations: Array, changes: Array, error: string|null }}
 */
function rebalance(allocations, targetTotal) {
  const currentTotal = allocations.reduce((sum, s) => sum + s.allocated, 0)
  const diff = targetTotal - currentTotal

  if (diff === 0) {
    return { allocations, changes: [], error: null }
  }

  const changes = []
  const unlocked = allocations.filter(s => !s.locked)

  if (diff > 0) {
    // Need to add periods - add to hardest unlocked subjects first
    const sortedByWeight = [...unlocked].sort((a, b) => {
      const weightA = DIFFICULTY_WEIGHTS[a.difficult] || 2
      const weightB = DIFFICULTY_WEIGHTS[b.difficult] || 2
      return weightB - weightA
    })

    for (const s of sortedByWeight) {
      if (diff <= 0) break
      const canAdd = s.max - s.allocated
      if (canAdd > 0) {
        const add = Math.min(canAdd, diff)
        s.allocated += add
        changes.push({
          subjectId: s.id,
          subjectName: s.name,
          type: 'auto-increase',
          from: s.allocated - add,
          to: s.allocated,
          reason: 'Auto-rebalanced to fit total slots'
        })
      }
    }
  } else {
    // Need to remove periods - remove from easiest unlocked subjects first
    const sortedByWeight = [...unlocked].sort((a, b) => {
      const weightA = DIFFICULTY_WEIGHTS[a.difficult] || 2
      const weightB = DIFFICULTY_WEIGHTS[b.difficult] || 2
      return weightA - weightB
    })

    for (const s of sortedByWeight) {
      if (diff >= 0) break
      const canRemove = s.allocated - s.min
      if (canRemove > 0) {
        const remove = Math.min(canRemove, Math.abs(diff))
        s.allocated -= remove
        changes.push({
          subjectId: s.id,
          subjectName: s.name,
          type: 'auto-decrease',
          from: s.allocated + remove,
          to: s.allocated,
          reason: 'Auto-rebalanced to fit total slots'
        })
      }
    }
  }

  const newTotal = allocations.reduce((sum, s) => sum + s.allocated, 0)
  if (newTotal !== targetTotal) {
    return {
      allocations,
      changes,
      error: `Cannot fit ${targetTotal} slots even after rebalancing. Total locked: ${allocations.filter(s => s.locked).reduce((sum, s) => sum + s.allocated, 0)}. Adjust some locked subjects or min/max limits.`
    }
  }

  return { allocations, changes, error: null }
}

module.exports = {
  allocateByDifficulty,
  rebalance,
  DIFFICULTY_WEIGHTS
}
