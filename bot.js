const axios = require('axios');
const fs = require('fs');
const ethers = require('ethers');
const readline = require('readline');
const FormData = require('form-data');
const chalk = require('chalk');
const TelegramBot = require('node-telegram-bot-api');

// 10 different color styles for output messages with borders
const colorStyles = [
    chalk.bold.red,
    chalk.bold.green,
    chalk.bold.yellow,
    chalk.bold.blue,
    chalk.bold.magenta,
    chalk.bold.cyan,
    chalk.bold.white,
    chalk.underline.red,
    chalk.underline.green,
    chalk.underline.blue,
];

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

// The bot instance will be set after token is provided.
let bot;

// Utility logging function to print to console and send to the Telegram user
async function userLog(chatId, message) {
    console.log(message);
    try {
        await bot.sendMessage(chatId, message);
    } catch (err) {
        console.error("Error sending log message to user:", err.message);
    }
}

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

async function createAndProcessWallet(walletNumber, totalWallets, refCode, chatId) {
    const style = colorStyles[(walletNumber - 1) % colorStyles.length];
    await userLog(chatId, style("=================================="));
    await userLog(chatId, style(`Creating wallet ${walletNumber}/${totalWallets}...`));
    const walletData = await createWallet(refCode, chatId);
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

    await userLog(chatId, style("=================================="));
    return walletData;
}

async function main(count, refCode, chatId) {
    const wallets = [];
    
    for (let i = 0; i < count; i++) {
        const walletData = await createAndProcessWallet(i + 1, count, refCode, chatId);
        if (walletData) {
            wallets.push(walletData);
        }
        await new Promise(resolve => setTimeout(resolve, 1000)); 
    }

    const filename = `wallet_${chatId}.json`;
    let existingWallets = [];
    if (fs.existsSync(filename)) {
        try {
            existingWallets = JSON.parse(fs.readFileSync(filename, 'utf8'));
        } catch (error) {
            await userLog(chatId, `Error reading existing ${filename}: ${error.message}`);
        }
    }
    const updatedWallets = existingWallets.concat(wallets);
    fs.writeFileSync(filename, JSON.stringify(updatedWallets, null, 2));
    await userLog(chatId, chalk.bold.green(`Successfully created and processed ${wallets.length} wallets and saved to ${filename}`));
    
    // Send the wallet file to the user
    try {
        await bot.sendDocument(chatId, filename, {}, { filename: filename });
    } catch (error) {
        await userLog(chatId, `Error sending wallet file: ${error.message}`);
    }
}

// Conversation state for each user
const userState = {}; // { chatId: { stage: 'awaiting_count' | 'awaiting_ref', count: number, refCode: string } }

// Create a readline interface to get the Telegram bot token from the operator
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

rl.question('Enter your Telegram Bot Token: ', (token) => {
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

    // Handle /start command and conversation flow
    bot.on('message', async (msg) => {
        const chatId = msg.chat.id;
        const text = msg.text;

        // Initialize state for new users
        if (!userState[chatId]) {
            userState[chatId] = { stage: 'awaiting_count' };
        }

        // Command handling
        if (text === '/start') {
            userState[chatId] = { stage: 'awaiting_count' };
            await bot.sendMessage(chatId, 'Welcome! Please enter the number of wallets you want to create:');
            return;
        }

        // Process based on conversation stage
        const state = userState[chatId];
        if (state.stage === 'awaiting_count') {
            const count = parseInt(text);
            if (isNaN(count) || count <= 0) {
                await bot.sendMessage(chatId, 'Please enter a valid number.');
            } else {
                state.count = count;
                state.stage = 'awaiting_ref';
                await bot.sendMessage(chatId, 'Please enter your referral code:');
            }
            return;
        }

        if (state.stage === 'awaiting_ref') {
            state.refCode = text.trim();
            state.stage = 'processing';
            await bot.sendMessage(chatId, `Starting wallet creation for ${state.count} wallet(s) with referral code "${state.refCode}". Please wait...`);
            // Start the wallet creation process
            main(state.count, state.refCode, chatId);
            // Clear state after processing (or you can keep it if needed)
            delete userState[chatId];
            return;
        }
    });
});
