import { App } from "@slack/bolt";
import { sql } from "bun";
import { createWakaUser, getLatestWakaData } from "./waka";
import {
  getSecondsCoded,
  getSecondsCodedTotal,
  hackSql,
  setUpDb,
  statsSql,
  track,
} from "./db";
import { ago, capitaliseFirstLetter } from "./utils";
import { registerJobs } from "./jobs";
import { buildSockView } from "./ui";

await setUpDb();

if (!process.env.EVENT_CHANNEL) {
  console.error("Env var EVENT_CHANNEL needs to be defined");
  process.exit();
}

export const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_APP_SIGNING_SECRET,
});

await app.start();
app.logger.info("Bolt app is running");
registerJobs();

export const eventStartDate = new Date("2025-02-10"); // 2025-02-17
export const eventEndDate = new Date("2025-02-27");

app.action("action-waka-setup-unix", async ({ ack, body, client, logger }) => {
  track("action-waka-setup-unix", body.user.id);

  const userInfo = await app.client.users.info({ user: body.user.id });
  const apiKeyResponse = await createWakaUser(userInfo).then((d) => d.json());

  await ack();

  try {
    if (body.type !== "block_actions" || !body.view) {
      return;
    }
    // Call views.update with the built-in client
    const result = await client.views.push({
      trigger_id: body.trigger_id,
      view: {
        type: "modal",
        callback_id: "modal-waka-setup-unix",
        notify_on_close: true,
        title: {
          type: "plain_text",
          text: "Setup for macOS/Linux",
        },
        blocks: [
          {
            type: "section",
            block_id: "section-intro",
            text: {
              type: "mrkdwn",
              text: `This should be the content of the file at \`~/.wakatime.cfg\`.
\`\`\`\n[settings]\napi_url = https://waka.hackclub.com/api\napi_key = ${apiKeyResponse.api_key}\n\`\`\`

If you don't know what this means, that's okay! Follow these steps;

1. Press ⌘ (command) and spacebar together, then search for "Terminal"
2. Paste the following text in: \`echo "[settings]\\napi_url = https://waka.hackclub.com/api\\napi_key = ${apiKeyResponse.api_key}" > ~/.wakatime.cfg\`
3. Press ⏎ return!
              `,
            },
          },
        ],
        close: {
          type: "plain_text",
          text: "Back",
        },
      },
    });
  } catch (error) {
    logger.error(error);
  }
});

app.view(
  { callback_id: "modal-waka-setup-windows", type: "view_closed" },
  async ({ ack, body, view, client, logger }) => {
    await ack({
      response_action: "update",
      view: await buildSockView(body),
    });
  },
);

app.view(
  { callback_id: "modal-waka-setup-unix", type: "view_closed" },
  async ({ ack, body, view, client, logger }) => {
    logger.info("unix setup view closed");
    await ack({
      response_action: "update",
      view: await buildSockView(body),
    });
  },
);

app.action(
  "action-waka-setup-windows",
  async ({ ack, body, client, logger }) => {
    track("action-waka-setup-windows", body.user.id);

    const userInfo = await app.client.users.info({ user: body.user.id });
    const apiKeyResponse = await createWakaUser(userInfo).then((d) => d.json());

    await ack();

    try {
      if (body.type !== "block_actions" || !body.view) {
        return;
      }
      // Call views.update with the built-in client
      const result = await client.views.push({
        trigger_id: body.trigger_id,
        // View payload with updated blocks
        view: {
          type: "modal",
          callback_id: "modal-waka-setup-windows",
          notify_on_close: true,
          title: {
            type: "plain_text",
            text: "Setup for Windows",
          },
          blocks: [
            {
              type: "section",
              block_id: "section-intro",
              text: {
                type: "mrkdwn",
                text: `This should be the content of the file at \`~/.wakatime.cfg\`.
\`\`\`\n[settings]\napi_url = https://waka.hackclub.com/api\napi_key = ${apiKeyResponse.api_key}\n\`\`\`

If you don't know what this means, that's okay! Follow these steps;

1. Press the Windows key, then search for "Powershell"
2. Paste the following text in: \`cmd /c "echo [settings]>%USERPROFILE%\.wakatime.cfg && echo api_url = https://waka.hackclub.com/api>>%USERPROFILE%\.wakatime.cfg && echo api_key = ${apiKeyResponse.api_key}>>%USERPROFILE%\.wakatime.cfg"\`
3. Press ⏎ return!
              `,
              },
            },
          ],
          close: {
            type: "plain_text",
            text: "Back",
          },
        },
      });
    } catch (error) {
      logger.error(error);
    }
  },
);

