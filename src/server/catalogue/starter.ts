import type { PrismaClient, SpecKind } from "@prisma/client";

/**
 * The categories in docs/ICTD_BUILD.md, with the specifications shoppers
 * filter by, added once to a new server. Staff change all of it at
 * /admin/categories; nothing here is read again after the first start.
 */

type F = [key: string, label: string, kind: SpecKind, extra?: { unit?: string; options?: string[]; highlight?: boolean; filterable?: boolean; mustMatch?: boolean }];
interface Starter {
  slug: string;
  name: string;
  description: string;
  fields: F[];
  children?: Omit<Starter, "children">[];
  suggests?: string[];
}

const OS = ["Windows 11 Home", "Windows 11 Pro", "macOS", "ChromeOS", "Linux", "No operating system"];
const MEMORY_TYPES = ["DDR4", "DDR5", "LPDDR4X", "LPDDR5", "LPDDR5X"];
const WIFI = ["Wi-Fi 5", "Wi-Fi 6", "Wi-Fi 6E", "Wi-Fi 7"];

const processor: F = ["processor", "Processor", "TEXT", { highlight: true }];
const memory: F = ["memory_gb", "Memory", "NUMBER", { unit: "GB", highlight: true }];
const memoryType: F = ["memory_type", "Memory type", "CHOICE", { options: MEMORY_TYPES, mustMatch: true }];
const storage: F = ["storage_gb", "Storage", "NUMBER", { unit: "GB", highlight: true }];
const storageType: F = ["storage_type", "Storage type", "CHOICE", { options: ["SSD", "Hard drive", "eMMC"] }];
const screen: F = ["screen_in", "Screen size", "NUMBER", { unit: "inch", highlight: true }];

