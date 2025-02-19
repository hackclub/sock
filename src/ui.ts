import type { SlackViewAction, SlashCommand } from "@slack/bolt";
import type { View } from "@slack/web-api";

import { app, eventEndDate, eventStartDate } from "./bot";
import { createWakaUser, getLatestWakaData } from "./waka";
import { sql } from "bun";
import { ago, capitaliseFirstLetter } from "./utils";

export async function buildSockView(
  body: SlashCommand | SlackViewAction,
): Promise<View> {
  const slackId: string = body.user_id ?? body.user.id;
  const slackUsername: string = body.user_name ?? body.user.name;

  if (
    !slackId ||
    typeof slackId !== "string" ||
    !slackUsername ||
    typeof slackUsername !== "string"
  ) {
    const err = `Error while trying to construct /sock view. Slack ID and slack username should both be strings.`;
    app.logger.error(err);
    throw new Error(err);
  }

  const userInfo = await app.client.users.info({ user: slackId });

  if (!userInfo.ok || !userInfo?.user?.profile) {
    const err = `Failed to get user profile for ${slackId}`;
    app.logger.error(err);
    throw new Error(err);
  }
  const { profile, real_name, tz, tz_label, tz_offset } = userInfo.user;

  // Check if the event is already running. If it is, you can't join.
  const adjustedNowTimestamp = Date.now() + (tz_offset ?? 0) * 1000;
  console.log(ago(eventStartDate));
  if (
    adjustedNowTimestamp > eventStartDate.getTime() &&
    !(await sql`select * from users where slack_id = ${slackId}`)[0]
  ) {
    return {
      type: "modal",
      callback_id: "modal-sock",
      title: {
        type: "plain_text",
        text: `Sockathon has started!`,
        emoji: true,
      },
      blocks: [
        {
          type: "image",
          image_url:
            "https://cdn.hack.pet/slackcdn/f4d5baac8d4e96673c7f1db537b2f6ee.png",
          alt_text: "A sad-looking sock puppet",
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `_Regretful sock noises_\n*Translation:* I'm so sorry, but you've missed the start of the event - it started ${ago(eventStartDate)}! We'll run another one soon; keep an eye on <#C0266FRGT>!`,
          },
        },
      ],
    };
  }

  // Create the user in the Sockathon DB.
  await sql`insert into users (slack_id, username, real_name, first_name, last_name, email, tz, tz_label, tz_offset) values
    (${slackId}, ${slackUsername}, ${real_name}, ${profile.first_name}, ${profile.last_name}, ${profile.email}, ${tz}, ${tz_label}, ${tz_offset})
    on conflict do nothing`;

  const [extendedUserRow] =
    await sql`select users.*, clans.name as clan_name, clans.join_code from users left join clans on users.clan_id = clans.id where users.slack_id = ${slackId}`;

  const wakaResponse = await createWakaUser(userInfo)
    .then((d) => d.json())
    .catch((err) => app.logger.error(err));

  const latestWakaData = await getLatestWakaData(slackId);

  let rn =
    adjustedNowTimestamp < eventStartDate.getTime()
      ? eventStartDate.getTime() - adjustedNowTimestamp
      : eventEndDate.getTime() - adjustedNowTimestamp;

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
          text: `✅ Be in a team; you're in _${extendedUserRow.clan_name}_. Others can join with the code \`${extendedUserRow.join_code}\``,
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

  const conditionalLeaveTeamButton = extendedUserRow.clan_id
    ? [
        {
          type: "actions",
          elements: [
            {
              type: "button",
              text: {
                type: "plain_text",
                text: `Leave team ${extendedUserRow.clan_name} :X:`,
                emoji: true,
              },
              action_id: "action-clan-leave",
            },
          ],
        },
      ]
    : [];

  const hakatimeInfoBlock = latestWakaData
    ? [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `✅ Set up <https://github.com/hackclub/hackatime|Hackatime>. ↓If this looks wrong, reconfigure Hakatime↓\n*${capitaliseFirstLetter(ago(latestWakaData?.time))} you edited your ${latestWakaData?.language} project _${latestWakaData?.project}_ in ${latestWakaData?.editor}.*`,
          },
        },
        {
          type: "actions",
          elements: [
            {
              type: "button",
              text: {
                type: "plain_text",
                text: "Reconfigure Hackatime ( :windows10-windows-10-logo: )",
                emoji: true,
              },
              action_id: "action-waka-setup-windows",
            },
            {
              type: "button",
              text: {
                type: "plain_text",
                text: "Reconfigure Hackatime ( / :linux:)",
                emoji: true,
              },
              action_id: "action-waka-setup-unix",
            },
          ],
        },
      ]
    : [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: "_...and_ configure <https://github.com/hackclub/hackatime|Hackatime> so we can track how long you've coded.",
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

  return {
    type: "modal",
    callback_id: "modal-sock",
    title: {
      type: "plain_text",
      text: "Welcome to Sockathon!",
      emoji: true,
    },
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `🧑‍💻 Code for 10 days straight on a *group project*;\n\n🫵 Get Hack Club socks!\n\n🕙 ${Date.now() < eventStartDate.getTime() ? "Starts" : "Ends"} in ${days} days, ${hours} hours, and ${minutes} minutes.`,
        },
        accessory: {
          type: "image",
          image_url:
            "https://cdn.hackclubber.dev/slackcdn/2d084df51fb8808433741b78a9949577.png",
          alt_text: "A pair of Hack Club socks",
        },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `0. Join <#${process.env.EVENT_CHANNEL}>\n\n1. Form a team. Up to 6 people.\n\n2. Everyone must code for at least 15 mins per day, or you're all out.\n\n3. The team with the most hours after 10 days wins a grand prize!\n\n‼️ You've *all* got to be working on the same project, *committing to the same repo* every day! <https://forms.hackclub.com/t/fWcHAW3iE3us|At the end, you'll submit here.>`,
        },
      },
      {
        type: "divider",
      },
      {
        type: "header",
        text: {
          type: "plain_text",
          text: `TO PLAY, YOU MUST:`,
          emoji: true,
        },
      },
      teamInfoBlock,
      ...hakatimeInfoBlock,
      // {
      //   type: "section",
      //   text: {
      //     type: "mrkdwn",
      //     text: "*Currently, your ass has done neither of these things.* The above will change as you complete them!",
      //   },
      // },
      // ...conditionalLeaveTeamButton,
    ],
  };
}
