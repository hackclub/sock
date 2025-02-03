import { App } from "@slack/bolt";
import { sql } from "bun";

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
  console.log({ real_name, tz, tz_label, tz_offset });

  const [userRow] = await sql.begin(async (tx) => {
    await tx`insert into users (slack_id, username, real_name, first_name, last_name, email, tz, tz_label, tz_offset) values
      (${body.user_id}, ${body.user_name}, ${real_name}, ${profile.first_name}, ${profile.last_name}, ${profile.email}, ${tz}, ${tz_label}, ${tz_offset})
      on conflict do nothing`;
    return await tx`select * from users where slack_id = ${body.user_id}`;
  });

  let rn = eventStartDate.getTime() - Date.now();
  let days = Math.floor(rn / (86400 * 1000));
  rn -= days * (86400 * 1000);
  let hours = Math.floor(rn / (60 * 60 * 1000));
  rn -= hours * (60 * 60 * 1000);
  let minutes = Math.floor(rn / (60 * 1000));

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
            type: "header",
            text: {
              type: "plain_text",
              text: `Starts in ${days} days, ${hours} hours, and ${minutes} minutes! :clock10:`,
              emoji: true,
            },
          },
          {
            type: "divider",
          },
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: "To partake in these shenanigans, you must;",
            },
          },
          {
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
                action_id: "modal-clan-join",
              },
            ],
          },
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
            type: "section",
            text: {
              type: "plain_text",
              text: `${JSON.stringify(userRow)}`,
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
