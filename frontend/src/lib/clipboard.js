// The async Clipboard API needs a secure context (https or localhost); the
// app is also served over plain http on a LAN, where only the legacy copy
// command works, and some browsers allow neither. Resolves to whether the
// text reached the clipboard, so a caller can fall back to selecting it.
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.append(area);
    area.select();
    try {
      return document.execCommand("copy");
    } catch {
      return false;
    } finally {
      area.remove();
    }
  }
}
