import { money0 as dollars0, money2 as dollars2, percentOf } from "./budget";

// The eye in the header. While hidden, every dollar amount in the app shows as dots and only
// percentages stay readable. A module flag keeps the formatters usable anywhere; Home re-renders
// the whole tree when it flips.
const KEY = "sundialed.hideNumbers";
let hidden = false;
try {
  hidden = localStorage.getItem(KEY) === "1";
} catch {
  /* private mode: just start visible */
}

export const isHidden = () => hidden;
export function setHidden(v: boolean) {
  hidden = v;
  try {
    localStorage.setItem(KEY, v ? "1" : "0");
  } catch {
    /* not saved */
  }
}

export const HIDDEN_TEXT = "•••";
export const money0 = (n: number) => (hidden ? HIDDEN_TEXT : dollars0(n));
export const money2 = (n: number) => (hidden ? HIDDEN_TEXT : dollars2(n));
export const pct = (spent: number, target: number) => `${percentOf(spent, target)}%`;
