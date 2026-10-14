"use client";

import type { ReactNode } from "react";
import type { FollowUp } from "@/lib/types";
import { useWorkspaceTime } from "./WorkspaceTime";

type FollowUpChecklistProps = {
  tasks: readonly FollowUp[];
  disabled: boolean;
  onTask: (id: string, completed: boolean) => void;
  className: string;
  completedClassName: string;
  children?: ReactNode;
};

/** Shared task controls; each view keeps its existing container and completion styles. */
export function FollowUpChecklist({
  tasks,
  disabled,
  onTask,
  className,
  completedClassName,
  children,
}: FollowUpChecklistProps) {
  const { dateLabel } = useWorkspaceTime();

  return (
    <div className={className}>
      {tasks.map((task) => (
        <label
          key={task.id}
          className={task.status === "completed" ? completedClassName : ""}
        >
          <input
            type="checkbox"
            checked={task.status === "completed"}
            disabled={disabled}
            onChange={(event) => onTask(task.id, event.target.checked)}
          />
          <span>
            <strong>{task.description}</strong>
            {task.dueAt && <small>Due {dateLabel(task.dueAt)}</small>}
          </span>
        </label>
      ))}
      {children}
    </div>
  );
}