// Open modal
app.action("action-clan-create", async ({ ack, body, client, logger }) => {
  track("action-clan-create", body.user.id);
  await ack();

  try {
    if (body.type !== "block_actions" || !body.view) {
      return;
    }
    // Call views.update with the built-in client
    const result = await client.views.push({
      trigger_id: body.trigger_id,
      // View payload with updated blocks
      view: {
        type: "modal",
        callback_id: "modal-clan-create",
        notify_on_close: true,
        title: {
          type: "plain_text",
          text: "Create a team",
        },
        blocks: [
          {
            type: "input",
            block_id: "input-clan-create-name",
            element: {
              type: "plain_text_input",
              action_id: "action-clan-create",
            },
            label: {
              type: "plain_text",
              text: "Name your team",
              emoji: true,
            },
          },
        ],
        close: {
          type: "plain_text",
          text: "Back",
        },
        submit: {
          type: "plain_text",
          text: "Create",
        },
      },
    });
  } catch (error) {
    logger.error(error);
  }
});

app.view(
  { callback_id: "modal-clan-create", type: "view_closed" },
  async ({ ack, body, view, client, logger }) => {
    logger.info("modal-clan-create view_closed", { body });

    await ack({
      response_action: "update",
      view: await buildSockView(body),
    });
  },
);

// React to submission
app.view(
  { callback_id: "modal-clan-create", type: "view_submission" },
  async ({ ack, body, view, client, logger }) => {
    track("modal-clan-create", body.user.id);
    logger.info("modal-clan-create view_submission");

    try {
      const newClanName =
        view.state.values["input-clan-create-name"]?.["action-clan-create"]
          ?.value;
      const joinCode = Math.random().toString(36).substring(2, 6);

      await sql.begin(async (tx) => {
        const [newClan] =
          await tx`insert into clans (name, join_code) values (${newClanName}, ${joinCode}) returning id`;
        await tx`update users set clan_id = ${newClan.id} where slack_id = ${body.user.id};`;
      });

      if (!process.env.EVENT_CHANNEL) {
        console.error("Env var EVENT_CHANNEL needs to be defined");
        process.exit();
      }

      await client.chat.postMessage({
        channel: process.env.EVENT_CHANNEL,
        text: `_Awe-filled sock noises_\n*Translation:* ⚔️ _A new challenger approaches!_\n<@${body.user.id}> just founded team *${newClanName}*! DM them for the join code.`,
      });
      await client.chat.postMessage({
        channel: body.user.id,
        text: `_Proud sock noises_\n*Translation:* Team "${newClanName}" created successfully! Give people this join code: \`${joinCode}\`. Team sizes must be <= 6 people.`,
      });
      await ack({
        response_action: "update",
        view: await buildSockView(body),
      });
    } catch (err: any) {
      if (err.errno === "23505") {
        await ack({
          response_action: "errors",
          errors: {
            "input-clan-create-name": "This team name is already taken!",
          },
        });
      } else {
        await ack({
          response_action: "errors",
          errors: {
            "input-clan-create-name": err.toString(),
          },
        });
      }
    }
  },
);

app.view(
  { callback_id: "modal-clan-join", type: "view_closed" },
  async ({ ack, body, view, client, logger }) => {
    await ack({
      response_action: "update",
      view: await buildSockView(body),
    });
  },
);

