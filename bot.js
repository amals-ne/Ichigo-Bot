// --- 0. REQUIRED MODULES ---
// Add this line near the start of your bot.js file
console.log(`Node.js Version Detected: ${process.version}`);
const express = require('express');
const https = require('https');
const app = express();
const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0'; 

// Ping server setup (Keeps Render host alive)
app.get('/', (req, res) => res.send('Ichigo is online!'));
app.listen(PORT, HOST, () => console.log(`Ping server running on http://${HOST}:${PORT}`));

// --- 1. LOAD ENVIRONMENT VARIABLES ---
require('dotenv').config();

// --- 2. IMPORT DISCORD.JS & VOICE ---
const { 
    Client, 
    GatewayIntentBits, 
    EmbedBuilder, 
    REST, 
    Routes, 
    ApplicationCommandOptionType,
    ActivityType,
    PermissionFlagsBits, // Added for administrator check
} = require('discord.js');
const { 
    joinVoiceChannel, 
    entersState, 
    VoiceConnectionStatus,
    createAudioPlayer, 
} = require('@discordjs/voice');

// --- 3. BOT CONFIGURATION AND CLIENT INITIALIZATION ---
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent, // REQUIRED for link blocker
        GatewayIntentBits.GuildVoiceStates, // REQUIRED for /online connect
    ],
});

// --- 4. DISCORD LOGGING SYSTEM (Enhanced for Fetching) ---
const LOG_CHANNEL_ID = process.env.DISCORD_LOG_CHANNEL_ID;

/**
 * Sends a formatted error log to the designated Discord channel, reliably fetching the channel.
 * @param {string} title - The title of the embed (e.g., 'CRITICAL ERROR').
 * @param {string} description - The main content, usually the error stack or details.
 * @param {string} color - The hex color for the embed.
 */
async function logToDiscord(title, description, color) {
    if (!LOG_CHANNEL_ID || !client.isReady()) {
        console.error(`Attempted to log to Discord but client is not ready or LOG_CHANNEL_ID is missing.`);
        console.error(`Log Content: [${title}] ${description}`);
        return;
    }

    const logEmbed = new EmbedBuilder()
        .setColor(color)
        .setTitle(title)
        .setDescription(`\`\`\`\n${description.substring(0, 4000)}\n\`\`\``)
        .setTimestamp()
        .setFooter({ text: client.user.tag });

    try {
        // Use .fetch() for more reliable access, especially during startup or in critical logs
        const channel = client.channels.cache.get(LOG_CHANNEL_ID) || await client.channels.fetch(LOG_CHANNEL_ID); 
        if (channel) {
            await channel.send({ embeds: [logEmbed] });
        } else {
            console.error(`Could not find logging channel with ID: ${LOG_CHANNEL_ID}`);
        }
    } catch (err) {
        console.error('Failed to send error log to Discord:', err);
    }
}

// --- 5. LINK BLOCKER STORAGE ---
const linkBlockedChannels = {};

// --- 6. LINK DETECTION FUNCTION ---
const containsLink = (text) => {
    // Basic regex for common links and invite codes
    const urlRegex = /(https?:\/\/[^\s]+|www\.[^\s]+|discord\.gg\/[^\s]+|\.[a-z]{2,4}\/)/i;
    return urlRegex.test(text);
};

// --- 7. SLASH COMMANDS ---
const commands = [
    {
        name: 'linkblock',
        description: 'Blocks all links in the current channel and sets a custom warning message.',
        default_member_permissions: PermissionFlagsBits.Administrator.toString(), // Use PermissionFlagsBits
        options: [
            { name: 'reason', description: 'The custom warning message to show users who post a link.', type: ApplicationCommandOptionType.String, required: true },
        ],
    },
    {
        name: 'broadcast',
        description: 'Sends an official-looking announcement embed to a specified channel.',
        default_member_permissions: PermissionFlagsBits.Administrator.toString(),
        options: [
            { name: 'channel', description: 'The channel to send the broadcast to.', type: ApplicationCommandOptionType.Channel, required: true },
            { name: 'message', description: 'The content of the announcement.', type: ApplicationCommandOptionType.String, required: true },
        ],
    },
    {
        name: 'ping',
        description: 'Checks if the bot is online and reports its latency.',
    },
    {
        name: 'online',
        description: 'Connect bot to a voice channel as muted/deafened.',
        default_member_permissions: PermissionFlagsBits.Administrator.toString(),
        options: [
            { name: 'connect', description: 'Voice channel to join', type: ApplicationCommandOptionType.Channel, required: true },
        ],
    },
];

