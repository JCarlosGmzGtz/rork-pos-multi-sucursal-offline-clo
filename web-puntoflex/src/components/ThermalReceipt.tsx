import { useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";
import type { Sale, Branch } from "@/db/database";

function formatCurrency(n: number): string {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
  }).format(n);
}

function formatDate(ts: number): string {
  return new Intl.DateTimeFormat("es-MX", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(ts));
}

interface ThermalReceiptProps {
  sale: Sale;
  branch: Branch;
  branchUserName: string;
  businessEmail: string;
  /** Paper width in mm — 58 or 80. */
  widthMm: 58 | 80;
}

/** Column widths per paper size (characters). */
const COL_WIDTHS: Record<58 | 80, { name: number; qty: number; price: number }> = {
  58: { name: 20, qty: 5, price: 9 },
  80: { name: 28, qty: 6, price: 12 },
};

export default function ThermalReceipt({
  sale,
  branch,
  branchUserName,
  businessEmail,
  widthMm,
}: ThermalReceiptProps) {
  const [qrDataUrl, setQrDataUrl] = useState("");
  const receiptRef = useRef<HTMLDivElement>(null);

  const cols = COL_WIDTHS[widthMm];

  useEffect(() => {
    QRCode.toDataURL(sale.id, {
      width: 160,
      margin: 0,
      color: { dark: "#000000", light: "#ffffff" },
    })
      .then(setQrDataUrl)
      .catch(() => setQrDataUrl(""));
  }, [sale.id]);

  const totalWidth = useMemo(() => cols.name + cols.qty + cols.price, [cols]);

  /** Pad a string to a fixed length (monospace-safe). */
  const padRight = (s: string, len: number): string => {
    const stripped = s.replace(/[^\x20-\x7E]/g, "");
    if (stripped.length >= len) return stripped.slice(0, len);
    return stripped + " ".repeat(len - stripped.length);
  };

  const padLeft = (s: string, len: number): string => {
    const stripped = s.replace(/[^\x20-\x7E]/g, "");
    if (stripped.length >= len) return stripped.slice(0, len);
    return " ".repeat(len - stripped.length) + stripped;
  };

  const center = (s: string): string => {
    const stripped = s.replace(/[^\x20-\x7E]/g, "");
    if (stripped.length >= totalWidth) return stripped.slice(0, totalWidth);
    const pad = Math.floor((totalWidth - stripped.length) / 2);
    return " ".repeat(pad) + stripped;
  };

  const divider = "-".repeat(totalWidth);
  const thinDivider = "·".repeat(totalWidth);

  const headerLines = useMemo(() => {
    const lines: string[] = [];
    if (branch.name) lines.push(center(branch.name.toUpperCase()));
    if (branch.address) lines.push(center(branch.address));
    if (branch.phone) lines.push(center("Tel: " + branch.phone));
    if (businessEmail) lines.push(center(businessEmail));
    return lines;
  }, [branch, businessEmail, totalWidth]);

  const itemLines = useMemo(() => {
    const lines: string[] = [];
    // Header
    lines.push(
      padRight("ARTICULO", cols.name) +
        " " +
        padRight("CANT", cols.qty) +
        " " +
        padLeft("PRECIO", cols.price),
    );
    lines.push(divider);
    for (const item of sale.items) {
      const name = padRight(item.productName, cols.name);
      const qty = padRight(String(item.quantity), cols.qty);
      const price = padLeft(formatCurrency(item.subtotal), cols.price);
      lines.push(name + " " + qty + " " + price);
    }
    return lines;
  }, [sale.items, cols, divider]);

  return (
    <div
      id="thermal-receipt"
      ref={receiptRef}
      className="thermal-receipt"
      style={{
        width: `${widthMm}mm`,
        maxWidth: `${widthMm}mm`,
        fontFamily: "'Courier New', Courier, monospace",
        fontSize: "10px",
        lineHeight: "1.35",
        color: "#000",
        backgroundColor: "#fff",
        padding: "4mm 3mm",
        boxSizing: "border-box",
        whiteSpace: "pre",
        overflow: "hidden",
      }}
    >
      {/* Header */}
      {headerLines.map((line, i) => (
        <div key={`h-${i}`}>{line}</div>
      ))}
      <div>{divider}</div>
      <div>{center("TICKET DE VENTA")}</div>
      <div>
        {padRight("Folio: " + sale.id.slice(0, 12), totalWidth)}
      </div>
      <div>
        {padRight("Fecha: " + formatDate(sale.createdAt), totalWidth)}
      </div>
      <div>{padRight("Cajero: " + branchUserName, totalWidth)}</div>
      <div>{divider}</div>

      {/* Items */}
      {itemLines.map((line, i) => (
        <div key={`item-${i}`}>{line}</div>
      ))}
      <div>{divider}</div>

      {/* Totals */}
      <div>
        {padRight("SUBTOTAL", totalWidth - 12)}
        {padLeft(formatCurrency(sale.total), 12)}
      </div>
      <div>
        {padRight("TOTAL", totalWidth - 12)}
        {padLeft(formatCurrency(sale.total), 12)}
      </div>
      <div>{thinDivider}</div>

      {/* Payment */}
      <div>
        {padRight(
          "Pago: " +
            (sale.paymentMethod === "cash"
              ? "EFECTIVO"
              : sale.paymentMethod === "card"
                ? "TARJETA"
                : "TRANSFERENCIA"),
          totalWidth,
        )}
      </div>
      {sale.paymentMethod === "cash" && (
        <>
          <div>
            {padRight("Recibido", totalWidth - 12)}
            {padLeft(formatCurrency(sale.amountPaid), 12)}
          </div>
          <div>
            {padRight("Cambio", totalWidth - 12)}
            {padLeft(formatCurrency(sale.change), 12)}
          </div>
        </>
      )}

      <div>{divider}</div>

      {/* Thank you */}
      <div>{center("¡GRACIAS POR SU COMPRA!")}</div>
      <div>{center("PuntoFlex POS")}</div>
      <div>{divider}</div>

      {/* QR Code */}
      {qrDataUrl && (
        <div style={{ textAlign: "center", marginTop: "2mm" }}>
          <img
            src={qrDataUrl}
            alt="QR"
            style={{
              width: `${widthMm * 0.35}mm`,
              height: `${widthMm * 0.35}mm`,
              display: "inline-block",
            }}
          />
        </div>
      )}
    </div>
  );
}

