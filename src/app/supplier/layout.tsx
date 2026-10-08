import { Logo } from "@/components/ui/logo";

/** Pages for our suppliers: our brand and nothing of the shop around it. */
export default function SupplierLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-page">
      <header className="border-b border-line bg-raised">
        <div className="mx-auto flex max-w-4xl items-center px-4 py-3 md:px-6">
          <Logo lockupOnly />
        </div>
      </header>
      <main id="main" className="mx-auto max-w-4xl px-4 py-8 md:px-6 md:py-12">
        {children}
      </main>
    </div>
  );
}
