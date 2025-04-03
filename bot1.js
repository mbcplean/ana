const axios = require('axios');
const fs = require('fs');
const ethers = require('ethers');
const readline = require('readline');
const FormData = require('form-data');
const TelegramBot = require('node-telegram-bot-api');

// Remove color styling

const defaultHeaders = {
  "accept": "*/*",
  "accept-language": "en-US,en;q=0.9",
  "priority": "u=1, i",
  "sec-ch-ua": "\"Chromium\";v=\"134\", \"Not:A-Brand\";v=\"24\", \"Microsoft Edge\";v=\"134\"",
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": "\"Windows\"",
  "sec-fetch-dest": "empty",
  "sec-fetch-mode": "cors",
  "sec-fetch-site": "same-site",
  "Referer": "https://ai.zoro.org/",
  "Referrer-Policy": "strict-origin-when-cross-origin"
};

const imageMissions = {
  "hamster": "92611072-99d6-4d39-ae06-0ef4175c0aea",
  "cattle": "a78693c5-aae5-4d5c-9e07-f79777cbebbb",
  "kiwi": "a11b1dd4-316c-4b75-b8f5-0c6aba7876ae",
  "lemon": "f052e17c-36fe-4a2b-8fc3-272ec0097ffa",
  "lollipop": "b85fbda3-0bcd-4a1e-bc2e-9e6e0f855eaf"
};

const missionRewardIds = [
  "3bb23601-b879-42b4-be72-3e175974604b",
  "31e4891d-9c1e-4ca0-8362-5be848176bf4"
];

const imageUrls = {
  "hamster": "https://images.unsplash.com/photo-1425082661705-1834bfd09dca",
  "cattle": "https://images.unsplash.com/photo-1596733430284-f7437764b1a9",
  "kiwi": "https://images.unsplash.com/photo-1616684000067-36952fde56ec",
  "lemon": "https://images.unsplash.com/photo-1590502593747-42a996133562",
  "lollipop": "https://plus.unsplash.com/premium_photo-1661255468024-de3a871dfc16"
};

function generateRandomUsername() {
  const adjectives = ['Cool', 'Happy', 'Smart', 'Fast', 'Lucky'];
  const nouns = ['Cat', 'Dog', 'Bird', 'Fish', 'Tiger'];
  const number = Math.floor(Math.random() * 1000);
  return `${adjectives[Math.floor(Math.random() * adjectives.length)]}${nouns[Math.floor(Math.random() * nouns.length)]}${number}`;
}

// Global variables set at startup
let bot;
let ADMIN_ID; // Set via CLI input

// File names for persistent data
const BLOCKED_FILE = 'blocked.json';
const USAGE_FILE = 'usage.json';
const STATS_FILE = 'stats.json';
const USERS_FILE = 'users.json';
const WELCOME_FILE = 'welcome.txt';
const SUFFIX_FILE = 'suffix.txt';
const MAXLIMIT_FILE = 'maxlimit.json';

// Default welcome message and max limit
const DEFAULT_WELCOME = `This bot is for Zoro Airdrop referrals.
Zoro Airdrop link: https://ai.zoro.org?refCode=1Gun5Z8vO3eNBgi
This bot was made by @vikitoshi and @Muhannad2025`;
const DEFAULT_MAX_LIMIT = 100;

// Load persistent data functions
function loadJSON(filename, defaultValue) {
  try {
    if (fs.existsSync(filename)) {
      return JSON.parse(fs.readFileSync(filename, 'utf8'));
    }
  } catch (err) {
    console.error(`Error reading ${filename}:`, err.message);
  }
  return defaultValue;
}

function saveJSON(filename, data) {
  fs.writeFileSync(filename, JSON.stringify(data, null, 2));
}

function loadText(filename, defaultText) {
  try {
    if (fs.existsSync(filename)) {
      return fs.readFileSync(filename, 'utf8');
    }
  } catch (err) {
    console.error(`Error reading ${filename}:`, err.message);
  }
  return defaultText;
}

