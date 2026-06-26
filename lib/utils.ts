import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { baseToHuman } from './coin-config';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Format base-unit amount as a human decimal string. Reads COIN_DECIMALS from env. */
export function formatSui(base: string | number | bigint, displayDecimals = 4): string {
  return baseToHuman(base, displayDecimals);
}

export function shortenAddress(addr: string, chars = 6): string {
  if (addr.length <= chars * 2 + 2) return addr;
  return `${addr.slice(0, chars)}…${addr.slice(-4)}`;
}

export function relativeTime(timestampMs: string | undefined): string {
  if (!timestampMs) return '';
  const diff = Date.now() - Number(timestampMs);
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
