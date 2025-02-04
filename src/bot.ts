import { App } from "@slack/bolt";
import { SQL, sql } from "bun";
import { Cron } from "croner";

await sql`CREATE TABLE IF NOT EXISTS clans (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    join_code TEXT NOT NULL
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
    clan_id INTEGER REFERENCES clans(id)
)`;

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_APP_SIGNING_SECRET,
});

await app.start();
app.logger.info("Bolt app is running");

const eventStartDate = new Date("2025-02-10T00:00:00Z");

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
      text: `⚔️ _A new challenger approaches!_\n<@${body.user.id}> just founded team *${newClanName}*! DM them for the join code.`,
    });
    await client.chat.postMessage({
      channel: body.user.id,
      text: `Team "${newClanName}" created successfully! Give people this join code: \`${joinCode}\`. Teams have to be between 2-6 people.`,
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
      text: `:huggies-fast: <@${body.user.id}> just joined *${clan.name}*${others.length > 0 ? `, teaming up with ${others.map(({ slack_id }: { slack_id: string }) => `<@${slack_id}>`).join(" & ")}` : "!"}`,
    });
    await client.chat.postMessage({
      channel: body.user.id,
      text: `Team "${clan.name}" joined successfully! Give people this join code: \`${clan.join_code}\`. Teams have to be between 2-6 people.`,
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
  console.log(userInfo);

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

  console.log({ real_name, tz, tz_label, tz_offset, extendedUserRow });

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
                value: "click_me_123",
                action_id: "modal_hakatime_setup_windows",
              },
              {
                type: "button",
                text: {
                  type: "plain_text",
                  text: "I'm on MacOS  or Linux :linux:",
                  emoji: true,
                },
                value: "click_me_123",
                action_id: "modal_hakatime_setup_unix",
              },
            ],
          },
          {
            type: "divider",
          },
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: "*Currently, your ass has done neither of these things.* The above will change as you complete them!",
            },
          },
          {
            type: "header",
            text: {
              type: "plain_text",
              text: `Starts in ${days} days, ${hours} hours, and ${minutes} minutes! :clock10:`,
              emoji: true,
            },
          },
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

const job = new Cron("* * * * *", async () => {
  console.log("This will run every fifth second");

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

  //@ts-expect-error The SQL constructor wants all the options, but I just want to go with the defaults for the omitted SQLOptions fields.
  const hackSql = new SQL({
    url: process.env.HACK_PG_URL!,
    hostname: process.env.HACK_PG_HOST!,
    username: process.env.HACK_PG_USER!,
    password: process.env.HACK_PG_PASS!,
    database: process.env.HACK_PG_TABL!,
  });

  const recentRows =
    await hackSql`select * from heartbeats order by created_at desc limit 1000;`;

  console.log(recentRows);
});
