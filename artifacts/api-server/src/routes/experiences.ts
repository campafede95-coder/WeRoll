import { Router, type Request, type Response } from "express";
import { and, asc, desc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import { db, experiencesTable, memoriesTable, participantsTable, pushTokensTable, reminderDeliveriesTable, remindersTable, usersTable } from "@workspace/db";
import { z } from "zod";
import { logger } from "../lib/logger";

const router = Router();
const id = () => `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
const inviteCode = () => Math.random().toString(36).slice(2, 8).toUpperCase();
const PHOTO_WINDOW_MS = 15 * 60 * 1000;
const REMINDER_SOUND = "photo-reminder.mp3";
const REMINDER_CHANNEL = "pic-sync-reminders-v2";
const EXPO_PUSH_BATCH_SIZE = 100;
const EXPO_RECEIPT_BATCH_SIZE = 1000;
const EXPO_RECEIPT_MIN_AGE_MS = 15_000;
const DELIVERY_LEASE_MS = 60_000;
const EXPO_REQUEST_TIMEOUT_MS = 20_000;
const INVALID_EXPO_TOKEN_ERRORS = new Set(["DeviceNotRegistered"]);

function messageVariantForReminder(reminderId: string) {
  let hash = 2166136261;
  for (let index = 0; index < reminderId.length; index += 1) {
    hash ^= reminderId.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % 100 < 30 ? "special" : "normal";
}

type ExpoPushTicket = {
  id?: string;
  status?: string;
  message?: string;
  details?: { error?: string };
};

async function sendExpoPushBatch(messages: Array<Record<string, unknown>>) {
  const response = await fetch("https://exp.host/--/api/v2/push/send", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(messages),
    signal: AbortSignal.timeout(EXPO_REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Expo push service returned ${response.status}`);

  const payload = await response.json() as { data?: ExpoPushTicket[] };
  if (!Array.isArray(payload.data) || payload.data.length !== messages.length) {
    throw new Error("Expo push service returned an invalid ticket response");
  }
  return payload.data;
}

async function markReminderCompleteIfDelivered(reminderId: string) {
  const openDelivery = await db.select({ id: reminderDeliveriesTable.id }).from(reminderDeliveriesTable)
    .where(and(
      eq(reminderDeliveriesTable.reminderId, reminderId),
      inArray(reminderDeliveriesTable.status, ["pending", "sending", "ticketed"]),
    )).limit(1);
  if (!openDelivery[0]) {
    await db.update(remindersTable).set({ notifiedAt: new Date() })
      .where(and(eq(remindersTable.id, reminderId), isNull(remindersTable.notifiedAt)));
  }
  return !openDelivery[0];
}

