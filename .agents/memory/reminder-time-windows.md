---
name: Reminder time windows
description: How Pic Sync keeps generated and edited reminders inside the creator's selected local time window.
---

Each group records the creator's IANA time zone and treats the selected start/end times as wall-clock times in that zone. Both generated reminders and owner edits are validated against that same range.

**Why:** Server time and participant device time can differ; comparing raw timestamps would let a reminder appear outside the advertised group window.

**How to apply:** Keep the group time zone with the session. Any future scheduler, notification service, or import/export feature must use it when presenting or validating reminder times.