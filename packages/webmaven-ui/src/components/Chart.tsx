import React, { useMemo } from 'react';
import {
  ResponsiveContainer,
  AreaChart, Area,
  LineChart, Line,
  BarChart, Bar,
  PieChart, Pie, Cell,
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  ScatterChart, Scatter,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';
import { colors } from '../foundation/tokens';
import s from './Chart.module.css';

const PALETTE = [colors.cyan, colors.blue, colors.purple, colors.mauve, colors.rose, colors.peach];

export interface ChartDataset {
  label: string;
  data: number[];
  color?: string;
}

export interface ChartAnnotation {
  type: 'line' | 'label';
  value: number;
  label: string;
  color?: string;
}

export interface ChartProps {
  type: string;
  data: {
    labels: string[];
    datasets: ChartDataset[];
  };
  title?: string;
  options?: {
    showLegend?: boolean;
    showGrid?: boolean;
    yAxisLabel?: string;
    y2AxisLabel?: string;
    aspectRatio?: number;
    stacked?: boolean;
    smooth?: boolean;
    horizontal?: boolean;
    annotations?: ChartAnnotation[];
    formatValue?: (value: number) => string;
    formatLabel?: (label: string) => string;
    [key: string]: any;
  };
  className?: string;
}

// Transform { labels, datasets } into recharts-compatible array of objects
function toRechartsData(labels: string[], datasets: ChartDataset[]): Record<string, any>[] {
  return labels.map((label, i) => {
    const point: Record<string, any> = { label };
    datasets.forEach((ds) => {
      point[ds.label] = ds.data[i] ?? 0;
    });
    return point;
  });
}

// Shared tooltip style
const tooltipStyle = {
  contentStyle: {
    background: 'var(--bg-raised)',
    border: '1px solid var(--glass-border)',
    borderRadius: '8px',
    boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
    color: 'var(--text)',
    fontSize: 13,
  },
  labelStyle: { color: 'var(--text)', fontWeight: 600, marginBottom: 4 },
  itemStyle: { color: 'var(--text)', fontSize: 12 },
};

const gridStroke = 'rgba(142, 133, 194, 0.12)';
const axisProps = {
  tick: { fill: 'var(--text-dim)', fontSize: 12 },
  axisLine: { stroke: gridStroke },
  tickLine: false as const,
};

export const Chart: React.FC<ChartProps> = ({ type, data, title, options = {}, className }) => {
  const {
    showLegend = false,
    showGrid = true,
    stacked = false,
    smooth = true,
    horizontal = false,
    formatValue,
    formatLabel,
  } = options;

  const rechartsData = useMemo(() => toRechartsData(data.labels, data.datasets), [data]);
  const height = options.aspectRatio ? undefined : 280;

  const labelFormatter = formatLabel || ((v: string) => v);
  const valueFormatter = formatValue || ((v: number) => v.toLocaleString());

  const renderChart = () => {
    switch (type) {
      case 'area':
        return (
          <AreaChart data={rechartsData} layout={horizontal ? 'vertical' : 'horizontal'}>
            {showGrid && <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />}
            <XAxis dataKey="label" tickFormatter={labelFormatter} {...axisProps} />
            <YAxis tickFormatter={valueFormatter} {...axisProps} />
            <Tooltip formatter={(v: any) => [valueFormatter(v), '']} labelFormatter={(l: any) => labelFormatter(String(l))} {...tooltipStyle} />
            {showLegend && <Legend />}
            {data.datasets.map((ds, i) => (
              <React.Fragment key={ds.label}>
                <defs>
                  <linearGradient id={`grad-${i}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={ds.color || PALETTE[i % PALETTE.length]} stopOpacity={0.25} />
                    <stop offset="95%" stopColor={ds.color || PALETTE[i % PALETTE.length]} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <Area
                  type={smooth ? 'monotone' : 'linear'}
                  dataKey={ds.label}
                  stroke={ds.color || PALETTE[i % PALETTE.length]}
                  strokeWidth={2}
                  fill={`url(#grad-${i})`}
                  stackId={stacked ? 'stack' : undefined}
                />
              </React.Fragment>
            ))}
          </AreaChart>
        );

      case 'line':
        return (
          <LineChart data={rechartsData}>
            {showGrid && <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />}
            <XAxis dataKey="label" tickFormatter={labelFormatter} {...axisProps} />
            <YAxis tickFormatter={valueFormatter} {...axisProps} />
            <Tooltip formatter={(v: any) => [valueFormatter(v), '']} labelFormatter={(l: any) => labelFormatter(String(l))} {...tooltipStyle} />
            {showLegend && <Legend />}
            {data.datasets.map((ds, i) => (
              <Line
                key={ds.label}
                type={smooth ? 'monotone' : 'linear'}
                dataKey={ds.label}
                stroke={ds.color || PALETTE[i % PALETTE.length]}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, strokeWidth: 0 }}
              />
            ))}
          </LineChart>
        );

      case 'bar':
        return (
          <BarChart data={rechartsData} layout={horizontal ? 'vertical' : 'horizontal'}>
            {showGrid && <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />}
            {horizontal ? (
              <>
                <YAxis dataKey="label" type="category" tickFormatter={labelFormatter} {...axisProps} width={100} />
                <XAxis type="number" tickFormatter={valueFormatter} {...axisProps} />
              </>
            ) : (
              <>
                <XAxis dataKey="label" tickFormatter={labelFormatter} {...axisProps} />
                <YAxis tickFormatter={valueFormatter} {...axisProps} />
              </>
            )}
            <Tooltip formatter={(v: any) => [valueFormatter(v), '']} labelFormatter={(l: any) => labelFormatter(String(l))} {...tooltipStyle} />
            {showLegend && <Legend />}
            {data.datasets.map((ds, i) => (
              <Bar
                key={ds.label}
                dataKey={ds.label}
                fill={ds.color || PALETTE[i % PALETTE.length]}
                radius={[4, 4, 0, 0]}
                stackId={stacked ? 'stack' : undefined}
              />
            ))}
          </BarChart>
        );

      case 'pie':
      case 'doughnut': {
        const pieData = data.labels.map((label, i) => ({
          name: label,
          value: data.datasets[0]?.data[i] ?? 0,
        }));
        const total = pieData.reduce((sum, d) => sum + d.value, 0);
        const innerRadius = type === 'doughnut' ? '55%' : 0;

        const pieSize = 200;
        const pieChart = (
            <PieChart width={pieSize} height={pieSize}>
              <Pie
                data={pieData}
                cx="50%"
                cy="50%"
                innerRadius={innerRadius}
                outerRadius="80%"
                paddingAngle={3}
                dataKey="value"
                nameKey="name"
                stroke="none"
                cornerRadius={4}
              >
                {pieData.map((_, i) => (
                  <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
                ))}
              </Pie>
              <Tooltip
                formatter={(v: any, name: any) => [valueFormatter(v), name]}
                {...tooltipStyle}
              />
            </PieChart>
        );

        const legend = (
          <div className={s.pieLegend}>
            {pieData.map((entry, i) => {
              const pct = total > 0 ? Math.round((entry.value / total) * 100) : 0;
              return (
                <div key={i} className={s.pieLegendItem}>
                  <div className={s.pieLegendLabel}>
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: PALETTE[i % PALETTE.length], flexShrink: 0 }} />
                    <span>{entry.name}</span>
                  </div>
                  <span className={s.pieLegendPct}>{pct}%</span>
                </div>
              );
            })}
          </div>
        );

        return (
          <div className={s.pieRow}>
            <div className={s.pieChart}>{pieChart}</div>
            {legend}
          </div>
        );
      }

      case 'radar': {
        const radarData = data.labels.map((label, i) => {
          const point: Record<string, any> = { subject: label };
          data.datasets.forEach((ds) => { point[ds.label] = ds.data[i] ?? 0; });
          return point;
        });
        return (
          <RadarChart data={radarData} cx="50%" cy="50%" outerRadius="75%">
            <PolarGrid stroke={gridStroke} />
            <PolarAngleAxis dataKey="subject" tick={{ fill: 'var(--text-dim)', fontSize: 11 }} />
            <PolarRadiusAxis tick={{ fill: 'var(--text-dim)', fontSize: 10 }} />
            {data.datasets.map((ds, i) => (
              <Radar
                key={ds.label}
                dataKey={ds.label}
                stroke={ds.color || PALETTE[i % PALETTE.length]}
                fill={ds.color || PALETTE[i % PALETTE.length]}
                fillOpacity={0.15}
                strokeWidth={2}
              />
            ))}
            <Tooltip {...tooltipStyle} />
            {showLegend && <Legend />}
          </RadarChart>
        );
      }

      case 'scatter':
        return (
          <ScatterChart>
            {showGrid && <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />}
            <XAxis dataKey="x" name="X" {...axisProps} />
            <YAxis dataKey="y" name="Y" {...axisProps} />
            <Tooltip cursor={{ strokeDasharray: '3 3' }} {...tooltipStyle} />
            {data.datasets.map((ds, i) => {
              const scatterData = ds.data.map((y, j) => ({ x: parseFloat(data.labels[j]) || j, y }));
              return (
                <Scatter
                  key={ds.label}
                  name={ds.label}
                  data={scatterData}
                  fill={ds.color || PALETTE[i % PALETTE.length]}
                />
              );
            })}
            {showLegend && <Legend />}
          </ScatterChart>
        );

      default:
        return (
          <div className={s.empty}>
            <span>Unsupported chart type: {type}</span>
          </div>
        );
    }
  };

  const isPie = type === 'pie' || type === 'doughnut';

  return (
    <div className={`${s.container} ${className || ''}`}>
      {title && <h4 className={s.title}>{title}</h4>}
      {isPie ? (
        renderChart()
      ) : (
        <div className={s.chart} style={height ? { height } : undefined}>
          <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={180}>
            {renderChart()}
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
};