/** Email body template — plain HTML matching the thermal ticket layout. */
export function buildEmailHtml(
  sale: Sale,
  branch: Branch,
  branchUserName: string,
  businessEmail: string,
): string {
  const itemsRows = sale.items
    .map(
      (item) => `
      <tr>
        <td style="padding:2px 8px;text-align:left;">${item.productName}</td>
        <td style="padding:2px 8px;text-align:center;">${item.quantity}</td>
        <td style="padding:2px 8px;text-align:right;">${formatCurrency(item.subtotal)}</td>
      </tr>`,
    )
    .join("");

  const paymentLabel =
    sale.paymentMethod === "cash"
      ? "Efectivo"
      : sale.paymentMethod === "card"
        ? "Tarjeta"
        : "Transferencia";

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>Ticket de Venta — ${branch.name}</title>
</head>
<body style="font-family:'Courier New',monospace;max-width:480px;margin:0 auto;padding:24px;color:#1e293b;background:#f8fafc;">
  <div style="background:#fff;border-radius:12px;padding:24px;box-shadow:0 1px 3px rgba(0,0,0,0.08);">

    <!-- Header -->
    <div style="text-align:center;margin-bottom:16px;">
      <h2 style="margin:0;font-size:18px;color:#0f172a;">${branch.name}</h2>
      ${branch.address ? `<p style="margin:4px 0;font-size:12px;color:#64748b;">${branch.address}</p>` : ""}
      ${branch.phone ? `<p style="margin:4px 0;font-size:12px;color:#64748b;">Tel: ${branch.phone}</p>` : ""}
    </div>

    <hr style="border:none;border-top:1px dashed #cbd5e1;margin:16px 0;">

    <!-- Ticket info -->
    <div style="font-size:12px;margin-bottom:16px;">
      <p style="margin:2px 0;"><strong>Folio:</strong> ${sale.id.slice(0, 12)}</p>
      <p style="margin:2px 0;"><strong>Fecha:</strong> ${formatDate(sale.createdAt)}</p>
      <p style="margin:2px 0;"><strong>Cajero:</strong> ${branchUserName}</p>
    </div>

    <hr style="border:none;border-top:1px dashed #cbd5e1;margin:16px 0;">

    <!-- Items table -->
    <table style="width:100%;font-size:12px;border-collapse:collapse;">
      <thead>
        <tr style="border-bottom:1px solid #e2e8f0;">
          <th style="padding:6px 8px;text-align:left;">Artículo</th>
          <th style="padding:6px 8px;text-align:center;">Cant</th>
          <th style="padding:6px 8px;text-align:right;">Precio</th>
        </tr>
      </thead>
      <tbody>
        ${itemsRows}
      </tbody>
    </table>

    <hr style="border:none;border-top:1px dashed #cbd5e1;margin:16px 0;">

    <!-- Totals -->
    <div style="font-size:14px;">
      <div style="display:flex;justify-content:space-between;margin:4px 0;">
        <span>TOTAL</span>
        <strong>${formatCurrency(sale.total)}</strong>
      </div>
      <div style="display:flex;justify-content:space-between;margin:4px 0;font-size:12px;color:#64748b;">
        <span>Método de pago</span>
        <span>${paymentLabel}</span>
      </div>
      ${sale.paymentMethod === "cash" ? `
      <div style="display:flex;justify-content:space-between;margin:4px 0;font-size:12px;color:#64748b;">
        <span>Recibido</span>
        <span>${formatCurrency(sale.amountPaid)}</span>
      </div>
      <div style="display:flex;justify-content:space-between;margin:4px 0;font-size:12px;color:#64748b;">
        <span>Cambio</span>
        <span>${formatCurrency(sale.change)}</span>
      </div>` : ""}
    </div>

    <hr style="border:none;border-top:1px dashed #cbd5e1;margin:16px 0;">

    <!-- Footer -->
    <div style="text-align:center;font-size:12px;color:#475569;">
      <p style="margin:4px 0;font-weight:600;">¡Gracias por su compra!</p>
      <p style="margin:4px 0;">PuntoFlex POS</p>
      <p style="margin:4px 0;font-size:10px;color:#94a3b8;">${businessEmail}</p>
    </div>

  </div>
</body>
</html>`;
}
