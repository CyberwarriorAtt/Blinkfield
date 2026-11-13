import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export type SpectrumPoint = {
  wave: number;
  flux: number;
  epoch: string;
  detector: string;
  when: string;
};

export function SpectrumChart({ points }: { points: SpectrumPoint[] }) {
  const epochs = [...new Set(points.map((p) => p.epoch))];
  const dataMap = new Map<number, Record<string, number>>();
  for (const point of points) {
    const key = Math.round(point.wave * 1000) / 1000;
    const row = dataMap.get(key) ?? { wave: key };
    row[point.epoch] = point.flux;
    dataMap.set(key, row);
  }
  const data = [...dataMap.values()].sort((a, b) => Number(a.wave) - Number(b.wave));
  if (points.length < 2) {
    return (
      <p className="text-sm text-muted">
        Open a spectral scan to plot the central aperture across the six detectors. Two survey passes are drawn
        when both exist.
      </p>
    );
  }
  const colors = ["var(--color-ember)", "var(--color-fg)"];
  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="var(--color-line)" strokeDasharray="3 3" />
          <XAxis
            dataKey="wave"
            stroke="var(--color-muted)"
            tick={{ fill: "var(--color-muted)", fontSize: 12 }}
            tickFormatter={(v: number) => v.toFixed(1)}
            label={{ value: "μm", position: "insideBottomRight", fill: "var(--color-muted)", fontSize: 12 }}
          />
          <YAxis
            stroke="var(--color-muted)"
            tick={{ fill: "var(--color-muted)", fontSize: 12 }}
            width={46}
            tickFormatter={(v: number) => v.toFixed(2)}
          />
          <Tooltip
            contentStyle={{
              background: "var(--color-surface)",
              border: "1px solid var(--color-line)",
              color: "var(--color-fg)",
              fontSize: 12,
            }}
            formatter={(value) =>
              typeof value === "number" ? value.toFixed(3) : String(value ?? "")
            }
          />
          {epochs.map((epoch, i) => (
            <Line
              key={epoch}
              type="monotone"
              dataKey={epoch}
              name={epoch}
              stroke={colors[i % colors.length]}
              strokeWidth={2}
              dot={{ r: 3, strokeWidth: 0, fill: colors[i % colors.length] }}
              connectNulls
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
