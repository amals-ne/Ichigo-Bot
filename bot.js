// --- 0. EXPRESS PING SERVER (Keeps Render Awake) ---
const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => res.send('Ichigo is online!'));
app.listen(PORT, () => console.log(`Ping server running on port ${PORT}`));

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
    ActivityType
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
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates,
    ],
});

// --- 4. LINK BLOCKER STORAGE ---
const linkBlockedChannels = {};

// --- 5. LINK DETECTION FUNCTION ---
const containsLink = (text) => {
    const urlRegex = /(https?:\/\/[^\s]+|www\.[^\s]+|discord\.gg\/[^\s]+|\.[a-z]{2,4}\/)/i;
    return urlRegex.test(text);
};

// --- 6. SLASH COMMANDS ---
const commands = [
    {
        name: 'linkblock',
        description: 'Blocks all links in the current channel and sets a custom warning message.',
        default_member_permissions: '8', 
        options: [
            {
                name: 'reason',
                description: 'The custom warning message to show users who post a link.',
                type: ApplicationCommandOptionType.String,
                required: true,
            },
        ],
    },
    {
        name: 'broadcast',
        description: 'Sends an official-looking announcement embed to a specified channel.',
        default_member_permissions: '8',
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
        default_member_permissions: '8',
        options: [
            {
                name: 'connect',
                description: 'Voice channel to join',
                type: ApplicationCommandOptionType.Channel,
                required: true,
            },
        ],
    },
];

// --- 7. REGISTER COMMANDS ---
async function registerCommands() {
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    try {
        console.log('Refreshing application (/) commands.');
        // NOTE: Only register to a specific guild for faster startup during development.
        // For production, you may want to use Routes.applicationCommands
        await rest.put(
            Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID, process.env.DISCORD_GUILD_ID),
            { body: commands },
        );
        console.log('Commands registered successfully.');
    } catch (error) {
        console.error('Failed to register commands:', error);
    }
}

// ----------------------------------------------------------------------
//                        *** ERROR DEBUGGING & LOGGING ***
// ----------------------------------------------------------------------

// *** CRITICAL PROCESS HANDLERS ***
// Catches exceptions that were not wrapped in a try/catch block
process.on('uncaughtException', (error, origin) => {
    console.error('🚨 UNCAUGHT EXCEPTION:', error, 'Origin:', origin);
    // DO NOT EXIT here if running on Render. Let Render restart the process.
});

// Catches promise rejections that were not handled by a .catch()
process.on('unhandledRejection', (reason, promise) => {
    console.error('⚠️ UNHANDLED REJECTION:', reason, 'Promise:', promise);
});

// *** DISCORD CONNECTION LOGGING ***
client.on('warn', info => console.log('🔶 DISCORD WARNING:', info));
client.on('error', error => console.error('🔴 DISCORD ERROR:', error));
client.on('debug', info => {
    // Log important connection info, but filter out noise
    if (info.includes('heartbeat') || info.includes('Gateway ping') || info.includes('Sending a heartbeat')) return;
    if (info.includes('State:')) console.log('🔵 DISCORD DEBUG:', info);
});

client.on('disconnect', (event) => {
    console.error(`❌ DISCORD DISCONNECT: Code ${event.code} - Reason: ${event.reason || 'Unknown'}`);
});

client.on('reconnecting', () => {
    console.log('🔄 DISCORD RECONNECTING...');
});
// ----------------------------------------------------------------------

// --- 8. READY EVENT ---
client.once('ready', () => {
    console.log(`🤖 Logged in as ${client.user.tag}!`);
    registerCommands();
    client.user.setPresence({
        activities: [{ name: 'for rule breakers!🛠️', type: ActivityType.Watching }],
        status: 'dnd',
    });
});

