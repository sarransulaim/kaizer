import { relations, sql } from 'drizzle-orm'
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  serial,
  text,
  time,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

/* -------------------------------------------------------------------------- */
/*                                   Enums                                    */
/* -------------------------------------------------------------------------- */

export const orderStatusEnum = pgEnum('order_status', [
  'new',
  'confirmed',
  'prepping',
  'ready',
  'out_for_delivery',
  'completed',
  'cancelled',
])

export const fulfillmentTypeEnum = pgEnum('fulfillment_type', [
  'dine_in',
  'pickup',
  'delivery',
])

export const orderChannelEnum = pgEnum('order_channel', [
  'google_form',
  'whatsapp',
  'phone',
  'walk_in',
  'other',
])

export const paymentStatusEnum = pgEnum('payment_status', [
  'unpaid',
  'partial',
  'paid',
  'refunded',
])

export const paymentMethodEnum = pgEnum('payment_method', [
  'zelle',
  'cash',
  'card',
  'venmo',
  'other',
])

export const userRoleEnum = pgEnum('user_role', [
  'owner',
  'manager',
  'kitchen',
  'driver',
])

/* -------------------------------------------------------------------------- */
/*                                   Users                                    */
/* -------------------------------------------------------------------------- */

/**
 * Auth is intentionally NOT wired up yet, but this table exists from day one so
 * that `created_by` / `updated_by` / audit trail columns are populated with a
 * real actor from the very first order. Backfilling "who did this" after the
 * fact is impossible, so we pay the small cost now.
 *
 * When auth is switched on: build the login screen, point `getCurrentActor()`
 * at the real session, and enable row-level security. No migration required.
 */
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  /**
   * Nullable: kitchen staff are added by name and a PIN so they can clock in,
   * and most of them have no reason to hold an account. Postgres allows any
   * number of NULLs under a unique constraint, so the owner's address stays
   * unique without forcing an address on everyone else.
   */
  email: text('email').unique(),
  phone: text('phone'),
  role: userRoleEnum('role').notNull().default('owner'),
  // Populated only once auth is enabled.
  passwordHash: text('password_hash'),
  /**
   * Scrypt hash of the 4-digit clock-in PIN. Four digits is weak in isolation;
   * it is here to stop one worker clocking in as another at a tablet they are
   * both standing at, not to resist an attacker who already has the database.
   */
  pinHash: text('pin_hash'),
  /** Pay rate in cents per hour. Zero means "not on payroll". */
  hourlyRateCents: integer('hourly_rate_cents').notNull().default(0),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

/* -------------------------------------------------------------------------- */
/*                                 Customers                                  */
/* -------------------------------------------------------------------------- */

export const customers = pgTable(
  'customers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    /** Normalized to digits-only (see `lib/phone.ts`) so lookup always matches. */
    phone: text('phone').notNull().unique(),
    email: text('email'),
    /** Free-text notes: allergies, "always late", gate code, etc. */
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('customers_name_idx').on(t.name)],
)

/* -------------------------------------------------------------------------- */
/*                                    Menu                                    */
/* -------------------------------------------------------------------------- */

export const menuItems = pgTable('menu_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  category: text('category').notNull().default('main'),
  description: text('description'),
  /**
   * How the dish is actually made: ingredients, quantities, method. Free text
   * rather than a structured ingredient table on purpose — this is the note a
   * cook reads off the wall, not something the app calculates against, and
   * forcing it into rows would make it slower to write and harder to read.
   *
   * Surfaced on the kitchen display: tapping a line on an order opens it.
   */
  recipe: text('recipe'),
  /**
   * How many hours before service this item needs to be started. Drives the
   * prep-alert scheduler — mutton biryani needs a longer runway than kheer.
   */
  prepLeadHours: integer('prep_lead_hours').notNull().default(12),
  active: boolean('active').notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const menuVariants = pgTable(
  'menu_variants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    menuItemId: uuid('menu_item_id')
      .notNull()
      .references(() => menuItems.id, { onDelete: 'cascade' }),
    /** "Individual", "Small tray", "Large tray", "8 oz", "22 oz" */
    sizeLabel: text('size_label').notNull(),
    priceCents: integer('price_cents').notNull(),
    /** Rough head-count a variant serves. Used for prep planning. */
    servesCount: integer('serves_count'),
    active: boolean('active').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique('menu_variants_item_size_unique').on(t.menuItemId, t.sizeLabel)],
)

