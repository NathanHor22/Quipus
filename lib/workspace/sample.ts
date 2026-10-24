import { formatDateKey } from "../calendar";
import type { Contact, Meeting } from "../types";
import type { WorkspaceData } from "./model";
import { scheduleDetailsSchema } from "./model";
import { z } from "zod";
import {
  meetingInsightSchema,
  transcriptSegmentSchema,
} from "../meeting-schema";

export const SAMPLE_STORAGE_KEY = "lantern:sample-workspace:v1";
export const LEGACY_SAMPLE_STORAGE_KEY = "roxanne:sample-workspace:v1";
const contacts: Contact[] = [
  {
    id: "sample:chung",
    name: "Mr Chung",
    company: "Chung & Co.",
    role: "Managing Director",
    email: "chung@example.com",
  },
  {
    id: "sample:aisyah",
    name: "Aisyah Rahman",
    company: "Nusa Retail",
    role: "Head of Operations",
    email: "aisyah@example.com",
  },
  {
    id: "sample:daniel",
    name: "Daniel Tan",
    company: "Mera Studio",
    role: "Founder",
    email: "daniel@example.com",
  },
];

export function createSampleWorkspace(now = new Date()): WorkspaceData {
  const day = formatDateKey(now);
  const at = (offset: number, hour: number, minute = 0) => {
    const date = new Date(`${day}T00:00:00+08:00`);
    date.setTime(
      date.getTime() + (offset * 24 * 60 + hour * 60 + minute) * 60_000,
    );
    return date.toISOString();
  };
  const meeting = (
    index: number,
    offset: number,
    duration: number,
    keyPoints: string[],
    concern: string,
    promised: string,
  ): Meeting => ({
    id: `sample:conversation:${index}`,
    title: [
      "A pilot worth getting right",
      "Growing together with Nusa",
      "The next chapter for Mera",
    ][index],
    startAt: at(offset, 10),
    endAt: at(offset, 10, duration),
    status: "ready",
    source: "hardware",
    contacts: [contacts[index]],
    insight: {
      meetingType: "Client conversation",
      intent: keyPoints[0],
      interestLevel: "high",
      wants: keyPoints[0],
      concern,
      promised,
      next: "Prepare for the follow-up meeting.",
      keyPoints,
      detectedLanguage: "English · Bahasa Malaysia",
      commitments: [],
      executiveSummary: keyPoints.join(" "),
      dealStage: "evaluation",
      risks: concern ? [concern] : [],
      openQuestions: [],
    },
    transcript: [],
    followUps: [],
  });
  const chung = meeting(
    0,
    -1,
    92,
    [
      "Start with a pilot at the Bangsar and PJ branches.",
      "Keep installation outside trading hours to avoid disruption.",
      "Mr Chung will bring his operations lead to the next meeting.",
    ],
    "Installation must not interrupt day-to-day operations.",
    "Send a revised quotation with a phased implementation timeline.",
  );
  chung.transcript = [
    {
      speaker: "Mr Chung",
      text: "For the pilot, kita start with Bangsar and PJ dulu. If it works well, then we roll out.",
      startSeconds: 112,
      endSeconds: 126,
    },
    {
      speaker: "You",
      text: "That makes sense. I'll revise the quotation and include a phased timeline before we meet again.",
      startSeconds: 138,
      endSeconds: 149,
    },
    {
      speaker: "Mr Chung",
      text: "My main concern is the installation. Jangan kacau our operating hours lah.",
      startSeconds: 940,
      endSeconds: 954,
    },
    {
      speaker: "You",
      text: `Let's meet again on ${formatDateKey(at(2, 13))} at one in the afternoon, for forty-five minutes. I'll send the invite.`,
      startSeconds: 5140,
      endSeconds: 5156,
    },
    {
      speaker: "Mr Chung",
      text: "Yes, confirmed. I'll bring my operations lead too.",
      startSeconds: 5157,
      endSeconds: 5168,
    },
  ];
  chung.followUps = [
    {
      id: "sample:approval:chung",
      meetingId: chung.id,
      contactId: contacts[0].id,
      type: "schedule",
      description: "Pilot review with Mr Chung",
      dueAt: at(2, 13),
      status: "pending",
      schedule: {
        agreement: "agreed",
        startAt: at(2, 13),
        durationMinutes: 45,
        attendees: [contacts[0].email!],
        location: "Chung & Co. · Bangsar",
        evidence: chung.transcript![3].text,
      },
    },
    {
      id: "sample:task:quotation",
      meetingId: chung.id,
      contactId: contacts[0].id,
      type: "send_file",
      description: "Send the revised quotation and implementation timeline",
      dueAt: at(1, 17),
      status: "pending",
    },
    {
      id: "sample:task:installation",
      meetingId: chung.id,
      contactId: contacts[0].id,
      type: "call",
      description: "Confirm after-hours installation with the delivery team",
      dueAt: at(1, 12),
      status: "pending",
    },
  ];
  const aisyah = meeting(
    1,
    -2,
    68,
    [
      "Nusa is opening three new outlets this quarter.",
      "Aisyah needs one point of contact for the rollout.",
      "Compare the annual plan against quarterly payments.",
    ],
    "The new outlets have different launch dates.",
    "Share a rollout plan and pricing comparison.",
  );
  aisyah.transcript = [
    {
      speaker: "Aisyah",
      text: `Okay, ${formatDateKey(at(4, 10))} at ten works for me. Let's block one hour to go through the rollout plan.`,
      startSeconds: 3400,
      endSeconds: 3413,
    },
  ];
  aisyah.followUps = [
    {
      id: "sample:approval:aisyah",
      meetingId: aisyah.id,
      contactId: contacts[1].id,
      type: "schedule",
      description: "Rollout planning with Aisyah",
      dueAt: at(4, 10),
      status: "pending",
      schedule: {
        agreement: "agreed",
        startAt: at(4, 10),
        durationMinutes: 60,
        attendees: [contacts[1].email!],
        location: null,
        evidence: "Let's block one hour to go through the rollout plan.",
      },
    },
    {
      id: "sample:task:rollout",
      meetingId: aisyah.id,
      contactId: contacts[1].id,
      type: "send_file",
      description: "Prepare Nusa's rollout plan and pricing comparison",
      dueAt: at(3, 17),
      status: "pending",
    },
  ];
  const daniel = meeting(
    2,
    -4,
    47,
    [
      "The studio is expanding its client services team.",
      "Daniel wants to try the workflow with two account managers.",
      "A short onboarding session will help the team get started.",
    ],
    "Keep onboarding simple for the team.",
    "Prepare a short walkthrough for the two account managers.",
  );
  daniel.followUps = [
    {
      id: "sample:task:walkthrough",
      meetingId: daniel.id,
      contactId: contacts[2].id,
      type: "send_file",
      description: "Prepare the team's onboarding walkthrough",
      dueAt: at(0, 17),
      status: "pending",
    },
  ];
  const existing: Meeting = {
    id: "sample:event:daniel",
    title: "Mera team walkthrough",
    startAt: at(1, 11),
    endAt: at(1, 11, 30),
    status: "upcoming",
    source: "calendar",
    contacts: [contacts[2]],
    sourceConversationId: daniel.id,
  };
  return { version: 1, meetings: [chung, aisyah, daniel, existing] };
}

