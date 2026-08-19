import { Router, type Request, type Response } from "express";
import { getAuth } from "@clerk/express";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  experiencesTable,
  memoriesTable,
  participantsTable,
  remindersTable,
  usersTable,
} from "@workspace/db";
import { z } from "zod";

const router = Router();
type AuthRequest = Request & { userId: string };
const id = () => `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
const inviteCode = () => Math.random().toString(36).slice(2, 8).toUpperCase();

function requireAuth(req: Request, res: Response, next: () => void) {
  const userId = getAuth(req).userId;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  (req as AuthRequest).userId = userId;
  next();
}

function statusFor(startDate: Date, endDate: Date) {
  const now = Date.now();
  if (now < startDate.getTime()) return "upcoming" as const;
  if (now > endDate.getTime()) return "completed" as const;
  return "ongoing" as const;
}

async function ensureUser(userId: string) {
  await db.insert(usersTable).values({ id: userId, displayName: "Amico" }).onConflictDoNothing();
}

async function serializeExperience(experience: typeof experiencesTable.$inferSelect) {
  const participants = await db
    .select({ id: usersTable.id, displayName: usersTable.displayName, avatarUrl: usersTable.avatarUrl })
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
    status: statusFor(experience.startDate, experience.endDate),
    participantCount: participants.length,
    inviteCode: experience.inviteCode,
  };
}

router.use(requireAuth);

router.get("/", async (req, res) => {
  const userId = (req as unknown as AuthRequest).userId;
  await ensureUser(userId);
  const memberships = await db.select({ experienceId: participantsTable.experienceId })
    .from(participantsTable).where(eq(participantsTable.userId, userId));
  if (!memberships.length) return res.json([]);
  const experiences = await db.select().from(experiencesTable)
    .where(inArray(experiencesTable.id, memberships.map((item) => item.experienceId)))
    .orderBy(desc(experiencesTable.startDate));
  return res.json(await Promise.all(experiences.map(serializeExperience)));
});

router.post("/", async (req, res) => {
  const userId = (req as AuthRequest).userId;
  const body = z.object({
    name: z.string().min(1),
    description: z.string().nullish(),
    location: z.string().nullish(),
    coverImageUri: z.string().nullish(),
    startDate: z.coerce.date(),
    endDate: z.coerce.date(),
  }).parse(req.body);
  await ensureUser(userId);
  const experience = {
    id: id(), ownerId: userId, inviteCode: inviteCode(),
    ...body, description: body.description ?? null, location: body.location ?? null, coverImageUri: body.coverImageUri ?? null,
    createdAt: new Date(),
  };
  await db.insert(experiencesTable).values(experience);
  await db.insert(participantsTable).values({ id: id(), experienceId: experience.id, userId });
  return res.status(201).json(await serializeExperience(experience));
});

router.post("/join", async (req, res) => {
  const userId = (req as unknown as AuthRequest).userId;
  const code = z.object({ inviteCode: z.string().min(4) }).parse(req.body).inviteCode.toUpperCase();
  await ensureUser(userId);
  const experience = await db.select().from(experiencesTable).where(eq(experiencesTable.inviteCode, code)).limit(1);
  if (!experience[0]) return res.status(404).json({ error: "Invite not found" });
  await db.insert(participantsTable).values({ id: id(), experienceId: experience[0].id, userId }).onConflictDoNothing();
  return res.json(await serializeExperience(experience[0]));
});

router.get("/:experienceId", async (req, res) => {
  const userId = (req as unknown as AuthRequest).userId;
  const experience = await db.select().from(experiencesTable).where(eq(experiencesTable.id, req.params.experienceId)).limit(1);
  if (!experience[0]) return res.status(404).json({ error: "Experience not found" });
  const access = await db.select().from(participantsTable).where(and(eq(participantsTable.experienceId, experience[0].id), eq(participantsTable.userId, userId))).limit(1);
  if (!access[0]) return res.status(403).json({ error: "Forbidden" });
  const [base, reminders, memoryRows] = await Promise.all([
    serializeExperience(experience[0]),
    db.select().from(remindersTable).where(eq(remindersTable.experienceId, experience[0].id)).orderBy(remindersTable.scheduledAt),
    db.select({ memory: memoriesTable, authorName: usersTable.displayName, reminderTitle: remindersTable.title })
      .from(memoriesTable).innerJoin(usersTable, eq(usersTable.id, memoriesTable.authorId))
      .leftJoin(remindersTable, eq(remindersTable.id, memoriesTable.reminderId))
      .where(eq(memoriesTable.experienceId, experience[0].id)).orderBy(desc(memoriesTable.capturedAt)),
  ]);
  return res.json({ ...base, participants: await db.select({ id: usersTable.id, displayName: usersTable.displayName, avatarUrl: usersTable.avatarUrl }).from(participantsTable).innerJoin(usersTable, eq(usersTable.id, participantsTable.userId)).where(eq(participantsTable.experienceId, experience[0].id)), reminders, memories: memoryRows.map(({ memory, authorName, reminderTitle }) => ({ id: memory.id, imageUri: memory.imageUri, authorName, capturedAt: memory.capturedAt, reminderTitle: reminderTitle ?? null })) });
});

router.patch("/:experienceId", async (req, res) => {
  const userId = (req as unknown as AuthRequest).userId;
  const body = z.object({ name: z.string().min(1), description: z.string().nullish(), location: z.string().nullish(), coverImageUri: z.string().nullish(), startDate: z.coerce.date(), endDate: z.coerce.date() }).parse(req.body);
  const updated = await db.update(experiencesTable).set({ ...body, description: body.description ?? null, location: body.location ?? null, coverImageUri: body.coverImageUri ?? null }).where(and(eq(experiencesTable.id, req.params.experienceId), eq(experiencesTable.ownerId, userId))).returning();
  if (!updated[0]) return res.status(404).json({ error: "Experience not found" });
  return res.json(await serializeExperience(updated[0]));
});

router.post("/:experienceId/reminders", async (req, res) => {
  const userId = (req as unknown as AuthRequest).userId;
  const body = z.object({ title: z.string().min(1), message: z.string().nullish(), scheduledAt: z.coerce.date() }).parse(req.body);
  const access = await db.select().from(participantsTable).where(and(eq(participantsTable.experienceId, req.params.experienceId), eq(participantsTable.userId, userId))).limit(1);
  if (!access[0]) return res.status(403).json({ error: "Forbidden" });
  const reminder = { id: id(), experienceId: req.params.experienceId, createdBy: userId, ...body, message: body.message ?? null };
  await db.insert(remindersTable).values(reminder);
  return res.status(201).json(reminder);
});

router.post("/:experienceId/memories", async (req, res) => {
  const userId = (req as unknown as AuthRequest).userId;
  const body = z.object({ imageUri: z.string().min(1), capturedAt: z.coerce.date(), reminderId: z.string().nullish() }).parse(req.body);
  const access = await db.select().from(participantsTable).where(and(eq(participantsTable.experienceId, req.params.experienceId), eq(participantsTable.userId, userId))).limit(1);
  if (!access[0]) return res.status(403).json({ error: "Forbidden" });
  await ensureUser(userId);
  const memory = { id: id(), experienceId: req.params.experienceId, authorId: userId, ...body, reminderId: body.reminderId ?? null };
  await db.insert(memoriesTable).values(memory);
  return res.status(201).json({ id: memory.id, imageUri: memory.imageUri, authorName: "Amico", capturedAt: memory.capturedAt, reminderTitle: null });
});

export default router;