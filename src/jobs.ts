import { Cron } from "croner";
import { getSecondsCoded, hackSql } from "./db";
import { sql } from "bun";
import { app } from "./bot";
import { createWakaUser } from "./waka";

export function registerJobs() {
  app.logger.info("Registering jobs");

  new Cron("* * * * *", async () => {
    app.logger.debug("Syncing...");

    const lastTrackedHbIds = new Map<string, [number, Date]>(); // <users.slack_id, [heartbeats.id, heartbeats.time]>
    const minIdToSearchFor =
      lastTrackedHbIds.size === 0
        ? 0
        : Math.min(
            ...Array.from(lastTrackedHbIds.values()).map(([num]) => num),
          );

    const recentHeartbeats =
      await hackSql`SELECT * FROM heartbeats WHERE id > ${minIdToSearchFor} ORDER BY time DESC LIMIT 1000;`;

    if (recentHeartbeats.length === 0) return; // No new heartbeats to process

    for (const hb of recentHeartbeats) {
      const slackId: string = hb.user_id.slice(-11);
      const currentEntry = lastTrackedHbIds.get(slackId);

      if (!currentEntry || hb.id > currentEntry[0]) {
        lastTrackedHbIds.set(slackId, [hb.id, hb.time]);
      }
    }

    // For each entry, normalise the time zone, to determine which summary day should be fetched.
    for (const [
      slackId,
      [lastHbId, lastHbTime],
    ] of lastTrackedHbIds.entries()) {
      try {
        // The wakatime `time`s are in UTC. Convert them to the user's static time zone, then decide the day.
        const userInfo = await app.client.users.info({ user: slackId });
        if (!userInfo.user?.id)
          throw new Error(`No user found from provided Slack ID ${slackId}`);

        const [user] =
          await sql`select * from users where slack_id = ${slackId}`;
        if (!user) continue;

        const userTzOffsetMs = user.tz_offset * 1_000;
        const hbLocalTime = new Date(lastHbTime.getTime() + userTzOffsetMs);

        const startOfDayLocal = new Date(
          hbLocalTime.getFullYear(),
          hbLocalTime.getMonth(),
          hbLocalTime.getDate(),
          0,
          0,
          0,
          0,
        );
        const startOfDayUtc = new Date(
          startOfDayLocal.getTime() - userTzOffsetMs,
        );

        // End of day (23:59:59.999)
        const endOfDayLocal = new Date(
          hbLocalTime.getFullYear(),
          hbLocalTime.getMonth(),
          hbLocalTime.getDate(),
          23,
          59,
          59,
          999,
        );
        const endOfDayUtc = new Date(endOfDayLocal.getTime() - userTzOffsetMs);

        const { api_key } = await createWakaUser(userInfo).then((res) =>
          res.json(),
        );

        const summaryRes = await fetch(
          `https://waka.hackclub.com/api/summary?from=${encodeURIComponent(startOfDayUtc.toISOString())}&to=${encodeURIComponent(endOfDayUtc.toISOString())}&recompute=true`,
          {
            headers: {
              Authorization: `Bearer ${api_key}`,
            },
          },
        );

        const summaryResJson = await summaryRes.json();

        const secondsBefore =
          (await getSecondsCoded(userInfo.user.id, startOfDayUtc)) ?? 0;

        const date = startOfDayUtc.toISOString().split("T")[0];
        await sql`insert into user_hakatime_daily_summary (user_id, date, summary) values (${userInfo.user.id}, ${date}, ${summaryResJson}) on conflict (user_id, date) do update set summary = excluded.summary;`;

        const secondsAfter = await getSecondsCoded(
          userInfo.user.id,
          startOfDayUtc,
        );

        app.logger.info(
          `Syncing ${userInfo.user.name} (${userInfo.user.id}) for ${date} before: ${secondsBefore / 60} mins, after: ${secondsAfter / 60} mins`,
        );

        if (secondsBefore < 15 * 60 && secondsAfter > 15 * 60) {
          await app.client.chat.postMessage({
            channel: process.env.EVENT_CHANNEL!,
            text: `_Relieved sock noises_\n*Translation:* No lint on these toes - <@${userInfo.user.id}> just hit the 15 min mark for today!`,
          });
        }
      } catch (e) {
        console.error("Sync iteraton failed: ", e);
      }
    }

    // Check for time warnings @ 6pm
  });

  sql`select slack_id, tz_label, tz_offset from users;`.then((users) => {
    users.forEach(
      async ({
        slack_id,
        tz_label,
        tz_offset,
      }: {
        slack_id: string;
        tz_label: string;
        tz_offset: number;
      }) => {
        // Get the current UTC time in milliseconds
        const nowUTC = Date.now();

        // Adjust the UTC time by the user's time zone offset to get the user's local time
        const userTime = new Date(nowUTC + tz_offset * 1000);

        console.log(userTime, userTime.getUTCHours(), userTime.getUTCMinutes());

        if (userTime.getUTCHours() === 18 && userTime.getUTCMinutes() === 0) {
          await app.client.chat.postMessage({
            channel: slack_id,
            text: `_Worried sock noises_\n*Translation:* It's 6pm ${tz_label.toLowerCase()}, and you haven't coded your 15 minutes yet today! You've got until midnight tonight. Don't be a smelly sock and let your team down!`,
          });
        }
      },
    );
  });
}