/* -------------------------------------------------------------------------- */
/*                                   Orders                                   */
/* -------------------------------------------------------------------------- */

export const orders = pgTable(
  'orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Human-readable reference used on the phone with customers: "order #1042". */
    orderNumber: serial('order_number').notNull().unique(),

    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'restrict' }),

    channel: orderChannelEnum('channel').notNull().default('whatsapp'),
    fulfillmentType: fulfillmentTypeEnum('fulfillment_type').notNull(),

    /**
     * Two representations of "when", deliberately:
     *
     *  - `serviceDate` + `serviceTime` are the *local* calendar date and clock
     *    time the business thinks in ("Saturday 6pm"). Grouping and filtering
     *    run off these, so no timezone math leaks into day-to-day queries.
     *  - `serviceAt` is the exact instant, computed on write from the two above
     *    plus the business timezone. Sorting and prep-alert scheduling use this
     *    so DST transitions can't shift an order by an hour.
     */
    serviceDate: date('service_date').notNull(),
    serviceTime: time('service_time').notNull(),
    serviceAt: timestamp('service_at', { withTimezone: true }).notNull(),

    status: orderStatusEnum('status').notNull().default('new'),

    subtotalCents: integer('subtotal_cents').notNull().default(0),
    discountCents: integer('discount_cents').notNull().default(0),
    taxCents: integer('tax_cents').notNull().default(0),
    totalCents: integer('total_cents').notNull().default(0),

    amountPaidCents: integer('amount_paid_cents').notNull().default(0),
    paymentStatus: paymentStatusEnum('payment_status').notNull().default('unpaid'),
    paymentMethod: paymentMethodEnum('payment_method'),
    /** "Name/phone the Zelle payment was sent from" — straight off the form. */
    paymentRef: text('payment_ref'),

    deliveryAddress: text('delivery_address'),
    /** Internal note for the kitchen. */
    notes: text('notes'),
    /** Anything the customer asked for, in their words. */
    customerNotes: text('customer_notes'),

    /**
     * Google Form response id (or WhatsApp message id) once auto-import lands.
     * Unique so re-running an import can never create duplicate orders.
     */
    externalRef: text('external_ref').unique(),

    createdById: uuid('created_by_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    updatedById: uuid('updated_by_id').references(() => users.id, {
      onDelete: 'set null',
    }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  },
  (t) => [
    index('orders_service_date_idx').on(t.serviceDate),
    index('orders_service_at_idx').on(t.serviceAt),
    index('orders_status_idx').on(t.status),
    index('orders_customer_idx').on(t.customerId),
    index('orders_date_status_idx').on(t.serviceDate, t.status),
  ],
)

export const orderItems = pgTable(
  'order_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),

    /** Kept for reporting/aggregation; restricted so menu history stays intact. */
    menuVariantId: uuid('menu_variant_id').references(() => menuVariants.id, {
      onDelete: 'restrict',
    }),

    /**
     * Snapshots. Menu names, sizes and prices change over time; an order must
     * always render and total exactly as it did the day it was taken.
     */
    itemNameSnapshot: text('item_name_snapshot').notNull(),
    sizeLabelSnapshot: text('size_label_snapshot').notNull(),
    unitPriceCents: integer('unit_price_cents').notNull(),

    quantity: integer('quantity').notNull().default(1),
    lineTotalCents: integer('line_total_cents').notNull(),
    notes: text('notes'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('order_items_order_idx').on(t.orderId)],
)

/* -------------------------------------------------------------------------- */
/*                                 Time clock                                 */
/* -------------------------------------------------------------------------- */

