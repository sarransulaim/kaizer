import { describe, expect, it } from 'vitest'

import {
  ACTIVE_STATUSES,
  advanceLabel,
  allowedTransitions,
  canTransition,
  derivePaymentStatus,
  nextStatus,
  ORDER_STATUSES,
  TERMINAL_STATUSES,
} from '@/lib/orders/status'

describe('the order lifecycle', () => {
  it('walks a pickup order from new to completed', () => {
    let status = nextStatus('new', 'pickup')
    expect(status).toBe('confirmed')
    status = nextStatus('confirmed', 'pickup')
    expect(status).toBe('prepping')
    status = nextStatus('prepping', 'pickup')
    expect(status).toBe('ready')
    status = nextStatus('ready', 'pickup')
    expect(status).toBe('completed')
    expect(nextStatus('completed', 'pickup')).toBeNull()
  })

  /* A delivery has to be handed to a driver before it can be complete. */
  it('routes a delivery through out_for_delivery', () => {
    expect(nextStatus('ready', 'delivery')).toBe('out_for_delivery')
    expect(advanceLabel('ready', 'delivery')).toBe('Send out')
    expect(nextStatus('out_for_delivery', 'delivery')).toBe('completed')
  })

  it('will not let an order skip straight to completed', () => {
    expect(canTransition('new', 'completed', 'pickup')).toBe(false)
    expect(canTransition('confirmed', 'ready', 'pickup')).toBe(false)
    expect(canTransition('new', 'ready', 'pickup')).toBe(false)
  })

  it('will not reopen a finished order', () => {
    for (const status of ORDER_STATUSES) {
      expect(canTransition('completed', status, 'pickup')).toBe(false)
      expect(canTransition('cancelled', status, 'pickup')).toBe(false)
    }
  })

  it('lets anything still open be cancelled', () => {
    for (const status of ACTIVE_STATUSES) {
      expect(allowedTransitions(status, 'pickup')).toContain('cancelled')
    }
  })

  it('never offers cancel as the one-tap next step', () => {
    for (const status of ACTIVE_STATUSES) {
      expect(nextStatus(status, 'pickup')).not.toBe('cancelled')
      expect(nextStatus(status, 'delivery')).not.toBe('cancelled')
    }
  })

  it('keeps active and terminal statuses disjoint and complete', () => {
    expect([...ACTIVE_STATUSES, ...TERMINAL_STATUSES].sort()).toEqual(
      [...ORDER_STATUSES].sort(),
    )
    for (const status of ACTIVE_STATUSES) {
      expect(TERMINAL_STATUSES).not.toContain(status)
    }
  })
})

describe('derivePaymentStatus', () => {
  it('reads nothing paid as unpaid', () => {
    expect(derivePaymentStatus(0, 10000)).toBe('unpaid')
  })

  it('reads part of the total as partial', () => {
    expect(derivePaymentStatus(4000, 10000)).toBe('partial')
  })

  it('reads the full total as paid', () => {
    expect(derivePaymentStatus(10000, 10000)).toBe('paid')
  })

  /* An overpayment is still paid — it must not read as partial. */
  it('reads an overpayment as paid', () => {
    expect(derivePaymentStatus(12000, 10000)).toBe('paid')
  })

  /* A fully discounted order is settled the moment it is created. */
  it('reads a zero-total order as paid', () => {
    expect(derivePaymentStatus(0, 0)).toBe('unpaid')
    expect(derivePaymentStatus(1, 0)).toBe('paid')
  })
})
