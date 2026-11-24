import type { LucideIcon, LucideProps } from "lucide-react";

/** Render icons selected from status maps and other data-driven UI. */
export function InterfaceIcon({ icon: Icon, ...props }: LucideProps & { icon: LucideIcon }) {
  return <Icon {...props} />;
}
