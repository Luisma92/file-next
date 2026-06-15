import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 Merge Tailwind CSS classes with conflict resolution.
 Mirrors shadcn/ui's `cn` utility so consumers get a familiar DX.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
