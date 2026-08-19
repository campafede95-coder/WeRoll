import { createInsertSchema } from "drizzle-zod";
import { date, pgTable, text, timestamp } from "drizzle-orm/pg-core";
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