// --- 8. REGISTER COMMANDS ---
async function registerCommands() {
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    try {
        console.log('Refreshing application (/) commands.');
        // Assuming DISCORD_GUILD_ID is used for guild-specific commands (faster updates)
        await rest.put(
            Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID, process.env.DISCORD_GUILD_ID),
            { body: commands },
        );
        console.log('Commands registered successfully.');
    } catch (error) {
        console.error('Failed to register commands:', error);
        logToDiscord('❌ Command Registration Failed', error.stack || error.message, '#FF0000');
    }
}

// ----------------------------------------------------------------------
//                    *** ERROR DEBUGGING & LOGGING (CRITICAL) ***
// ----------------------------------------------------------------------

// *** CRITICAL PROCESS HANDLERS (Now logs and exits) ***
process.on('uncaughtException', (error, origin) => {
    const message = `UNCAUGHT EXCEPTION: ${error.stack || error.message}\nOrigin: ${origin}`;
    console.error(`🚨 ${message}`);
    logToDiscord('🚨 CRITICAL: UNCAUGHT EXCEPTION', message, '#8B0000');
    // Best practice: Exit after an uncaught exception to ensure a clean restart
    setTimeout(() => process.exit(1), 5000); 
});

process.on('unhandledRejection', (reason, promise) => {
    const message = `UNHANDLED REJECTION: ${reason.stack || reason.message || reason}`;
    console.error(`⚠️ ${message}`);
    logToDiscord('⚠️ WARNING: UNHANDLED REJECTION', message, '#FFA500');
});

// *** DISCORD CONNECTION LOGGING ***
client.on('error', error => {
    console.error('🔴 DISCORD ERROR:', error);
    logToDiscord('🔴 DISCORD ERROR', error.stack || error.message, '#FF0000');
});

client.on('disconnect', (event) => {
    const message = `DISCONNECT: Code ${event.code} - Reason: ${event.reason || 'Unknown'}`;
    console.error(`❌ ${message}`);
    logToDiscord('❌ DISCORD DISCONNECT', message, '#FF4500');
});

client.on('warn', info => console.log('🔶 DISCORD WARNING:', info));
client.on('reconnecting', () => {
    console.log('🔄 DISCORD RECONNECTING...');
    logToDiscord('🔄 DISCORD RECONNECTING', 'The client is attempting to reconnect to the gateway.', '#00BFFF');
});
// ----------------------------------------------------------------------

// --- 9. READY EVENT ---
client.once('ready', () => {
    console.log(`🤖 Logged in as ${client.user.tag}!`);
    logToDiscord('✅ BOT ONLINE', `Logged in successfully! Latency: ${client.ws.ping}ms`, '#32CD32');

    registerCommands();
    client.user.setPresence({
        activities: [{ name: 'for rule breakers!🛠️', type: ActivityType.Watching }],
        status: 'dnd',
    });

    // START SELF-PING LOOP: Prevents Render from killing the process
    setInterval(() => {
        https.get('https://ichigo-bot.onrender.com', (res) => {
            if (res.statusCode !== 200) {
                const message = `Self-Ping failed with status code: ${res.statusCode}.`;
                console.error(`Self-Ping Error: ${message}`);
                logToDiscord('🚨 HOSTING ALERT (Self-Ping)', message, '#FFD700');
            }
        }).on('error', (err) => {
            const message = `Self-Ping failed to connect: ${err.message}.`;
            console.error(`Self-Ping Error: ${message}`);
            logToDiscord('🚨 CRITICAL HOSTING FAILURE', message, '#FF4500');
        });
    }, 300000); // Ping every 5 minutes
});

