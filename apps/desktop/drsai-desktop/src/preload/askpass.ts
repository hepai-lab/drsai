import { ipcRenderer } from "electron";
import { ASKPASS_SUBMIT_CHANNEL } from "../shared/askpass";

function submit(value: string | null): void {
  ipcRenderer.send(ASKPASS_SUBMIT_CHANNEL, value);
}

window.addEventListener("DOMContentLoaded", () => {
  const passwordInput = document.getElementById(
    "pw",
  ) as HTMLInputElement | null;
  const okButton = document.getElementById("ok");
  const cancelButton = document.getElementById("cancel");

  if (!passwordInput || !okButton || !cancelButton) {
    submit(null);
    return;
  }

  okButton.addEventListener("click", () => submit(passwordInput.value));
  cancelButton.addEventListener("click", () => submit(null));
  passwordInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") submit(passwordInput.value);
    if (event.key === "Escape") submit(null);
  });
  passwordInput.focus();
});
