import { registerOnUserDelete } from "@/core/account/on-user-delete";
import { db } from "@/core/db";
import { createLeadService } from "./service";
// Cleanup remains active when capture is disabled, for previously collected data.
registerOnUserDelete("acquisition:leads", ({ email }) =>
  createLeadService(db).withdrawEmail(email),
);
