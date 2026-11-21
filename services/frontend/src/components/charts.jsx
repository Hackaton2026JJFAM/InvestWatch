// Wspólny styl wykresów: kolory z tokenów motywu (CSS), recesywne osie i siatka, własny tooltip i legenda.
import { useMemo } from 'react';
import { CartesianGrid, XAxis, YAxis } from 'recharts';
import { useResolvedTheme } from '../theme.jsx';

const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

// Kolory bieżącego motywu – przeliczane przy zmianie motywu.
export function useChartColors() {
  const theme = useResolvedTheme();
  return useMemo(() => ({
    theme,
    s1: css('--series-1'), s2: css('--series-2'), s3: css('--series-3'),
    grid: css('--grid'), axis: css('--axis'), surface: css('--chart-surface'), text: css('--text'), muted: css('--muted'),
  }), [theme]);
}

export const axisProps = (c) => ({ tick: { fill: c.axis, fontSize: 11 }, tickLine: false, axisLine: { stroke: c.grid }, tickMargin: 6 });
export const gridProps = (c, vertical = false) => ({ stroke: c.grid, strokeDasharray: '3 4', vertical, horizontal: !vertical });

export function ChartGrid({ c, vertical = false }) {
  return <CartesianGrid {...gridProps(c, vertical)} />;
}
export const X = (props) => <XAxis {...props} />;
export const Y = (props) => <YAxis {...props} />;

const fmt = (v) => (typeof v === 'number' ? v.toLocaleString('pl-PL', { maximumFractionDigits: 2 }) : v);

// Tooltip: tytuł + wiersze z próbką koloru serii; tekst w kolorach tekstu, nie serii.
export function ChartTooltip({ active, payload, label, labelFormatter, valueFormatter = fmt }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tip">
      {label !== undefined && <div className="t">{labelFormatter ? labelFormatter(label, payload) : label}</div>}
      {payload.map((p) => (
        <div className="r" key={p.dataKey ?? p.name}>
          <span className="k"><i className="sw" style={{ background: p.color ?? p.payload?.fill }} />{p.name}</span>
          <span className="v">{valueFormatter(p.value, p)}</span>
        </div>
      ))}
    </div>
  );
}

// Legenda nad wykresem (≥ 2 serie) – tożsamość nie tylko kolorem.
export function Legend({ items }) {
  return (
    <div className="chart-legend">
      {items.map((i) => <span key={i.label}><i style={{ background: i.color }} />{i.label}</span>)}
    </div>
  );
}

// Gradient wypełnienia dla wykresu warstwowego.
export function AreaGradient({ id, color }) {
  return (
    <defs>
      <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor={color} stopOpacity={0.32} />
        <stop offset="100%" stopColor={color} stopOpacity={0.02} />
      </linearGradient>
    </defs>
  );
}

export const cursorStyle = (c) => ({ stroke: c.axis, strokeDasharray: '3 3', strokeOpacity: 0.6 });
export const barCursor = (c) => ({ fill: c.grid, fillOpacity: 0.5 });
