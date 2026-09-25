import {
  ChartColumnIcon,
  CreditCardIcon,
  FileTextIcon,
  HouseIcon,
  LayersIcon,
  SettingsIcon,
  SparklesIcon,
  UsersIcon,
  type LucideIcon,
} from "lucide-react";

import type { DashboardIcon } from "@/core/config/schema";

export const dashboardIconComponents: Record<DashboardIcon, LucideIcon> = {
  home: HouseIcon,
  settings: SettingsIcon,
  layers: LayersIcon,
  sparkles: SparklesIcon,
  fileText: FileTextIcon,
  chart: ChartColumnIcon,
  users: UsersIcon,
  creditCard: CreditCardIcon,
};
