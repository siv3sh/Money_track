import { useLayoutEffect, useRef } from 'react'
import * as am5 from '@amcharts/amcharts5'
import * as am5xy from '@amcharts/amcharts5/xy'
import * as am5percent from '@amcharts/amcharts5/percent'
import * as am5radar from '@amcharts/amcharts5/radar'
import am5themes_Animated from '@amcharts/amcharts5/themes/Animated'

function readCssVar(name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return value || fallback
}

function chartPalette() {
  return {
    text: readCssVar('--text', '#12151a'),
    muted: readCssVar('--muted', '#5a6572'),
    border: readCssVar('--border', '#d8dee6'),
    surface: readCssVar('--surface', '#ffffff'),
    debit: readCssVar('--chart-debit', '#e07a6a'),
    credit: readCssVar('--chart-credit', '#5bb88a'),
    accent: readCssVar('--accent', '#1f6feb'),
    series: [
      readCssVar('--accent', '#1f6feb'),
      readCssVar('--chart-credit', '#5bb88a'),
      readCssVar('--chart-debit', '#e07a6a'),
      '#7c6cf0',
      '#f0a05a',
      '#4db6c8',
      '#d45d8a',
      '#8aa06a',
    ],
  }
}

function useChartRoot(create: (root: am5.Root) => void, depsKey: string) {
  const ref = useRef<HTMLDivElement | null>(null)

  useLayoutEffect(() => {
    if (!ref.current) return
    const root = am5.Root.new(ref.current)
    root.setThemes([am5themes_Animated.new(root)])
    root._logo?.dispose()
    create(root)
    return () => root.dispose()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [depsKey])

  return ref
}

function EmptyChart({ message }: { message: string }) {
  return (
    <div className="flex h-full min-h-[280px] items-center justify-center text-sm text-[var(--muted)]">
      {message}
    </div>
  )
}

export function MonthlyCashflowChart({
  data,
}: {
  data: Array<{ month: string; debit: number; credit: number; net: number }>
}) {
  const ref = useChartRoot((root) => {
    const colors = chartPalette()
    const chart = root.container.children.push(
      am5xy.XYChart.new(root, {
        panX: false,
        panY: false,
        layout: root.verticalLayout,
        paddingLeft: 8,
        paddingRight: 12,
      }),
    )

    const xAxis = chart.xAxes.push(
      am5xy.CategoryAxis.new(root, {
        categoryField: 'month',
        renderer: am5xy.AxisRendererX.new(root, { minGridDistance: 30 }),
      }),
    )
    xAxis.get('renderer').labels.template.setAll({
      fill: am5.color(colors.muted),
      fontSize: 11,
    })
    xAxis.get('renderer').grid.template.setAll({ stroke: am5.color(colors.border), strokeOpacity: 0.5 })
    xAxis.data.setAll(data)

    const yAxis = chart.yAxes.push(
      am5xy.ValueAxis.new(root, {
        renderer: am5xy.AxisRendererY.new(root, {}),
        numberFormat: "#'",
      }),
    )
    yAxis.get('renderer').labels.template.setAll({
      fill: am5.color(colors.muted),
      fontSize: 11,
      text: '{value}',
    })
    yAxis.get('renderer').grid.template.setAll({ stroke: am5.color(colors.border), strokeOpacity: 0.4 })
    yAxis.set(
      'numberFormatter',
      am5.NumberFormatter.new(root, {
        numberFormat: '#a',
      }),
    )

    const makeColumn = (field: string, name: string, color: string) => {
      const series = chart.series.push(
        am5xy.ColumnSeries.new(root, {
          name,
          xAxis,
          yAxis,
          valueYField: field,
          categoryXField: 'month',
          tooltip: am5.Tooltip.new(root, {
            labelText: `${name}: ₹{valueY.formatNumber('#,###.##')}`,
          }),
        }),
      )
      series.columns.template.setAll({
        width: am5.percent(38),
        fill: am5.color(color),
        stroke: am5.color(color),
        cornerRadiusTL: 4,
        cornerRadiusTR: 4,
      })
      series.data.setAll(data)
      series.appear(700)
      return series
    }

    makeColumn('debit', 'Expenses', colors.debit)
    makeColumn('credit', 'Income', colors.credit)

    const legend = chart.children.push(am5.Legend.new(root, { centerX: am5.p50, x: am5.p50 }))
    legend.labels.template.setAll({ fill: am5.color(colors.text), fontSize: 12 })
    legend.data.setAll(chart.series.values)
    chart.appear(700, 80)
  }, JSON.stringify(data))

  if (data.length === 0) return <EmptyChart message="No monthly trend data" />
  return <div ref={ref} className="h-[320px] w-full" />
}

export function DailyCashflowChart({
  data,
}: {
  data: Array<{ date: string; debit: number; credit: number; net: number }>
}) {
  const ref = useChartRoot((root) => {
    const colors = chartPalette()
    const chart = root.container.children.push(
      am5xy.XYChart.new(root, {
        panX: true,
        panY: false,
        wheelX: 'panX',
        wheelY: 'zoomX',
        layout: root.verticalLayout,
        paddingLeft: 8,
      }),
    )

    const cursor = chart.set('cursor', am5xy.XYCursor.new(root, { behavior: 'none' }))
    cursor.lineY.set('visible', false)

    const xAxis = chart.xAxes.push(
      am5xy.CategoryAxis.new(root, {
        categoryField: 'date',
        renderer: am5xy.AxisRendererX.new(root, { minGridDistance: 50 }),
        tooltip: am5.Tooltip.new(root, {}),
      }),
    )
    xAxis.get('renderer').labels.template.setAll({
      fill: am5.color(colors.muted),
      fontSize: 10,
      rotation: -35,
      centerY: am5.p50,
      centerX: am5.p100,
    })
    xAxis.get('renderer').grid.template.setAll({ strokeOpacity: 0 })
    xAxis.data.setAll(data)

    const yAxis = chart.yAxes.push(
      am5xy.ValueAxis.new(root, {
        renderer: am5xy.AxisRendererY.new(root, {}),
      }),
    )
    yAxis.get('renderer').labels.template.setAll({ fill: am5.color(colors.muted), fontSize: 11 })
    yAxis.get('renderer').grid.template.setAll({
      stroke: am5.color(colors.border),
      strokeOpacity: 0.4,
    })

    const makeLine = (field: string, name: string, color: string, filled: boolean) => {
      const series = chart.series.push(
        am5xy.SmoothedXLineSeries.new(root, {
          name,
          xAxis,
          yAxis,
          valueYField: field,
          categoryXField: 'date',
          tooltip: am5.Tooltip.new(root, {
            labelText: `${name}: ₹{valueY.formatNumber('#,###.##')}`,
          }),
        }),
      )
      series.strokes.template.setAll({ strokeWidth: 2.2, stroke: am5.color(color) })
      if (filled) {
        series.fills.template.setAll({
          visible: true,
          fillOpacity: 0.14,
          fill: am5.color(color),
        })
      }
      series.data.setAll(data)
      series.appear(800)
    }

    makeLine('debit', 'Expenses', colors.debit, true)
    makeLine('credit', 'Income', colors.credit, true)
    makeLine('net', 'Net', colors.accent, false)

    const legend = chart.children.push(am5.Legend.new(root, { centerX: am5.p50, x: am5.p50 }))
    legend.labels.template.setAll({ fill: am5.color(colors.text), fontSize: 12 })
    legend.data.setAll(chart.series.values)
    chart.appear(700, 80)
  }, JSON.stringify(data))

  if (data.length === 0) return <EmptyChart message="No daily cash-flow data" />
  return <div ref={ref} className="h-[340px] w-full" />
}

export function CumulativeNetChart({
  data,
}: {
  data: Array<{ date: string; debit: number; credit: number; net: number }>
}) {
  const cumulative = data.reduce<Array<{ date: string; cumulative: number }>>((acc, row) => {
    const prev = acc.length ? acc[acc.length - 1].cumulative : 0
    acc.push({ date: row.date, cumulative: prev + row.net })
    return acc
  }, [])

  const ref = useChartRoot((root) => {
    const colors = chartPalette()
    const chart = root.container.children.push(
      am5xy.XYChart.new(root, {
        panX: true,
        wheelX: 'panX',
        wheelY: 'zoomX',
        paddingLeft: 8,
      }),
    )
    chart.set('cursor', am5xy.XYCursor.new(root, { behavior: 'none' }))

    const xAxis = chart.xAxes.push(
      am5xy.CategoryAxis.new(root, {
        categoryField: 'date',
        renderer: am5xy.AxisRendererX.new(root, { minGridDistance: 50 }),
      }),
    )
    xAxis.get('renderer').labels.template.setAll({
      fill: am5.color(colors.muted),
      fontSize: 10,
      rotation: -35,
      centerY: am5.p50,
      centerX: am5.p100,
    })
    xAxis.data.setAll(cumulative)

    const yAxis = chart.yAxes.push(
      am5xy.ValueAxis.new(root, {
        renderer: am5xy.AxisRendererY.new(root, {}),
      }),
    )
    yAxis.get('renderer').labels.template.setAll({ fill: am5.color(colors.muted), fontSize: 11 })
    yAxis.get('renderer').grid.template.setAll({
      stroke: am5.color(colors.border),
      strokeOpacity: 0.4,
    })

    const series = chart.series.push(
      am5xy.SmoothedXLineSeries.new(root, {
        name: 'Cumulative net',
        xAxis,
        yAxis,
        valueYField: 'cumulative',
        categoryXField: 'date',
        tooltip: am5.Tooltip.new(root, {
          labelText: 'Cumulative net: ₹{valueY.formatNumber("#,###.##")}',
        }),
      }),
    )
    series.strokes.template.setAll({ strokeWidth: 2.4, stroke: am5.color(colors.accent) })
    series.fills.template.setAll({
      visible: true,
      fillOpacity: 0.16,
      fill: am5.color(colors.accent),
    })
    series.bullets.push(() =>
      am5.Bullet.new(root, {
        sprite: am5.Circle.new(root, {
          radius: 2.5,
          fill: am5.color(colors.accent),
        }),
      }),
    )
    series.data.setAll(cumulative)
    series.appear(800)
    chart.appear(700, 80)
  }, JSON.stringify(data))

  if (cumulative.length === 0) return <EmptyChart message="No cumulative net data" />
  return <div ref={ref} className="h-[320px] w-full" />
}

export function WeekdaySpendChart({
  data,
}: {
  data: Array<{ day: string; amount: number; count: number }>
}) {
  const ref = useChartRoot((root) => {
    const colors = chartPalette()
    const chart = root.container.children.push(
      am5xy.XYChart.new(root, {
        layout: root.verticalLayout,
        paddingLeft: 8,
      }),
    )

    const xAxis = chart.xAxes.push(
      am5xy.CategoryAxis.new(root, {
        categoryField: 'day',
        renderer: am5xy.AxisRendererX.new(root, { minGridDistance: 20 }),
      }),
    )
    xAxis.get('renderer').labels.template.setAll({ fill: am5.color(colors.muted), fontSize: 12 })
    xAxis.get('renderer').grid.template.setAll({ strokeOpacity: 0 })
    xAxis.data.setAll(data)

    const yAxis = chart.yAxes.push(
      am5xy.ValueAxis.new(root, {
        renderer: am5xy.AxisRendererY.new(root, {}),
      }),
    )
    yAxis.get('renderer').labels.template.setAll({ fill: am5.color(colors.muted), fontSize: 11 })
    yAxis.get('renderer').grid.template.setAll({
      stroke: am5.color(colors.border),
      strokeOpacity: 0.4,
    })

    const series = chart.series.push(
      am5xy.ColumnSeries.new(root, {
        name: 'Spend',
        xAxis,
        yAxis,
        valueYField: 'amount',
        categoryXField: 'day',
        tooltip: am5.Tooltip.new(root, {
          labelText: '{categoryX}: ₹{valueY.formatNumber("#,###.##")} ({count} txns)',
        }),
      }),
    )
    series.columns.template.setAll({
      width: am5.percent(55),
      cornerRadiusTL: 5,
      cornerRadiusTR: 5,
      fillOpacity: 0.9,
      templateField: 'columnSettings',
    })
    series.data.setAll(
      data.map((row, index) => ({
        ...row,
        columnSettings: { fill: am5.color(colors.series[index % colors.series.length]) },
      })),
    )
    series.appear(700)
    chart.appear(700, 80)
  }, JSON.stringify(data))

  if (data.length === 0) return <EmptyChart message="No weekday spend data" />
  return <div ref={ref} className="h-[300px] w-full" />
}

export function DonutBreakdownChart({
  data,
  valueField = 'debit',
}: {
  data: Array<{ name: string; debit: number; credit: number; count: number }>
  valueField?: 'debit' | 'credit' | 'count'
}) {
  const prepared = data
    .map((row) => ({
      category: row.name,
      value: row[valueField],
      count: row.count,
    }))
    .filter((row) => row.value > 0)

  const ref = useChartRoot((root) => {
    const colors = chartPalette()
    const chart = root.container.children.push(
      am5percent.PieChart.new(root, {
        layout: root.verticalLayout,
        innerRadius: am5.percent(52),
      }),
    )

    const series = chart.series.push(
      am5percent.PieSeries.new(root, {
        valueField: 'value',
        categoryField: 'category',
        alignLabels: true,
        tooltip: am5.Tooltip.new(root, {
          labelText: '{category}: ₹{value.formatNumber("#,###.##")} ({valuePercentTotal.formatNumber("0.0")}%)',
        }),
      }),
    )
    series.labels.template.setAll({
      text: '{category}',
      fontSize: 11,
      fill: am5.color(colors.text),
      maxWidth: 110,
      oversizedBehavior: 'wrap',
    })
    series.ticks.template.setAll({ stroke: am5.color(colors.muted), strokeOpacity: 0.5 })
    series.slices.template.setAll({
      strokeWidth: 2,
      stroke: am5.color(colors.surface),
    })
    series.get('colors')?.set(
      'colors',
      colors.series.map((c) => am5.color(c)),
    )
    series.data.setAll(prepared)
    series.appear(800)

    const legend = chart.children.push(
      am5.Legend.new(root, {
        centerX: am5.p50,
        x: am5.p50,
        marginTop: 8,
        layout: root.gridLayout,
      }),
    )
    legend.labels.template.setAll({ fill: am5.color(colors.text), fontSize: 11 })
    legend.valueLabels.template.setAll({ fill: am5.color(colors.muted), fontSize: 11 })
    legend.data.setAll(series.dataItems)
    chart.appear(700, 80)
  }, JSON.stringify(prepared))

  if (prepared.length === 0) return <EmptyChart message="No composition data" />
  return <div ref={ref} className="h-[340px] w-full" />
}

export function MerchantHorizontalChart({
  data,
}: {
  data: Array<{ merchant: string; amount: number; count: number; share: number }>
}) {
  const prepared = [...data].reverse()
  const ref = useChartRoot((root) => {
    const colors = chartPalette()
    const chart = root.container.children.push(
      am5xy.XYChart.new(root, {
        layout: root.verticalLayout,
        paddingLeft: 4,
        paddingRight: 16,
      }),
    )

    const yAxis = chart.yAxes.push(
      am5xy.CategoryAxis.new(root, {
        categoryField: 'merchant',
        renderer: am5xy.AxisRendererY.new(root, {
          inversed: true,
          cellStartLocation: 0.1,
          cellEndLocation: 0.9,
        }),
      }),
    )
    yAxis.get('renderer').labels.template.setAll({
      fill: am5.color(colors.text),
      fontSize: 11,
      maxWidth: 140,
      oversizedBehavior: 'truncate',
    })
    yAxis.get('renderer').grid.template.setAll({ strokeOpacity: 0 })
    yAxis.data.setAll(prepared)

    const xAxis = chart.xAxes.push(
      am5xy.ValueAxis.new(root, {
        renderer: am5xy.AxisRendererX.new(root, {}),
        min: 0,
      }),
    )
    xAxis.get('renderer').labels.template.setAll({ fill: am5.color(colors.muted), fontSize: 11 })
    xAxis.get('renderer').grid.template.setAll({
      stroke: am5.color(colors.border),
      strokeOpacity: 0.4,
    })

    const series = chart.series.push(
      am5xy.ColumnSeries.new(root, {
        name: 'Spend',
        xAxis,
        yAxis,
        valueXField: 'amount',
        categoryYField: 'merchant',
        tooltip: am5.Tooltip.new(root, {
          labelText: '{categoryY}: ₹{valueX.formatNumber("#,###.##")} · {share}% · {count} txns',
        }),
      }),
    )
    series.columns.template.setAll({
      height: am5.percent(70),
      cornerRadiusBR: 4,
      cornerRadiusTR: 4,
      fill: am5.color(colors.debit),
      strokeOpacity: 0,
    })
    series.data.setAll(prepared)
    series.appear(700)
    chart.appear(700, 80)
  }, JSON.stringify(data))

  if (data.length === 0) return <EmptyChart message="No merchant spend data" />
  return <div ref={ref} className="h-[420px] w-full" />
}

export function IncomeExpenseRadarChart({
  debit,
  credit,
}: {
  debit: number
  credit: number
}) {
  const data = [
    { category: 'Expenses', value: debit },
    { category: 'Income', value: credit },
    { category: 'Net capacity', value: Math.max(debit, credit) },
  ]

  const ref = useChartRoot((root) => {
    const colors = chartPalette()
    const chart = root.container.children.push(
      am5radar.RadarChart.new(root, {
        panX: false,
        panY: false,
        innerRadius: am5.percent(20),
      }),
    )

    const xAxis = chart.xAxes.push(
      am5xy.CategoryAxis.new(root, {
        maxDeviation: 0,
        categoryField: 'category',
        renderer: am5radar.AxisRendererCircular.new(root, {}),
      }),
    )
    xAxis.get('renderer').labels.template.setAll({ fill: am5.color(colors.text), fontSize: 11 })
    xAxis.data.setAll(data)

    const yAxis = chart.yAxes.push(
      am5xy.ValueAxis.new(root, {
        renderer: am5radar.AxisRendererRadial.new(root, { minGridDistance: 20 }),
      }),
    )
    yAxis.get('renderer').labels.template.setAll({ fill: am5.color(colors.muted), fontSize: 10 })

    const series = chart.series.push(
      am5radar.RadarColumnSeries.new(root, {
        name: 'Amount',
        xAxis,
        yAxis,
        valueYField: 'value',
        categoryXField: 'category',
        tooltip: am5.Tooltip.new(root, {
          labelText: '{categoryX}: ₹{valueY.formatNumber("#,###.##")}',
        }),
      }),
    )
    series.columns.template.setAll({
      cornerRadius: 4,
      templateField: 'columnSettings',
    })
    series.data.setAll([
      { ...data[0], columnSettings: { fill: am5.color(colors.debit) } },
      { ...data[1], columnSettings: { fill: am5.color(colors.credit) } },
      { ...data[2], columnSettings: { fill: am5.color(colors.accent) } },
    ])
    series.appear(800)
    chart.appear(700, 80)
  }, JSON.stringify({ debit, credit }))

  if (debit === 0 && credit === 0) return <EmptyChart message="No income/expense data" />
  return <div ref={ref} className="h-[320px] w-full" />
}

export function SavingsGaugeChart({ rate }: { rate: number | null }) {
  const value = rate == null ? 0 : Math.max(-50, Math.min(100, rate))
  const ref = useChartRoot((root) => {
    const colors = chartPalette()
    const chart = root.container.children.push(
      am5radar.RadarChart.new(root, {
        panX: false,
        panY: false,
        startAngle: -180,
        endAngle: 0,
        innerRadius: -24,
      }),
    )

    const axisRenderer = am5radar.AxisRendererCircular.new(root, {
      strokeOpacity: 0.15,
      minGridDistance: 30,
    })
    axisRenderer.ticks.template.set('visible', false)
    axisRenderer.grid.template.set('forceHidden', true)

    const axis = chart.xAxes.push(
      am5xy.ValueAxis.new(root, {
        maxDeviation: 0,
        min: -50,
        max: 100,
        strictMinMax: true,
        renderer: axisRenderer,
      }),
    )
    axis.get('renderer').labels.template.setAll({
      fill: am5.color(colors.muted),
      fontSize: 10,
    })

    const createRange = (from: number, to: number, color: string) => {
      const rangeDataItem = axis.makeDataItem({ value: from, endValue: to })
      axis.createAxisRange(rangeDataItem)
      rangeDataItem.get('axisFill')?.setAll({
        visible: true,
        fill: am5.color(color),
        fillOpacity: 0.85,
      })
    }
    createRange(-50, 0, colors.debit)
    createRange(0, 20, '#f0a05a')
    createRange(20, 100, colors.credit)

    const clockHand = am5radar.ClockHand.new(root, {
      pinRadius: 10,
      radius: am5.percent(90),
      bottomWidth: 10,
    })
    const handDataItem = axis.makeDataItem({ value: value })
    handDataItem.set(
      'bullet',
      am5xy.AxisBullet.new(root, {
        sprite: clockHand,
      }),
    )
    axis.createAxisRange(handDataItem)
    clockHand.pin.setAll({ fill: am5.color(colors.text) })
    clockHand.hand.setAll({ fill: am5.color(colors.text) })

    chart.radarContainer.children.push(
      am5.Label.new(root, {
        text: rate == null ? 'N/A' : `${rate.toFixed(1)}%`,
        fontSize: 28,
        fontWeight: '600',
        fill: am5.color(colors.text),
        centerX: am5.p50,
        centerY: am5.p50,
        dy: -12,
      }),
    )
    chart.radarContainer.children.push(
      am5.Label.new(root, {
        text: 'Savings rate',
        fontSize: 12,
        fill: am5.color(colors.muted),
        centerX: am5.p50,
        centerY: am5.p50,
        dy: 18,
      }),
    )
    chart.appear(700, 80)
  }, String(rate))

  return <div ref={ref} className="h-[280px] w-full" />
}

export function TransactionMixChart({
  debitCount,
  creditCount,
}: {
  debitCount: number
  creditCount: number
}) {
  const data = [
    { category: 'Debit txns', value: debitCount },
    { category: 'Credit txns', value: creditCount },
  ].filter((row) => row.value > 0)

  const ref = useChartRoot((root) => {
    const colors = chartPalette()
    const chart = root.container.children.push(
      am5percent.PieChart.new(root, {
        layout: root.horizontalLayout,
        innerRadius: am5.percent(60),
      }),
    )
    const series = chart.series.push(
      am5percent.PieSeries.new(root, {
        valueField: 'value',
        categoryField: 'category',
        tooltip: am5.Tooltip.new(root, {
          labelText: '{category}: {value} ({valuePercentTotal.formatNumber("0.0")}%)',
        }),
      }),
    )
    series.labels.template.set('forceHidden', true)
    series.ticks.template.set('forceHidden', true)
    series.slices.template.setAll({ stroke: am5.color(colors.surface), strokeWidth: 2 })
    series.get('colors')?.set('colors', [am5.color(colors.debit), am5.color(colors.credit)])
    series.data.setAll(data)

    chart.seriesContainer.children.push(
      am5.Label.new(root, {
        text: `${debitCount + creditCount}`,
        fontSize: 26,
        fontWeight: '600',
        fill: am5.color(colors.text),
        centerX: am5.p50,
        centerY: am5.p50,
        dy: -8,
      }),
    )
    chart.seriesContainer.children.push(
      am5.Label.new(root, {
        text: 'transactions',
        fontSize: 11,
        fill: am5.color(colors.muted),
        centerX: am5.p50,
        centerY: am5.p50,
        dy: 14,
      }),
    )

    const legend = chart.children.push(
      am5.Legend.new(root, {
        centerY: am5.p50,
        y: am5.p50,
        layout: root.verticalLayout,
        marginLeft: 16,
      }),
    )
    legend.labels.template.setAll({ fill: am5.color(colors.text), fontSize: 12 })
    legend.valueLabels.template.setAll({ fill: am5.color(colors.muted), fontSize: 12 })
    legend.data.setAll(series.dataItems)
    series.appear(700)
    chart.appear(700, 80)
  }, JSON.stringify({ debitCount, creditCount }))

  if (data.length === 0) return <EmptyChart message="No transaction mix data" />
  return <div ref={ref} className="h-[260px] w-full" />
}
