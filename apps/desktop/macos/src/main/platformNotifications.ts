import { Notification } from "electron";
import type { DesktopNotificationService } from "../../../shared/api";

export const MACOS_NOTIFICATION_SERVICE: DesktopNotificationService = {
  supported: () => Notification.isSupported(),
  create: (input) => new Notification(input),
};
