import { SQL, sql } from "bun";
import { app } from "./bot";

if (
  !process.env.HACK_PG_URL ||
  !process.env.HACK_PG_HOST ||
  !process.env.HACK_PG_USER ||
  !process.env.HACK_PG_PASS ||
  !process.env.HACK_PG_TABL
) {
  console.error("Some HACK_PG_**** var is not present. Exiting.");
  process.exit();
}

export const hackSql = new SQL({
  url: process.env.HACK_PG_URL!,
  hostname: process.env.HACK_PG_HOST!,
  username: process.env.HACK_PG_USER!,
  password: process.env.HACK_PG_PASS!,
  database: process.env.HACK_PG_TABL!,
  max: 3,
});

if (!process.env.STATS_PG_URL) {
  console.error("STATS_PG_URL env var is not present. Exiting.");
  process.exit();
}

export async function setUpDb() {
  await sql`CREATE TABLE IF NOT EXISTS clans (
      id SERIAL PRIMARY KEY,
      name VARCHAR(50) NOT NULL UNIQUE,
      join_code TEXT NOT NULL,
      failed_at DATE
  )`;

  await sql`CREATE TABLE IF NOT EXISTS users (
      slack_id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      real_name TEXT NOT NULL,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      email TEXT NOT NULL,
      tz TEXT NOT NULL,
      tz_label TEXT NOT NULL,
      tz_offset INTEGER NOT NULL,
      clan_id INTEGER REFERENCES clans(id),
      hakatime_password text DEFAULT upper(substr(md5(random()::text), 1, 32))
  )`;

  await sql`CREATE TABLE IF NOT EXISTS user_hakatime_daily_summary (
      user_id TEXT NOT NULL REFERENCES users(slack_id),
      date DATE NOT NULL,
      summary JSONB NOT NULL,
      PRIMARY KEY (user_id, date)
  )`;
}

export async function getSecondsCoded(slackId: string, date: Date) {
  // const [{ total_seconds_today }] =
  //   await sql`SELECT SUM((project->>'total')::int) AS total_seconds_today
  //               FROM user_hakatime_daily_summary,
  //               LATERAL jsonb_array_elements(summary->'projects') AS project
  //               WHERE user_id = ${slackId} AND date = ${date.toISOString()};`;

  const categoriesResultRaw = await sql`
    SELECT summary->>'categories' as categories
    FROM user_hakatime_daily_summary
    WHERE user_id = ${slackId} AND date = ${date.toISOString()};`;

  if (categoriesResultRaw.length === 0 || !categoriesResultRaw[0].categories) {
    return 0;
  }

  const total = JSON.parse(categoriesResultRaw[0].categories)
    .filter(({ key }: { key: string }) =>
      ["coding", "building", "debugging"].includes(key),
    )
    .reduce((acc: number, { total }: { total: number }) => acc + total, 0);

  if (typeof total !== "number") {
    return 0;
  }

  return total;
}

export async function getSecondsCodedTotal(slackId: string) {
  try {
    const days = await sql`
    SELECT summary->>'categories' as categories
    FROM user_hakatime_daily_summary
    JOIN users ON user_id = users.slack_id
    WHERE users.slack_id = ${slackId};`;

    const total = days.reduce(
      (acc: number, { categories }: { categories: string }) => {
        const cats = JSON.parse(categories);
        const dayTotal = cats
          .filter(({ key }: { key: string }) =>
            ["coding", "building", "debugging"].includes(key),
          )
          .reduce(
            (acc: number, { total }: { total: number }) => acc + total,
            0,
          );

        return acc + dayTotal;
      },
      0,
    );

    if (!total || typeof total !== "number") {
      return 0;
    }

    return total;
  } catch (error) {
    console.error(error);
    return 0;
  }
}

//#region Telemetry
export const statsSql = new SQL(process.env.STATS_PG_URL);
export function track(evt: string, sid?: string) {
  const env = process.env.NODE_ENV ?? "development";

  void (async () => {
    try {
      await statsSql`insert into events (env, prj, evt, sid) values (${env}, 'sockathon', ${evt}, ${sid});`;
    } catch (e) {
      app.logger.error("Stats tracking err:", e);
    }
  })();
}
//#endregion
