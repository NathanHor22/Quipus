export type DeviceDemoState =
  | { stage: "ready" }
  | { stage: "consent" }
  | { stage: "recording"; seconds: number }
  | { stage: "saved"; seconds: number }
  | { stage: "report"; approved: boolean };

export type DeviceDemoAction = {
  type: "start" | "consent" | "decline" | "tick" | "stop" | "report" | "approve" | "reset";
};

export const initialDeviceDemoState: DeviceDemoState = { stage: "ready" };

export function deviceDemoReducer(
  state: DeviceDemoState,
  action: DeviceDemoAction,
): DeviceDemoState {
  if (action.type === "reset") return initialDeviceDemoState;

  switch (state.stage) {
    case "ready":
      return action.type === "start" ? { stage: "consent" } : state;
    case "consent":
      if (action.type === "consent") return { stage: "recording", seconds: 0 };
      return action.type === "decline" ? initialDeviceDemoState : state;
    case "recording":
      if (action.type === "tick") return { ...state, seconds: Math.min(state.seconds + 1, 3_599) };
      return action.type === "stop" ? { stage: "saved", seconds: state.seconds } : state;
    case "saved":
      return action.type === "report" ? { stage: "report", approved: false } : state;
    case "report":
      return action.type === "approve" && !state.approved ? { ...state, approved: true } : state;
  }
}

export function formatDeviceDemoTime(seconds: number): string {
  return `${Math.floor(seconds / 60).toString().padStart(2, "0")}:${(seconds % 60)
    .toString()
    .padStart(2, "0")}`;
}
