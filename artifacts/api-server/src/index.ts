import app from "./app";
import { logger } from "./lib/logger";
import { deliverDuePhotoReminders } from "./routes/experiences";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);
const runReminderDelivery = () => {
  void deliverDuePhotoReminders().catch((err) => {
    logger.error({ err }, "Unable to process due photo reminders");
  });
};

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
  runReminderDelivery();
  setInterval(runReminderDelivery, 15_000).unref();
});
