import { db } from "./database";

const DEFAULT_CATEGORIES = [
  "Bebidas",
  "Snacks",
  "Lácteos",
  "Panadería",
  "Limpieza",
  "Carnes",
  "Frutas",
  "Verduras",
];

const PRODUCT_NAMES: Record<string, string[]> = {
  Bebidas: [
    "Coca-Cola 600ml",
    "Pepsi 600ml",
    "Agua Mineral 1L",
    "Jugo de Naranja 500ml",
    "Gatorade 500ml",
    "Cerveza Corona 355ml",
    "Red Bull 250ml",
    "Lipton Ice Tea 500ml",
  ],
  Snacks: [
    "Papas Fritas 150g",
    "Doritos 180g",
    "Galletas Oreo",
    "Chocolate Snickers",
    "Palomitas 100g",
    "Nueces Mixtas 200g",
    "Barra Granola",
    "Cacahuates Japoneses",
  ],
  Lácteos: [
    "Leche Entera 1L",
    "Yogurt Natural 250g",
    "Queso Panela 400g",
    "Crema 250ml",
    "Mantequilla 200g",
    "Queso Oaxaca 400g",
    "Leche Deslactosada 1L",
    "Yogurt Griego 150g",
  ],
  Panadería: [
    "Pan Blanco Grande",
    "Bolillo",
    "Pan Dulce Concha",
    "Croissant",
    "Pan Integral",
    "Baguette",
    "Donas 2pk",
    "Cuernitos 4pk",
  ],
  Limpieza: [
    "Jabón Líquido 500ml",
    "Cloro 1L",
    "Detergente 1kg",
    "Limpiador Multiusos",
    "Papel Higiénico 4pk",
    "Servilletas 100pk",
    "Jabón de Manos",
    "Desinfectante en Spray",
  ],
  Carnes: [
    "Pechuga de Pollo 1kg",
    "Carne Molida 1kg",
    "Chuleta de Cerdo 1kg",
    "Bistec de Res 1kg",
    "Salchichas 8pk",
    "Jamón de Pavo 250g",
    "Tocino 200g",
    "Alitas de Pollo 1kg",
  ],
  Frutas: [
    "Manzana Roja 1kg",
    "Plátano 1kg",
    "Naranja 1kg",
    "Fresa 500g",
    "Uva Verde 1kg",
    "Mango 1kg",
    "Sandía Entera",
    "Papaya Entera",
  ],
  Verduras: [
    "Jitomate 1kg",
    "Cebolla Blanca 1kg",
    "Aguacate 1kg",
    "Lechuga Romana",
    "Zanahoria 1kg",
    "Papa Blanca 1kg",
    "Espinaca 250g",
    "Brócoli",
  ],
};

const DEMO_BRANCHES = [
  { name: "Sucursal Centro", address: "Av. Reforma 123, Centro", phone: "555-0101" },
  { name: "Sucursal Norte", address: "Calz. Vallejo 456, Norte", phone: "555-0202" },
  { name: "Sucursal Sur", address: "Av. Universidad 789, Sur", phone: "555-0303" },
];

const DEMO_BRANCH_USERS: Array<{ name: string; pin: string; role: "cajero" }> = [
  { name: "Ana García", pin: "123456", role: "cajero" },
  { name: "Carlos López", pin: "123456", role: "cajero" },
  { name: "María Hernández", pin: "123456", role: "cajero" },
  { name: "Pedro Ramírez", pin: "123456", role: "cajero" },
  { name: "Luisa Fernández", pin: "123456", role: "cajero" },
];

/** Default owner name — only used for demo mode since Firebase users auto-create their own owner. */
const DEMO_OWNER_NAME = "Admin Principal";

function generateId(): string {
  return crypto.randomUUID();
}

function randomPrice(min: number, max: number): number {
  return Math.round((Math.random() * (max - min) + min) * 100) / 100;
}

