import { cn } from '@/lib/utils'

/**
 * The two chart forms this app needs, built in plain HTML.
 *
 * Every chart here plots one series whose job is magnitude, so all of them use
 * a single hue rather than a categorical palette — colour carries no meaning
 * the bar length isn't already carrying, and a per-category rainbow would spend
 * the only free channel on nothing. Identity comes from the labels beside the
 * marks; text stays in ink tokens so nothing depends on reading colour.
 *
 * Marks follow the house spec: thin bars, a 4px rounded data-end with a square
 * baseline, a recessive track one step off the surface, and no gridlines where
 * every value is already written next to its bar.
 */

/* -------------------------------------------------------------------------- */
/*                                  Bar list                                  */
/* -------------------------------------------------------------------------- */

export type BarRow = {
  key: string
  label: string
  sublabel?: string
  /** Drives the bar length. */
  value: number
  /** Pre-formatted value, printed at the end of the row. */
  display: string
  meta?: string
}

/**
 * A ranked list where each row carries its own bar. This doubles as the table
 * view — every value is written out, so nothing is reachable only by hovering.
 */
export function BarList({
  rows,
  empty = 'Nothing in this period.',
}: {
  rows: BarRow[]
  empty?: string
}) {
  if (rows.length === 0) {
    return <p className="text-ink-faint py-2 text-sm">{empty}</p>
  }

  const max = Math.max(...rows.map((r) => r.value), 0)

  return (
    <ul className="space-y-2.5">
      {rows.map((row) => {
        /* A non-zero value always gets a visible sliver, otherwise a small
           number reads as "none at all". */
        const pct = max > 0 ? (row.value / max) * 100 : 0
        const width = row.value > 0 ? Math.max(pct, 2) : 0

        return (
          <li key={row.key}>
            <div className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 truncate text-sm">
                {row.label}
                {row.sublabel && (
                  <span className="text-ink-faint"> · {row.sublabel}</span>
                )}
              </span>
              <span className="tabular shrink-0 text-sm font-medium">
                {row.display}
              </span>
            </div>
            <div className="bg-surface-raised mt-1 h-2 w-full overflow-hidden rounded-[2px]">
              <div
                className="bg-accent h-2 rounded-r-[4px]"
                style={{ width: `${width}%` }}
              />
            </div>
            {row.meta && (
              <div className="text-ink-faint mt-0.5 text-xs">{row.meta}</div>
            )}
          </li>
        )
      })}
    </ul>
  )
}

/* -------------------------------------------------------------------------- */
/*                                Column chart                                */
/* -------------------------------------------------------------------------- */

export type Column = {
  key: string
  label: string
  value: number
  display: string
}

/**
 * Columns for comparing across a small, ordered set — days of the week, or a
 * period's revenue over time.
 *
 * Only the tallest column is labelled. A number over every column is the
 * classic way to make a chart unreadable, and the exact figures for every row
 * are in the tables elsewhere on the page.
 */
export function ColumnChart({
  columns,
  height = 104,
  empty = 'Nothing in this period.',
}: {
  columns: Column[]
  height?: number
  empty?: string
}) {
  if (columns.length === 0) {
    return <p className="text-ink-faint py-2 text-sm">{empty}</p>
  }

  const max = Math.max(...columns.map((c) => c.value), 0)

  return (
    <div>
      {/* `items-stretch`, not `items-end`: each column must inherit the row's
          definite height, or the bars' percentage heights resolve against an
          auto height and collapse to nothing. The bars sit on the baseline via
          `justify-end` inside each full-height column instead. */}
      <div className="flex items-stretch gap-[2px]" style={{ height }}>
        {columns.map((column) => {
          const pct = max > 0 ? (column.value / max) * 100 : 0
          const isPeak = max > 0 && column.value === max

          /* The tallest bar stops short of the ceiling so the one direct label
             always has room above it rather than pushing the plot out of shape. */
          const barHeight = column.value > 0 ? Math.max(pct * 0.86, 3) : 0

          return (
            <div
              key={column.key}
              className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1"
            >
              {isPeak && (
                <span className="text-ink-muted tabular text-[0.625rem] leading-none">
                  {column.display}
                </span>
              )}
              <div
                title={`${column.label}: ${column.display}`}
                className="bg-accent w-full max-w-6 rounded-t-[4px]"
                style={{ height: `${barHeight}%` }}
              />
            </div>
          )
        })}
      </div>

      {/* Solid hairline baseline; the axis band sits inside the card, never
          clipped, because the wrapper grows with its labels.

          Past eight columns a label per column cannot fit on a phone, and
          truncating them to "Ju…" tells the reader nothing. Every nth column is
          labelled instead, and the labels that survive are shown in full. */}
      <div className="border-line/60 mt-1 flex gap-[2px] overflow-visible border-t pt-1.5">
        {columns.map((column, index) => {
          const stride = columns.length > 8 ? Math.ceil(columns.length / 5) : 1
          const isFirst = index === 0
          const isLast = index === columns.length - 1
          const show = stride === 1 || index % stride === 0 || isLast

          return (
            <span
              key={column.key}
              className={cn(
                'text-ink-faint min-w-0 flex-1 text-[0.625rem] whitespace-nowrap',
                isFirst ? 'text-left' : isLast ? 'text-right' : 'text-center',
              )}
            >
              {show ? column.label : ' '}
            </span>
          )
        })}
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/*                              Status breakdown                              */
/* -------------------------------------------------------------------------- */

/**
 * Payment state is the one place on this page where colour means something, so
 * it uses the app's reserved status colours rather than the chart hue — and
 * every segment is labelled, so the colour is reinforcement, never the message.
 */
export function StatusBar({
  segments,
}: {
  segments: { key: string; label: string; value: number; display: string; className: string }[]
}) {
  const total = segments.reduce((sum, s) => sum + s.value, 0)
  if (total === 0) {
    return <p className="text-ink-faint py-2 text-sm">Nothing in this period.</p>
  }

  const present = segments.filter((s) => s.value > 0)

  return (
    <div>
      {/* A 2px surface gap separates the segments — no borders drawn on marks. */}
      <div className="flex h-2.5 w-full gap-[2px] overflow-hidden">
        {present.map((segment, index) => (
          <div
            key={segment.key}
            className={cn(
              segment.className,
              index === 0 && 'rounded-l-[2px]',
              index === present.length - 1 && 'rounded-r-[4px]',
            )}
            style={{ width: `${(segment.value / total) * 100}%` }}
            title={`${segment.label}: ${segment.display}`}
          />
        ))}
      </div>

      <ul className="mt-3 space-y-1.5">
        {segments.map((segment) => (
          <li key={segment.key} className="flex items-baseline gap-2 text-sm">
            <span
              className={cn('size-2 shrink-0 rounded-full', segment.className)}
              aria-hidden
            />
            <span className="min-w-0 flex-1 truncate">{segment.label}</span>
            <span className="tabular shrink-0 font-medium">{segment.display}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
