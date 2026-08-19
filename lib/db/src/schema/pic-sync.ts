import { createInsertSchema } from "drizzle-zod";
import { integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { z } from "zod/v4";

export const usersTable = pgTable("pic_sync_users", {
  id: text("id").primaryKey(),
  displayName: text("display_name").notNull(),
  avatarUrl: text("avatar_url"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const experiencesTable = pgTable("pic_sync_experiences", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  location: text("location"),
  coverImageUri: text("cover_image_uri"),
  startDate: timestamp("start_date", { withTimezone: true }).notNull(),
  endDate: timestamp("end_date", { withTimezone: true }).notNull(),
  inviteCode: text("invite_code").notNull().unique(),
  targetPhotoCount: integer("target_photo_count").notNull().default(12),
  windowStart: text("window_start"),
  windowEnd: text("window_end"),
  timeZone: text("time_zone").notNull().default("Europe/Rome"),
  sessionStatus: text("session_status").notNull().default("lobby"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const participantsTable = pgTable("pic_sync_participants", {
  id: text("id").primaryKey(),
  experienceId: text("experience_id").notNull(),
  userId: text("user_id").notNull(),
  joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
});

export const remindersTable = pgTable("pic_sync_reminders", {
  id: text("id").primaryKey(),
  experienceId: text("experience_id").notNull(),
  createdBy: text("created_by").notNull(),
  title: text("title").notNull(),
  message: text("message"),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
  notifiedAt: timestamp("notified_at", { withTimezone: true }),
});

export const pushTokensTable = pgTable("pic_sync_push_tokens", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  token: text("token").notNull().unique(),
  platform: text("platform").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const memoriesTable = pgTable("pic_sync_memories", {
  id: text("id").primaryKey(),
  experienceId: text("experience_id").notNull(),
  authorId: text("author_id").notNull(),
  reminderId: text("reminder_id"),
  imageUri: text("image_uri").notNull(),
  capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(),
});

export const insertExperienceSchema = createInsertSchema(experiencesTable).omit({
  id: true,
  ownerId: true,
  inviteCode: true,
  createdAt: true,
});
export const insertReminderSchema = createInsertSchema(remindersTable).omit({
  id: true,
  createdBy: true,
});
export const insertMemorySchema = createInsertSchema(memoriesTable).omit({
  id: true,
  authorId: true,
});
export type InsertExperience = z.infer<typeof insertExperienceSchema>;
export type Experience = typeof experiencesTable.$inferSelect;
export type Reminder = typeof remindersTable.$inferSelect;
export type Memory = typeof memoriesTable.$inferSelect;