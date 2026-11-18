/*
 * Technically Social: theme decorations
 * Written by Himal Shrestha
 *
 * The small header piece at the top of each card. All four versions are drawn,
 * and globals.css only shows the one matching the current theme.
 * "label" is the page name used by the Secure and Blueprint versions.
 */

const tickerText =
  "TECHNICALLY SOCIAL ▲ LIVE  ·  FIDI ▲  ·  CYBERSECURITY ▲  ·  SOFTWARE ENG ▲  ·  IT ▲  ·  NETWORKING ▲  ·  ";

// Building heights (px) for the After hours skyline; true = lit window on top.
const skyline: [number, boolean][] = [
  [14, false], [24, false], [18, true], [30, false], [12, false], [22, true], [28, false], [16, false], [20, true],
];

export default function ThemeDecor({ label }: { label: string }) {
  return (
    <div aria-hidden="true">
      {/* Ticker: the text is written twice so the scroll loops with no gap. */}
      <div className="ts-decor ts-decor-ticker">
        <span className="ts-ticker-track">{tickerText}{tickerText}</span>
      </div>

      {/* Secure channel: a status line with a blinking cursor. */}
      <div className="ts-decor ts-decor-secure">
        [ secure channel · {label.toLowerCase()} · ok ]<span className="ts-cursor">▌</span>
      </div>

      {/* After hours: a mini FiDi skyline. */}
      <div className="ts-decor ts-decor-after-hours">
        <div className="ts-skyline">
          {skyline.map(([height, lit], i) => (
            <span key={i} className={lit ? "lit" : undefined} style={{ height }} />
          ))}
        </div>
      </div>

      {/* Blueprint: a spec-sheet label. */}
      <div className="ts-decor ts-decor-blueprint">SPEC · TECHNICALLY SOCIAL · {label.toUpperCase()} · REV B</div>
    </div>
  );
}
