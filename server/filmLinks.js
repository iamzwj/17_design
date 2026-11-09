import fs from "node:fs";
import path from "node:path";
import { randomBytes, createHmac, timingSafeEqual } from "node:crypto";
export function filmLinkKey(root) {
  const file = path.join(root, ".link-key");
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    const key = randomBytes(32).toString("hex");
    try {
      fs.writeFileSync(file, key, { mode: 0o600, flag: "wx" });
      return key;
    } catch {
      return fs.readFileSync(file, "utf8");
    }
  }
}
export const FILM_REFERENCE_TTL_SECONDS = 2 * 60 * 60;

const digest = (key, id, file, expires) =>
  createHmac("sha256", key).update(`${id}/${file}/${expires}`).digest("hex");
export function filmAssetLink(root, id, file, base, now = Date.now()) {
  const expires = Math.floor(now / 1000) + FILM_REFERENCE_TTL_SECONDS;
  return `${base}/api/film-assets/${id}/${file}?expires=${expires}&signature=${digest(filmLinkKey(root), id, file, expires)}`;
}
export function validFilmLink(
  key,
  id,
  file,
  expires,
  signature,
  now = Date.now(),
) {
  const time = Math.floor(now / 1000);
  if (
    !/^[a-f0-9-]{36}$/.test(id) ||
    !/^(asset|frame)-[a-zA-Z0-9_-]+\.png$/.test(file) ||
    !/^\d+$/.test(String(expires)) ||
    Number(expires) < time ||
    Number(expires) > time + FILM_REFERENCE_TTL_SECONDS ||
    !/^[a-f0-9]{64}$/.test(signature || "")
  )
    return false;
  return timingSafeEqual(
    Buffer.from(digest(key, id, file, expires), "hex"),
    Buffer.from(signature, "hex"),
  );
}
