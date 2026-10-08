import { AlertTriangle, Package } from 'lucide-react'
import Link from 'next/link'

import { CountSheet } from '@/components/inventory/count-sheet'
import { DeliveryForm } from '@/components/inventory/delivery-form'
import { IngredientEditor } from '@/components/inventory/ingredient-editor'
import { WastePanel } from '@/components/inventory/waste-panel'
import { StatTile } from '@/components/stat-tile'
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card'
import {
  getAllIngredients,
  getPeriodSummary,
  getRecentCounts,
  getRecentPurchases,
  getRecentWaste,
  getStock,
} from '@/lib/inventory/queries'
import {
  CATEGORY_LABELS,
  formatQuantity,
  formatWithUnit,
} from '@/lib/inventory/units'
import { formatCents, formatCentsCompact } from '@/lib/money'
import { formatDate, today } from '@/lib/time'
import { cn } from '@/lib/utils'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Inventory' }

const TABS = ['stock', 'deliveries', 'counts', 'waste'] as const
type Tab = (typeof TABS)[number]

const TAB_LABELS: Record<Tab, string> = {
  stock: 'Stock',
  deliveries: 'Deliveries',
  counts: 'Counts',
  waste: 'Waste',
}

/**
 * Inventory for the whole kitchen — the restaurant and the catering side share
 * one store room, so they share one list.
 *
 * Without a till feeding every plate served, what was used can only be worked
 * out between counts: opening, plus deliveries, minus what is left. So the
 * figures here are honest about which are measured and which are inferred.
 * On-hand between counts is an upper bound, and says so, because restaurant
 * covers leave the shelf without passing through this app.
 */
