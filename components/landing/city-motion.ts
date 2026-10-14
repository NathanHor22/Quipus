export type RoadPoint = Readonly<{ x: number; z: number }>;
export type RoadSegment = Readonly<{
  start: RoadPoint;
  end: RoadPoint;
  length: number;
  axis: "x" | "z";
  lightOffset: number;
}>;
export type RoadRoute = Readonly<{ segments: readonly RoadSegment[]; length: number }>;
export type TrafficColour = "green" | "amber" | "red";

export function roadRoute(points: readonly RoadPoint[], offset = 0): RoadRoute {
  const segments = points.map((start, index) => {
    const end = points[(index + 1) % points.length];
    return {
      start, end,
      length: Math.hypot(end.x - start.x, end.z - start.z),
      axis: (start.x === end.x ? "z" : "x") as "x" | "z",
      lightOffset: offset + index * .6,
    };
  });
  return { segments, length: segments.reduce((length, segment) => length + segment.length, 0) };
}

/** Alternate green phases with amber and an all-red interval; no path-finding. */
export function trafficColour(time: number, axis: "x" | "z", offset = 0): TrafficColour {
  const phase = ((time + offset + (axis === "z" ? 6 : 0)) % 12 + 12) % 12;
  return phase < 4.2 ? "green" : phase < 5.4 ? "amber" : "red";
}

export function roadPosition(route: RoadRoute, distance: number) {
  let remaining = ((distance % route.length) + route.length) % route.length;
  for (const segment of route.segments) {
    if (remaining <= segment.length) {
      const mix = remaining / segment.length;
      return {
        x: segment.start.x + (segment.end.x - segment.start.x) * mix,
        z: segment.start.z + (segment.end.z - segment.start.z) * mix,
        heading: Math.atan2(segment.end.x - segment.start.x, segment.end.z - segment.start.z),
      };
    }
    remaining -= segment.length;
  }
  const first = route.segments[0];
  return { x: first.start.x, z: first.start.z, heading: 0 };
}

/** Pause at the two-unit stop line before a corner while its light is not green. */
export function advanceCar(route: RoadRoute, distance: number, speed: number, delta: number, time: number) {
  const wrapped = ((distance % route.length) + route.length) % route.length;
  let start = 0;
  for (const segment of route.segments) {
    const end = start + segment.length;
    if (wrapped < end) {
      const next = wrapped + speed * Math.min(.1, Math.max(0, delta));
      const stop = end - 2;
      if (wrapped <= stop + .001 && next >= stop && trafficColour(time, segment.axis, segment.lightOffset) !== "green") {
        return stop;
      }
      return next % route.length;
    }
    start = end;
  }
  return 0;
}

/** Dock holds are part of a fixed illustrative route, never user meeting state. */
export function flightPhase(time: number, cycle: number, offset: number, hold: number) {
  const elapsed = ((time + offset) % cycle + cycle) % cycle;
  const travel = cycle - hold;
  return {
    progress: Math.min(1, elapsed / travel),
    docked: hold > 0 && elapsed >= travel,
  };
}
