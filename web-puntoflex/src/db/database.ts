import Dexie, { type Table } from "dexie";

export interface Branch {
  id: string;
  businessId: string;
  name: string;
  address: string;
  phone: string;
  createdAt: number;
}

export interface BranchUser {
  id: string;
  businessId: string;
  branchId: string;
  name: string;
  pin: string;
  role: "admin" | "cajero";
  /** True for the Firebase account owner — has full access to all branches. */
  isOwner: boolean;
  /** Branch IDs this user can access. Empty array = all branches (owner/admins). */
  accessibleBranchIds: string[];
  createdAt: number;
}

export interface BusinessCategory {
  id: string;
  businessId: string;
  name: string;
  createdAt: number;
}

export interface Product {
  id: string;
  businessId: string;
  branchId: string;
  name: string;
  price: number;
  cost: number;
  barcode: string;
  category: string;
  stock: number;
  imageUrl: string;
  createdAt: number;
}

export interface SaleItem {
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  subtotal: number;
}

export interface CashShift {
  id: string;
  businessId: string;
  branchId: string;
  branchUserId: string;
  initialCash: number;
  totalSales: number;
  declaredCash: number;
  difference: number;
  status: "open" | "closed";
  openedAt: number;
  closedAt: number;
  synced: number;
}

export interface InventoryMovement {
  id: string;
  businessId: string;
  sourceBranchId: string;
  sourceBranchName: string;
  destBranchId: string;
  destBranchName: string;
  productId: string;
  productName: string;
  quantity: number;
  transferredBy: string;
  transferredByName: string;
  createdAt: number;
}

export interface Sale {
  id: string;
  businessId: string;
  branchId: string;
  /** The employee/cashier who made this sale. */
  branchUserId: string;
  /** The cash shift this sale belongs to. */
  shiftId: string;
  items: SaleItem[];
  total: number;
  paymentMethod: "cash" | "card" | "transfer";
  amountPaid: number;
  change: number;
  /** Optional customer email for sending the receipt. */
  customerEmail: string;
  createdAt: number;
  synced: number;
}

export class PuntoFlexDB extends Dexie {
  branches!: Table<Branch, string>;
  branchUsers!: Table<BranchUser, string>;
  categories!: Table<BusinessCategory, string>;
  products!: Table<Product, string>;
  sales!: Table<Sale, string>;
  cashShifts!: Table<CashShift, string>;
  inventoryMovements!: Table<InventoryMovement, string>;

  constructor() {
    super("PuntoFlexDB");
    this.version(6).stores({
      branches: "id, businessId, name",
      branchUsers: "id, businessId, branchId, isOwner",
      categories: "id, businessId, name",
      products: "id, businessId, branchId, name, category, barcode",
      sales: "id, businessId, branchId, branchUserId, shiftId, createdAt, synced",
      cashShifts: "id, businessId, branchId, branchUserId, status, openedAt",
      inventoryMovements: "id, businessId, sourceBranchId, destBranchId, productId, createdAt",
    });

    this.version(7).stores({
      branches: "id, businessId, name",
      branchUsers: "id, businessId, branchId, isOwner",
      categories: "id, businessId, name",
      products: "id, businessId, branchId, name, category, barcode",
      sales: "id, businessId, branchId, branchUserId, shiftId, createdAt, synced",
      cashShifts: "id, businessId, branchId, branchUserId, status, openedAt",
      inventoryMovements: "id, businessId, sourceBranchId, destBranchId, productId, createdAt",
    }).upgrade((tx) => {
      return tx.table("sales").toCollection().modify((sale: Sale) => {
        if (sale.shiftId === undefined) sale.shiftId = "";
      });
    });

    // v8: Clean up old demo data — ensure only the real owner has isOwner:true per business
    this.version(8).stores({
      branches: "id, businessId, name",
      branchUsers: "id, businessId, branchId, isOwner",
      categories: "id, businessId, name",
      products: "id, businessId, branchId, name, category, barcode",
      sales: "id, businessId, branchId, branchUserId, shiftId, createdAt, synced",
      cashShifts: "id, businessId, branchId, branchUserId, status, openedAt",
      inventoryMovements: "id, businessId, sourceBranchId, destBranchId, productId, createdAt",
    }).upgrade(async (tx) => {
      // For each businessId, keep only ONE owner (the first one found by createdAt).
      // Demote all other isOwner entries and fix demo-name users.
      const DEMO_NAMES = new Set([
        "Ana García", "Carlos López", "María Hernández",
        "Pedro Ramírez", "Luisa Fernández",
      ]);
      const allUsers = await tx.table("branchUsers").toArray();
      // Group by businessId
      const byBusiness = new Map<string, BranchUser[]>();
      for (const u of allUsers) {
        const list = byBusiness.get(u.businessId) || [];
        list.push(u);
        byBusiness.set(u.businessId, list);
      }
      for (const [, users] of byBusiness) {
        const owners = users.filter((u) => u.isOwner);
        // If multiple owners exist, keep only the oldest one
        if (owners.length > 1) {
          owners.sort((a, b) => a.createdAt - b.createdAt);
          const [keep, ...demote] = owners;
          console.log(`[DB v8] Business ${keep.businessId}: keeping owner "${keep.name}", demoting ${demote.length} duplicate(s)`);
          for (const u of demote) {
            await tx.table("branchUsers").update(u.id, { isOwner: false, role: "cajero" as const });
          }
        }
        // Fix demo-name users
        for (const u of users) {
          if (DEMO_NAMES.has(u.name)) {
            await tx.table("branchUsers").update(u.id, { isOwner: false, role: "cajero" as const });
          }
        }
      }
    });

    // Legacy versions kept for migration path
    this.version(4).stores({
      branches: "id, businessId, name",
      branchUsers: "id, businessId, branchId, isOwner",
      categories: "id, businessId, name",
      products: "id, businessId, branchId, name, category, barcode",
      sales: "id, businessId, branchId, branchUserId, createdAt, synced",
    }).upgrade((tx) => {
      return tx.table("branchUsers").toCollection().modify((user: BranchUser) => {
        if (user.isOwner === undefined) user.isOwner = false;
        if (user.accessibleBranchIds === undefined) user.accessibleBranchIds = [];
      }).then(() =>
        tx.table("sales").toCollection().modify((sale: Sale) => {
          if (sale.branchUserId === undefined) sale.branchUserId = "";
        })
      );
    });

    this.version(5).stores({
      branches: "id, businessId, name",
      branchUsers: "id, businessId, branchId, isOwner",
      categories: "id, businessId, name",
      products: "id, businessId, branchId, name, category, barcode",
      sales: "id, businessId, branchId, branchUserId, createdAt, synced",
    }).upgrade((tx) => {
      return tx.table("sales").toCollection().modify((sale: Sale) => {
        if (sale.customerEmail === undefined) sale.customerEmail = "";
      });
    });
  }
}

export const db = new PuntoFlexDB();
