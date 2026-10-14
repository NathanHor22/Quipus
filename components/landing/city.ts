export type CityDestination = "device" | "capture" | "understand" | "follow-up" | "history" | "about" | "privacy" | "terms";
export type ProductFeature = "microphone" | "screen" | "speaker" | "storage" | "charging";

export const CITY_DESTINATIONS = [
  { id: "device", label: "Introducing Quipus", position: [8, 0, 14], height: 11 },
  { id: "capture", label: "Be in the conversation", position: [-13, 0, -3], height: 9 },
  { id: "understand", label: "Know what matters", position: [-1, 0, -16], height: 15 },
  { id: "follow-up", label: "Keep the momentum", position: [27, 0, 1], height: 12 },
  { id: "history", label: "Remember the person", position: [27, 0, -25], height: 19 },
  { id: "about", label: "About Quipus", position: [38, 0, -38], height: 13 },
  { id: "privacy", label: "Privacy", position: [51, 0, -17], height: 12 },
  { id: "terms", label: "Terms", position: [50, 0, 15], height: 10 },
] as const satisfies readonly {
  id: CityDestination;
  label: string;
  position: readonly [number, number, number];
  height: number;
}[];

export const PRODUCT_FEATURES = [
  { id: "microphone", label: "Microphone" },
  { id: "screen", label: "Touchscreen" },
  { id: "speaker", label: "Side speaker" },
  { id: "storage", label: "SD-card slot" },
  { id: "charging", label: "USB-C" },
] as const satisfies readonly { id: ProductFeature; label: string }[];