/**
 * One row per shift. `clockOutAt` is null while someone is on the clock, which
 * is what the kitchen tablet reads to decide whether a worker's button says
 * "Punch in" or "Punch out".
 *
 * `workDate` is the local calendar date the shift *started*, stored rather than
 * derived. Payroll is grouped by business day and week, and a shift that runs
 * past midnight still belongs to the day it began — deriving that from the
 * timestamp at query time would need timezone arithmetic in every report.
 */
export const timeEntries = pgTable(
  'time_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),

    clockInAt: timestamp('clock_in_at', { withTimezone: true }).notNull(),
    clockOutAt: timestamp('clock_out_at', { withTimezone: true }),

    workDate: date('work_date').notNull(),

    /** "Forgot to punch out", "covered for Imran" — shown on the payroll sheet. */
    note: text('note'),

    /**
     * Set when the owner corrects a punch by hand. A corrected timesheet that
     * doesn't say it was corrected is how payroll disputes start.
     */
    editedById: uuid('edited_by_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    editedAt: timestamp('edited_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('time_entries_user_date_idx').on(t.userId, t.workDate),
    index('time_entries_date_idx').on(t.workDate),
    /**
     * At most one open shift per worker, enforced by the database rather than by
     * a check-then-insert in application code. Two taps on a laggy tablet would
     * otherwise open two shifts and silently double the week's hours.
     */
    uniqueIndex('time_entries_one_open_per_user')
      .on(t.userId)
      .where(sql`${t.clockOutAt} IS NULL`),
  ],
)

/**
 * One row per worker per week, written when the wages are actually handed over.
 *
 * It records the amount rather than just a flag, because the amount can stop
 * matching. A forgotten punch-out corrected next Tuesday changes what the week
 * computes to, and the payroll page would then show a total that was never the
 * one paid. Storing what was paid, and the hours it covered, lets the
 * difference be shown instead of silently rewriting history.
 */
export const payrollPayments = pgTable(
  'payroll_payments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),

    /** The Monday of the week being settled. */
    weekStart: date('week_start').notNull(),

    /** What was handed over, as computed at that moment. */
    amountCents: integer('amount_cents').notNull(),
    /** And the hours it covered, for the same reason. */
    minutes: integer('minutes').notNull(),

    note: text('note'),

    markedById: uuid('marked_by_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    paidAt: timestamp('paid_at', { withTimezone: true }).notNull().defaultNow(),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    /* A week can only be settled once. Marking it twice would be a
       double payment on paper. */
    unique('payroll_payments_user_week').on(t.userId, t.weekStart),
    index('payroll_payments_week_idx').on(t.weekStart),
  ],
)

/* -------------------------------------------------------------------------- */
/*                                Audit trail                                 */
/* -------------------------------------------------------------------------- */

export const orderEvents = pgTable(
  'order_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),

    /** created | status_changed | payment_updated | items_changed | note | cancelled */
    type: text('type').notNull(),
    fromStatus: orderStatusEnum('from_status'),
    toStatus: orderStatusEnum('to_status'),
    message: text('message'),
    meta: jsonb('meta'),

    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
    /** Snapshot so history stays readable even if the user record is removed. */
    actorName: text('actor_name'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('order_events_order_idx').on(t.orderId, t.createdAt)],
)

/* -------------------------------------------------------------------------- */
/*                             Push notifications                             */
/* -------------------------------------------------------------------------- */

