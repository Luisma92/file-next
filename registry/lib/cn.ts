/**
 * Local `cn` helper shim for the registry test environment.
 *
 * The shadcn-style registry items import `{ cn } from "@/lib/cn"`,
 * which the consumer's `components.json` resolves to their own
 * `lib/cn.ts`. In this repo's test environment we don't ship the
 * consumer app, so we provide an equivalent here.
 *
 * The shim matches the standard shadcn implementation (clsx +
 * tailwind-merge) so the tests exercise the same logic the consumer
 * will exercise at install time.
 */
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ReadonlyArray<ClassValue>): string {
  return twMerge(clsx(inputs));
}