export async function seedDatabase(businessId?: string): Promise<void> {
  const bid = businessId ?? "demo-business";
  const existingBranches = await db.branches.where("businessId").equals(bid).count();
  if (existingBranches > 0) return;

  // Seed categories for this business
  for (const catName of DEFAULT_CATEGORIES) {
    await db.categories.add({
      id: generateId(),
      businessId: bid,
      name: catName,
      createdAt: Date.now(),
    });
  }

  // Create branches
  const branchIds: string[] = [];
  for (const b of DEMO_BRANCHES) {
    const id = generateId();
    branchIds.push(id);
    await db.branches.add({
      id,
      businessId: bid,
      name: b.name,
      address: b.address,
      phone: b.phone,
      createdAt: Date.now() - Math.random() * 90 * 24 * 60 * 60 * 1000,
    });
  }

  // Create the owner for demo mode (first branch, first user)
  const ownerId = generateId();
  await db.branchUsers.add({
    id: ownerId,
    businessId: bid,
    branchId: branchIds[0],
    name: DEMO_OWNER_NAME,
    pin: "123456",
    role: "admin",
    isOwner: true,
    accessibleBranchIds: [],
    createdAt: Date.now(),
  });

  // Create branch users per branch (skip the first branch for owner uniqueness)
  const branchUserEntries: Array<{ branchId: string; userId: string; name: string; role: "admin" | "cajero" }> = [];
  for (const branchId of branchIds) {
    const userCount = 1 + Math.floor(Math.random() * 2);
    const assigned: Set<number> = new Set();
    for (let u = 0; u < userCount; u++) {
      let idx: number;
      do {
        idx = Math.floor(Math.random() * DEMO_BRANCH_USERS.length);
      } while (assigned.has(idx) && assigned.size < DEMO_BRANCH_USERS.length);
      assigned.add(idx);
      const bu = DEMO_BRANCH_USERS[idx];
      const userId = generateId();
      branchUserEntries.push({ branchId, userId, name: bu.name, role: bu.role });
      await db.branchUsers.add({
        id: userId,
        businessId: bid,
        branchId,
        name: bu.name,
        pin: bu.pin,
        role: bu.role,
        isOwner: false,
        accessibleBranchIds: [branchId],
        createdAt: Date.now(),
      });
    }
  }

  // Create products for each branch
  const productIds: { id: string; name: string; price: number }[] = [];
  for (const branchId of branchIds) {
    for (const [category, names] of Object.entries(PRODUCT_NAMES)) {
      for (const name of names) {
        const id = generateId();
        const price = randomPrice(15, 250);
        productIds.push({ id, name, price });
        await db.products.add({
          id,
          businessId: bid,
          name,
          price,
          cost: Math.round(price * 0.65 * 100) / 100,
          barcode: `750${String(Math.floor(Math.random() * 10000000000)).padStart(10, "0")}`,
          category,
          stock: Math.floor(Math.random() * 200) + 10,
          branchId,
          imageUrl: "",
          createdAt: Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000,
        });
      }
    }
  }

  // Create sample sales for the last 7 days
  for (const branchId of branchIds) {
    for (let d = 6; d >= 0; d--) {
      const salesCount = Math.floor(Math.random() * 15) + 5;
      for (let i = 0; i < salesCount; i++) {
        const itemCount = Math.floor(Math.random() * 5) + 1;
        const items: { productId: string; productName: string; quantity: number; unitPrice: number; subtotal: number }[] = [];
        let total = 0;

        const shuffled = [...productIds].sort(() => Math.random() - 0.5).slice(0, itemCount);
        for (const p of shuffled) {
          const qty = Math.floor(Math.random() * 3) + 1;
          const subtotal = Math.round(p.price * qty * 100) / 100;
          total += subtotal;
          items.push({
            productId: p.id,
            productName: p.name,
            quantity: qty,
            unitPrice: p.price,
            subtotal,
          });
        }

        const paymentMethods: Array<"cash" | "card" | "transfer"> = ["cash", "card", "transfer"];
        const pm = paymentMethods[Math.floor(Math.random() * 3)];
        const amountPaid = pm === "cash" ? Math.ceil(total / 50) * 50 : total;

        const dayMs = d * 24 * 60 * 60 * 1000;
        const saleTime = Date.now() - dayMs - Math.random() * 12 * 60 * 60 * 1000;

        // Pick a random branch user from this branch to be the cashier
        const branchUserPool = branchUserEntries.filter((e) => e.branchId === branchId);
        const cashierId = branchUserPool.length > 0
          ? branchUserPool[Math.floor(Math.random() * branchUserPool.length)].userId
          : ownerId;

        await db.sales.add({
          id: generateId(),
          businessId: bid,
          branchId,
          branchUserId: cashierId,
          items,
          total: Math.round(total * 100) / 100,
          paymentMethod: pm,
          amountPaid,
          change: pm === "cash" ? Math.round((amountPaid - total) * 100) / 100 : 0,
          customerEmail: "",
          shiftId: "",
          createdAt: saleTime,
          synced: 1,
        });
      }
    }
  }
}
