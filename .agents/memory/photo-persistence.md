---
name: Pic Sync photo persistence
description: Current MVP photo persistence tradeoff and the intended next migration.
---

The MVP stores compressed camera/gallery images as data URIs in the memories table so another device can render the shared album without a storage service.

**Why:** This keeps the anonymous, no-login prototype self-contained and immediately testable across devices, but it is not suitable for large albums.

**How to apply:** Preserve data-URI rendering during migration; move new uploads to persistent object storage and add ZIP export before scaling album size.