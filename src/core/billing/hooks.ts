// Collects every module's onBillingEvent registration. handleBillingEvent imports this file so all
// hooks are registered before any event is handled. The kit's own hooks live in ./register-hooks.ts
// (granting credits); business modules add a line here too: import "@/features/<name>/on-billing-event".
import "./register-hooks";
import "@/features/downloads/on-billing-event";
