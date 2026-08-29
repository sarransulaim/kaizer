/**
 * Business-wide constants. Kept in one place so that changing the timezone,
 * name, or tax treatment is a single edit rather than a search-and-replace.
 */

export const BUSINESS = {
  name: 'Kaizr',
  tagline: 'Catering orders',
  /**
   * IANA zone, not a fixed offset — New Jersey observes DST, and orders are
   * routinely taken across the March and November transitions.
   */
  timezone: 'America/New_York',
} as const

/** Tax is not currently applied to catering orders; kept configurable. */
export const TAX_RATE = 0

/** How far ahead the dashboard's upcoming view looks, in days. */
export const UPCOMING_WINDOW_DAYS = 21

/**
 * How many one-tap day chips the order form and prep sheet offer. The kitchen
 * takes orders every day of the week, so these are simply the next N calendar
 * days — there is no weekday filter to fall foul of.
 */
export const DAY_CHIP_COUNT = 7