export const pushSubscriptions = pgTable('push_subscriptions', {
  id: uuid('id').primaryKey().defaultRandom(),
  endpoint: text('endpoint').notNull().unique(),
  p256dh: text('p256dh').notNull(),
  auth: text('auth').notNull(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
  /** Friendly device name so a dead phone can be identified and removed. */
  label: text('label'),
  userAgent: text('user_agent'),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
})

/**
 * Every notification we've sent. `dedupeKey` is the important column: the prep
 * scheduler runs on a cron and will re-evaluate the same orders repeatedly, so
 * a unique key per (order, alert kind, window) is what stops the kitchen from
 * being pinged five times about the same tray of biryani.
 */
export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** prep_alert | prep_sheet | order_due | new_order | payment_due */
    kind: text('kind').notNull(),
    orderId: uuid('order_id').references(() => orders.id, { onDelete: 'cascade' }),
    dedupeKey: text('dedupe_key').notNull().unique(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    url: text('url'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    deliveredCount: integer('delivered_count').notNull().default(0),
    failedCount: integer('failed_count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('notifications_kind_idx').on(t.kind, t.createdAt)],
)

/* -------------------------------------------------------------------------- */
/*                                  Settings                                  */
/* -------------------------------------------------------------------------- */

export const appSettings = pgTable('app_settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

/* -------------------------------------------------------------------------- */
/*                                 Relations                                  */
/* -------------------------------------------------------------------------- */

export const customersRelations = relations(customers, ({ many }) => ({
  orders: many(orders),
}))

export const menuItemsRelations = relations(menuItems, ({ many }) => ({
  variants: many(menuVariants),
}))

export const menuVariantsRelations = relations(menuVariants, ({ one }) => ({
  item: one(menuItems, {
    fields: [menuVariants.menuItemId],
    references: [menuItems.id],
  }),
}))

export const ordersRelations = relations(orders, ({ one, many }) => ({
  customer: one(customers, {
    fields: [orders.customerId],
    references: [customers.id],
  }),
  items: many(orderItems),
  events: many(orderEvents),
  createdBy: one(users, {
    fields: [orders.createdById],
    references: [users.id],
  }),
}))

export const orderItemsRelations = relations(orderItems, ({ one }) => ({
  order: one(orders, { fields: [orderItems.orderId], references: [orders.id] }),
  variant: one(menuVariants, {
    fields: [orderItems.menuVariantId],
    references: [menuVariants.id],
  }),
}))

export const usersRelations = relations(users, ({ many }) => ({
  timeEntries: many(timeEntries),
}))

export const timeEntriesRelations = relations(timeEntries, ({ one }) => ({
  user: one(users, { fields: [timeEntries.userId], references: [users.id] }),
}))

export const payrollPaymentsRelations = relations(payrollPayments, ({ one }) => ({
  user: one(users, { fields: [payrollPayments.userId], references: [users.id] }),
}))

export const orderEventsRelations = relations(orderEvents, ({ one }) => ({
  order: one(orders, { fields: [orderEvents.orderId], references: [orders.id] }),
  actor: one(users, { fields: [orderEvents.actorId], references: [users.id] }),
}))

/* -------------------------------------------------------------------------- */
/*                              Inferred types                                */
/* -------------------------------------------------------------------------- */

export type User = typeof users.$inferSelect
export type Customer = typeof customers.$inferSelect
export type NewCustomer = typeof customers.$inferInsert
export type MenuItem = typeof menuItems.$inferSelect
export type MenuVariant = typeof menuVariants.$inferSelect
export type Order = typeof orders.$inferSelect
export type NewOrder = typeof orders.$inferInsert
export type OrderItem = typeof orderItems.$inferSelect
export type OrderEvent = typeof orderEvents.$inferSelect
export type PayrollPayment = typeof payrollPayments.$inferSelect
export type TimeEntry = typeof timeEntries.$inferSelect
export type NewTimeEntry = typeof timeEntries.$inferInsert
export type PushSubscription = typeof pushSubscriptions.$inferSelect
export type AppNotification = typeof notifications.$inferSelect

export type OrderStatus = (typeof orderStatusEnum.enumValues)[number]
export type FulfillmentType = (typeof fulfillmentTypeEnum.enumValues)[number]
export type OrderChannel = (typeof orderChannelEnum.enumValues)[number]
export type PaymentStatus = (typeof paymentStatusEnum.enumValues)[number]
export type PaymentMethod = (typeof paymentMethodEnum.enumValues)[number]
export type UserRole = (typeof userRoleEnum.enumValues)[number]
