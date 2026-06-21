import * as XLSX from "xlsx";
import type { Sale, InventoryMovement, Product, CashShift } from "@/db/database";

function formatCurrency(n: number): string {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
  }).format(n);
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleString("es-MX", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export interface BranchReportData {
  branchName: string;
  sales: Sale[];
  products: Product[];
  inventoryMovements: InventoryMovement[];
  cashShifts: CashShift[];
}

export interface EmployeeReportData {
  employeeName: string;
  branchName: string;
  role: string;
  sales: Sale[];
  cashShifts: CashShift[];
}

function buildSheet(data: (string | number)[][], sheetName: string, workbook: XLSX.WorkBook) {
  const ws = XLSX.utils.aoa_to_sheet(data);
  // Auto-width columns
  const colWidths: { wch: number }[] = [];
  for (const row of data) {
    for (let i = 0; i < row.length; i++) {
      const len = String(row[i] ?? "").length;
      colWidths[i] = { wch: Math.max(colWidths[i]?.wch ?? 10, Math.min(len + 2, 50)) };
    }
  }
  ws["!cols"] = colWidths;
  XLSX.utils.book_append_sheet(workbook, ws, sheetName);
}

export function generateBranchReport(data: BranchReportData): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();

  // ── Summary sheet ──
  const totalRevenue = data.sales.reduce((sum, s) => sum + s.total, 0);
  const cashSales = data.sales.filter((s) => s.paymentMethod === "cash");
  const cardSales = data.sales.filter((s) => s.paymentMethod === "card");
  const transferSales = data.sales.filter((s) => s.paymentMethod === "transfer");

  buildSheet(
    [
      [`REPORTE DE SUCURSAL: ${data.branchName}`],
      [`Generado: ${formatDate(Date.now())}`],
      [""],
      ["RESUMEN"],
      ["Total de ventas", data.sales.length],
      ["Ingresos totales", formatCurrency(totalRevenue)],
      ["Ventas en efectivo", cashSales.length, formatCurrency(cashSales.reduce((s, s2) => s + s2.total, 0))],
      ["Ventas con tarjeta", cardSales.length, formatCurrency(cardSales.reduce((s, s2) => s + s2.total, 0))],
      ["Ventas por transferencia", transferSales.length, formatCurrency(transferSales.reduce((s, s2) => s + s2.total, 0))],
      ["Productos en inventario", data.products.length],
      ["Traspasos registrados", data.inventoryMovements.length],
      ["Turnos de caja", data.cashShifts.length],
    ],
    "Resumen",
    wb,
  );

  // ── Sales sheet ──
  const salesRows: (string | number)[][] = [
    ["Fecha", "Folio", "Cajero", "Artículos", "Total", "Método de pago", "Cambio", "Email cliente"],
  ];
  for (const s of data.sales) {
    salesRows.push([
      formatDate(s.createdAt),
      s.id,
      s.branchUserId,
      s.items.map((i) => `${i.productName} x${i.quantity}`).join("; "),
      s.total,
      s.paymentMethod === "cash" ? "Efectivo" : s.paymentMethod === "card" ? "Tarjeta" : "Transferencia",
      s.change,
      s.customerEmail || "",
    ]);
  }
  buildSheet(salesRows, "Ventas", wb);

  // ── Products sheet ──
  const prodRows: (string | number)[][] = [
    ["Nombre", "Categoría", "Código", "Precio", "Costo", "Stock"],
  ];
  for (const p of data.products) {
    prodRows.push([p.name, p.category, p.barcode, p.price, p.cost, p.stock]);
  }
  buildSheet(prodRows, "Productos", wb);

  // ── Inventory movements sheet ──
  if (data.inventoryMovements.length > 0) {
    const movRows: (string | number)[][] = [
      ["Fecha", "Origen", "Destino", "Producto", "Cantidad", "Transferido por"],
    ];
    for (const m of data.inventoryMovements) {
      movRows.push([
        formatDate(m.createdAt),
        m.sourceBranchName,
        m.destBranchName,
        m.productName,
        m.quantity,
        m.transferredByName,
      ]);
    }
    buildSheet(movRows, "Traspasos", wb);
  }

  // ── Cash shifts sheet ──
  if (data.cashShifts.length > 0) {
    const shiftRows: (string | number)[][] = [
      ["Apertura", "Cierre", "Fondo inicial", "Ventas totales", "Efectivo declarado", "Diferencia", "Estado"],
    ];
    for (const cs of data.cashShifts) {
      shiftRows.push([
        formatDate(cs.openedAt),
        cs.closedAt > 0 ? formatDate(cs.closedAt) : "—",
        cs.initialCash,
        cs.totalSales,
        cs.declaredCash,
        cs.difference,
        cs.status === "open" ? "Abierto" : "Cerrado",
      ]);
    }
    buildSheet(shiftRows, "Turnos de Caja", wb);
  }

  return wb;
}

export function generateEmployeeReport(data: EmployeeReportData): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();

  const totalRevenue = data.sales.reduce((sum, s) => sum + s.total, 0);
  const cashSales = data.sales.filter((s) => s.paymentMethod === "cash");

  buildSheet(
    [
      [`REPORTE DE EMPLEADO: ${data.employeeName}`],
      [`Rol: ${data.role === "admin" ? "Administrador" : "Cajero"}`],
      [`Sucursal: ${data.branchName}`],
      [`Generado: ${formatDate(Date.now())}`],
      [""],
      ["RESUMEN"],
      ["Total de ventas", data.sales.length],
      ["Ingresos totales", formatCurrency(totalRevenue)],
      ["Ventas en efectivo", cashSales.length, formatCurrency(cashSales.reduce((s, s2) => s + s2.total, 0))],
      ["Turnos de caja", data.cashShifts.length],
      ["Turnos abiertos", data.cashShifts.filter((cs) => cs.status === "open").length],
      ["Turnos cerrados", data.cashShifts.filter((cs) => cs.status === "closed").length],
    ],
    "Resumen",
    wb,
  );

  // ── Sales sheet ──
  const salesRows: (string | number)[][] = [
    ["Fecha", "Folio", "Artículos", "Total", "Método de pago", "Cambio"],
  ];
  for (const s of data.sales) {
    salesRows.push([
      formatDate(s.createdAt),
      s.id,
      s.items.map((i) => `${i.productName} x${i.quantity}`).join("; "),
      s.total,
      s.paymentMethod === "cash" ? "Efectivo" : s.paymentMethod === "card" ? "Tarjeta" : "Transferencia",
      s.change,
    ]);
  }
  buildSheet(salesRows, "Ventas", wb);

  // ── Cash shifts sheet ──
  if (data.cashShifts.length > 0) {
    const shiftRows: (string | number)[][] = [
      ["Apertura", "Cierre", "Fondo inicial", "Ventas totales", "Efectivo declarado", "Diferencia", "Estado"],
    ];
    for (const cs of data.cashShifts) {
      shiftRows.push([
        formatDate(cs.openedAt),
        cs.closedAt > 0 ? formatDate(cs.closedAt) : "—",
        cs.initialCash,
        cs.totalSales,
        cs.declaredCash,
        cs.difference,
        cs.status === "open" ? "Abierto" : "Cerrado",
      ]);
    }
    buildSheet(shiftRows, "Turnos de Caja", wb);
  }

  return wb;
}

export function downloadExcel(wb: XLSX.WorkBook, filename: string) {
  XLSX.writeFile(wb, `${filename}.xlsx`, { bookType: "xlsx", type: "binary" });
}
