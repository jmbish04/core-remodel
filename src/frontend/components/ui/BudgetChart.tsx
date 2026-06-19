import React from "react";

interface ChartDataPoint {
  label: string;
  min: number;
  avg: number;
  max: number;
}

interface BudgetChartProps {
  data: ChartDataPoint[];
  cap: number;
}

export function BudgetChart({ data, cap }: BudgetChartProps) {
  if (!data || data.length === 0) return null;

  // Compute running cumulative sums
  let runningMin = 0;
  let runningAvg = 0;
  let runningMax = 0;

  const cumulativeData = data.map((d) => {
    runningMin += d.min;
    runningAvg += d.avg;
    runningMax += d.max;
    return {
      label: d.label,
      min: runningMin,
      avg: runningAvg,
      max: runningMax,
    };
  });

  const maxVal = Math.max(...cumulativeData.map((d) => d.max), cap) * 1.1;
  const minVal = 0;
  const range = maxVal - minVal;

  const height = 220;
  const width = 600;
  const padding = { top: 20, right: 20, bottom: 40, left: 60 };

  const getX = (index: number) => {
    if (cumulativeData.length <= 1) return padding.left;
    return padding.left + (index / (cumulativeData.length - 1)) * (width - padding.left - padding.right);
  };

  const getY = (value: number) => {
    return padding.top + (1 - (value - minVal) / range) * (height - padding.top - padding.bottom);
  };

  // Generate coordinate paths for cumulative lines
  const pointsMin = cumulativeData.map((d, i) => `${getX(i)},${getY(d.min)}`).join(" ");
  const pointsAvg = cumulativeData.map((d, i) => `${getX(i)},${getY(d.avg)}`).join(" ");
  const pointsMax = cumulativeData.map((d, i) => `${getX(i)},${getY(d.max)}`).join(" ");

  const capY = getY(cap);

  return (
    <div className="w-full bg-zinc-900/40 border border-zinc-800/80 rounded-2xl p-5 shadow-xl relative overflow-hidden group hover:border-zinc-700/80 transition-all duration-300">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6 border-b border-zinc-800 pb-4">
        <div>
          <h4 className="text-sm font-bold text-white tracking-wide">Cumulative Cost Build-up vs. Cap Ceiling</h4>
          <p className="text-[11px] text-zinc-500">Live accumulative projection of construction phases against the $300k budget.</p>
        </div>
        <div className="flex flex-wrap gap-3 text-[10px] font-semibold">
          <span className="flex items-center gap-1.5 text-zinc-400">
            <span className="w-2.5 h-2.5 rounded bg-emerald-500" />
            Optimistic Total (Min)
          </span>
          <span className="flex items-center gap-1.5 text-zinc-400">
            <span className="w-2.5 h-2.5 rounded bg-emerald-400" />
            Realistic Total (Avg)
          </span>
          <span className="flex items-center gap-1.5 text-zinc-400">
            <span className="w-2.5 h-2.5 rounded bg-amber-500" />
            Risk Total (Max)
          </span>
          <span className="flex items-center gap-1.5 text-red-400">
            <span className="w-2.5 h-1 border-t-2 border-dashed border-red-500" />
            $300k Budget Cap
          </span>
        </div>
      </div>

      <div className="relative w-full h-[220px]">
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-full overflow-visible">
          {/* Y Axis Grid lines */}
          {[0, 0.25, 0.5, 0.75, 1].map((p, idx) => {
            const val = minVal + p * range;
            const y = getY(val);
            return (
              <g key={idx} className="opacity-40">
                <line
                  x1={padding.left}
                  y1={y}
                  x2={width - padding.right}
                  y2={y}
                  stroke="#27272a"
                  strokeWidth="0.5"
                  strokeDasharray="4 4"
                />
                <text
                  x={padding.left - 8}
                  y={y + 3}
                  fill="#71717a"
                  fontSize="8"
                  textAnchor="end"
                  fontFamily="monospace"
                >
                  {new Intl.NumberFormat("en-US", {
                    style: "currency",
                    currency: "USD",
                    maximumFractionDigits: 0,
                    notation: "compact",
                  }).format(val)}
                </text>
              </g>
            );
          })}

          {/* X Axis Labels (Angled or offset slightly for fit) */}
          {cumulativeData.map((d, i) => (
            <text
              key={i}
              x={getX(i)}
              y={height - 12}
              fill="#71717a"
              fontSize="7.5"
              textAnchor="middle"
              className="font-sans font-medium"
            >
              {d.label}
            </text>
          ))}

          {/* Budget Cap Line */}
          <g>
            <line
              x1={padding.left}
              y1={capY}
              x2={width - padding.right}
              y2={capY}
              stroke="#ef4444"
              strokeWidth="1.5"
              strokeDasharray="5 5"
              className="animate-pulse"
            />
            <text
              x={width - padding.right}
              y={capY - 6}
              fill="#ef4444"
              fontSize="7.5"
              fontWeight="bold"
              textAnchor="end"
            >
              CAP CEILING ($300k)
            </text>
          </g>

          {/* Polyline Areas */}
          {cumulativeData.length > 1 && (
            <>
              {/* Optimistic Area */}
              <polyline
                fill="none"
                stroke="#10b981"
                strokeWidth="2"
                points={pointsMin}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              {/* Realistic Area */}
              <polyline
                fill="none"
                stroke="#34d399"
                strokeWidth="2.5"
                points={pointsAvg}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              {/* Contingency Risk Area */}
              <polyline
                fill="none"
                stroke="#f59e0b"
                strokeWidth="2"
                points={pointsMax}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </>
          )}

          {/* Data Points / Interaction dots */}
          {cumulativeData.map((d, i) => (
            <g key={i}>
              <circle
                cx={getX(i)}
                cy={getY(d.avg)}
                r="3.5"
                fill="#34d399"
                stroke="#09090b"
                strokeWidth="1.5"
                className="hover:scale-125 transition-transform"
              />
            </g>
          ))}
        </svg>
      </div>
    </div>
  );
}
