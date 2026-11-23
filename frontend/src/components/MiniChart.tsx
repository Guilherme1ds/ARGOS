import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { useI18n } from '../i18n'

/** `value: null` = sem dado no minuto (a linha fica com uma lacuna; a coluna não aparece). */
export type ChartPoint = { at: string; value: number | null }

type Props = {
  title: string
  points: ChartPoint[]
  kind: 'column' | 'line'
  /** Texto do valor (ex.: "12", "340 ms"). */
  format: (value: number) => string
  /** Valores inteiros (contagens): marcas do eixo só em inteiros. */
  integer?: boolean
  /** Texto exibido no lugar do gráfico quando não há nenhum valor acima de zero. */
  emptyText?: string
}

const height = 150
const pad = { top: 12, right: 8, bottom: 22, left: 48 }

function timeLabel(value: string) {
  return new Date(value).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

function niceMax(value: number, integer: boolean) {
  if (value <= 0) return integer ? 2 : 1
  const magnitude = 10 ** Math.floor(Math.log10(value))
  const nice = Math.ceil(value / magnitude) * magnitude
  return integer ? Math.max(2, Math.ceil(nice / 2) * 2) : nice
}

/**
 * Gráfico de uma série (sem legenda: o título nomeia a série). Colunas finas com cantos de 4px no topo e base reta,
 * ou linha de 2px com lacunas onde não há dado; grade discreta; dica por marca ao passar o mouse ou com as setas do
 * teclado; a mesma série em tabela logo abaixo. O desenho usa a largura real (texto do eixo no tamanho certo).
 */
export function MiniChart({ title, points, kind, format, integer = false, emptyText }: Props) {
  const { t } = useI18n()
  const titleId = useId()
  const plotRef = useRef<HTMLDivElement | null>(null)
  const [width, setWidth] = useState(600)
  const [active, setActive] = useState<number | null>(null)

  useEffect(() => {
    const element = plotRef.current
    if (!element) return
    const update = () => setWidth(Math.max(240, Math.round(element.clientWidth)))
    update()
    const observer = new ResizeObserver(update)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const values = points.map((point) => point.value ?? 0)
  const hasData = values.some((value) => value > 0)
  const max = useMemo(() => niceMax(Math.max(0, ...values), integer), [values.join(','), integer])
  const plotWidth = width - pad.left - pad.right
  const plotHeight = height - pad.top - pad.bottom
  const step = plotWidth / Math.max(1, points.length)
  const barWidth = Math.min(24, Math.max(2, step - 2))
  const x = (index: number) => pad.left + step * index + step / 2
  const y = (value: number) => pad.top + plotHeight - (value / max) * plotHeight
  const baseline = pad.top + plotHeight
  const ticks = [0, max / 2, max].filter((value) => !integer || Number.isInteger(value))

  function indexFromPointer(event: PointerEvent<SVGSVGElement>) {
    const box = event.currentTarget.getBoundingClientRect()
    if (!points.length || !box.width) return null
    const relative = ((event.clientX - box.left) / box.width) * width - pad.left
    return Math.min(points.length - 1, Math.max(0, Math.floor(relative / step)))
  }

  function onKeyDown(event: KeyboardEvent<SVGSVGElement>) {
    if (!points.length) return
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault()
      const current = active ?? (event.key === 'ArrowRight' ? -1 : points.length)
      setActive(Math.min(points.length - 1, Math.max(0, current + (event.key === 'ArrowRight' ? 1 : -1))))
    }
    if (event.key === 'Escape') setActive(null)
  }

  const columnPath = (index: number, value: number) => {
    if (value <= 0) return ''
    const top = y(value)
    const left = x(index) - barWidth / 2
    const radius = Math.min(4, barWidth / 2, baseline - top)
    return `M${left},${baseline} V${top + radius} Q${left},${top} ${left + radius},${top} H${left + barWidth - radius} Q${left + barWidth},${top} ${left + barWidth},${top + radius} V${baseline} Z`
  }

  // Cada trecho contínuo com dado vira um segmento; minutos sem dado interrompem a linha.
  const linePath = points
    .map((point, index) => {
      if (point.value == null) return ''
      const previous = points[index - 1]
      return `${index === 0 || previous?.value == null ? 'M' : 'L'}${x(index)},${y(point.value)}`
    })
    .join(' ')
  // Um minuto com dado entre dois sem dado não forma segmento: vira um ponto para continuar visível.
  const isolated = points
    .map((point, index) => ({ point, index }))
    .filter(({ point, index }) => point.value != null && points[index - 1]?.value == null && points[index + 1]?.value == null)
  const activePoint = active != null ? points[active] : null
  const tooltipLeft = active != null && x(active) > width / 2

  return (
    <figure className="viz-root mini-chart">
      <figcaption id={titleId}>{title}</figcaption>
      <div className="mini-chart-plot" ref={plotRef}>
        <svg
          viewBox={`0 0 ${width} ${height}`}
          width={width}
          height={height}
          role="img"
          aria-labelledby={titleId}
          tabIndex={0}
          onPointerMove={(event) => setActive(indexFromPointer(event))}
          onPointerLeave={() => setActive(null)}
          onKeyDown={onKeyDown}
          onBlur={() => setActive(null)}
        >
          {ticks.map((value) => (
            <g key={value}>
              <line className="viz-grid" x1={pad.left} x2={width - pad.right} y1={y(value)} y2={y(value)} />
              <text className="viz-axis" x={pad.left - 6} y={y(value) + 4} textAnchor="end">{format(value)}</text>
            </g>
          ))}
          {points.length > 0 && (
            <>
              <text className="viz-axis" x={x(0)} y={height - 6} textAnchor="start">{timeLabel(points[0].at)}</text>
              <text className="viz-axis" x={x(points.length - 1)} y={height - 6} textAnchor="end">{timeLabel(points[points.length - 1].at)}</text>
            </>
          )}
          {kind === 'column'
            ? points.map((point, index) => (
                <path key={point.at} className={`viz-mark ${active === index ? 'active' : ''}`} d={columnPath(index, point.value ?? 0)} />
              ))
            : (
              <>
                <path className="viz-line" d={linePath} />
                {isolated.map(({ point, index }) => <circle key={point.at} className="viz-dot" cx={x(index)} cy={y(point.value ?? 0)} r={3} />)}
              </>
            )}
          {activePoint && active != null && (
            <g className="viz-hover" aria-hidden="true">
              <line className="viz-crosshair" x1={x(active)} x2={x(active)} y1={pad.top} y2={baseline} />
              {kind === 'line' && activePoint.value != null && <circle className="viz-dot" cx={x(active)} cy={y(activePoint.value)} r={4} />}
            </g>
          )}
        </svg>
        {!hasData && emptyText && <p className="viz-empty">{emptyText}</p>}
        {activePoint && active != null && (
          <div className={`viz-tooltip ${tooltipLeft ? 'left' : 'right'}`} role="status" style={{ left: `${x(active)}px`, top: `${pad.top}px` }}>
            <strong>{activePoint.value == null ? t('sem dados') : format(activePoint.value)}</strong>
            <span>{timeLabel(activePoint.at)}</span>
          </div>
        )}
      </div>
      <details className="viz-table">
        <summary>{t('Ver dados em tabela')}</summary>
        <table>
          <thead><tr><th scope="col">{t('Minuto')}</th><th scope="col">{title}</th></tr></thead>
          <tbody>
            {points.filter((point) => point.value != null && point.value > 0).map((point) => (
              <tr key={point.at}><td>{timeLabel(point.at)}</td><td>{format(point.value ?? 0)}</td></tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  )
}
