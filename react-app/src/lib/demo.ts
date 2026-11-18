// Sample data for local development only (?demo). Never part of the published build.
import type { User } from "firebase/auth";
import type { Customer, Product, Transport } from "./data";

export const demoUser = { email: "demo@example.com", uid: "demo" } as unknown as User;

export const demoCustomers: Customer[] = [
  "AB Infinite", "Adeshivakeshva Rhythm House - Raichur", "Adil Mobile Center", "Amaresh - Gilesugur Camp", "Ashok Reddy - Mantralayam",
  "Badrinath Allundi - Raichur", "C Raghavendra", "Deepak", "K K Enterprise - Devadurga", "Kashi SLN", "Lokesh - Kallur",
  "Mallu Mobiles and Electronics - Pothnal", "Sri Durga Electronics - Manvi", "Vijay Radios - Lingasugur",
].map((name, i) => ({ id: "d" + i, name, mobile: i % 4 === 3 ? "" : "98" + String(45012345 + i * 7919).slice(0, 8) }));

export const demoProducts: Product[] = [
  ["Makwell - Stabilizer - Led Mini - 5 Yr.", "Makwell", 740], ["Makwell - Stabilizer - RF500VA - 5 Yr.", "Makwell", 890],
  ["Redpower - AC Stand - 2.8KG", "Redpower", 310], ["Redpower - Dual Arm Wallmount Tiltable - 26*55", "Redpower", 1450],
  ["Remote - AC", "Remote", 95], ["Remote - China - BPL Led - NVR", "Remote", 120], ["Haier - EI3V - C1 - White", "Haier", 2650],
  ["Impex - Mixer Grinder - 750 W", "Impex", 2150], ["CPPLUS - UNR - 108F (CP Plus NVR)", "CPPLUS", 0], ["Cable - Hdmi 3 mtrs 4k", "Cable", 180],
  ["Accessories - AAA Battery", "Accessories", 25], ["Goldmedal - Rapido Exhaust Fan - 225MM", "Goldmedal", 690],
].map(([name, category, price], i) => ({ id: "p" + i, name: String(name), category: String(category), price: Number(price) }));

export const demoTransports: Transport[] = [
  { id: "t1", name: "VRL Logistics", contactPerson: "Ramesh", phone: "9845012345", branch: "Raichur, Station Road" },
  { id: "t2", name: "Navata Road Transport", phone: "9123456780", branch: "Raichur" },
  { id: "t3", name: "Sri Durga Transport", phone: "9000011111", branch: "Manvi" },
];
