// Profile → Progress (#31): XP per day and words over time as plain SVG, one series each. Data: Stats.xpDays and db.wordDays.
import { useTranslation } from "react-i18next";
import { lastDays, runningTotal, today } from "./progress";

const W = 240, H = 120, L = 26, R = 6, T = 8, B = 18; // viewBox and plot padding
const PW = W - L - R, PH = H - T - B;

type Props = { title: string; summary: string; days: string[]; values: number[]; kind: "bar" | "line"; color: string; unit: string };

function Chart({ title, summary, days, values, kind, color, unit }: Props) {
  const { t, i18n } = useTranslation();
  const fmt = (d: string) => new Date(d + "T12:00").toLocaleDateString(i18n.language, { month: "short", day: "numeric" });
  const max = Math.max(1, ...values);
  const step = PW / days.length;
  const y = (v: number) => T + PH - (v / max) * PH;
  const x = (i: number) => L + step * i + step / 2;
  const label = (i: number) => `${fmt(days[i])}: ${values[i]} ${unit}`;
  const line = values.map((v, i) => `${i ? "L" : "M"}${x(i)},${y(v)}`).join("");
  const last = values.length - 1;
  return (
    <figure className="card chart">
      <figcaption><b>{title}</b><span className="muted small">{summary}</span></figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${title}. ${summary}`}>
        <g className="chart-axis">
          <line x1={L} x2={W - R} y1={T + PH} y2={T + PH} />
          <line x1={L} x2={W - R} y1={T} y2={T} strokeDasharray="2 3" />
          <text x={L - 6} y={T + 4} textAnchor="end">{max}</text>
          <text x={L - 6} y={T + PH + 4} textAnchor="end">0</text>
          <text x={L} y={H - 4}>{fmt(days[0])}</text>
          <text x={W - R} y={H - 4} textAnchor="end">{fmt(days[last])}</text>
        </g>
        {kind === "bar"
          ? values.map((v, i) => v > 0 && <path key={i} fill={color} d={bar(x(i) - step / 2 + 1, step - 2, y(v), T + PH)} />)
          : <>
            <path d={`${line}L${x(last)},${T + PH}L${x(0)},${T + PH}Z`} fill={color} opacity={0.12} />
            <path d={line} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" />
            <circle cx={x(last)} cy={y(values[last])} r={4} fill={color} stroke="var(--card)" strokeWidth={2} />
          </>}
        {/* Hover targets: one full-height column per day, wider than the mark. ponytail: native <title> tooltips */}
        {days.map((_, i) => <rect key={i} className="chart-hit" x={L + step * i} y={T} width={step} height={PH}><title>{label(i)}</title></rect>)}
      </svg>
      <details className="small muted">
        <summary>{t("progress.table")}</summary>
        <table className="chart-table"><tbody>
          {days.map((d, i) => <tr key={d}><td>{fmt(d)}</td><td>{values[i]} {unit}</td></tr>)}
        </tbody></table>
      </details>
    </figure>
  );
}

/** A bar from the baseline up to `top`, its top corners rounded 4px (data end only). */
function bar(x: number, w: number, top: number, base: number) {
  const r = Math.min(4, w / 2, base - top);
  return `M${x},${base}V${top + r}Q${x},${top} ${x + r},${top}H${x + w - r}Q${x + w},${top} ${x + w},${top + r}V${base}Z`;
}

export function ProgressCharts({ xpDays, wordDays }: { xpDays: Record<string, number>; wordDays: Record<string, number> }) {
  const { t } = useTranslation();
  const end = today();
  const xpRange = lastDays(end, 14), wordRange = lastDays(end, 30);
  const xp = xpRange.map((d) => xpDays[d] ?? 0);
  const words = runningTotal(wordDays, wordRange);
  const added = words[words.length - 1] - (words[0] - (wordDays[wordRange[0]] ?? 0));
  return (
    <div className="od-grid profile-cards" style={{ "--od-cols": 2, "--od-gap": "12px" } as React.CSSProperties}>
      <Chart title={t("progress.xpTitle")} summary={t("progress.xpSummary", { n: xp.reduce((a, b) => a + b, 0) })}
        days={xpRange} values={xp} kind="bar" color="var(--gold-dark)" unit="XP" />
      <Chart title={t("progress.wordsTitle")} summary={t("progress.wordsSummary", { n: words[words.length - 1], added })}
        days={wordRange} values={words} kind="line" color="var(--green)" unit={t("progress.words")} />
    </div>
  );
}