let blockedUsers = loadJSON(BLOCKED_FILE, []);
let usageData = loadJSON(USAGE_FILE, {});  // { chatId: { date: 'YYYY-MM-DD', count: number } }
let stats = loadJSON(STATS_FILE, { totalUsers: 0, totalWalletRequests: 0 });
let usersList = loadJSON(USERS_FILE, []);    // array of chat IDs
let welcomeMessage = loadText(WELCOME_FILE, DEFAULT_WELCOME);
let suffix = loadText(SUFFIX_FILE, "");
let maxLimit = loadJSON(MAXLIMIT_FILE, DEFAULT_MAX_LIMIT);

// Global dictionaries for pending/cancelled requests and admin state
const pendingRequests = {};  // chatId: { cancel: boolean }
const adminState = {};       // admin chatId: { stage: string }

// Utility logging function: sends to console and to Telegram user using code blocks
async function userLog(chatId, message) {
  const fullMessage = "```\n" + message + "\n```" + (suffix ? "\n" + suffix : "");
  console.log(message);
  try {
    await bot.sendMessage(chatId, fullMessage, { parse_mode: 'Markdown' });
  } catch (err) {
    console.error("Error sending log message to user:", err.message);
  }
}

// Create wallet function; returns { error: '409' } if error 409 occurs.
async function createWallet(refCode, chatId) {
  try {
    const wallet = ethers.Wallet.createRandom();
    const address = wallet.address;
    const privateKey = wallet.privateKey;

    await userLog(chatId, `Requesting login for address: ${address}`);
    const loginRequest = await axios.get(
      `https://api.zoro.org/user-auth/wallet/login-request?strategy=ETHEREUM_SIGNATURE&address=${address}`,
      { headers: defaultHeaders }
    );

    const { token, message } = loginRequest.data;
    const signature = await wallet.signMessage(message);

    await userLog(chatId, `Signing message for wallet ${address}`);
    const loginResponse = await axios.get(
      `https://api.zoro.org/user-auth/login?strategy=ETHEREUM_SIGNATURE&address=${address}&message=${message}&token=${token}&signature=${signature}&inviter=${refCode}`,
      { headers: defaultHeaders }
    );

    const { access_token } = loginResponse.data.tokens;
    const randomUsername = generateRandomUsername();

    const nicknameHeaders = {
      ...defaultHeaders,
      "authorization": `Bearer ${access_token}`
    };

    await axios.post(
      `https://api.zoro.org/user/set-nickname?nickname=${randomUsername}`,
      null,
      { headers: nicknameHeaders }
    );

    await userLog(chatId, `Wallet created - Address: ${address}, Username: ${randomUsername}`);
    return {
      address,
      privateKey,
      username: randomUsername,
      accessToken: access_token,
      message,
      signature
    };
  } catch (error) {
    if (error.response && error.response.status === 409) {
      await userLog(chatId, `Error creating wallet: Request failed with status code 409`);
      return { error: '409' };
    }
    await userLog(chatId, `Error creating wallet: ${error.message}`);
    if (error.response) {
      await userLog(chatId, `Response data: ${JSON.stringify(error.response.data)}`);
    }
    return null;
  }
}

async function claimDailyReward(accessToken, chatId) {
  try {
    await userLog(chatId, 'Claiming daily reward...');
    const response = await axios.post(
      "https://api.zoro.org/daily-rewards/claim",
      null,
      {
        headers: {
          ...defaultHeaders,
          "authorization": `Bearer ${accessToken}`
        }
      }
    );
    await userLog(chatId, 'Daily reward claimed successfully');
    return response.data;
  } catch (error) {
    await userLog(chatId, `Error claiming daily reward: ${error.message}`);
    return null;
  }
}

async function claimMissionReward(accessToken, rewardId, chatId) {
  try {
    await userLog(chatId, `Claiming mission reward ${rewardId}...`);
    const response = await axios.post(
      `https://api.zoro.org/mission-reward/${rewardId}`,
      null,
      {
        headers: {
          ...defaultHeaders,
          "authorization": `Bearer ${accessToken}`
        }
      }
    );
    await userLog(chatId, `Mission reward ${rewardId} claimed successfully`);
    return response.data;
  } catch (error) {
    await userLog(chatId, `Error claiming mission reward ${rewardId}: ${error.message}`);
    return null;
  }
}

