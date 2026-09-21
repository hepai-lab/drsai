import { Notification } from "electron";
import type { DesktopNotificationService } from "../../../shared/api";

export const WINDOWS_NOTIFICATION_SERVICE: DesktopNotificationService = {
  supported() {
    return Notification.isSupported();
  },
  create(input) {
    return new Notification(input);
  },
};
