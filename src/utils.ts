import TimeAgo from "javascript-time-ago";
import en from "javascript-time-ago/locale/en";
TimeAgo.addDefaultLocale(en);
const timeAgo = new TimeAgo("en-US");

export function ago(date: Date) {
  return timeAgo.format(date);
}

export function capitaliseFirstLetter(str: string) {
  return String(str).charAt(0).toUpperCase() + String(str).slice(1);
}
