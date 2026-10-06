import type { Contact, Meeting, PublicResearchSource } from "../types";
import { isConversation } from "./model";

export type ClientOutstandingItem = {
  key: string;
  description: string;
  dueAt: string | null;
  owner: "Your commitment" | "Client commitment" | "Follow-up" | "Calendar approval";
  meeting: Meeting;
};

export type ClientResearchItem = { source: PublicResearchSource; meeting: Meeting };

const normalize = (value: string) => value.trim().toLowerCase().replace(/\s+/g, " ");

/** Identity comes from the saved contact ID, never a name or public search match. */
export function clientHistory(contact: Contact, conversations: Meeting[]) {
  const meetings = conversations
    .filter(meeting => isConversation(meeting) && meeting.contacts.some(person => person.id === contact.id))
    .sort((a, b) => Date.parse(b.startAt) - Date.parse(a.startAt));
  const outstanding: ClientOutstandingItem[] = [];
  const research: ClientResearchItem[] = [];
  const researchURLs = new Set<string>();

  for (const meeting of meetings) {
    const tasks = (meeting.followUps || []).filter(task => task.contactId === contact.id || (!task.contactId && meeting.contacts.length === 1));
    const taskDescriptions = new Set(tasks.map(task => normalize(task.description)));
    for (const task of tasks) {
      if (task.status === "completed" || task.status === "dismissed") continue;
      outstanding.push({
        key: `${meeting.id}:task:${task.id}`,
        description: task.description,
        dueAt: task.schedule?.startAt || task.dueAt,
        owner: task.type === "schedule" ? "Calendar approval" : "Follow-up",
        meeting,
      });
    }
    for (const [index, commitment] of (meeting.insight?.commitments || []).entries()) {
      if (commitment.status === "completed" || taskDescriptions.has(normalize(commitment.description))) continue;
      // A group conversation cannot identify which contact owns an unnamed promise.
      if (commitment.ownerType === "contact" && meeting.contacts.length !== 1) continue;
      outstanding.push({
        key: `${meeting.id}:commitment:${commitment.id || index}`,
        description: commitment.description,
        dueAt: commitment.dueAt || null,
        owner: commitment.ownerType === "user" ? "Your commitment" : "Client commitment",
        meeting,
      });
    }
    for (const source of meeting.research || []) {
      if (!contact.company || normalize(source.company) !== normalize(contact.company) || researchURLs.has(source.url)) continue;
      try { if (!["https:", "http:"].includes(new URL(source.url).protocol)) continue; } catch { continue; }
      researchURLs.add(source.url);
      research.push({ source, meeting });
    }
  }

  const nextStepMeeting = meetings.find(meeting => meeting.insight?.next?.trim());
  return { meetings, outstanding, research, nextStepMeeting };
}