// --- 10. INTERACTION HANDLER ---
client.on('interactionCreate', async interaction => {
    try {
        if (!interaction.isCommand()) return;
        
        // Command checks use the default_member_permissions set in the command definition, 
        // which is handled by Discord. This manual check is a good secondary layer.
        const isModCommand = ['linkblock', 'broadcast', 'online'].includes(interaction.commandName);
        if (isModCommand && !interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({ content: '🚫 You must have Administrator permissions to use this command.', ephemeral: true });
        }
        
        const { commandName } = interaction;

        // --- /ping ---
        if (commandName === 'ping') {
            const latency = Date.now() - interaction.createdTimestamp;
            const apiLatency = client.ws.ping;

            const pingEmbed = new EmbedBuilder()
                .setColor('#0099ff')
                .setTitle('Pong! 🏓')
                .setDescription(`**Latency:** ${latency}ms\n**API Latency:** ${apiLatency}ms`)
                .setTimestamp();

            await interaction.reply({ embeds: [pingEmbed], ephemeral: false });
        }

        // --- /linkblock ---
        if (commandName === 'linkblock') {
            const reason = interaction.options.getString('reason');
            const channelId = interaction.channelId;
            linkBlockedChannels[channelId] = reason;

            const confirmationEmbed = new EmbedBuilder()
                .setColor('#FFA500')
                .setTitle('🔗 Link Blocker Activated')
                .setDescription(`All links are now blocked in this channel: <#${channelId}>.\n\n**Custom Warning Message Set:**\n>>> ${reason}`)
                .setFooter({ text: 'The bot will now automatically delete links posted here.' });

            await interaction.reply({ embeds: [confirmationEmbed] });
        }

        // --- /broadcast ---
        if (commandName === 'broadcast') {
            const targetChannel = interaction.options.getChannel('channel');
            const messageContent = interaction.options.getString('message');
            if (!targetChannel.isTextBased()) return interaction.reply({ content: '🚫 Please select a valid text channel.', ephemeral: true });

            const broadcastEmbed = new EmbedBuilder()
                .setColor('#3498db')
                .setTitle('📣 Broadcast Message (Mods)')
                .setDescription(`**${messageContent}**`)
                .setTimestamp()
                .setFooter({ text: `Announcement posted by Moderator: ${interaction.user.tag}` });

            try {
                await targetChannel.send({ content: '@everyone', embeds: [broadcastEmbed] });
                await interaction.reply({ content: `✅ Broadcast sent successfully to ${targetChannel}!`, ephemeral: true });
            } catch (error) {
                console.error(`Could not send broadcast:`, error);
                logToDiscord('❌ Broadcast Error', `Failed to send broadcast message.\nError: ${error.message}\nStack: ${error.stack}`, '#FF4500');
                await interaction.reply({ content: `❌ Could not send broadcast. Check bot permissions.`, ephemeral: true });
            }
        }

        // --- /online connect (Voice Join) ---
        if (commandName === 'online') {
            const vcChannel = interaction.options.getChannel('connect');
            // Channel type 2 is a Voice Channel
            if (!vcChannel || vcChannel.type !== 2) {
                return interaction.reply({ content: '🚫 Select a valid voice channel.', ephemeral: true });
            }

            await interaction.deferReply({ ephemeral: true });

            try {
                const connection = joinVoiceChannel({
                    channelId: vcChannel.id,
                    guildId: vcChannel.guild.id,
                    adapterCreator: vcChannel.guild.voiceAdapterCreator,
                    selfMute: true, // Bot is muted
                    selfDeaf: true, // Bot is deafened
                });
                
                // Set up the connection state and monitor status
                const player = createAudioPlayer();
                connection.subscribe(player); 

                // Wait for the connection to be ready (critical step for stability)
                await entersState(connection, VoiceConnectionStatus.Ready, 30_000); 

                await interaction.editReply({ content: `✅ Connected to **${vcChannel.name}** as muted/deafened. **(Connection Stabilized)**` });
                
                // Handle disconnections gracefully
                connection.on(VoiceConnectionStatus.Disconnected, async () => {
                    console.log(`🔊 Voice Disconnected from ${vcChannel.name}. Attempting to reconnect...`); 
                    try {
                        // Attempt to reconnect within a short window
                        await Promise.race([
                            entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
                            entersState(connection, VoiceConnectionStatus.NearConnection, 5_000),
                        ]);
                        console.log(`🔊 Voice Reconnected to ${vcChannel.name}.`);
                    } catch (error) {
                        connection.destroy();
                        console.error(`🔊 VOICE ERROR: Connection to ${vcChannel.name} failed to reconnect and was destroyed.`);
                        logToDiscord('🔴 VOICE RECONNECT FAILURE', `Connection to ${vcChannel.name} failed to reconnect and was destroyed.\nError: ${error.message}`, '#FF4500');
                    }
                });

            } catch (err) {
                // This catches the 'No compatible encryption modes' error if the Node.js version is still old
                console.error('Voice connection failed:', err);
                logToDiscord('🔴 VC Connection Failed', `Command: /online connect\nError: ${err.message}\nStack: ${err.stack}`, '#FF0000');
                await interaction.editReply({ content: '❌ Failed to connect to VC. **HINT: If the error is "No compatible encryption modes," you must update your Node.js version to 18+ on the host.**' });
            }
        }
    } catch (error) {
        // Catch interaction errors (like timed out interactions)
        console.error('❌ CRITICAL ERROR IN INTERACTION HANDLER:', error);
        logToDiscord('❌ INTERACTION HANDLER CRASH', `Command failed.\nError: ${error.message}\nStack: ${error.stack}`, '#8B0000');
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: '❌ An unexpected error occurred while processing this command.', ephemeral: true }).catch(e => console.error('Failed to send error reply:', e));
        }
    }
});

