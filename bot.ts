import { App } from "@slack/bolt";

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_APP_SIGNING_SECRET,
});

await app.start();
app.logger.info("Bolt app is running");

// Listen for a slash command invocation
app.command("/sock", async ({ ack, body, client, logger }) => {
  await ack();

  app.logger.info(body);

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
              text: "Starts in 8 days, 17 hours, 36 minutes.",
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
                value: "click_me_123",
              },
              {
                type: "button",
                text: {
                  type: "plain_text",
                  text: "Join a team :handshake:",
                  emoji: true,
                },
                value: "click_me_123",
                url: "https://google.com",
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
                action_id: "actionId-0",
              },
              {
                type: "button",
                text: {
                  type: "plain_text",
                  text: "I'm on MacOS  or Linux :linux:",
                  emoji: true,
                },
                value: "click_me_123",
                action_id: "actionId-1",
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
        ],
      },
    });
    logger.info(result);
  } catch (error) {
    logger.error(error);
  }
});