async function completeImageMission(accessToken, missionType, missionId, chatId) {
  try {
    const imageUrl = imageUrls[missionType];
    await userLog(chatId, `Downloading image for mission ${missionType}...`);
    const imageResponse = await axios.get(imageUrl, { responseType: 'arraybuffer' });
    const imageBuffer = Buffer.from(imageResponse.data);

    const form = new FormData();
    form.append('image', imageBuffer, {
      filename: `${missionType}.jpg`,
      contentType: 'image/jpeg'
    });

    await userLog(chatId, `Completing mission ${missionType}...`);
    const response = await axios.post(
      `https://api.zoro.org/mission-activity/${missionId}`,
      form,
      {
        headers: {
          ...defaultHeaders,
          "authorization": `Bearer ${accessToken}`,
          "content-type": `multipart/form-data; boundary=${form._boundary}`
        }
      }
    );
    await userLog(chatId, `Mission ${missionType} completed successfully`);
    return response.data;
  } catch (error) {
    await userLog(chatId, `Error completing ${missionType} mission: ${error.message}`);
    return null;
  }
}

async function getAccountInfo(accessToken, chatId) {
  try {
    await userLog(chatId, 'Fetching account info...');
    const response = await axios.get(
      "https://api.zoro.org/scoreboard/me",
      {
        headers: {
          ...defaultHeaders,
          "authorization": `Bearer ${accessToken}`
        }
      }
    );
    const nickname = response.data.user.nickname;
    const { balance, rank } = response.data;
    await userLog(chatId, 'Account Info:');
    await userLog(chatId, `Nickname: ${nickname}`);
    await userLog(chatId, `Balance: ${balance}`);
    await userLog(chatId, `Rank: ${rank}`);
    return { nickname, balance, rank };
  } catch (error) {
    await userLog(chatId, `Error fetching account info: ${error.message}`);
    return null;
  }
}

