import { useMemo } from "react";
import { encode } from "uqr";

/**
 * Draws a QR code as a single SVG path built from the module matrix. No HTML
 * strings are injected, so this cannot become an XSS vector. Always dark on
 * white, as scanners expect, whatever the page theme.
 */
export function QrCode({
  value,
  label,
  size = 208,
}: {
  value: string;
  label: string;
  size?: number;
}) {
  const { path, modules } = useMemo(() => {
    const qr = encode(value, { ecc: "M", border: 2 });
    const parts: string[] = [];
    qr.data.forEach((row, y) => {
      row.forEach((dark, x) => {
        if (dark) parts.push(`M${x} ${y}h1v1h-1z`);
      });
    });
    return { path: parts.join(""), modules: qr.size };
  }, [value]);

  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${modules} ${modules}`}
      width={size}
      height={size}
      shapeRendering="crispEdges"
      className="rounded-md bg-white"
    >
      <rect width={modules} height={modules} fill="#ffffff" />
      <path d={path} fill="#000000" />
    </svg>
  );
}