async function processExpoPushReceipts() {
  const ticketed = await db.select().from(reminderDeliveriesTable)
    .where(and(
      eq(reminderDeliveriesTable.status, "ticketed"),
      lte(reminderDeliveriesTable.updatedAt, new Date(Date.now() - EXPO_RECEIPT_MIN_AGE_MS)),
    ))
    .orderBy(asc(reminderDeliveriesTable.updatedAt))
    .limit(EXPO_RECEIPT_BATCH_SIZE);
  const withTicket = ticketed.filter((delivery): delivery is typeof delivery & { ticketId: string } => Boolean(delivery.ticketId));
  if (!withTicket.length) return;

  const response = await fetch("https://exp.host/--/api/v2/push/getReceipts", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ ids: withTicket.map((delivery) => delivery.ticketId) }),
    signal: AbortSignal.timeout(EXPO_REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Expo push receipt service returned ${response.status}`);
  const payload = await response.json() as { data?: Record<string, ExpoPushTicket> };
  if (!payload.data || typeof payload.data !== "object") throw new Error("Expo push receipt service returned an invalid response");

  const touchedReminderIds = new Set<string>();
  const invalidTokens = new Set<string>();
  await Promise.all(withTicket.map(async (delivery) => {
    const receipt = payload.data?.[delivery.ticketId];
    if (!receipt) {
      await db.update(reminderDeliveriesTable).set({ updatedAt: new Date() })
        .where(and(
          eq(reminderDeliveriesTable.id, delivery.id),
          eq(reminderDeliveriesTable.status, "ticketed"),
          eq(reminderDeliveriesTable.ticketId, delivery.ticketId),
        ));
      return;
    }
    if (receipt.status === "ok") {
      const updated = await db.update(reminderDeliveriesTable).set({
        status: "accepted",
        lastError: null,
        updatedAt: new Date(),
      }).where(and(
        eq(reminderDeliveriesTable.id, delivery.id),
        eq(reminderDeliveriesTable.status, "ticketed"),
        eq(reminderDeliveriesTable.ticketId, delivery.ticketId),
      )).returning({ id: reminderDeliveriesTable.id });
      if (updated[0]) touchedReminderIds.add(delivery.reminderId);
      return;
    }
    const errorCode = receipt.details?.error ?? "UnknownExpoReceiptError";
    const invalid = INVALID_EXPO_TOKEN_ERRORS.has(errorCode);
    const updated = await db.update(reminderDeliveriesTable).set({
      status: invalid ? "invalid" : "pending",
      ticketId: null,
      leaseUntil: null,
      leaseOwner: null,
      lastError: `${errorCode}: ${receipt.message ?? "Expo could not deliver this notification"}`.slice(0, 500),
      updatedAt: new Date(),
    }).where(and(
      eq(reminderDeliveriesTable.id, delivery.id),
      eq(reminderDeliveriesTable.status, "ticketed"),
      eq(reminderDeliveriesTable.ticketId, delivery.ticketId),
    )).returning({ id: reminderDeliveriesTable.id });
    if (updated[0]) {
      touchedReminderIds.add(delivery.reminderId);
      if (invalid) invalidTokens.add(delivery.token);
      logger.warn({ err: errorCode, reminderId: delivery.reminderId }, "Expo receipt rejected a photo reminder recipient");
    }
  }));
  if (invalidTokens.size) {
    await db.delete(pushTokensTable).where(inArray(pushTokensTable.token, [...invalidTokens]));
  }
  await Promise.all([...touchedReminderIds].map(markReminderCompleteIfDelivered));
}

export async function deliverDuePhotoReminders() {
  try {
    await processExpoPushReceipts();
  } catch (error) {
    logger.error({ err: error }, "Unable to process Expo photo reminder receipts");
  }
  const now = new Date();
  await db.update(reminderDeliveriesTable).set({
    status: "pending",
    leaseUntil: null,
    leaseOwner: null,
    updatedAt: now,
  }).where(and(
    eq(reminderDeliveriesTable.status, "sending"),
    lte(reminderDeliveriesTable.leaseUntil, now),
  ));

  const expiredReminders = await db.select({ id: remindersTable.id }).from(remindersTable)
    .where(and(
      isNull(remindersTable.notifiedAt),
      lte(remindersTable.scheduledAt, new Date(now.getTime() - PHOTO_WINDOW_MS)),
    ));
  if (expiredReminders.length) {
    const expiredIds = expiredReminders.map(({ id: reminderId }) => reminderId);
    await db.update(reminderDeliveriesTable).set({
      status: "expired",
      ticketId: null,
      leaseUntil: null,
      leaseOwner: null,
      lastError: "Reminder window expired before delivery completed",
      updatedAt: now,
    }).where(and(
      inArray(reminderDeliveriesTable.reminderId, expiredIds),
      inArray(reminderDeliveriesTable.status, ["pending", "sending", "ticketed"]),
    ));
    await db.update(remindersTable).set({ notifiedAt: now })
      .where(and(inArray(remindersTable.id, expiredIds), isNull(remindersTable.notifiedAt)));
  }

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
    try {
      const currentExperience = await db.select({ sessionStatus: experiencesTable.sessionStatus })
        .from(experiencesTable)
        .where(eq(experiencesTable.id, experience.id))
        .limit(1);
      if (currentExperience[0]?.sessionStatus !== "active") continue;
      const members = await db.select({ userId: participantsTable.userId }).from(participantsTable)
        .where(eq(participantsTable.experienceId, experience.id));
      const userIds = members.map((member) => member.userId);
      const tokens = userIds.length ? await db.select({ token: pushTokensTable.token }).from(pushTokensTable)
        .where(inArray(pushTokensTable.userId, userIds)) : [];
      if (!tokens.length) continue;

      await db.insert(reminderDeliveriesTable).values(tokens.map(({ token }) => ({
        id: `${reminder.id}:${token}`,
        reminderId: reminder.id,
        token,
      }))).onConflictDoNothing();
      const leaseOwner = id();
      const pendingDeliveries = await db.update(reminderDeliveriesTable).set({
        status: "sending",
        leaseUntil: new Date(Date.now() + DELIVERY_LEASE_MS),
        leaseOwner,
        updatedAt: new Date(),
      })
        .where(and(
          eq(reminderDeliveriesTable.reminderId, reminder.id),
          eq(reminderDeliveriesTable.status, "pending"),
          inArray(reminderDeliveriesTable.token, tokens.map(({ token }) => token)),
        )).returning();
      const invalidTokens = new Set<string>();
      let acceptedCount = 0;
      let rejectedCount = 0;
      let transportFailureCount = 0;
      for (let offset = 0; offset < pendingDeliveries.length; offset += EXPO_PUSH_BATCH_SIZE) {
        const batchDeliveries = pendingDeliveries.slice(offset, offset + EXPO_PUSH_BATCH_SIZE);
        await db.transaction(async (tx) => {
          await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${"pic-sync-experience:" + experience.id}, 0))`);
          const activeCheck = await tx.select({ sessionStatus: experiencesTable.sessionStatus })
            .from(experiencesTable)
            .where(eq(experiencesTable.id, experience.id))
            .limit(1);
          if (activeCheck[0]?.sessionStatus !== "active") {
            for (const delivery of batchDeliveries) {
              await tx.update(reminderDeliveriesTable).set({
                status: "cancelled",
                ticketId: null,
                leaseUntil: null,
                leaseOwner: null,
                lastError: "Session closed before delivery completed",
                updatedAt: new Date(),
              }).where(and(
                eq(reminderDeliveriesTable.id, delivery.id),
                eq(reminderDeliveriesTable.status, "sending"),
                eq(reminderDeliveriesTable.leaseOwner, leaseOwner),
              ));
            }
            return;
          }
          const batch = batchDeliveries.map(({ token }) => ({
            to: token,
            title: `${organizerName} · ${reminder.title}`,
            body: `${organizerName} ti invita a scattare: hai 15 minuti per questo ricordo.`,
            sound: REMINDER_SOUND,
            priority: "high",
            channelId: REMINDER_CHANNEL,
            data: {
              experienceId: experience.id,
              reminderId: reminder.id,
              scheduledAt: reminder.scheduledAt.toISOString(),
              messageVariant: messageVariantForReminder(reminder.id),
            },
          }));
          let tickets: ExpoPushTicket[];
          try {
            tickets = await sendExpoPushBatch(batch);
          } catch (error) {
            transportFailureCount += batch.length;
            for (const delivery of batchDeliveries) {
              await tx.update(reminderDeliveriesTable).set({
                status: "pending",
                leaseUntil: null,
                leaseOwner: null,
                attempts: delivery.attempts + 1,
                lastError: error instanceof Error ? error.message.slice(0, 500) : "Expo transport error",
                updatedAt: new Date(),
              }).where(and(
                eq(reminderDeliveriesTable.id, delivery.id),
                eq(reminderDeliveriesTable.status, "sending"),
                eq(reminderDeliveriesTable.leaseOwner, leaseOwner),
              ));
            }
            logger.warn({ err: error, reminderId: reminder.id, recipientCount: batch.length }, "Expo photo reminder batch transport failed");
            return;
          }
          for (const [index, ticket] of tickets.entries()) {
            const delivery = batchDeliveries[index];
            if (ticket.status === "ok" && ticket.id) {
              const updated = await tx.update(reminderDeliveriesTable).set({
                status: "ticketed",
                ticketId: ticket.id,
                leaseUntil: null,
                leaseOwner: null,
                attempts: delivery.attempts + 1,
                lastError: null,
                updatedAt: new Date(),
              }).where(and(
                eq(reminderDeliveriesTable.id, delivery.id),
                eq(reminderDeliveriesTable.status, "sending"),
                eq(reminderDeliveriesTable.leaseOwner, leaseOwner),
              )).returning({ id: reminderDeliveriesTable.id });
              if (updated[0]) acceptedCount += 1;
            } else {
              const errorCode = ticket.details?.error ?? "UnknownExpoPushError";
              const invalid = INVALID_EXPO_TOKEN_ERRORS.has(errorCode);
              const updated = await tx.update(reminderDeliveriesTable).set({
                status: invalid ? "invalid" : "pending",
                ticketId: null,
                leaseUntil: null,
                leaseOwner: null,
                attempts: delivery.attempts + 1,
                lastError: `${errorCode}: ${ticket.message ?? "Expo rejected this recipient"}`.slice(0, 500),
                updatedAt: new Date(),
              }).where(and(
                eq(reminderDeliveriesTable.id, delivery.id),
                eq(reminderDeliveriesTable.status, "sending"),
                eq(reminderDeliveriesTable.leaseOwner, leaseOwner),
              )).returning({ id: reminderDeliveriesTable.id });
              if (updated[0]) {
                rejectedCount += 1;
                if (invalid) invalidTokens.add(delivery.token);
                logger.warn({ err: errorCode, reminderId: reminder.id }, "Expo rejected a photo reminder recipient");
              }
            }
          }
        });
      }
      if (invalidTokens.size) {
        await db.delete(pushTokensTable).where(inArray(pushTokensTable.token, [...invalidTokens]));
      }
      const deliveryComplete = await markReminderCompleteIfDelivered(reminder.id);
      logger.info({
        reminderId: reminder.id,
        experienceId: experience.id,
        recipientCount: tokens.length,
        acceptedCount,
        rejectedCount,
        transportFailureCount,
        invalidTokenCount: invalidTokens.size,
        deliveryComplete,
      }, "Processed photo reminder push recipients");
    } catch (error) {
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
  const updated = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${"pic-sync-experience:" + experience.id}, 0))`);
    const closed = await tx.update(experiencesTable).set({ sessionStatus: "closed" })
      .where(eq(experiencesTable.id, experience.id)).returning();
    const reminderIds = await tx.select({ id: remindersTable.id }).from(remindersTable)
      .where(eq(remindersTable.experienceId, experience.id));
    if (reminderIds.length) {
      await tx.update(reminderDeliveriesTable).set({
        status: "cancelled",
        ticketId: null,
        leaseUntil: null,
        leaseOwner: null,
        lastError: "Session closed before delivery completed",
        updatedAt: new Date(),
      }).where(and(
        inArray(reminderDeliveriesTable.reminderId, reminderIds.map(({ id: reminderId }) => reminderId)),
        inArray(reminderDeliveriesTable.status, ["pending", "sending", "ticketed"]),
      ));
    }
    return closed[0];
  });
  const detail = await serializeExperience(updated, userId);
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