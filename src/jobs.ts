import { Cron } from "croner";
import { getSecondsCoded, hackSql, track } from "./db";
import { sql } from "bun";
import { app, eventEndDate, eventStartDate } from "./bot";
import { createWakaUser } from "./waka";

export function registerJobs() {
  app.logger.info("Registering jobs");

  // Restart every hour (10 mins into the hour to be safe)
  // This is because the bot becomes unresponsive after a while.
  new Cron("10 * * * *", async () => process.exit());

  new Cron("* * * * *", async () => {
    const minuteCronStart = performance.now();
    track("job-sync");
    // Loop through users.
    app.logger.info("SELECTING...");
    const users = await sql`select * from users where clan_id is not null;`;

    for (const user of users) {
      for (
        let date = eventStartDate;
        date <= eventEndDate;
        date.setDate(date.getDate() + 1)
      ) {
        const localStartDate = new Date(date.getTime() + user.tz_offset * 1000);
        const localEndDate = new Date(
          localStartDate.getTime() + 1_000 * 60 * 60 * 24,
        );

        const { api_key } = await createWakaUser({
          slackId: user.slack_id,
        }).then((res) => res.json());

        const summaryRes = await fetch(
          `https://waka.hackclub.com/api/summary?from=${encodeURIComponent(localStartDate.toISOString())}&to=${encodeURIComponent(localEndDate.toISOString())}&recompute=true`,
          {
            headers: {
              Authorization: `Bearer ${api_key}`,
            },
          },
        ).then((res) => res.json());

        app.logger.info("INSERTING...");
        await sql`insert into user_hakatime_daily_summary (user_id, date, summary) values (${user.slack_id}, ${date.toISOString()}, ${summaryRes}) on conflict (user_id, date) do update set summary = excluded.summary;`;
        await new Promise((r) => setTimeout(r, 500));
      }
    }

    await app.client.chat.postMessage({
      text: `sync job took ${performance.now() - minuteCronStart} ms`,
      channel: "U03DFNYGPCN", // @Malted
    });

    await new Promise((r) => setTimeout(r, 5_000));

    sql`select slack_id, tz_label, tz_offset, clans.id as clan_id, clans.failed_at as clan_failed_at from users join clans on users.clan_id = clans.id;`.then(
      (users) => {
        users.forEach(
          async ({
            slack_id,
            tz_label,
            tz_offset,
            clan_id,
            clan_failed_at,
          }: {
            slack_id: string;
            tz_label: string;
            tz_offset: number;
            clan_id: number;
            clan_failed_at: string;
          }) => {
            console.log({ clan_failed_at });
            console.log("Processing user", slack_id);
            if (!clan_id) return;

            // Get the current UTC time in milliseconds
            const nowUTC = Date.now();

            // Adjust the UTC time by the user's time zone offset to get the user's local time
            const userTime = new Date(nowUTC + tz_offset * 1000);

            if (userTime > eventEndDate || userTime < eventStartDate) {
              console.log("Out of event bounds");
              return;
            }

            const minsCodedToday =
              (await getSecondsCoded(slack_id, new Date())) / 60;

            if (
              userTime.getUTCHours() === 18 &&
              userTime.getUTCMinutes() === 0 &&
              minsCodedToday < 15 &&
              !clan_failed_at
            ) {
              // Send a reminder
              await app.client.chat.postMessage({
                channel: slack_id,
                text: `_Worried sock noises_\n*Translation:* It's 6pm ${tz_label.toLowerCase()}, and you haven't coded your 15 minutes yet today! You've got until midnight tonight. Don't be a smelly sock and let your team down!`,
              });
              await app.client.chat.postMessage({
                channel: "U03DFNYGPCN",
                text: `Just warned <@${slack_id}> about time at 6pm (well actually ${userTime.toISOString()}). Mins coded today: ${minsCodedToday}`,
              });
            } else if (
              userTime.getUTCHours() === 23 &&
              userTime.getUTCMinutes() === 59 &&
              minsCodedToday < 15 &&
              !clan_failed_at
            ) {
              await app.client.chat.postMessage({
                channel: "U03DFNYGPCN",
                text: `Failing user ${slack_id} for only coding ${minsCodedToday} minutes today. It's ${userTime.toISOString()}.`,
              });
              console.log(`${slack_id} lost, failing them...`);
              // Lost the day
              await sql`update clans set failed_at = ${userTime.toISOString()} where id = ${clan_id}`;

              const clanSlackIds =
                await sql`select slack_id from users where clan_id = ${clan_id}`.then(
                  (ids) =>
                    ids.map(({ slack_id }: { slack_id: string }) => slack_id),
                );

              const [clan] =
                await sql`select * from clans where id = ${clan_id}`;

              app.logger.info(`${clan.name} is out!`);

              clanSlackIds.forEach(async (id: string) => {
                await app.client.chat.postMessage({
                  channel: id,
                  text: `_Sad sock noises, sock tail between sock legs (?)_\n*Translation:* Sorry to have to tell you this, but *${clan.name}* is out of Sockathon, because ${slack_id === id ? "you" : `<@${slack_id}>`} didn't do ${slack_id === id ? "your" : "their"} 15 minutes of coding today. Better luck next time! :tux-dance:`,
                });
              });

              await app.client.chat.postMessage({
                channel: process.env.EVENT_CHANNEL!,
                text: `_Crying sock noises_\n*Translation:* And just like that folks, *${clan.name}* is out! Give it up for ${clanSlackIds.map((id: string) => `<@${id}>`).join(" & ")}! :clapping:`,
              });
            }
          },
        );
      },
    );
  });

  // (async function () {
  //   while (true) {

  //   }
  // })();
}
