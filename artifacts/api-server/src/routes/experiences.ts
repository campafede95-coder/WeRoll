import { Router, type Request, type Response } from "express";
import { and, desc, eq, gte, inArray, isNull, lte } from "drizzle-orm";
import { db, experiencesTable, memoriesTable, participantsTable, pushTokensTable, remindersTable, usersTable } from "@workspace/db";
import { z } from "zod";
import { logger } from "../lib/logger";

const router = Router();
const id = () => `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
const inviteCode = () => Math.random().toString(36).slice(2, 8).toUpperCase();
const PHOTO_WINDOW_MS = 15 * 60 * 1000;
const REMINDER_SOUND = "photo-reminder.mp3";
const REMINDER_CHANNEL = "pic-sync-reminders-v2";
const EXPO_PUSH_BATCH_SIZE = 100;

type ExpoPushTicket = {
  status?: "ok" | "error";
  message?: string;
  details?: { error?: string };
};

function batches<T>(items: T[], size: number) {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, (index + 1) * size));
}

export async function deliverDuePhotoReminders() {
  const now = new Date();
  const dueReminders = await db
    .select({ reminder: remindersTable, experience: experiencesTable, organizerName: usersTable.displayName })
    .from(remindersTable)
    .innerJoin(experiencesTable, eq(experiencesTable.id, remindersTable.experienceId))
    .innerJoin(usersTable, eq(usersTable.id, experiencesTable.ownerId))
    .where(and(
      eq(experiencesTable.sessionStatus, "active"),
      isNull(remindersTable.notifiedAt),
      lte(remindersTable.scheduledAt, now),
      gte(remindersTable.scheduledAt, new Date(now.getTime() - PHOTO_WINDOW_MS)),
    ));
  for (const { reminder, experience, organizerName } of dueReminders) {
    const members = await db.select({ userId: participantsTable.userId }).from(participantsTable)
      .where(eq(participantsTable.experienceId, experience.id));
    const userIds = members.map((member) => member.userId);
    // Tokens are intentionally stored per device, rather than per user: a
    // participant may use the same group on more than one phone.
    const tokens = userIds.length ? await db.select({ token: pushTokensTable.token }).from(pushTokensTable)
      .where(inArray(pushTokensTable.userId, userIds)) : [];
    if (!tokens.length) continue;
    const claimed = await db.update(remindersTable).set({ notifiedAt: now })
      .where(and(eq(remindersTable.id, reminder.id), isNull(remindersTable.notifiedAt))).returning({ id: remindersTable.id });
    if (!claimed[0]) continue;
    try {
      const failedTokens: Array<{ token: string; ticket: ExpoPushTicket }> = [];
      for (const batch of batches(tokens, EXPO_PUSH_BATCH_SIZE)) {
        const response = await fetch("https://exp.host/--/api/v2/push/send", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify(batch.map(({ token }) => ({
            to: token,
            title: `${organizerName} · ${reminder.title}`,
            body: `${organizerName} ti invita a scattare: hai 15 minuti per questo ricordo.`,
            sound: REMINDER_SOUND,
            priority: "high",
            channelId: REMINDER_CHANNEL,
            data: { experienceId: experience.id, reminderId: reminder.id, scheduledAt: reminder.scheduledAt.toISOString() },
          }))),
        });
        if (!response.ok) throw new Error(`Expo push service returned ${response.status}`);
        const payload: unknown = await response.json();
        const tickets = payload && typeof payload === "object" && Array.isArray((payload as { data?: unknown }).data)
          ? (payload as { data: ExpoPushTicket[] }).data : null;
        if (!tickets || tickets.length !== batch.length) throw new Error("Expo push service returned an invalid ticket response");
        tickets.forEach((ticket, index) => {
          if (ticket.status !== "ok") failedTokens.push({ token: batch[index].token, ticket });
        });
      }
      if (failedTokens.length) {
        const unregisteredTokens = failedTokens.filter(({ ticket }) => ticket.details?.error === "DeviceNotRegistered").map(({ token }) => token);
        if (unregisteredTokens.length) await db.delete(pushTokensTable).where(inArray(pushTokensTable.token, unregisteredTokens));
        logger.warn({ reminderId: reminder.id, failures: failedTokens.map(({ token, ticket }) => ({ token, message: ticket.message, error: ticket.details?.error })) }, "Expo rejected one or more reminder push tokens");
        throw new Error(`Expo rejected ${failedTokens.length} reminder push token(s)`);
      }
    } catch (error) {
      await db.update(remindersTable).set({ notifiedAt: null })
        .where(and(eq(remindersTable.id, reminder.id), eq(remindersTable.notifiedAt, now)));
      logger.error({ err: error, reminderId: reminder.id }, "Unable to deliver photo reminder push notification");
    }
  }
}

function guest(req: Request, res: Response) {
  const userId = req.header("x-pic-sync-guest-id")?.trim();
  if (!userId) {
    res.status(400).json({ error: "Missing guest identity" });
    return null;
  }
  return userId.slice(0, 80);
}

async function ensureUser(userId: string, displayName?: string) {
  const name = displayName?.trim().slice(0, 40) || "Partecipante";
  await db
    .insert(usersTable)
    .values({ id: userId, displayName: name })
    .onConflictDoUpdate({ target: usersTable.id, set: { displayName: name } });
}

function statusFor(experience: typeof experiencesTable.$inferSelect) {
  if (experience.sessionStatus === "closed") return "completed" as const;
  if (experience.sessionStatus === "active") return "ongoing" as const;
  return "upcoming" as const;
}

async function serializeExperience(experience: typeof experiencesTable.$inferSelect, viewerId?: string) {
  const participants = await db
    .select({ id: usersTable.id, displayName: usersTable.displayName, avatarUrl: usersTable.avatarUrl, isOrganizer: participantsTable.userId })
    .from(participantsTable)
    .innerJoin(usersTable, eq(usersTable.id, participantsTable.userId))
    .where(eq(participantsTable.experienceId, experience.id));
  return {
    id: experience.id,
    name: experience.name,
    description: experience.description,
    location: experience.location,
    coverImageUri: experience.coverImageUri,
    startDate: experience.startDate,
    endDate: experience.endDate,
    status: statusFor(experience),
    participantCount: participants.length,
    inviteCode: experience.inviteCode,
    targetPhotoCount: experience.targetPhotoCount,
    sessionStatus: experience.sessionStatus as "lobby" | "active" | "closed",
    windowStart: experience.windowStart,
    windowEnd: experience.windowEnd,
    timeZone: experience.timeZone,
    isOwner: experience.ownerId === viewerId,
  };
}

function timeParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value);
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute") };
}

function zonedDate(base: Date, hour: number, minute: number, timeZone: string) {
  const local = timeParts(base, timeZone);
  const targetMs = Date.UTC(local.year, local.month - 1, local.day, hour, minute, 0);
  const provisional = new Date(targetMs);
  const represented = timeParts(provisional, timeZone);
  const offsetMs = Date.UTC(represented.year, represented.month - 1, represented.day, represented.hour, represented.minute) - provisional.getTime();
  return new Date(targetMs - offsetMs);
}

function timeToMinutes(time: string) {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

function isWithinWindow(date: Date, experience: typeof experiencesTable.$inferSelect) {
  if (!experience.windowStart || !experience.windowEnd) return true;
  const local = timeParts(date, experience.timeZone);
  const minutes = local.hour * 60 + local.minute;
  return minutes >= timeToMinutes(experience.windowStart) && minutes <= timeToMinutes(experience.windowEnd);
}

function buildReminderDates(start: string, end: string, count: number, timeZone: string) {
  const [startHour, startMinute] = start.split(":").map(Number);
  const [endHour, endMinute] = end.split(":").map(Number);
  const now = new Date();
  let first = zonedDate(now, startHour || 9, startMinute || 0, timeZone);
  let last = zonedDate(now, endHour || 18, endMinute || 0, timeZone);
  if (last <= first) last = zonedDate(new Date(now.getTime() + 86_400_000), endHour || 18, endMinute || 0, timeZone);
  if (last < now) {
    first = zonedDate(new Date(now.getTime() + 86_400_000), startHour || 9, startMinute || 0, timeZone);
    last = zonedDate(new Date(now.getTime() + 86_400_000), endHour || 18, endMinute || 0, timeZone);
  }
  const span = last.getTime() - first.getTime();
  return Array.from({ length: count }, (_, index) => {
    const slot = span / (count + 1);
    const jitter = (Math.random() - 0.5) * Math.min(slot * 0.38, 18 * 60 * 1000);
    return new Date(first.getTime() + slot * (index + 1) + jitter);
  }).sort((a, b) => a.getTime() - b.getTime());
}

async function canAccess(experienceId: string, userId: string) {
  const row = await db.select({ id: participantsTable.id }).from(participantsTable)
    .where(and(eq(participantsTable.experienceId, experienceId), eq(participantsTable.userId, userId))).limit(1);
  return Boolean(row[0]);
}

async function requireOwner(experienceId: string, userId: string, res: Response) {
  const experience = await db.select().from(experiencesTable)
    .where(and(eq(experiencesTable.id, experienceId), eq(experiencesTable.ownerId, userId))).limit(1);
  if (!experience[0]) {
    res.status(403).json({ error: "Only the group creator can do this" });
    return null;
  }
  return experience[0];
}

router.get("/", async (req, res) => {
  const userId = guest(req, res);
  if (!userId) return;
  await ensureUser(userId, req.header("x-pic-sync-guest-name") ?? undefined);
  const memberships = await db.select({ experienceId: participantsTable.experienceId }).from(participantsTable)
    .where(eq(participantsTable.userId, userId));
  if (!memberships.length) return res.json([]);
  const experiences = await db.select().from(experiencesTable)
    .where(inArray(experiencesTable.id, memberships.map((membership) => membership.experienceId)))
    .orderBy(desc(experiencesTable.createdAt));
  return res.json(await Promise.all(experiences.map((experience) => serializeExperience(experience, userId))));
});

router.post("/", async (req, res) => {
  const userId = guest(req, res);
  if (!userId) return;
  const body = z.object({
    name: z.string().nullish(),
    description: z.string().nullish(),
    location: z.string().nullish(),
    coverImageUri: z.string().nullish(),
    startDate: z.coerce.date(),
    endDate: z.coerce.date(),
    targetPhotoCount: z.coerce.number().int().min(1).max(36).default(12),
    windowStart: z.string().regex(/^\d{2}:\d{2}$/).nullish(),
    windowEnd: z.string().regex(/^\d{2}:\d{2}$/).nullish(),
    timeZone: z.string().min(1).max(80).nullish(),
  }).parse(req.body);
  await ensureUser(userId, req.header("x-pic-sync-guest-name") ?? undefined);
  const experience = {
    id: id(),
    ownerId: userId,
    name: body.name?.trim() || "La nostra avventura",
    description: body.description ?? null,
    location: body.location ?? null,
    coverImageUri: body.coverImageUri ?? null,
    startDate: body.startDate,
    endDate: body.endDate,
    inviteCode: inviteCode(),
    targetPhotoCount: body.targetPhotoCount,
    windowStart: body.windowStart ?? "09:00",
    windowEnd: body.windowEnd ?? "18:00",
    timeZone: body.timeZone ?? "Europe/Rome",
    sessionStatus: "lobby",
    createdAt: new Date(),
  };
  await db.insert(experiencesTable).values(experience);
  await db.insert(participantsTable).values({ id: id(), experienceId: experience.id, userId });
  const reminderDates = buildReminderDates(experience.windowStart, experience.windowEnd, experience.targetPhotoCount, experience.timeZone);
  await db.insert(remindersTable).values(reminderDates.map((scheduledAt, index) => ({
    id: id(),
    experienceId: experience.id,
    createdBy: userId,
    title: `Ricordo ${index + 1}`,
    message: "Hai 15 minuti per scattare questo ricordo.",
    scheduledAt,
  })));
  return res.status(201).json(await serializeExperience(experience, userId));
});

router.post("/join", async (req, res) => {
  const userId = guest(req, res);
  if (!userId) return;
  const body = z.object({ inviteCode: z.string().min(4), displayName: z.string().trim().min(1).max(40) }).parse(req.body);
  const code = body.inviteCode.toUpperCase();
  await ensureUser(userId, body.displayName);
  const experience = await db.select().from(experiencesTable).where(eq(experiencesTable.inviteCode, code)).limit(1);
  if (!experience[0]) return res.status(404).json({ error: "Invite not found" });
  const present = await canAccess(experience[0].id, userId);
  if (!present) await db.insert(participantsTable).values({ id: id(), experienceId: experience[0].id, userId });
  return res.json(await serializeExperience(experience[0], userId));
});

router.get("/:experienceId", async (req, res) => {
  const userId = guest(req, res);
  if (!userId) return;
  const experience = await db.select().from(experiencesTable).where(eq(experiencesTable.id, req.params.experienceId)).limit(1);
  if (!experience[0]) return res.status(404).json({ error: "Group not found" });
  if (!await canAccess(experience[0].id, userId)) return res.status(403).json({ error: "Forbidden" });
  const [base, participants, reminders, memoryRows] = await Promise.all([
    serializeExperience(experience[0], userId),
    db.select({ id: usersTable.id, displayName: usersTable.displayName, avatarUrl: usersTable.avatarUrl, organizerId: participantsTable.userId })
      .from(participantsTable).innerJoin(usersTable, eq(usersTable.id, participantsTable.userId))
      .where(eq(participantsTable.experienceId, experience[0].id)),
    db.select().from(remindersTable).where(eq(remindersTable.experienceId, experience[0].id)).orderBy(remindersTable.scheduledAt),
    db.select({ memory: memoriesTable, authorName: usersTable.displayName, reminderTitle: remindersTable.title })
      .from(memoriesTable).innerJoin(usersTable, eq(usersTable.id, memoriesTable.authorId))
      .leftJoin(remindersTable, eq(remindersTable.id, memoriesTable.reminderId))
      .where(eq(memoriesTable.experienceId, experience[0].id)).orderBy(desc(memoriesTable.capturedAt)),
  ]);
  return res.json({ ...base, participants: participants.map(({ organizerId, ...participant }) => ({ ...participant, isOrganizer: organizerId === experience[0].ownerId })), reminders, memories: memoryRows.map(({ memory, authorName, reminderTitle }) => ({
    id: memory.id, imageUri: memory.imageUri, authorName, capturedAt: memory.capturedAt, reminderTitle: reminderTitle ?? null,
  })) });
});

router.post("/:experienceId/start", async (req, res) => {
  const userId = guest(req, res);
  if (!userId) return;
  const experience = await requireOwner(req.params.experienceId, userId, res);
  if (!experience) return;
  const updated = await db.update(experiencesTable).set({ sessionStatus: "active" })
    .where(eq(experiencesTable.id, experience.id)).returning();
  const detail = await serializeExperience(updated[0], userId);
  return res.json({ ...detail, participants: [], reminders: [], memories: [] });
});

router.post("/:experienceId/push-token", async (req, res) => {
  const userId = guest(req, res);
  if (!userId) return;
  if (!await canAccess(req.params.experienceId, userId)) return res.status(403).json({ error: "Forbidden" });
  const body = z.object({
    token: z.string().min(10).max(300),
    platform: z.enum(["ios", "android"]),
  }).parse(req.body);
  await db.insert(pushTokensTable).values({
    id: id(),
    userId,
    token: body.token,
    platform: body.platform,
    updatedAt: new Date(),
  }).onConflictDoUpdate({
    target: pushTokensTable.token,
    set: { userId, platform: body.platform, updatedAt: new Date() },
  });
  return res.status(204).send();
});

router.post("/:experienceId/close", async (req, res) => {
  const userId = guest(req, res);
  if (!userId) return;
  const experience = await requireOwner(req.params.experienceId, userId, res);
  if (!experience) return;
  const updated = await db.update(experiencesTable).set({ sessionStatus: "closed" })
    .where(eq(experiencesTable.id, experience.id)).returning();
  const detail = await serializeExperience(updated[0], userId);
  return res.json({ ...detail, participants: [], reminders: [], memories: [] });
});

router.patch("/:experienceId/reminders/:reminderId", async (req, res) => {
  const userId = guest(req, res);
  if (!userId) return;
  const experience = await requireOwner(req.params.experienceId, userId, res);
  if (!experience) return;
  const body = z.object({ title: z.string().min(1), message: z.string().nullish(), scheduledAt: z.coerce.date() }).parse(req.body);
  if (!isWithinWindow(body.scheduledAt, experience)) {
    return res.status(400).json({ error: `Reminder must remain between ${experience.windowStart} and ${experience.windowEnd}` });
  }
  const updated = await db.update(remindersTable).set({ ...body, message: body.message ?? null })
    .where(and(eq(remindersTable.id, req.params.reminderId), eq(remindersTable.experienceId, experience.id))).returning();
  if (!updated[0]) return res.status(404).json({ error: "Reminder not found" });
  return res.json(updated[0]);
});

router.post("/:experienceId/memories", async (req, res) => {
  const userId = guest(req, res);
  if (!userId) return;
  if (!await canAccess(req.params.experienceId, userId)) return res.status(403).json({ error: "Forbidden" });
  const body = z.object({ imageUri: z.string().min(1), capturedAt: z.coerce.date(), reminderId: z.string().nullish() }).parse(req.body);
  const memory = { id: id(), experienceId: req.params.experienceId, authorId: userId, ...body, reminderId: body.reminderId ?? null };
  await db.insert(memoriesTable).values(memory);
  const author = await db.select({ displayName: usersTable.displayName }).from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  return res.status(201).json({ id: memory.id, imageUri: memory.imageUri, authorName: author[0]?.displayName ?? "Partecipante", capturedAt: memory.capturedAt, reminderTitle: null });
});

export default router;
