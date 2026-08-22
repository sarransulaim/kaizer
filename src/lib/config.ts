/**
 * Business-wide constants. Kept in one place so that changing the timezone,
 * name, or tax treatment is a single edit rather than a search-and-replace.
 */

export const BUSINESS = {
  name: 'Kaizr',
  tagline: 'Hyderabadi Weekend Orders',
  /**
   * IANA zone, not a fixed offset — New Jersey observes DST, and orders are
   * routinely taken across the March and November transitions.
   */
  timezone: 'America/New_York',
  /** Days the kitchen normally serves. Used to highlight the weekend view. */
  serviceDays: [5, 6, 7] as number[], // Luxon weekdays: Mon=1 … Sun=7
} as const

/** Tax is not currently applied to catering orders; kept configurable. */
export const TAX_RATE = 0

/** How far ahead the "Upcoming" view looks, in days. */
export const UPCOMING_WINDOW_DAYS = 21