export default async function InventoryPage(props: PageProps<'/inventory'>) {
  const params = await props.searchParams
  const requested = typeof params.tab === 'string' ? params.tab : undefined
  const tab: Tab = TABS.includes(requested as Tab) ? (requested as Tab) : 'stock'

  const [stock, period, all, purchases, counts, waste] = await Promise.all([
    getStock(),
    getPeriodSummary(),
    getAllIngredients(),
    getRecentPurchases(),
    getRecentCounts(),
    getRecentWaste(),
  ])

  const stockValue = stock.reduce((sum, row) => sum + row.onHandValueCents, 0)
  const belowPar = stock.filter((row) => row.belowPar)
  const now = today()

  const grouped = stock.reduce<Record<string, typeof stock>>((acc, row) => {
    ;(acc[row.category] ||= []).push(row)
    return acc
  }, {})

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-5 lg:py-8">
      <header className="mb-5">
        <h1 className="text-2xl font-semibold tracking-tight">Inventory</h1>
        <p className="text-ink-faint text-sm">
          {period
            ? `Last period ${formatDate(period.from)} – ${formatDate(period.to)}`
            : 'Restaurant and catering, one store room'}
        </p>
      </header>

      <div className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatTile
          label="Stock value"
          value={formatCentsCompact(stockValue)}
          hint={`${stock.length} ingredient${stock.length === 1 ? '' : 's'}`}
        />
        <StatTile
          label="Below par"
          value={belowPar.length}
          tone={belowPar.length > 0 ? 'warning' : 'positive'}
          hint={belowPar.length > 0 ? 'need reordering' : 'all stocked'}
        />
        <StatTile
          label="Food cost"
          value={period?.foodCostPercent !== null && period?.foodCostPercent !== undefined
            ? `${period.foodCostPercent}%`
            : '—'}
          tone={
            period?.foodCostPercent != null && period.foodCostPercent > 35
              ? 'warning'
              : 'default'
          }
          hint={period?.salesCents == null ? 'needs takings' : 'of takings'}
        />
        <StatTile
          label="Waste"
          value={period ? formatCentsCompact(period.wasteCostCents) : '—'}
          tone={period && period.wasteCostCents > 0 ? 'warning' : 'default'}
          hint="last period"
        />
      </div>

      <nav className="bg-surface-raised ring-line mb-5 grid grid-cols-4 gap-1 rounded-lg p-1 ring-1">
        {TABS.map((value) => (
          <Link
            key={value}
            href={value === 'stock' ? '/inventory' : `/inventory?tab=${value}`}
            className={cn(
              'flex h-10 items-center justify-center rounded-md text-sm font-medium transition',
              value === tab
                ? 'bg-accent text-accent-ink shadow-sm'
                : 'text-ink-muted hover:text-ink',
            )}
          >
            {TAB_LABELS[value]}
          </Link>
        ))}
      </nav>

      {/* ------------------------------- Stock -------------------------------- */}
      {tab === 'stock' && (
        <div className="space-y-5">
          {stock.length > 0 && (
            <p className="text-ink-faint flex items-start gap-2 text-xs">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              On hand is the last count plus deliveries, less logged waste.
              Restaurant covers leave the shelf without passing through here, so
              treat it as a ceiling until the next stocktake.
            </p>
          )}

          {Object.entries(grouped).map(([category, rows]) => (
            <Card key={category}>
              <CardHeader>
                <CardTitle>{CATEGORY_LABELS[category] ?? category}</CardTitle>
              </CardHeader>
              <CardBody className="px-0">
                <ul className="divide-line/50 divide-y">
                  {rows.map((row) => (
                    <li
                      key={row.id}
                      className="flex items-center gap-3 px-4 py-2.5"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium">{row.name}</span>
                        <span className="text-ink-faint block text-xs">
                          {row.parLevelMilli > 0 &&
                            `par ${formatQuantity(row.parLevelMilli)} ${row.stockUnit} · `}
                          {row.lastCostCents > 0
                            ? `${formatCentsCompact(row.lastCostCents)}/${row.stockUnit}`
                            : 'no cost yet'}
                          {row.supplier && ` · ${row.supplier}`}
                        </span>
                      </span>

                      <span className="shrink-0 text-right">
                        <span
                          className={cn(
                            'tabular block text-sm font-semibold',
                            row.belowPar && 'text-amber-400',
                          )}
                        >
                          {formatWithUnit(row.onHandMilli, row.stockUnit)}
                        </span>
                        <span className="text-ink-faint tabular block text-xs">
                          {row.daysLeft !== null
                            ? `${row.daysLeft}d left`
                            : row.onHandValueCents > 0
                              ? formatCentsCompact(row.onHandValueCents)
                              : '—'}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          ))}

          <Card>
            <CardHeader>
              <CardTitle>Ingredients</CardTitle>
            </CardHeader>
            <CardBody>
              <IngredientEditor
                rows={all.map((row) => ({
                  id: row.id,
                  name: row.name,
                  category: row.category,
                  stockUnit: row.stockUnit,
                  purchaseUnit: row.purchaseUnit,
                  stockPerPurchaseMilli: row.stockPerPurchaseMilli,
                  parLevelMilli: row.parLevelMilli,
                  lastCostCents: row.lastCostCents,
                  supplier: row.supplier,
                  notes: row.notes,
                  active: row.active,
                }))}
              />
            </CardBody>
          </Card>

          {stock.length === 0 && <Empty />}
        </div>
      )}

      {/* ----------------------------- Deliveries ----------------------------- */}
      {tab === 'deliveries' && (
        <div className="space-y-4">
          <DeliveryForm
            today={now}
            ingredients={all
              .filter((i) => i.active)
              .map((i) => ({
                id: i.id,
                name: i.name,
                stockUnit: i.stockUnit,
                purchaseUnit: i.purchaseUnit,
                stockPerPurchaseMilli: i.stockPerPurchaseMilli,
                lastCostCents: i.lastCostCents,
              }))}
          />

          {purchases.length === 0 ? (
            <p className="text-ink-faint text-sm">Nothing logged yet.</p>
          ) : (
            purchases.map((purchase) => (
              <Card key={purchase.id}>
                <CardHeader>
                  <CardTitle>
                    {purchase.supplier} · {formatDate(purchase.purchasedOn)}
                  </CardTitle>
                </CardHeader>
                <CardBody className="px-0">
                  <ul className="divide-line/50 divide-y">
                    {purchase.lines.map((line) => (
                      <li
                        key={line.id}
                        className="flex items-center gap-3 px-4 py-2 text-sm"
                      >
                        <span className="min-w-0 flex-1">
                          {line.ingredient.name}
                          <span className="text-ink-faint block text-xs">
                            {formatQuantity(line.quantityMilli)}{' '}
                            {line.ingredient.purchaseUnit} ={' '}
                            {formatWithUnit(
                              line.stockQuantityMilli,
                              line.ingredient.stockUnit,
                            )}
                          </span>
                        </span>
                        <span className="tabular shrink-0">
                          {formatCents(line.lineTotalCents)}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <div className="border-line/60 mt-2 flex justify-between border-t px-4 pt-2 text-sm font-semibold">
                    <span>Total</span>
                    <span className="tabular">{formatCents(purchase.totalCents)}</span>
                  </div>
                </CardBody>
              </Card>
            ))
          )}
        </div>
      )}

      {/* ------------------------------- Counts ------------------------------- */}
      {tab === 'counts' && (
        <div className="space-y-4">
          <CountSheet
            today={now}
            ingredients={stock.map((row) => ({
              id: row.id,
              name: row.name,
              category: row.category,
              stockUnit: row.stockUnit,
              onHandMilli: row.onHandMilli,
            }))}
          />

          {period && (
            <Card>
              <CardHeader>
                <CardTitle>
                  {formatDate(period.from)} – {formatDate(period.to)} ·{' '}
                  {period.days} days
                </CardTitle>
              </CardHeader>
              <CardBody>
                <dl className="space-y-1.5 text-sm">
                  <Line label="Bought" value={formatCents(period.purchaseCostCents)} />
                  <Line label="Used" value={formatCents(period.usageCostCents)} />
                  <Line label="Of that, waste" value={formatCents(period.wasteCostCents)} />
                  <Line
                    label="Takings"
                    value={
                      period.salesCents != null ? formatCents(period.salesCents) : 'not entered'
                    }
                  />
                  <div className="border-line/60 flex justify-between border-t pt-2 text-base font-semibold">
                    <span>Food cost</span>
                    <span className="tabular">
                      {period.foodCostPercent != null
                        ? `${period.foodCostPercent}%`
                        : '—'}
                    </span>
                  </div>
                </dl>
              </CardBody>
            </Card>
          )}

          {counts.length === 0 ? (
            <p className="text-ink-faint text-sm">No stocktakes yet.</p>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle>Past counts</CardTitle>
              </CardHeader>
              <CardBody className="px-0">
                <ul className="divide-line/50 divide-y">
                  {counts.map((count) => (
                    <li
                      key={count.id}
                      className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm"
                    >
                      <span>
                        {formatDate(count.countedOn)}
                        <span className="text-ink-faint block text-xs">
                          {count.lines.length} item
                          {count.lines.length === 1 ? '' : 's'} counted
                        </span>
                      </span>
                      <span className="tabular text-ink-muted shrink-0 text-xs">
                        {count.salesSinceLastCents != null
                          ? `${formatCentsCompact(count.salesSinceLastCents)} takings`
                          : 'no takings'}
                      </span>
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          )}
        </div>
      )}

      {/* -------------------------------- Waste ------------------------------- */}
      {tab === 'waste' && (
        <WastePanel
          today={now}
          ingredients={all
            .filter((i) => i.active)
            .map((i) => ({
              id: i.id,
              name: i.name,
              stockUnit: i.stockUnit,
              lastCostCents: i.lastCostCents,
            }))}
          rows={waste.map((row) => ({
            id: row.id,
            name: row.ingredient.name,
            quantityLabel: formatWithUnit(row.quantityMilli, row.ingredient.stockUnit),
            costCents: row.costCents,
            reason: row.reason,
            note: row.note,
            dateLabel: formatDate(row.wastedOn),
          }))}
        />
      )}
    </div>
  )
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-ink-muted">{label}</dt>
      <dd className="tabular">{value}</dd>
    </div>
  )
}

function Empty() {
  return (
    <div className="rounded-card bg-surface ring-line/70 px-6 py-12 text-center ring-1">
      <Package className="text-ink-faint mx-auto size-8" />
      <p className="mt-3 font-medium">Nothing in the store room yet</p>
      <p className="text-ink-faint mx-auto mt-1 max-w-sm text-sm">
        Add the things you buy — rice, chicken, oil, trays — with how they are
        sold and how you count them. Then log a delivery and the costs look after
        themselves.
      </p>
    </div>
  )
}
