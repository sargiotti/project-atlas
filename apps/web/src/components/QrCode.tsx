import { useEffect, useState } from "react";

/**
 * QR code generated in the browser (no third-party QR service), drawn as SVG elements:
 * no data: URLs and no HTML injection, so it works under the strict CSP.
 */
export default function QrCode({ text, label }: { text: string; label: string }) {
  const [qr, setQr] = useState<{ size: number; d: string } | null>(null);

  useEffect(() => {
    let live = true;
    import("qrcode").then((mod) => {
      const QR: any = (mod as any).default ?? mod;
      const { modules } = QR.create(text, { errorCorrectionLevel: "M" });
      const n: number = modules.size;
      const data: ArrayLike<number> = modules.data;
      // One horizontal run of dark modules per path segment.
      let d = "";
      for (let y = 0; y < n; y++) {
        let x = 0;
        while (x < n) {
          if (!data[y * n + x]) { x++; continue; }
          const start = x;
          while (x < n && data[y * n + x]) x++;
          d += `M${start} ${y}h${x - start}v1h-${x - start}z`;
        }
      }
      if (live) setQr({ size: n, d });
    });
    return () => {
      live = false;
    };
  }, [text]);

  if (!qr) return <div className="qr qr-pending" aria-hidden="true" />;
  const quiet = 4;
  const full = qr.size + quiet * 2;
  return (
    <svg className="qr" viewBox={`${-quiet} ${-quiet} ${full} ${full}`} role="img" aria-label={label} shapeRendering="crispEdges">
      <rect x={-quiet} y={-quiet} width={full} height={full} fill="#ffffff" />
      <path d={qr.d} fill="#000000" />
    </svg>
  );
}
