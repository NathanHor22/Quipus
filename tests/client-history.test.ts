import assert from "node:assert/strict";
import test from "node:test";
import type { Contact, Meeting, MeetingInsight } from "../lib/types";
import { clientHistory } from "../lib/workspace/client-history";

const contact: Contact = { id: "saved-client", name: "Sam Lee", company: "Acme" };
const other: Contact = { id: "different-client", name: "Sam Lee", company: "Acme" };
const insight: MeetingInsight = { meetingType: "review", intent: "Pilot discussion", interestLevel: "medium", wants: "A pilot", concern: "", promised: "", next: "Review the pilot", keyPoints: [], commitments: [] };
function meeting(id: string, date: string, contacts: Contact[] = [contact], changes: Partial<Meeting> = {}): Meeting {
  return { id, title: `Meeting ${id}`, startAt: `${date}T03:00:00Z`, endAt: `${date}T04:00:00Z`, source: "hardware", status: "ready", contacts, insight, ...changes };
}

test("client history joins only saved contact IDs and selects the latest recorded next step", () => {
  const older = meeting("older", "2026-10-01");
  const newest = meeting("newest", "2026-10-05", [contact], { insight: { ...insight, next: "Send the revised quote" } });
  const sameName = meeting("wrong-person", "2026-10-06", [other]);
  const calendar = meeting("calendar", "2026-10-08", [contact], { source: "calendar", status: "upcoming", insight: null });
  const result = clientHistory(contact, [older, sameName, calendar, newest]);
  assert.deepEqual(result.meetings.map(item => item.id), ["newest", "older"]);
  assert.equal(result.nextStepMeeting?.insight?.next, "Send the revised quote");
});

test("outstanding items exclude resolved tasks, avoid duplicate promises, and do not attribute other participants' follow-ups", () => {
  const single = meeting("single", "2026-10-05", [contact], {
    followUps: [
      { id: "done", meetingId: "single", contactId: contact.id, type: "email", description: "Send the quote", dueAt: null, status: "completed" },
      { id: "open", meetingId: "single", contactId: contact.id, type: "send_file", description: "Send pilot details", dueAt: null, status: "pending" },
      { id: "dismissed", meetingId: "single", contactId: contact.id, type: "call", description: "Call next week", dueAt: null, status: "dismissed" },
    ],
    insight: { ...insight, commitments: [
      { ownerType: "user", description: " Send   the quote ", status: "open" },
      { ownerType: "user", description: "Send pilot details", status: "open" },
      { ownerType: "contact", description: "Confirm installation dates", status: "open" },
      { ownerType: "contact", description: "Review brochure", status: "completed" },
    ] },
  });
  const group = meeting("group", "2026-10-02", [contact, other], {
    followUps: [
      { id: "other-task", meetingId: "group", contactId: other.id, type: "call", description: "Call the other person", dueAt: null, status: "pending" },
      { id: "unattributed", meetingId: "group", contactId: null, type: "message", description: "An unassigned follow-up", dueAt: null, status: "pending" },
    ],
    insight: { ...insight, commitments: [{ ownerType: "contact", description: "An unnamed participant promised" }] },
  });
  const result = clientHistory(contact, [single, group]);
  assert.deepEqual(result.outstanding.map(item => item.description), ["Send pilot details", "Confirm installation dates"]);
});

test("public research is scoped to linked company sources and never used as contact identity", () => {
  const source = { company: "Acme", title: "Company expansion", url: "https://example.com/acme", snippet: "Public company context", publishedDate: null };
  const linked = meeting("linked", "2026-10-05", [contact], { research: [source, { ...source, company: "Another company", url: "https://example.com/other" }, { ...source, url: "javascript:alert(1)" }] });
  const earlier = meeting("earlier", "2026-10-01", [contact], { research: [source] });
  const unrelated = meeting("unrelated", "2026-10-06", [other], { research: [{ ...source, url: "https://example.com/name-match" }] });
  const result = clientHistory(contact, [linked, earlier, unrelated]);
  assert.deepEqual(result.research.map(item => item.source.url), [source.url]);
  assert.equal(result.research[0].meeting.id, "linked");
  assert.equal(clientHistory({ ...contact, company: null }, [linked]).research.length, 0);
});
