import { AppWindow, Cable, HardDrive, Keyboard, Laptop, MemoryStick, Monitor, Network, Package, PcCase, Server, Smartphone, Zap, type LucideProps } from "lucide-react";

/** A drawing for each top-level category, for tiles and for products without a photo yet. */
const ICONS = {
  laptops: Laptop,
  desktops: PcCase,
  phones: Smartphone,
  monitors: Monitor,
  memory: MemoryStick,
  storage: HardDrive,
  networking: Network,
  servers: Server,
  power: Zap,
  cables: Cable,
  peripherals: Keyboard,
  "software-licences": AppWindow,
} as const;

export function CategoryIcon({ slug, ...props }: { slug: string | null | undefined } & LucideProps) {
  const Icon = (slug && ICONS[slug as keyof typeof ICONS]) || Package;
  return <Icon aria-hidden {...props} />;
}
