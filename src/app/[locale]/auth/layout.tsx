export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-[calc(100vh-8rem)] items-center justify-center bg-grid px-4 py-16">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_60%_60%_at_50%_40%,rgba(201,168,76,0.07),transparent)]" />
      <div className="relative w-full">{children}</div>
    </div>
  );
}
