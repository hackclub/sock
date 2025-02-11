import { App } from "@slack/bolt";
import { sql } from "bun";
import { createWakaUser, getLatestWakaData } from "./waka";
import { getSecondsCoded, hackSql, setUpDb } from "./db";
import { ago } from "./utils";
import { registerJobs } from "./jobs";

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

const eventStartDate = new Date("2025-02-10");

app.action("action-waka-setup-unix", async ({ ack, body, client, logger }) => {
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
4. Run \`/sock\` again
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

app.action(
  "action-waka-setup-windows",
  async ({ ack, body, client, logger }) => {
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
4. Run \`/sock\` again
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
  // Acknowledge the button request
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

// React to submission
app.view("modal-clan-create", async ({ ack, body, view, client, logger }) => {
  console.log(body, view);
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
      text: `_Proud sock noises_\n*Translation:* Team "${newClanName}" created successfully! Give people this join code: \`${joinCode}\`. Teams have to be between 2-6 people.`,
    });
    await ack();
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
});

// React to submission
app.view("modal-clan-join", async ({ ack, body, view, client, logger }) => {
  try {
    const joinCode =
      view.state.values["input-clan-join-code"]?.["action-clan-join"]?.value;
    console.log({ joinCode });

    const clan = await sql.begin(async (tx) => {
      const [clan] =
        await tx`select * from clans where join_code = ${joinCode};`;
      if (!clan) return;
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
      text: `_Excited sock noises_\n*Translation:* Team "${clan.name}" joined successfully! Give people this join code: \`${clan.join_code}\`. Teams have to be between 2-6 people.`,
    });

    await ack();
  } catch (err: any) {
    await ack({
      response_action: "errors",
      errors: {
        "input-clan-join-code": err.toString(),
      },
    });
  }
});

// Open modal
app.action("action-clan-join", async ({ ack, body, client, logger }) => {
  // Acknowledge the button request
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

// Listen for a slash command invocation
app.command("/sock", async ({ ack, body, client, logger }) => {
  await ack();

  app.logger.info(body);

  const userInfo = await app.client.users.info({ user: body.user_id });
  console.log("sockinit", { userInfo });

  if (!userInfo.ok || !userInfo?.user?.profile) {
    logger.error(`Failed to get user profile for ${body.user_id}`);
    return;
  }
  const { profile, real_name, tz, tz_label, tz_offset } = userInfo.user;

  const [extendedUserRow] = await sql.begin(async (tx) => {
    await tx`insert into users (slack_id, username, real_name, first_name, last_name, email, tz, tz_label, tz_offset) values
      (${body.user_id}, ${body.user_name}, ${real_name}, ${profile.first_name}, ${profile.last_name}, ${profile.email}, ${tz}, ${tz_label}, ${tz_offset})
      on conflict do nothing`;
    return await tx`select users.*, clans.name as clan_name, clans.join_code from users left join clans on users.clan_id = clans.id where users.slack_id = ${body.user_id}`;
  });

  const wakaResponse = await createWakaUser(userInfo)
    .then((d) => d.json())
    .catch((err) => logger.error(err));

  const latestWakaData = await getLatestWakaData(body.user_id);

  console.log({
    real_name,
    tz,
    tz_label,
    tz_offset,
    extendedUserRow,
    latestWakaData,
  });

  let rn = eventStartDate.getTime() - Date.now();
  let days = Math.floor(rn / (86400 * 1000));
  rn -= days * (86400 * 1000);
  let hours = Math.floor(rn / (60 * 60 * 1000));
  rn -= hours * (60 * 60 * 1000);
  let minutes = Math.floor(rn / (60 * 1000));

  const teamInfoBlock = extendedUserRow.clan_name
    ? {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `✅ Be in a team; you're in *${extendedUserRow.clan_name}*. Others can join with \`${extendedUserRow.join_code}\``,
        },
      }
    : {
        type: "actions",
        elements: [
          {
            type: "button",
            text: {
              type: "plain_text",
              text: "Create a team :tada:",
              emoji: true,
            },
            action_id: "action-clan-create",
          },
          {
            type: "button",
            text: {
              type: "plain_text",
              text: "Join a team :handshake:",
              emoji: true,
            },
            action_id: "action-clan-join",
          },
        ],
      };

  const hakatimeInfoBlock = latestWakaData
    ? [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `✅ Set up Hakatime; ${timeAgo.format(latestWakaData?.time)} you edited your ${latestWakaData?.language} project _${latestWakaData?.project}_ in ${latestWakaData?.editor}`,
          },
        },
      ]
    : [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: "_...and_ configure <https://github.com/hackclub/hackatime|Hakatime> so we can track how long you've coded.\n*If you've configured it previously, you'll need to do it again for this.*",
          },
        },
        {
          type: "actions",
          elements: [
            {
              type: "button",
              text: {
                type: "plain_text",
                text: "I'm on Windows :windows10-windows-10-logo:",
                emoji: true,
              },
              action_id: "action-waka-setup-windows",
            },
            {
              type: "button",
              text: {
                type: "plain_text",
                text: "I'm on MacOS  or Linux :linux:",
                emoji: true,
              },
              action_id: "action-waka-setup-unix",
            },
          ],
        },
      ];

  const hakatimeInstallRefresher = latestWakaData
    ? [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: "_...and_ configure <https://github.com/hackclub/hackatime|Hakatime> so we can track how long you've coded.\n*If you've configured it previously, you'll need to do it again for this.*",
          },
        },
        {
          type: "actions",
          elements: [
            {
              type: "button",
              text: {
                type: "plain_text",
                text: "Windows install instructions ",
                emoji: true,
              },
              action_id: "action-waka-setup-windows",
            },
            {
              type: "button",
              text: {
                type: "plain_text",
                text: "MacOS/Linux install instructions",
                emoji: true,
              },
              action_id: "action-waka-setup-unix",
            },
          ],
        },
      ]
    : [];

  try {
    // Call views.open with the built-in client
    const result = await client.views.open({
      // Pass a valid trigger_id within 3 seconds of receiving it
      trigger_id: body.trigger_id,
      // View payload
      view: {
        type: "modal",
        title: {
          type: "plain_text",
          text: "Welcome to Sockathon!",
          emoji: true,
        },
        blocks: [
          {
            type: "section",
            text: {
              type: "plain_text",
              text: "Code for 10 days straight on a group project, get Hack Club socks! :socks:",
              emoji: true,
            },
          },
          {
            type: "divider",
          },
          {
            type: "section",
            text: {
              type: "plain_text",
              text: "1. Form a team. You know, your friends. Which you have. :huggies-fast:\n\n2. Everyone must code for over 15 mins per day, or you're all out! :eyes_shaking:\n\n3. Team with the most hours after 10 days wins ('/sock prizes' btw) :party-parrot:",
              emoji: true,
            },
          },
          {
            type: "divider",
          },
          {
            type: "header",
            text: {
              type: "plain_text",
              text: `What do I need to do to get started?`,
              emoji: true,
            },
          },
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: "To partake in these shenanigans, you must;",
            },
          },
          teamInfoBlock,
          ...hakatimeInfoBlock,
          {
            type: "divider",
          },
          // {
          //   type: "section",
          //   text: {
          //     type: "mrkdwn",
          //     text: "*Currently, your ass has done neither of these things.* The above will change as you complete them!",
          //   },
          // },
          {
            type: "header",
            text: {
              type: "plain_text",
              text: `Starts in ${days} days, ${hours} hours, and ${minutes} minutes! :clock10:`,
              emoji: true,
            },
          },
          ...hakatimeInstallRefresher,
          {
            type: "section",
            text: {
              type: "plain_text",
              text: `${JSON.stringify(extendedUserRow)}`,
              emoji: true,
            },
          },
        ],
      },
    });
  } catch (error) {
    logger.error(error);
  }
});