const sampleMeetingSchema = z.object({
  calendarHidden: z.boolean().optional(),
  id: z.string().startsWith("sample:"),
  title: z.string(),
  startAt: z.string().datetime({ offset: true }),
  endAt: z.string().datetime({ offset: true }),
  status: z.enum(["upcoming", "processing", "ready", "failed"]),
  source: z.enum(["manual", "calendar", "hardware", "upload", "agora"]),
  contacts: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      company: z.string().nullable(),
      email: z.string().nullable().optional(),
      role: z.string().nullable().optional(),
    }),
  ),
  insight: meetingInsightSchema.nullable().optional(),
  transcript: z.array(transcriptSegmentSchema).optional(),
  followUps: z
    .array(
      z.object({
        id: z.string().startsWith("sample:"),
        meetingId: z.string().startsWith("sample:"),
        contactId: z.string().nullable(),
        type: z.enum(["schedule", "send_file", "message", "email", "call"]),
        description: z.string(),
        dueAt: z.string().nullable(),
        status: z.enum([
          "pending",
          "approved",
          "completed",
          "failed",
          "dismissed",
        ]),
        schedule: scheduleDetailsSchema.nullable().optional(),
      }),
    )
    .optional(),
  sourceConversationId: z.string().startsWith("sample:").nullable().optional(),
  sourceApprovalId: z.string().startsWith("sample:").nullable().optional(),
});

export function readSampleWorkspace(raw: string | null): WorkspaceData | null {
  if (!raw) return null;
  try {
    return z
      .object({
        version: z.literal(1),
        meetings: z.array(sampleMeetingSchema).min(1).max(500),
      })
      .parse(JSON.parse(raw));
  } catch {
    return null;
  }
}
