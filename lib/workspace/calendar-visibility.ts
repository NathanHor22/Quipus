import type { Meeting } from "../types";
import { isConversation } from "./model";

export function canHideRecording(meeting: Meeting): boolean {
  return meeting.source !== "calendar" && meeting.status !== "upcoming" && isConversation(meeting);
}

/** Calendar visibility never removes the source conversation or its actions. */
export function calendarMeetings(meetings: Meeting[], hidden = false): Meeting[] {
  return meetings.filter(
    (meeting) => (canHideRecording(meeting) && Boolean(meeting.calendarHidden)) === hidden,
  );
}

export function updateCalendarVisibility(
  meetings: Meeting[],
  id: string,
  hidden: boolean,
): Meeting[] {
  return meetings.map((meeting) =>
    meeting.id === id && canHideRecording(meeting)
      ? { ...meeting, calendarHidden: hidden }
      : meeting,
  );
}
