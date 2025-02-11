import type { UsersInfoResponse } from "@slack/web-api";
import { sql } from "bun";
import { hackSql } from "./db";

export async function createWakaUser(userInfo: UsersInfoResponse) {
  if (!process.env.WAKA_API_KEY) {
    console.error("Env var WAKA_API_KEY not set. Exiting.");
    process.exit();
  }

  if (
    !userInfo.ok ||
    !userInfo.user ||
    !userInfo.user.id ||
    !userInfo.user.name
  ) {
    throw new Error("Invalid user info");
  }

  const [userRow] =
    await sql`select hakatime_password from users where slack_id = ${userInfo.user.id};`;

  console.log({ userInfo, userRow });

  const payload = {
    location: userInfo.user.tz ?? "Factory",
    email: "malted@hackclub.com", //userInfo.user.profile?.email ?? "",
    password: userRow.hakatime_password,
    password_repeat: userRow.hakatime_password,
    name: userInfo.user.name,
    username: userInfo.user.id,
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
  console.log({ slackId });
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