// Create and process one wallet. failureCount is an object to count referral code errors.
async function createAndProcessWallet(walletNumber, totalWallets, refCode, chatId, failureCount) {
  // Check if admin cancelled this user's request.
  if (pendingRequests[chatId] && pendingRequests[chatId].cancel) {
    await userLog(chatId, "Your request has been cancelled by the admin.");
    return { cancelled: true };
  }
  const walletData = await createWallet(refCode, chatId);
  if (walletData && walletData.error === '409') {
    failureCount.value++;
    return { error409: true };
  }
  if (!walletData) return null;

  await claimDailyReward(walletData.accessToken, chatId);
  await new Promise(resolve => setTimeout(resolve, 500));

  for (const [missionType, missionId] of Object.entries(imageMissions)) {
    await completeImageMission(walletData.accessToken, missionType, missionId, chatId);
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  for (const rewardId of missionRewardIds) {
    await claimMissionReward(walletData.accessToken, rewardId, chatId);
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  await getAccountInfo(walletData.accessToken, chatId);
  return walletData;
}

async function main(count, refCode, chatId) {
  try {
    // Enforce daily limit
    const today = new Date().toISOString().slice(0, 10);
    if (!usageData[chatId] || usageData[chatId].date !== today) {
      usageData[chatId] = { date: today, count: 0 };
    }
    if (usageData[chatId].count + count > maxLimit) {
      await userLog(chatId, `Daily wallet creation limit reached. You have already created ${usageData[chatId].count} wallet(s) today. Maximum is ${maxLimit} per day.`);
      return;
    }

    // Increase global stats for wallet requests
    stats.totalWalletRequests += count;
    saveJSON(STATS_FILE, stats);

    let failureCount = { value: 0 };
    const wallets = [];
    for (let i = 0; i < count; i++) {
      // Check for admin cancellation
      if (pendingRequests[chatId] && pendingRequests[chatId].cancel) {
        await userLog(chatId, "Your request has been cancelled by the admin.");
        break;
      }
      const result = await createAndProcessWallet(i + 1, count, refCode, chatId, failureCount);
      if (result && result.cancelled) {
        break;
      }
      if (result && result.error409) {
        if (failureCount.value >= 3) {
          await userLog(chatId, "Your referral code is wrong");
          break;
        }
        // Retry the same iteration if fewer than 3 failures.
        i--;
        continue;
      }
      if (result) {
        wallets.push(result);
        // Save wallet immediately to user-specific file
        const filename = `wallet_${chatId}.json`;
        let existingWallets = [];
        if (fs.existsSync(filename)) {
          try {
            existingWallets = JSON.parse(fs.readFileSync(filename, 'utf8'));
          } catch (error) {
            await userLog(chatId, `Error reading existing ${filename}: ${error.message}`);
          }
        }
        existingWallets.push(result);
        fs.writeFileSync(filename, JSON.stringify(existingWallets, null, 2));
        // Send wallet creation log messages using code blocks
        await bot.sendMessage(chatId, "```✅️ Successful ✅️```", { parse_mode: 'Markdown' });
        // Create emoji style text for wallet count (example: Wallet 1️⃣ of 1️⃣0️⃣0️⃣ created)
        const walletCountMsg = `Wallet ${i + 1}️⃣ of ${count}️⃣ created`;
        await bot.sendMessage(chatId, "```" + walletCountMsg + "```", { parse_mode: 'Markdown' });
      }
      usageData[chatId].count++;
      saveJSON(USAGE_FILE, usageData);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    await userLog(chatId, `Successfully created and processed ${wallets.length} wallet(s).`);
    // Send the wallet file to the user
    try {
      await bot.sendDocument(chatId, `wallet_${chatId}.json`, {}, { filename: `wallet_${chatId}.json` });
    } catch (error) {
      await userLog(chatId, `Error sending wallet file: ${error.message}`);
    }
  } catch (err) {
    console.error("Error in main:", err);
  }
}

// Conversation state for each user
const userState = {}; // { chatId: { stage, count, refCode } }

// When a user sends /start, add them to usersList and update stats
async function handleStart(chatId) {
  if (!usersList.includes(chatId)) {
    usersList.push(chatId);
    saveJSON(USERS_FILE, usersList);
    stats.totalUsers++;
    saveJSON(STATS_FILE, stats);
  }
  // Send welcome message using Markdown code block formatting
  await bot.sendMessage(chatId, "```" + welcomeMessage + "```", { parse_mode: 'Markdown' });
  await bot.sendMessage(chatId, 'Please enter the number of wallets you want to create (max ' + maxLimit + ' per day):');
  userState[chatId] = { stage: 'awaiting_count' };
}

// Check if a user is blocked
function isBlocked(chatId) {
  return blockedUsers.includes(chatId);
}

// Global error handler to prevent crashes
process.on('uncaughtException', (err) => {
  console.error("Uncaught Exception:", err);
});

// Create a readline interface to get the Telegram bot token and admin ID from the operator
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

rl.question('Enter your Telegram Bot Token: ', (token) => {
  rl.question('Enter your Admin Telegram ID: ', (adminIdInput) => {
    ADMIN_ID = parseInt(adminIdInput);
    bot = new TelegramBot(token, { polling: true });
    console.log('Telegram bot started.');

    // Inline query handler for inline mode support
    bot.on('inline_query', (query) => {
      const results = [{
        type: 'article',
        id: '1',
        title: 'Wallet Creation Bot',
        input_message_content: {
          message_text: 'Use /start in a private chat with me to create wallets.'
        }
      }];
      bot.answerInlineQuery(query.id, results);
    });

    // Build admin inline menu with extra options
    function getAdminMenu() {
      return {
        reply_markup: {
          inline_keyboard: [
            [
              { text: '🚫 Block User', callback_data: 'block_user' },
              { text: '✅ Unblock User', callback_data: 'unblock_user' }
            ],
            [{ text: '❌ Cancel User Request', callback_data: 'cancel_request' }],
            [{ text: '📊 Show Stats', callback_data: 'show_stats' }],
            [{ text: '✏️ Change Welcome Message', callback_data: 'change_welcome' }],
            [{ text: '📝 Set Suffix', callback_data: 'set_suffix' }, { text: '🗑 Remove Suffix', callback_data: 'remove_suffix' }],
            [{ text: '🔧 Change Max Limit', callback_data: 'change_max_limit' }],
            [{ text: '📢 Broadcast', callback_data: 'broadcast' }]
          ]
        }
      };
    }

    // Handle /admin command from admin
    bot.on('message', async (msg) => {
      const chatId = msg.chat.id;
      const text = msg.text;
      // If sender is blocked, do nothing.
      if (isBlocked(chatId)) {
        await bot.sendMessage(chatId, 'You are blocked 🚫.');
        return;
      }
      // Admin commands
      if (chatId === ADMIN_ID && text === '/admin') {
        adminState[chatId] = { stage: 'idle' };
        await bot.sendMessage(chatId, 'Admin Menu:', getAdminMenu());
        return;
      }
      // Process admin text input for pending admin states
      if (chatId === ADMIN_ID && adminState[chatId] && adminState[chatId].stage !== 'idle') {
        switch (adminState[chatId].stage) {
          case 'block':
            {
              const targetId = parseInt(text.trim());
              if (isNaN(targetId)) {
                await bot.sendMessage(chatId, 'Invalid chat ID. Please send a valid number.');
                return;
              }
              if (!blockedUsers.includes(targetId)) {
                blockedUsers.push(targetId);
                saveJSON(BLOCKED_FILE, blockedUsers);
                await bot.sendMessage(chatId, `User ${targetId} has been blocked 🚫.`);
              } else {
                await bot.sendMessage(chatId, `User ${targetId} is already blocked.`);
              }
              adminState[chatId].stage = 'idle';
            }
            break;
          case 'unblock':
            {
              const targetId = parseInt(text.trim());
              if (isNaN(targetId)) {
                await bot.sendMessage(chatId, 'Invalid chat ID. Please send a valid number.');
                return;
              }
              if (blockedUsers.includes(targetId)) {
                blockedUsers = blockedUsers.filter(id => id !== targetId);
                saveJSON(BLOCKED_FILE, blockedUsers);
                await bot.sendMessage(chatId, `User ${targetId} has been unblocked.`);
              } else {
                await bot.sendMessage(chatId, `User ${targetId} is not in the blocked list.`);
              }
              adminState[chatId].stage = 'idle';
            }
            break;
          case 'cancel':
            {
              const targetId = parseInt(text.trim());
              if (isNaN(targetId)) {
                await bot.sendMessage(chatId, 'Invalid chat ID. Please send a valid number.');
                return;
              }
              pendingRequests[targetId] = { cancel: true };
              await bot.sendMessage(chatId, `Wallet creation request for user ${targetId} has been cancelled.`);
              try {
                await bot.sendMessage(targetId, "Your wallet creation request has been cancelled by the admin.");
              } catch (e) { }
              adminState[chatId].stage = 'idle';
            }
            break;
          case 'change_welcome':
            {
              welcomeMessage = text;
              fs.writeFileSync(WELCOME_FILE, welcomeMessage);
              await bot.sendMessage(chatId, "Welcome message updated.");
              adminState[chatId].stage = 'idle';
            }
            break;
          case 'set_suffix':
            {
              suffix = text;
              fs.writeFileSync(SUFFIX_FILE, suffix);
              await bot.sendMessage(chatId, "Suffix updated.");
              adminState[chatId].stage = 'idle';
            }
            break;
          case 'change_max_limit':
            {
              const newLimit = parseInt(text.trim());
              if (isNaN(newLimit) || newLimit <= 0) {
                await bot.sendMessage(chatId, 'Please provide a valid positive number for max limit.');
                return;
              }
              maxLimit = newLimit;
              saveJSON(MAXLIMIT_FILE, maxLimit);
              await bot.sendMessage(chatId, `Max wallet creation limit updated to ${maxLimit}.`);
              adminState[chatId].stage = 'idle';
            }
            break;
          case 'broadcast':
            {
              const broadcastText = text;
              for (const userId of usersList) {
                try {
                  await bot.sendMessage(userId, "```Broadcast Message:\n" + broadcastText + "```", { parse_mode: 'Markdown' });
                } catch (e) { }
              }
              await bot.sendMessage(chatId, "Broadcast message sent to all users.");
              adminState[chatId].stage = 'idle';
            }
            break;
          default:
            break;
        }
        return;
      }
      // End admin text input processing

      // For normal users, if they are not admin, process conversation.
      if (isBlocked(chatId)) {
        await bot.sendMessage(chatId, 'You are blocked 🚫.');
        return;
      }
      // For new users, handle /start to register them and show welcome message.
      if (text === '/start') {
        await handleStart(chatId);
        return;
      }
      // Process user conversation state for wallet creation
      if (!userState[chatId]) return;
      const state = userState[chatId];
      if (state.stage === 'awaiting_count') {
        const count = parseInt(text);
        if (isNaN(count) || count <= 0 || count > maxLimit) {
          await bot.sendMessage(chatId, 'Please enter a valid number (1-' + maxLimit + ').');
        } else {
          state.count = count;
          state.stage = 'awaiting_ref';
          await bot.sendMessage(chatId, 'Please enter your referral code (exactly 15 letters):');
        }
        return;
      }
      if (state.stage === 'awaiting_ref') {
        const refCode = text.trim();
        if (refCode.length !== 15) {
          await bot.sendMessage(chatId, 'Referral code must be exactly 15 letters. Please try again.');
          return;
        }
        state.refCode = refCode;
        state.stage = 'processing';
        await bot.sendMessage(chatId, `Starting wallet creation for ${state.count} wallet(s) with referral code "${state.refCode}". Please wait...`);
        main(state.count, state.refCode, chatId);
        delete userState[chatId];
        return;
      }
    });

    // Handle admin callback queries for inline actions
    bot.on('callback_query', async (callbackQuery) => {
      const action = callbackQuery.data;
      const adminChatId = callbackQuery.from.id;
      if (adminChatId !== ADMIN_ID) {
        await bot.answerCallbackQuery(callbackQuery.id, { text: 'You are not authorized to perform this action.' });
        return;
      }
      switch (action) {
        case 'block_user':
          adminState[adminChatId] = { stage: 'block' };
          await bot.sendMessage(adminChatId, 'Please send the chat ID of the user to block:');
          break;
        case 'unblock_user':
          adminState[adminChatId] = { stage: 'unblock' };
          await bot.sendMessage(adminChatId, 'Please send the chat ID of the user to unblock:');
          break;
        case 'cancel_request':
          adminState[adminChatId] = { stage: 'cancel' };
          await bot.sendMessage(adminChatId, 'Please send the chat ID of the user whose request you want to cancel:');
          break;
        case 'show_stats':
          await bot.sendMessage(adminChatId, `*Stats:*\nTotal Users: ${stats.totalUsers}\nTotal Wallet Requests: ${stats.totalWalletRequests}\nMax Limit: ${maxLimit}`, { parse_mode: 'Markdown' });
          break;
        case 'change_welcome':
          adminState[adminChatId] = { stage: 'change_welcome' };
          await bot.sendMessage(adminChatId, 'Please send the new welcome message:');
          break;
        case 'set_suffix':
          adminState[adminChatId] = { stage: 'set_suffix' };
          await bot.sendMessage(adminChatId, 'Please send the new suffix text:');
          break;
        case 'remove_suffix':
          suffix = "";
          fs.writeFileSync(SUFFIX_FILE, suffix);
          await bot.sendMessage(adminChatId, 'Suffix removed.');
          break;
        case 'change_max_limit':
          adminState[adminChatId] = { stage: 'change_max_limit' };
          await bot.sendMessage(adminChatId, 'Please send the new maximum wallet creation limit:');
          break;
        case 'broadcast':
          adminState[adminChatId] = { stage: 'broadcast' };
          await bot.sendMessage(adminChatId, 'Please send the message to broadcast to all users:');
          break;
        default:
          break;
      }
      await bot.answerCallbackQuery(callbackQuery.id);
    });
  });
});
