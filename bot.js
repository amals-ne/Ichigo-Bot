// --- 0. REQUIRED MODULES ---
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
    Events, 
    GatewayIntentBits, 
    EmbedBuilder, 
    REST, 
    Routes, 
    ApplicationCommandOptionType,
    ActivityType,
    PermissionFlagsBits,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
} = require('discord.js');
const { 
    joinVoiceChannel, 
    entersState, 
    VoiceConnectionStatus,
    createAudioPlayer, 
    getVoiceConnection, // 👈 ADDED: To get existing connection for /disconnect
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
        .setFooter({ text: client.user.tag, iconURL: client.user.displayAvatarURL() });

    try {
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

// --- 6. LINK DETECTION FUNCTION (FIXED FOR GIF/EXTERNAL LINKS) ---
/**
 * Detects external links but bypasses official Discord CDN links (used by Nitro GIFs, attachments).
 * @param {string} text 
 * @returns {boolean} True if a non-Discord link is found.
 */
const containsLink = (text) => {
    // 1. Regex to find any common URL structure (http, https, www, .com, discord.gg)
    const urlRegex = /(https?:\/\/[^\s]+|www\.[^\s]+|discord\.gg\/[^\s]+|\.[a-z]{2,4}\/)/i;
    
    // 2. Regex to check for Discord's official CDN. This is where Nitro/Tenor GIFs resolve.
    // We are looking specifically for attachments/emojis/icons hosted by discordapp.com
    const isDiscordAsset = /https:\/\/cdn\.discordapp\.com\/(emojis|attachments|icons)\//i.test(text);

    // Block the link ONLY if a link is found AND it is NOT an official Discord asset link.
    // This allows the internal GIF links to pass through.
    return urlRegex.test(text) && !isDiscordAsset;
};


// --- 7. SLASH COMMANDS ---
const commands = [
    {
        name: 'linkblock',
        description: 'Blocks all links in the current channel and sets a custom warning message.',
        default_member_permissions: PermissionFlagsBits.Administrator.toString(),
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
        name: 'connect', // 👈 RENAMED from 'online'
        description: 'Connect bot to a voice channel as muted/deafened.',
        default_member_permissions: PermissionFlagsBits.Administrator.toString(),
        options: [
            { name: 'channel', description: 'Voice channel to join', type: ApplicationCommandOptionType.Channel, required: true }, // 👈 Renamed option for clarity
        ],
    },
    {
        name: 'disconnect', // 👈 NEW COMMAND
        description: 'Disconnects the bot from its current voice channel.',
        default_member_permissions: PermissionFlagsBits.Administrator.toString(),
    },
];

// --- 8. REGISTER COMMANDS ---
async function registerCommands() {
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    try {
        console.log('Refreshing application (/) commands.');
        // FIX: Added environmental variable checks for safety (Recommended best practice)
        if (!process.env.DISCORD_CLIENT_ID || !process.env.DISCORD_GUILD_ID) {
            throw new Error("Missing DISCORD_CLIENT_ID or DISCORD_GUILD_ID in environment variables.");
        }
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

// ... (Process Handlers, Discord Logging, and Ready Event remain unchanged) ...

client.once(Events.ClientReady, () => {
    // ... (rest of the ready block) ...
    registerCommands();
    client.user.setPresence({
        activities: [{ name: 'for rule breakers! 🛠️', type: ActivityType.Watching }],
        status: 'dnd',
    });
    // ... (self-ping loop) ...
});

// --- 10. INTERACTION HANDLER ---
client.on(Events.InteractionCreate, async interaction => {
    try {
        if (!interaction.isChatInputCommand()) return; 

        const { commandName } = interaction;

        const isModCommand = ['linkblock', 'broadcast', 'connect', 'disconnect'].includes(interaction.commandName); // 👈 Updated list
        if (isModCommand && !interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
             // ... (Permission Denied Embed) ...
             const errorEmbed = new EmbedBuilder()
                 .setColor('#FF4444')
                 .setTitle('🚫 Permission Denied')
                 .setDescription('You must have **Administrator** permissions to use this command.')
                 .setThumbnail('https://cdn.discordapp.com/emojis/994444412779126865.gif?size=96&quality=lossless')
                 .setFooter({ text: 'Command Execution Failed', iconURL: client.user.displayAvatarURL() })
                 .setTimestamp();
            return interaction.reply({ embeds: [errorEmbed], ephemeral: true });
        }
        
        // --- /ping ---
        if (commandName === 'ping') {
            // ... (ping logic remains unchanged) ...
             const latency = Date.now() - interaction.createdTimestamp;
             const apiLatency = client.ws.ping;
             const status = apiLatency < 150 ? '🟢 Excellent' : apiLatency < 300 ? '🟡 Good' : '🔴 Poor';
 
             const pingEmbed = new EmbedBuilder()
                 .setColor(apiLatency < 150 ? '#22C55E' : apiLatency < 300 ? '#F59E0B' : '#EF4444')
                 .setTitle('🏓 Pong!')
                 .setDescription(`**Connection Status:** ${status}`)
                 .addFields(
                     { name: '🤖 Bot Latency', value: `\`${latency}ms\``, inline: true },
                     { name: '📡 API Latency', value: `\`${apiLatency}ms\``, inline: true },
                     { name: '🕒 Uptime', value: `<t:${Math.floor((Date.now() - client.uptime) / 1000)}:R>`, inline: true }
                 )
                 .setThumbnail('https://cdn.discordapp.com/emojis/992823455538544670.gif?size=96&quality=lossless')
                 .setFooter({ text: `Requested by ${interaction.user.tag}`, iconURL: interaction.user.displayAvatarURL() })
                 .setTimestamp();
 
             const row = new ActionRowBuilder()
                 .addComponents(
                     new ButtonBuilder()
                         .setLabel('Support Server')
                         .setStyle(ButtonStyle.Link)
                         .setURL('https://discord.gg/your-server'),
                     new ButtonBuilder()
                         .setLabel('Invite Bot')
                         .setStyle(ButtonStyle.Link)
                         .setURL('https://discord.com/oauth2/authorize?client_id=YOUR_CLIENT_ID')
                 );
 
             await interaction.reply({ embeds: [pingEmbed], components: [row], ephemeral: false });
        }

        // --- /linkblock ---
        if (commandName === 'linkblock') {
            // ... (linkblock logic remains unchanged) ...
             const reason = interaction.options.getString('reason');
             const channelId = interaction.channelId;
             linkBlockedChannels[channelId] = reason;
 
             const confirmationEmbed = new EmbedBuilder()
                 .setColor('#F59E0B')
                 .setTitle('🛡️ Link Blocker Activated')
                 .setDescription(`**Channel Protection Enabled**\n<#${channelId}> is now secured against unauthorized links.`)
                 .addFields(
                     { name: '🔒 Protection Status', value: '```🟢 ACTIVE```', inline: true },
                     { name: '👮 Moderator', value: `\`${interaction.user.tag}\``, inline: true },
                     { name: '📝 Custom Message', value: `>>> ${reason}` }
                 )
                 .setThumbnail('https://cdn.discordapp.com/emojis/992823453267918898.gif?size=96&quality=lossless')
                 .setFooter({ text: 'Links will be automatically deleted', iconURL: client.user.displayAvatarURL() })
                 .setTimestamp();
 
             const row = new ActionRowBuilder()
                 .addComponents(
                     new ButtonBuilder()
                         .setCustomId('disable_linkblock')
                         .setLabel('Disable Protection')
                         .setStyle(ButtonStyle.Danger)
                         .setEmoji('❌')
                 );
 
             await interaction.reply({ embeds: [confirmationEmbed], components: [row] });
        }

        // --- /broadcast ---
        if (commandName === 'broadcast') {
            // ... (broadcast logic remains unchanged) ...
             const targetChannel = interaction.options.getChannel('channel');
             const messageContent = interaction.options.getString('message');
             if (!targetChannel.isTextBased()) {
                 const errorEmbed = new EmbedBuilder()
                     .setColor('#FF4444')
                     .setTitle('❌ Invalid Channel')
                     .setDescription('Please select a valid text channel for the broadcast.')
                     .setThumbnail('https://cdn.discordapp.com/emojis/994444412779126865.gif?size=96&quality=lossless');
 
                 return interaction.reply({ embeds: [errorEmbed], ephemeral: true });
             }
 
             const broadcastEmbed = new EmbedBuilder()
                 .setColor('#3B82F6')
                 .setTitle('📢 Official Announcement')
                 .setDescription(messageContent)
                 .addFields(
                     { name: '📅 Announcement Date', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true },
                     { name: '👤 Posted By', value: `\`${interaction.user.tag}\``, inline: true }
                 )
                 .setThumbnail('https://cdn.discordapp.com/emojis/992823454910148698.gif?size=96&quality=lossless')
                 .setImage('https://cdn.discordapp.com/attachments/1063273368487469097/1063273368487469097/announcement-banner.png')
                 .setFooter({ text: 'Important Announcement • Please read carefully', iconURL: interaction.guild.iconURL() })
                 .setTimestamp();
 
             try {
                 await targetChannel.send({ content: '@everyone', embeds: [broadcastEmbed] });
                 
                 const successEmbed = new EmbedBuilder()
                     .setColor('#22C55E')
                     .setTitle('✅ Broadcast Sent')
                     .setDescription(`Successfully delivered announcement to ${targetChannel}`)
                     .setThumbnail('https://cdn.discordapp.com/emojis/992823455538544670.gif?size=96&quality=lossless')
                     .setFooter({ text: 'Broadcast System', iconURL: client.user.displayAvatarURL() })
                     .setTimestamp();
 
                 await interaction.reply({ embeds: [successEmbed], ephemeral: true });
             } catch (error) {
                 console.error(`Could not send broadcast:`, error);
                 logToDiscord('❌ Broadcast Error', `Failed to send broadcast message.\nError: ${error.message}\nStack: ${error.stack}`, '#FF4500');
                 
                 const errorEmbed = new EmbedBuilder()
                     .setColor('#FF4444')
                     .setTitle('❌ Broadcast Failed')
                     .setDescription('Could not send broadcast. Please check bot permissions in the target channel.')
                     .setThumbnail('https://cdn.discordapp.com/emojis/994444412779126865.gif?size=96&quality=lossless');
 
                 await interaction.reply({ embeds: [errorEmbed], ephemeral: true });
             }
        }

        // --- /connect (Voice Join) ---
        if (commandName === 'connect') {
            const vcChannel = interaction.options.getChannel('channel');
            if (!vcChannel || vcChannel.type !== 2) {
                // ... (Invalid Channel Embed) ...
                const errorEmbed = new EmbedBuilder()
                    .setColor('#FF4444')
                    .setTitle('❌ Invalid Channel')
                    .setDescription('Please select a valid voice channel to connect to.')
                    .setThumbnail('https://cdn.discordapp.com/emojis/994444412779126865.gif?size=96&quality=lossless');
                return interaction.reply({ embeds: [errorEmbed], ephemeral: true });
            }

            await interaction.deferReply({ ephemeral: true }); 

            try {
                const connection = joinVoiceChannel({
                    channelId: vcChannel.id,
                    guildId: vcChannel.guild.id,
                    adapterCreator: vcChannel.guild.voiceAdapterCreator,
                    selfMute: true,
                    selfDeaf: true,
                });
                
                const player = createAudioPlayer();
                connection.subscribe(player); 

                await entersState(connection, VoiceConnectionStatus.Ready, 30_000); 

                const successEmbed = new EmbedBuilder()
                    .setColor('#22C55E')
                    .setTitle('🔊 Voice Connection Established')
                    .setDescription(`Successfully connected to **${vcChannel.name}**`)
                    .addFields(
                        { name: '🔇 Status', value: '```🟢 CONNECTED```', inline: true },
                        { name: '🎤 Microphone', value: '`MUTED`', inline: true },
                        { name: '🔊 Sound', value: '`DEAFENED`', inline: true }
                    )
                    .setThumbnail('https://cdn.discordapp.com/emojis/992823455538544670.gif?size=96&quality=lossless')
                    .setFooter({ text: 'Voice Channel Manager', iconURL: client.user.displayAvatarURL() })
                    .setTimestamp();

                await interaction.editReply({ embeds: [successEmbed] });
                
                // Handle disconnections gracefully
                connection.on(VoiceConnectionStatus.Disconnected, async () => {
                    // ... (reconnection logic remains unchanged) ...
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
                        logToDiscord('🔴 VOICE RECONNECT FAILURE', `Connection to ${vcChannel.name} failed to reconnect and was destroyed.\nError: ${error.message}`, '#FF4500');
                    }
                });

            } catch (err) {
                console.error('Voice connection failed:', err);
                logToDiscord('🔴 VC Connection Failed', `Command: /connect\nError: ${err.message}\nStack: ${err.stack}`, '#FF0000');
                
                // ... (Error Embed) ...
                const errorEmbed = new EmbedBuilder()
                    .setColor('#FF4444')
                    .setTitle('❌ Connection Failed')
                    .setDescription('Failed to connect to the voice channel. Please check permissions and try again.')
                    .addFields(
                        { name: '🔧 Troubleshooting', value: '• Check bot permissions\n• Ensure channel is not full\n• Verify voice channel accessibility' }
                    )
                    .setThumbnail('https://cdn.discordapp.com/emojis/994444412779126865.gif?size=96&quality=lossless');
                await interaction.editReply({ embeds: [errorEmbed] });
            }
        }

        // --- /disconnect (Voice Leave) --- 👈 NEW COMMAND LOGIC
        if (commandName === 'disconnect') {
            await interaction.deferReply({ ephemeral: true });

            const connection = getVoiceConnection(interaction.guildId);

            if (!connection) {
                const errorEmbed = new EmbedBuilder()
                    .setColor('#F59E0B')
                    .setTitle('❓ Already Disconnected')
                    .setDescription('The bot is not currently connected to any voice channel in this server.')
                    .setThumbnail('https://cdn.discordapp.com/emojis/994444412779126865.gif?size=96&quality=lossless');

                return interaction.editReply({ embeds: [errorEmbed] });
            }

            try {
                connection.destroy();
                
                const successEmbed = new EmbedBuilder()
                    .setColor('#22C55E')
                    .setTitle('👋 Voice Disconnected')
                    .setDescription('Successfully disconnected from the voice channel.')
                    .setThumbnail('https://cdn.discordapp.com/emojis/992823455538544670.gif?size=96&quality=lossless')
                    .setFooter({ text: 'Voice Channel Manager', iconURL: client.user.displayAvatarURL() })
                    .setTimestamp();

                await interaction.editReply({ embeds: [successEmbed] });

            } catch (error) {
                console.error('Failed to destroy voice connection:', error);
                logToDiscord('🔴 VC Disconnect Failure', `Command: /disconnect\nError: ${error.message}\nStack: ${error.stack}`, '#FF0000');
                
                const errorEmbed = new EmbedBuilder()
                    .setColor('#FF4444')
                    .setTitle('❌ Disconnection Failed')
                    .setDescription('An error occurred while trying to disconnect the bot.')
                    .setThumbnail('https://cdn.discordapp.com/emojis/994444412779126865.gif?size=96&quality=lossless');
                await interaction.editReply({ embeds: [errorEmbed] });
            }
        }

    } catch (error) {
        // ... (general interaction error handling remains unchanged) ...
         console.error('❌ CRITICAL ERROR IN INTERACTION HANDLER:', error);
         logToDiscord('❌ INTERACTION HANDLER CRASH', `Command failed.\nError: ${error.message}\nStack: ${error.stack}`, '#8B0000');
         
         const errorEmbed = new EmbedBuilder()
             .setColor('#8B0000')
             .setTitle('💥 Critical Error')
             .setDescription('An unexpected error occurred while processing this command.')
             .setFooter({ text: 'Please contact support if this persists', iconURL: client.user.displayAvatarURL() })
             .setTimestamp();
 
         if (!interaction.replied && !interaction.deferred) {
             await interaction.reply({ embeds: [errorEmbed], ephemeral: true }).catch(e => console.error('Failed to send error reply:', e));
         } else if (interaction.deferred) {
             await interaction.editReply({ embeds: [errorEmbed] }).catch(e => console.error('Failed to edit error reply:', e));
         }
    }
});

// --- 11. MESSAGE HANDLER (LINK DELETION) ---
client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.inGuild()) return;
    const channelId = message.channel.id;
    const customReason = linkBlockedChannels[channelId];

    if (!customReason) return;

    // IGNORE ADMINS/MODERATORS
    if (message.member && message.member.permissions.has(PermissionFlagsBits.Administrator)) {
        return;
    }

    // Bypass if the message contains genuine attachments or stickers (for uploads).
    const isAttachmentOrSticker = message.attachments.size > 0 || message.stickers.size > 0;
    
    // Check if the message contains a non-Discord link AND does not have an upload.
    if (containsLink(message.content) && !isAttachmentOrSticker) {
        try { 
            await message.delete(); 
        } catch (err) { 
            console.error('Failed to delete link message (permissions issue?):', err);
            logToDiscord('🔶 Link Delete Permission Alert', `Bot failed to delete a link message in <#${message.channel.id}>. Check 'Manage Messages' permission.\nError: ${err.message}`, '#FF8C00');
            return; 
        }

        // ... (Warning Embed logic remains unchanged) ...
        const warningEmbed = new EmbedBuilder()
            .setColor('#EF4444')
            .setTitle('🚫 Link Detected & Removed')
            .setDescription(`**Security System Activated**\nUnauthorized link posting detected and automatically removed.`)
            .addFields(
                { name: '👤 User', value: `${message.author} (\`${message.author.tag}\`)`, inline: true },
                { name: '📌 Channel', value: `${message.channel}`, inline: true },
                { name: '📝 Channel Rules', value: `>>> ${customReason}` }
            )
            .setThumbnail('https://cdn.discordapp.com/emojis/992823453267918898.gif?size=96&quality=lossless')
            .setFooter({ text: 'Automated Security System • This message will self-destruct', iconURL: client.user.displayAvatarURL() })
            .setTimestamp();

        try {
            const warningMessage = await message.channel.send({ 
                content: `${message.author}`,
                embeds: [warningEmbed] 
            });
            setTimeout(() => warningMessage.delete().catch(err => console.error('Failed to delete warning message:', err)), 5000);
        } catch (error) {
            console.error(`Failed to send warning:`, error);
        }
    }
});

