"use client";

import { useEffect, useReducer, useRef } from "react";
import {
  deviceDemoReducer,
  initialDeviceDemoState,
  formatDeviceDemoTime,
  type DeviceDemoAction,
} from "@/lib/landing/device-demo";
import styles from "./device-simulation.module.css";

export function DeviceSimulation() {
  const [state, dispatch] = useReducer(deviceDemoReducer, initialDeviceDemoState);
  const isRecording = state.stage === "recording";
  const heading = useRef<HTMLHeadingElement>(null);
  const focusOnChange = useRef(false);

  function interact(type: DeviceDemoAction["type"]) {
    focusOnChange.current = true;
    dispatch({ type });
  }

  useEffect(() => {
    if (!focusOnChange.current) return;
    heading.current?.focus({ preventScroll: true });
    focusOnChange.current = false;
  }, [state]);

  useEffect(() => {
    if (!isRecording) return;
    const timer = window.setInterval(() => dispatch({ type: "tick" }), 1_000);
    return () => window.clearInterval(timer);
  }, [isRecording]);

  return (
    <section className={styles.demo} aria-label="Interactive device demo">
      <div className={styles.toolbar}>
        <span className={styles.label}>Interactive demo &middot; sample</span>
        {state.stage !== "ready" && (
          <button
            className={styles.reset}
            type="button"
            onClick={() => interact("reset")}
          >
            Reset demo
          </button>
        )}
      </div>

      {state.stage === "ready" && (
        <div className={styles.content}>
          <h3 ref={heading} tabIndex={-1} className={styles.title}>Try a session.</h3>
          <p className={styles.description}>A short, interactive preview. Your microphone stays off.</p>
          <button
            className={styles.primary}
            type="button"
            onClick={() => interact("start")}
          >
            Start session
          </button>
        </div>
      )}

      {state.stage === "consent" && (
        <div className={styles.content}>
          <h3 ref={heading} tabIndex={-1} className={styles.title}>Ready to record?</h3>
          <p className={styles.description}>
            Ask everyone first. Quipus waits for your confirmation.
          </p>
          <div className={styles.actions}>
            <button
              className={styles.primary}
              type="button"
              onClick={() => interact("consent")}
            >
              We consent
            </button>
            <button
              className={styles.secondary}
              type="button"
              onClick={() => interact("decline")}
            >
              Not now
            </button>
          </div>
        </div>
      )}

      {state.stage === "recording" && (
        <div className={styles.content}>
          <div className={styles.recordingLine}>
            <h3 ref={heading} tabIndex={-1} className={styles.title}>Recording a sample.</h3>
            <span className={styles.timer} aria-hidden="true">
              {formatDeviceDemoTime(state.seconds)}
            </span>
          </div>
          <p className={styles.description}>
            Stay in the conversation. Stop whenever you are ready.
          </p>
          <button
            className={styles.primary}
            type="button"
            onClick={() => interact("stop")}
          >
            Stop recording
          </button>
        </div>
      )}

      {state.stage === "saved" && (
        <div className={styles.content}>
          <div className={styles.recordingLine}>
            <h3 ref={heading} tabIndex={-1} className={styles.title}>Sample saved offline.</h3>
            <span className={styles.timer}>{formatDeviceDemoTime(state.seconds)}</span>
          </div>
          <p className={styles.description}>
            Real sessions upload when connected. Preview the finished report.
          </p>
          <button
            className={styles.primary}
            type="button"
            onClick={() => interact("report")}
          >
            Preview report
          </button>
        </div>
      )}

      {state.stage === "report" && (
        <div className={styles.content}>
          <h3 ref={heading} tabIndex={-1} className={styles.title}>Meeting with Alex</h3>
          <ul className={styles.points}>
            <li>Interested in a pilot for the sales team.</li>
            <li>Send pricing before Friday.</li>
          </ul>
          <p className={styles.nextStep}>Next: a 20-minute follow-up.</p>
          {state.approved ? (
            <p className={styles.approved} role="status">
              Sample follow-up approved.
            </p>
          ) : (
            <button
              className={styles.primary}
              type="button"
              onClick={() => interact("approve")}
            >
              Approve sample follow-up
            </button>
          )}
        </div>
      )}
    </section>
  );
}
