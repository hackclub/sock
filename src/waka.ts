import { sql } from "bun";
import { hackSql } from "./db";

export async function createWakaUser({ slackId }: { slackId: string }) {
  if (!process.env.WAKA_API_KEY) {
    console.error("Env var WAKA_API_KEY not set. Exiting.");
    process.exit();
  }

  const [userRow] = await sql`select * from users where slack_id = ${slackId};`;

  const payload = {
    location: userRow.tz ?? "Factory",
    email: userRow.email ?? "",
    password: userRow.hakatime_password,
    password_repeat: userRow.hakatime_password,
    name: userRow.real_name,
    username: userRow.slack_id,
  };

  return await fetch("https://waka.hackclub.com/signup", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.WAKA_API_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(payload),
  });
}

export async function getLatestWakaData(slackId: string): Promise<{
  project: string;
  language: string;
  editor?: string;
  time: any;
} | null> {
  const [hb] =
    await hackSql`select * from heartbeats where user_id = ${slackId} order by time desc limit 1;`;

  if (!hb) return null;

  return {
    project: hb.project,
    language: hb.language,
    editor: hb.editor,
    time: hb.time,
  };
}
