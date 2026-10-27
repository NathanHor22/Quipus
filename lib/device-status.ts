/** Shared pairing eligibility: reset/history rows are never usable recorders. */
export type DeviceAvailability = {
  revoked_at?: string | null;
  reset?: { state: string } | null;
};

export function isActiveDevice(device: DeviceAvailability): boolean {
  return !device.revoked_at && !device.reset;
}

export function selectActiveDevice<T extends DeviceAvailability>(devices: readonly T[]): T | null {
  return devices.find(isActiveDevice) ?? null;
}