// React to submission
app.view(
  { callback_id: "modal-clan-join", type: "view_submission" },
  async ({ ack, body, view, client, logger }) => {
    track("modal-clan-join", body.user.id);

    try {
      const joinCode =
        view.state.values["input-clan-join-code"]?.["action-clan-join"]?.value;

      const clan = await sql.begin(async (tx) => {
        const [clan] =
          await tx`select clans.*, count(users) from clans left join users on clans.id = users.clan_id where join_code = ${joinCode} group by clans.id;`;

        if (!clan) return 0;
        if (clan.count >= 6) return 1;

        await tx`update users set clan_id = ${clan.id} where slack_id = ${body.user.id};`;

        return clan;
      });

      if (!clan) {
        await ack({
          response_action: "errors",
          errors: {
            "input-clan-join-code":
              "Invalid code! You should assert_eq!(code.len(), 4) then retry.",
          },
        });
        return;
      } else if (clan === 1) {
        await ack({
          response_action: "errors",
          errors: {
            "input-clan-join-code": "This team is already at 6 members!",
          },
        });
        return;
      }

      const others =
        await sql`select slack_id from users where clan_id = ${clan.id};`.then(
          (res) =>
            res.filter(
              ({ slack_id }: { slack_id: string }) => slack_id !== body.user.id,
            ),
        );

      if (!process.env.EVENT_CHANNEL) {
        console.error("Env var EVENT_CHANNEL needs to be defined");
        process.exit();
      }

      await client.chat.postMessage({
        channel: process.env.EVENT_CHANNEL,
        text: `_Happy sock noises_\n*Translation:* :huggies-fast: <@${body.user.id}> just joined *${clan.name}*${others.length > 0 ? `, teaming up with ${others.map(({ slack_id }: { slack_id: string }) => `<@${slack_id}>`).join(" & ")}` : "!"}`,
      });
      await client.chat.postMessage({
        channel: body.user.id,
        text: `_Excited sock noises_\n*Translation:* Team "${clan.name}" joined successfully! Give people this join code: \`${clan.join_code}\`. Team sizes must be <= 6 people.`,
      });

      await ack({
        response_action: "update",
        view: await buildSockView(body),
      });
    } catch (err: any) {
      await ack({
        response_action: "errors",
        errors: {
          "input-clan-join-code": err.toString(),
        },
      });
    }
  },
);

// Open modal
app.action("action-clan-join", async ({ ack, body, client, logger }) => {
  track("action-clan-join", body.user.id);
  await ack();

  try {
    if (body.type !== "block_actions" || !body.view) {
      return;
    }
    // Call views.update with the built-in client
    const result = await client.views.push({
      trigger_id: body.trigger_id,
      // View payload with updated blocks
      view: {
        type: "modal",
        callback_id: "modal-clan-join",
        notify_on_close: true,
        title: {
          type: "plain_text",
          text: "Create a team",
        },
        blocks: [
          {
            type: "input",
            block_id: "input-clan-join-code",
            element: {
              type: "plain_text_input",
              action_id: "action-clan-join",
            },
            label: {
              type: "plain_text",
              text: "Enter your 4-character join code",
              emoji: true,
            },
          },
        ],
        close: {
          type: "plain_text",
          text: "Back",
        },
        submit: {
          type: "plain_text",
          text: "Join",
        },
      },
    });
  } catch (error) {
    logger.error(error);
  }
});

app.action("action-clan-leave", async ({ ack, body, client, logger }) => {
  track("action-clan-leave", body.user.id);

  // Acknowledge the button request
  await ack();

  try {
    if (body.type !== "block_actions" || !body.view) {
      return;
    }

    await sql`update users set clan_id = null where slack_id = ${body.user.id}`;
  } catch (error) {
    logger.error(error);
  }
});

app.command("/sock-board", async ({ ack, body, client, logger }) => {
  track("/sock-board", body.user_id);

  const intros = [
    "Here ye, here ye!",
    "Everysocky, gather around!",
    "Hold onto your socks!",
  ];
  const intro = intros[Math.floor(Math.random() * intros.length)];

  const leaderboardRows = await sql`SELECT
        c.id AS clan_id,
        c.name AS clan_name,
        COALESCE(SUM((project->>'total')::int), 0) AS total_seconds_coded
      FROM
        clans c
      LEFT JOIN
        users u ON c.id = u.clan_id
      LEFT JOIN
        user_hakatime_daily_summary uhds ON u.slack_id = uhds.user_id
      LEFT JOIN
        LATERAL jsonb_array_elements(uhds.summary->'projects') AS project ON true
      WHERE
        uhds.date >= ${eventStartDate.toISOString()} AND c.failed_at IS NULL
      GROUP BY
        c.id, c.name
      ORDER BY
        total_seconds_coded desc;
  `;

  const leaderboard = leaderboardRows.map(
    (
      {
        clan_name,
        total_seconds_coded,
      }: {
        clan_name: string;
        total_seconds_coded: number;
      },
      idx: number,
    ) => {
      let medal =
        idx === 0
          ? ":first_place_medal:"
          : idx === 1
            ? ":second_place_medal:"
            : idx === 2
              ? ":third_place_medal:"
              : "";

      return `${medal} ${clan_name}: ${(total_seconds_coded / 60 / 60).toFixed(1)} hours`;
    },
  );

  await client.chat.postMessage({
    channel: process.env.EVENT_CHANNEL!,
    text: `_Fanfare-y sock noises_\n*Translation:* ${intro} The <#${process.env.EVENT_CHANNEL}> standings are as follows:\n${leaderboard.join("\n")}\n\n> <@${body.user_id}> ran \`/sock-board\``,
  });

  await ack();
});