const lastTrackedHbIds = new Map<string, [number, Date]>(); // <users.slack_id, [heartbeats.id, heartbeats.time]>
const minIdToSearchFor =
  lastTrackedHbIds.size === 0
    ? 0
    : Math.min(...Array.from(lastTrackedHbIds.values()).map(([num]) => num));

console.log("Fetching usres");
const recentHeartbeats =
  await hackSql`SELECT * FROM heartbeats WHERE id > ${minIdToSearchFor} ORDER BY time DESC LIMIT 1000;`;
console.log("fetched usres");
// if (recentHeartbeats.length === 0) {
//   return; // No new heartbeats to process
// }

for (const hb of recentHeartbeats) {
  const slackId: string = hb.user_id.slice(-11);
  const currentEntry = lastTrackedHbIds.get(slackId);

  if (!currentEntry || hb.id > currentEntry[0]) {
    lastTrackedHbIds.set(slackId, [hb.id, hb.time]);
  }
}

// For each entry, normalise the time zone, to determine which summary day should be fetched.
for (const [slackId, [lastHbId, lastHbTime]] of lastTrackedHbIds.entries()) {
  // The wakatime `time`s are in UTC. Convert them to the user's static time zone, then decide the day.
  const userInfo = await app.client.users.info({ user: slackId });
  const [user] = await sql`select * from users where slack_id = ${slackId}`;
  if (!user) continue;

  const userTzOffsetMs = user.tz_offset * 1_000;
  const hbLocalTime = new Date(lastHbTime.getTime() + userTzOffsetMs);

  console.log({ user, hbLocalTime });
}

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

async function createWakaUser(userInfo: UsersInfoResponse) {
  if (!process.env.WAKA_USERNAME_PREFIX) {
    console.error("Env var WAKA_USERNAME_PREFIX not set. Exiting.");
    process.exit();
  }
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
    email: userInfo.user.profile?.email ?? "",
    password: userRow.hakatime_password,
    password_repeat: userRow.hakatime_password,
    name: userInfo.user.name,
    username: "test5" + process.env.WAKA_USERNAME_PREFIX + userInfo.user.id,
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

/// Body is passed for safety, so you can only get the current user's API key.
// async function getWakaApiKey(body: SlashCommand) {
//   const [user] =
//     await hackSql`select * from users where id LIKE '%sockathon-' || ${body.user_id};`;
//   return user.api_key;
// }

async function getLatestWakaData(slackId: string): Promise<{
  project: string;
  language: string;
  editor?: string;
  time: any;
} | null> {
  console.log({ slackId });
  const [hb] =
    await hackSql`select * from heartbeats where user_id = 'test5sockathon-' || ${slackId} order by time desc limit 1;`;

  if (!hb) return null;

  return {
    project: hb.project,
    language: hb.language,
    editor: hb.editor,
    time: hb.time,
  };
}
