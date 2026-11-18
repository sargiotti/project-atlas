import { INK, PAPER, PIN_BODY, PIN_WINDOW, QUIET, TANGERINE, pinBox, qrPathD, type Qr } from "../lib/shareKit/qr";

/** Share-kit QR as React SVG elements (no HTML injection, vector at any print size). Same geometry as the SVG export. */
export default function QrSvg({ qr, label, className }: { qr: Qr; label: string; className?: string }) {
  const full = qr.size + QUIET * 2;
  const p = qr.knock ? pinBox(qr) : null;
  return (
    <svg className={className} viewBox={`0 0 ${full} ${full}`} role="img" aria-label={label} shapeRendering="crispEdges">
      <rect width={full} height={full} fill={PAPER} />
      <path transform={`translate(${QUIET} ${QUIET})`} d={qrPathD(qr)} fill={INK} />
      {p && (
        <g transform={`translate(${QUIET + p.x} ${QUIET + p.y}) scale(${p.side / 80})`}>
          <g fill={TANGERINE}>
            {PIN_BODY.map(([x, y, w, h]) => <rect key={`${x}-${y}`} x={x} y={y} width={w} height={h} />)}
          </g>
          <rect x={PIN_WINDOW[0]} y={PIN_WINDOW[1]} width={PIN_WINDOW[2]} height={PIN_WINDOW[3]} fill={INK} />
        </g>
      )}
    </svg>
  );
}