app.command("/sock-team", async ({ ack, body, client, logger }) => {
  track("/sock-team", body.user_id);
  await ack();

  const teamMembers =
    await sql`select u2.slack_id from users u1 join users u2 on u1.clan_id = u2.clan_id where u1.slack_id = ${body.user_id};`;

  const [clan] =
    await sql`select c.name from users u join clans c on u.clan_id = c.id where u.slack_id = ${body.user_id};`;

  const stats = await Promise.all(
    teamMembers.map(async ({ slack_id }: { slack_id: string }) => {
      return [
        slack_id,
        (await getSecondsCoded(slack_id, new Date())) ?? 0,
        (await getSecondsCodedTotal(slack_id)) ?? 0,
      ];
    }),
  );

  stats.sort((a, b) => b[2] - a[2]);

  const board = stats
    .map(([slackId, coded, totalCoded], idx) => {
      let medal =
        idx === 0
          ? ":first_place_medal: "
          : idx === 1
            ? ":second_place_medal: "
            : idx === 2
              ? ":third_place_medal: "
              : "";

      return `${medal}<@${slackId}> coded ${(totalCoded / 3600).toFixed(1)} hours total (${(coded / 60).toFixed(1)} mins today)`;
    })
    .join("\n");

  await client.chat.postMessage({
    channel: body.channel_id,
    text: `_Proclamatory sock noises_\n*Translation:* <#${process.env.EVENT_CHANNEL!}> standings for team *${clan.name}*:\n${board}\n\n> <@${body.user_id}> ran \`/sock-team\``,
  });
});

// Listen for a slash command invocation
app.command("/sock", async ({ ack, body, client, logger }) => {
  track("/sock", body.user_id);
  await ack();

  app.logger.info(body);

  try {
    const view = await buildSockView(body);
    await client.views.open({
      trigger_id: body.trigger_id,
      view,
    });
  } catch (error) {
    logger.error(error);
  }
});

// TODO: i have the new hbs. i need to normalise their time zones as per zrl doc, query /summary, then create the participanthackatimedailysummary table and overwrite them.
// if the last summary is less than 15 mins, and the new summary is greater than, then send a message saying "nice! you've got over 15 mins for today (monday)

// const job = new Cron("* * * * *", async () => {
//   const empty = lastTrackedHbIds.size === 0;
//   const minIdToSearchFor = empty ? 0 : Math.min(...lastTrackedHbIds.values());

//   const recentHeartbeats = await hackSql`
//     SELECT * FROM heartbeats
//     WHERE id > ${minIdToSearchFor}
//     ORDER BY time DESC
//     LIMIT 1000
//   `;

//   if (recentHeartbeats.length === 0) {
//     return; // No new heartbeats to process
//   }

//   const latestPerUser: any = {};
//   for (const hb of recentHeartbeats) {
//     const slackId: string = hb.user_id.split("-")[1];
//     if (!latestPerUser[slackId] || hb.id > latestPerUser[slackId].id) {
//       latestPerUser[slackId] = hb;
//     }
//   }

//   console.log({ latestPerUser });
// });

/// Body is passed for safety, so you can only get the current user's API key.
// async function getWakaApiKey(body: SlashCommand) {
//   const [user] =
//     await hackSql`select * from users where id LIKE '%sockathon-' || ${body.user_id};`;
//   return user.api_key;
// }