// --- 12. BUTTON INTERACTIONS ---
client.on(Events.InteractionCreate, async interaction => {
    if (!interaction.isButton()) return;
    // ... (disable_linkblock logic remains unchanged) ...
    if (interaction.customId === 'disable_linkblock') {
         if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
             const errorEmbed = new EmbedBuilder()
                 .setColor('#FF4444')
                 .setTitle('🚫 Permission Denied')
                 .setDescription('Only administrators can disable link protection.')
                 .setThumbnail('https://cdn.discordapp.com/emojis/994444412779126865.gif?size=96&quality=lossless');
 
             return interaction.reply({ embeds: [errorEmbed], ephemeral: true });
         }
 
         delete linkBlockedChannels[interaction.channelId];
 
         const successEmbed = new EmbedBuilder()
             .setColor('#22C55E')
             .setTitle('🛡️ Protection Disabled')
             .setDescription('Link blocking has been **disabled** for this channel.')
             .addFields(
                 { name: '🔓 Status', value: '```🔴 INACTIVE```', inline: true },
                 { name: '👮 Moderator', value: `\`${interaction.user.tag}\``, inline: true }
             )
             .setThumbnail('https://cdn.discordapp.com/emojis/992823455538544670.gif?size=96&quality=lossless')
             .setFooter({ text: 'Channel protection disabled', iconURL: client.user.displayAvatarURL() })
             .setTimestamp();
 
         await interaction.reply({ embeds: [successEmbed] });
         await interaction.message.edit({ components: [] });
    }
});

// --- 13. CLIENT LOGIN ---
client.login(process.env.DISCORD_TOKEN);