// --- 11. MESSAGE HANDLER (LINK DELETION) (Enhanced with Admin Bypass) ---
client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.inGuild()) return;
    const channelId = message.channel.id;
    const customReason = linkBlockedChannels[channelId];

    if (!customReason) return;

    // IGNORE ADMINS/MODERATORS: Admins should be able to post links
    if (message.member && message.member.permissions.has(PermissionFlagsBits.Administrator)) {
        return;
    }

    // Bypass if the message is only media/sticker, even if it contains a link-like mention in the description
    const isMediaOrPreview = message.attachments.size > 0 || message.stickers.size > 0 || message.embeds.length > 0;
    
    if (containsLink(message.content) && !isMediaOrPreview) {
        try { 
            await message.delete(); 
        } catch (err) { 
            console.error('Failed to delete link message (permissions issue?):', err);
            logToDiscord('🔶 Link Delete Permission Alert', `Bot failed to delete a link message in <#${message.channel.id}>. Check 'Manage Messages' permission.\nError: ${err.message}`, '#FF8C00');
            return; 
        }

        const warningEmbed = new EmbedBuilder()
            .setColor('#FF0000')
            .setTitle('⛔ WARNING: Link Deletion')
            .setDescription(`**❌ Link Posting Violation ❌**\n<@${message.author.id}>, do not post links in this channel!\n\n**Channel Note:**\n>>> ${customReason}\n*This warning will self-delete in 5 seconds.*`)
            .setAuthor({ name: message.author.tag, iconURL: message.author.displayAvatarURL() })
            .setTimestamp();

        try {
            const warningMessage = await message.channel.send({ content: `<@${message.author.id}>`, embeds: [warningEmbed] });
            setTimeout(() => warningMessage.delete().catch(err => console.error('Failed to delete warning message:', err)), 5000);
        } catch (error) {
            console.error(`Failed to send warning:`, error);
        }
    }
});

// --- 12. CLIENT LOGIN ---
client.login(process.env.DISCORD_TOKEN);