export const STARTER_CATEGORIES: Starter[] = [
  {
    slug: "laptops",
    name: "Laptops",
    description: "Everyday notebooks, business laptops and workstations.",
    fields: [processor, memory, memoryType, storage, storageType, screen, ["os", "Operating system", "CHOICE", { options: OS }], ["graphics", "Graphics", "TEXT"], ["touchscreen", "Touchscreen", "YES_NO"], ["weight_kg", "Weight", "NUMBER", { unit: "kg", filterable: false }]],
    suggests: ["memory", "storage", "peripherals", "software-licences"],
  },
  {
    slug: "desktops",
    name: "Desktops",
    description: "Towers, small form factor and all-in-one computers.",
    fields: [processor, memory, memoryType, storage, storageType, ["form_factor", "Form factor", "CHOICE", { options: ["Tower", "Small form factor", "Mini", "All-in-one"] }], ["os", "Operating system", "CHOICE", { options: OS }], ["graphics", "Graphics", "TEXT"]],
    suggests: ["monitors", "memory", "storage", "peripherals", "software-licences"],
  },
  {
    slug: "phones",
    name: "Phones",
    description: "Current flagship models and dependable everyday phones.",
    fields: [storage, memory, screen, ["os", "Operating system", "CHOICE", { options: ["Android", "iOS"] }], ["network", "Network", "CHOICE", { options: ["4G", "5G"], highlight: true }], ["dual_sim", "Dual SIM", "YES_NO"], ["colour", "Colour", "TEXT"]],
    suggests: ["peripherals"],
  },
  {
    slug: "monitors",
    name: "Monitors",
    description: "Office, design and gaming displays.",
    fields: [
      screen,
      ["resolution", "Resolution", "CHOICE", { options: ["1920 x 1080", "2560 x 1440", "3440 x 1440", "3840 x 2160"], highlight: true }],
      ["refresh_hz", "Refresh rate", "NUMBER", { unit: "Hz" }],
      ["panel", "Panel", "CHOICE", { options: ["IPS", "VA", "TN", "OLED"] }],
      ["usb_c", "USB-C input", "YES_NO"],
      ["height_adjustable", "Height adjustable", "YES_NO"],
    ],
    suggests: ["cables"],
  },
  {
    slug: "storage",
    name: "Storage",
    description: "SSDs, hard drives and external drives.",
    fields: [["capacity_gb", "Capacity", "NUMBER", { unit: "GB", highlight: true }], ["interface", "Interface", "CHOICE", { options: ["SATA", "NVMe PCIe 3.0", "NVMe PCIe 4.0", "NVMe PCIe 5.0", "USB"], highlight: true }]],
    children: [
      { slug: "ssds", name: "SSDs", description: "Solid state drives.", fields: [["drive_form", "Form factor", "CHOICE", { options: ["2.5 inch", "M.2 2280", "M.2 2242", "M.2 2230"] }]] },
      { slug: "hard-drives", name: "Hard drives", description: "Internal hard drives for desktops, servers and NAS.", fields: [["rpm", "Speed", "NUMBER", { unit: "rpm" }]] },
      { slug: "external-drives", name: "External drives", description: "Portable and desktop external drives.", fields: [] },
    ],
  },
  {
    slug: "memory",
    name: "Memory",
    description: "RAM for laptops, desktops and servers.",
    fields: [["capacity_gb", "Capacity", "NUMBER", { unit: "GB", highlight: true }], memoryType, ["module", "Module", "CHOICE", { options: ["SO-DIMM", "DIMM", "RDIMM"], highlight: true }], ["speed_mts", "Speed", "NUMBER", { unit: "MT/s" }]],
  },
  {
    slug: "networking",
    name: "Networking",
    description: "Switches, routers, access points, Wi-Fi extenders and firewalls.",
    fields: [],
    suggests: ["cables", "power"],
    children: [
      { slug: "switches", name: "Switches", description: "Unmanaged, smart and managed switches.", fields: [["ports", "Ports", "NUMBER", { highlight: true }], ["port_speed", "Port speed", "CHOICE", { options: ["1 Gb", "2.5 Gb", "10 Gb"] }], ["management", "Management", "CHOICE", { options: ["Unmanaged", "Smart", "Managed"], highlight: true }], ["poe", "PoE", "YES_NO"]] },
      { slug: "routers", name: "Routers", description: "Routers for homes, branches and offices.", fields: [["wifi", "Wi-Fi", "CHOICE", { options: [...WIFI, "None"], highlight: true }], ["wan", "Internet connection", "TEXT"]] },
      { slug: "access-points", name: "Access points", description: "Indoor and outdoor wireless access points.", fields: [["wifi", "Wi-Fi", "CHOICE", { options: WIFI, highlight: true }], ["mount", "Mounting", "CHOICE", { options: ["Ceiling", "Wall", "Outdoor"] }], ["poe_powered", "Powered over Ethernet", "YES_NO"]] },
      { slug: "wifi-extenders", name: "Wi-Fi extenders", description: "Extenders and mesh units.", fields: [["wifi", "Wi-Fi", "CHOICE", { options: WIFI, highlight: true }]] },
      { slug: "firewalls", name: "Firewalls", description: "Firewalls and security appliances.", fields: [["throughput_mbps", "Firewall throughput", "NUMBER", { unit: "Mbps", highlight: true }], ["users", "Suggested users", "NUMBER"]] },
    ],
  },
  {
    slug: "cables",
    name: "Cables",
    description: "Network, display, USB and power cables.",
    fields: [["cable_type", "Type", "CHOICE", { options: ["Cat6", "Cat6a", "Fibre", "HDMI", "DisplayPort", "USB-C", "Power"], highlight: true }], ["length_m", "Length", "NUMBER", { unit: "m", highlight: true }]],
  },
  {
    slug: "power",
    name: "Power",
    description: "UPS units and power protection.",
    fields: [],
    children: [
      { slug: "ups", name: "UPS", description: "Uninterruptible power supplies.", fields: [["capacity_va", "Capacity", "NUMBER", { unit: "VA", highlight: true }], ["topology", "Type", "CHOICE", { options: ["Standby", "Line-interactive", "Online double conversion"], highlight: true }], ["mounting", "Form", "CHOICE", { options: ["Tower", "Rack"] }]] },
    ],
  },
  {
    slug: "peripherals",
    name: "Peripherals",
    description: "Keyboards, mice, headsets, webcams, docks and bags.",
    fields: [["kind", "Kind", "CHOICE", { options: ["Keyboard", "Mouse", "Keyboard and mouse", "Headset", "Webcam", "Docking station", "Bag", "Printer"], highlight: true }], ["connection", "Connection", "CHOICE", { options: ["Wired", "Wireless", "Bluetooth"] }]],
  },
  {
    slug: "servers",
    name: "Servers",
    description: "Tower and rack servers.",
    fields: [processor, memory, ["form_factor", "Form factor", "CHOICE", { options: ["Tower", "1U", "2U", "4U"], highlight: true }], ["drive_bays", "Drive bays", "NUMBER"]],
    suggests: ["memory", "storage", "power", "software-licences"],
  },
  {
    slug: "software-licences",
    name: "Software licences",
    description: "Operating systems, office and security software.",
    fields: [["licence", "Licence", "CHOICE", { options: ["Subscription", "Perpetual"], highlight: true }], ["term_months", "Term", "NUMBER", { unit: "months" }], ["users", "Users or devices", "NUMBER", { highlight: true }]],
  },
];

/** Adds the starting categories when there are none. Returns what it added. */
export async function seedStarterCategories(db: PrismaClient): Promise<string[]> {
  if (await db.category.count()) return [];
  const ids = new Map<string, string>();
  const make = async (c: Omit<Starter, "children">, parentId: string | null, sortOrder: number) => {
    const row = await db.category.create({ data: { slug: c.slug, name: c.name, description: c.description, parentId, sortOrder } });
    ids.set(c.slug, row.id);
    await db.specField.createMany({
      data: c.fields.map(([key, label, kind, x = {}], i) => ({ categoryId: row.id, key, label, kind, unit: x.unit ?? "", options: x.options ?? [], highlight: x.highlight ?? false, filterable: x.filterable ?? true, mustMatch: x.mustMatch ?? false, sortOrder: (i + 1) * 10 })),
    });
  };
  for (const [i, c] of STARTER_CATEGORIES.entries()) {
    await make(c, null, (i + 1) * 10);
    for (const [j, s] of (c.children ?? []).entries()) await make(s, ids.get(c.slug)!, (j + 1) * 10);
  }
  for (const c of STARTER_CATEGORIES) {
    const related = (c.suggests ?? []).map((s) => ids.get(s)).filter((x): x is string => Boolean(x));
    if (related.length) await db.categorySuggestion.createMany({ data: related.map((r) => ({ categoryId: ids.get(c.slug)!, relatedId: r })) });
  }
  return [`${ids.size} starting categories`];
}