// --- 9. INTERACTION HANDLER ---
client.on('interactionCreate', async interaction => {
    // Wrap the entire handler in a try/catch to prevent a crash from one interaction
    try {
        if (!interaction.isCommand()) return;
        
        // Admin Check for mod commands
        const isModCommand = ['linkblock', 'broadcast', 'online'].includes(interaction.commandName);
        if (isModCommand && !interaction.memberPermissions.has('Administrator')) {
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
                await interaction.reply({ content: `❌ Could not send broadcast. Check bot permissions.`, ephemeral: true });
            }
        }

        // --- /online connect (Voice Join) ---
        if (commandName === 'online') {
            const vcChannel = interaction.options.getChannel('connect');
            if (!vcChannel || vcChannel.type !== 2) {
                return interaction.reply({ content: '🚫 Select a valid voice channel.', ephemeral: true });
            }

            try {
                const connection = joinVoiceChannel({
                    channelId: vcChannel.id,
                    guildId: vcChannel.guild.id,
                    adapterCreator: vcChannel.guild.voiceAdapterCreator,
                    selfMute: true,
                    selfDeaf: true,
                });
                
                // FIX: Create and subscribe an AudioPlayer to prevent auto-disconnect
                const player = createAudioPlayer();
                connection.subscribe(player); 

                entersState(connection, VoiceConnectionStatus.Ready, 30_000);
                await interaction.reply({ content: `✅ Connected to ${vcChannel.name} as muted/deafened. **(Connection Stabilized)**`, ephemeral: true });
                
                // Optional: Handle disconnect/reconnect attempts
                connection.on(VoiceConnectionStatus.Disconnected, async () => {
                    console.log(`🔊 Voice Disconnected from ${vcChannel.name}. Attempting to reconnect...`);
                    try {
                        await Promise.race([
                            entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
                            entersState(connection, VoiceConnectionStatus.NearConnection, 5_000),
                        ]);
                        console.log(`🔊 Voice Reconnected to ${vcChannel.name}.`);
                    } catch (error) {
                        connection.destroy();
                        console.error(`🔊 VOICE ERROR: Connection to ${vcChannel.name} failed to reconnect and was destroyed.`);
                    }
                });

            } catch (err) {
                console.error('Voice connection failed:', err);
                await interaction.reply({ content: '❌ Failed to connect to VC. Check bot permissions (Connect & Speak) and ensure you added the GuildVoiceStates intent.', ephemeral: true });
            }
        }
    } catch (error) {
        console.error('❌ CRITICAL ERROR IN INTERACTION HANDLER:', error);
        // Attempt to reply ephemerally if the interaction hasn't been replied to yet
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: '❌ An unexpected error occurred while processing this command.', ephemeral: true }).catch(e => console.error('Failed to send error reply:', e));
        }
    }
});

// --- 10. MESSAGE HANDLER (LINK DELETION) ---
client.on('messageCreate', async (message) => {
    // 1. Basic checks remain the same
    if (message.author.bot || !message.inGuild()) return;
    const channelId = message.channel.id;
    const customReason = linkBlockedChannels[channelId];

    // If link blocking is not active, stop here
    if (!customReason) return;

    // --- BYPASS CHECK FOR GIFS/MEDIA (Fixes GIF/Sticker deletion) ---
    // If the message contains an attachment, a sticker, or any embed, bypass the link check.
    const isMedia = message.attachments.size > 0 || message.stickers.size > 0 || message.embeds.some(embed => embed.type === 'image' || embed.type === 'gifv');
    
    // If the message has no text content (just media) OR it contains media, ignore it.
    if (message.content.length === 0 || isMedia) {
        return;
    }
    // --- END BYPASS LOGIC ---

    // 2. Check for links in the remaining messages (which are text-based or have only link content)
    if (containsLink(message.content)) {
        try { 
            await message.delete(); 
        } catch (err) { 
            // This is a common failure due to permissions. Log the failure.
            console.error('Failed to delete link message (permissions issue?):', err);
            return; 
        }

        const warningEmbed = new EmbedBuilder()
            .setColor('#FF0000')
            .setTitle('⛔ WARNING: Link Deletion')
            .setDescription(`**❌ Link Posting Violation ❌**\n\n**Do not post links in this channel!**\n**Action:** Deleted.\n**Channel Note:**\n>>> ${customReason}\n*Thank you for respecting the server rules.*`)
            .setAuthor({ name: message.author.tag, iconURL: message.author.displayAvatarURL() })
            .setTimestamp()
            .setFooter({ text: `This warning will self-delete in 5 seconds.` });

        try {
            const warningMessage = await message.channel.send({ content: `<@${message.author.id}>`, embeds: [warningEmbed] });
            setTimeout(() => warningMessage.delete().catch(err => console.error('Failed to delete warning message:', err)), 5000);
        } catch (error) {
            console.error(`Failed to send warning:`, error);
        }
    }
});

// --- 11. CLIENT LOGIN ---
client.login(process.env.DISCORD_TOKEN);
