// Collects the onUserDelete registrations of every module. Account-deletion code imports this file
// so that all hooks are registered before it runs. Core modules import their own registration files
// here; business modules likewise add a line: import "@/features/<name>/on-user-delete".
import "@/core/billing/register-user-delete";
import "@/core/acquisition/leads/register-user-delete";
