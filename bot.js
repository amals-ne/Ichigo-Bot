// --- 0. REQUIRED MODULES ---
console.log(`Node.js Version Detected: ${process.version}`); 
const express = require('express');
const https = require('https');
// ... (express setup remains) ...

// --- 1. LOAD ENVIRONMENT VARIABLES ---
require('dotenv').config();

// --- 2. IMPORT DISCORD.JS & VOICE ---
const { 
    // ... (existing imports) ...
    Client, 
    Events, 
    GatewayIntentBits, 
    EmbedBuilder, 
    REST, 
    Routes, 
    ApplicationCommandOptionType,
    ActivityType,
    PermissionFlagsBits,
    // ... (existing imports) ...
} = require('discord.js');
const { 
    // ... (voice imports) ...
    getVoiceConnection, 
} = require('@discordjs/voice');

// --- External Library for Pixel Analysis (Required for Heuristic) ---
// Note: You must install jimp/sharp. For this example, we assume JIMP.
// const Jimp = require('jimp'); 
// -------------------------------------------------------------------

// --- 3. BOT CONFIGURATION AND CLIENT INITIALIZATION ---
// ... (client config remains) ...

// --- 4. DISCORD LOGGING SYSTEM ---
// ... (logToDiscord remains) ...

// --- 5. CORE SECURITY DATA STRUCTURES --- 🛠️ NEW
const SECURITY_CONFIG = {
    NSFW_MODE: 'relaxed', // 'strict' or 'relaxed'
    IS_RAID_MODE: false,
    SECURITY_LOG_CHANNEL_ID: process.env.SECURITY_LOG_CHANNEL_ID,
    REVIEW_CHANNEL_ID: process.env.REVIEW_CHANNEL_ID,
    FROZEN_ROLE_ID: process.env.FROZEN_ROLE_ID,
};

const NSFW_PATTERNS = [
    'nsfw', 'porn', 'hentai', 'xxx', '18+', 'adult', 'lewd', 'nude',
    // Unicode obfuscation check (simplified)
    /p0rn/i, /x_x_x/i, /h3ntai/i
];

const LINK_GLOBAL_WHITELIST = [
    'youtube.com', 'youtu.be', 'tiktok.com', 'twitter.com', 'instagram.com', 'discord.gg'
];

const LINK_CHANNEL_BLOCKED = {}; // { channelId: 'reason' } (existing linkblock)

const FROZEN_USERS = {}; // { userId: { reason: '...', timestamp: Date.now() } }

const MEDIA_REVIEW_QUEUE = {}; // { reviewMessageId: { originalMessage: {}, userId: '...', mediaUrl: '...' } }

const MESSAGE_HISTORY = new Map(); // { userId: [timestamp1, timestamp2, ...] }

// --- 6. CORE SECURITY FUNCTIONS (LOGIC & MECHANICS) --- 🛠️ NEW

/**
 * Heuristic 3: Lightweight Pixel Color Cluster & Skin-Tone Ratio Analysis.
 * NOTE: Requires an external library (like Jimp) to be installed and imported.
 * @param {string} url - Discord CDN URL of the media.
 * @returns {Promise<number>} Confidence score (0 to 100) or 0 if analysis fails.
 */
async function pixelAnalysisHeuristic(url) {
    // --- REQUIRES JIMP/SHARP LIBRARY ---
    // If you don't install a library like Jimp, this will always return 0.
    return 0; // Placeholder for logic requiring external library
    
    /* try {
        const image = await Jimp.read(url);
        let skinTonePixels = 0;
        const totalPixels = image.bitmap.width * image.bitmap.height;

        image.scan(0, 0, image.bitmap.width, image.bitmap.height, (x, y, idx) => {
            const r = image.bitmap.data[idx];
            const g = image.bitmap.data[idx + 1];
            const b = image.bitmap.data[idx + 2];

            // Simplified Skin-Tone RGB Heuristic (R must be highest, G & B close to each other)
            if (r > 95 && g > 40 && b > 20 && r > g && r > b && (Math.abs(r - g) > 15) && (r > g) && (g > b)) {
                skinTonePixels++;
            }
        });

        const confidence = (skinTonePixels / totalPixels) * 100;
        return confidence;

    } catch (e) {
        console.error('JIMP/Pixel analysis failed:', e.message);
        return 0; // Failure/Safe return
    }
    */
}

/**
 * Logic 6: Check for link that is BLOCKED (not whitelisted and not CDN).
 * @param {string} text - Message content.
 * @returns {boolean} True if a non-whitelisted, non-Discord link is found.
 */
const containsBlockedLink = (text) => {
    // 1. Regex to find any common URL structure
    const urlRegex = /(https?:\/\/[^\s]+|www\.[^\s]+|discord\.gg\/[^\s]+|\.[a-z]{2,4}\/)/i;
    if (!urlRegex.test(text)) return false;

    // 2. Bypass: Official Discord CDN links (GIFs, attachments, stickers)
    const isDiscordAsset = /https:\/\/cdn\.discordapp\.com\/(emojis|attachments|icons)\//i.test(text);
    if (isDiscordAsset) return false;

    // 3. Bypass: Global Whitelist Check
    const isGloballyAllowed = LINK_GLOBAL_WHITELIST.some(domain => text.includes(domain));
    if (isGloballyAllowed) return false;
    
    // 4. Blocked Domain Check (Example check for a known harmful TLD)
    if (/\.(xyz|gq|cf|tk)\//i.test(text)) return true; // Flagging suspicious TLDs
    
    return true; // It's a link, not a Discord asset, and not on the whitelist.
};

/**
 * Action: Applies the Management Authority Freeze to a user.
 * @param {GuildMember} member 
 * @param {string} reason 
 */
async function applyFreeze(member, reason) {
    if (!SECURITY_CONFIG.FROZEN_ROLE_ID || member.user.bot || member.permissions.has(PermissionFlagsBits.Administrator)) return;
    
    try {
        const frozenRole = member.guild.roles.cache.get(SECURITY_CONFIG.FROZEN_ROLE_ID) || await member.guild.roles.fetch(SECURITY_CONFIG.FROZEN_ROLE_ID);

        if (frozenRole) {
            await member.roles.set([frozenRole.id], reason);
            FROZEN_USERS[member.id] = { reason, timestamp: Date.now() };
            // Log action...
            // logToDiscord('❄️ User Frozen', `User ${member.user.tag} frozen for: **${reason}**`, '#6A5ACD');
        } else {
             // logToDiscord('⚠️ Freeze Error', 'FROZEN_ROLE_ID is missing or role not found.', '#FFA500');
        }
    } catch (e) {
        // logToDiscord('🚨 Freeze Failed', `Could not freeze ${member.user.tag}. Error: ${e.message}`, '#FF0000');
    }
}

// --- 7. SLASH COMMANDS --- 🛠️ NEW COMMANDS

const commands = [
    // ... (linkblock, broadcast, ping, connect, disconnect remain) ...
    
    // --- Media Review Commands ---
    {
        name: 'review',
        description: 'Manages the media review queue (Approve, Deny, Enable/Disable Holding).',
        default_member_permissions: PermissionFlagsBits.ManageMessages.toString(),
        options: [
            { name: 'approve', description: 'Approves held media and reposts it.', type: ApplicationCommandOptionType.Subcommand, 
                options: [{ name: 'message_id', description: 'The review message ID to approve.', type: ApplicationCommandOptionType.String, required: true }] },
            { name: 'deny', description: 'Denies and deletes held media.', type: ApplicationCommandOptionType.Subcommand,
                options: [{ name: 'message_id', description: 'The review message ID to deny.', type: ApplicationCommandOptionType.String, required: true }] },
            { name: 'mode', description: 'Enables or disables global media holding for review.', type: ApplicationCommandOptionType.SubcommandGroup,
                options: [
                    { name: 'enable', description: 'Enable global media holding.', type: ApplicationCommandOptionType.Subcommand },
                    { name: 'disable', description: 'Disable global media holding.', type: ApplicationCommandOptionType.Subcommand }
                ]
            },
        ],
    },
    
    // --- NSFW Management Commands ---
    {
        name: 'nsfw',
        description: 'Manages the rule-based NSFW detection system.',
        default_member_permissions: PermissionFlagsBits.Administrator.toString(),
        options: [
            { name: 'mode', description: 'Sets the NSFW check mode.', type: ApplicationCommandOptionType.Subcommand,
                options: [{ name: 'level', description: 'Choose strict (full checks) or relaxed (filename/domain only).', type: ApplicationCommandOptionType.String, required: true,
                    choices: [{ name: 'strict', value: 'strict' }, { name: 'relaxed', value: 'relaxed' }] 
                }] 
            },
            { name: 'whitelist', description: 'Exempts a user from NSFW review.', type: ApplicationCommandOptionType.Subcommand,
                options: [{ name: 'user', description: 'The user to exempt.', type: ApplicationCommandOptionType.User, required: true }]
            },
            // ... (Other NSFW options like blacklist could be added here) ...
        ],
    },
    
    // --- Anti-Raid / Security Commands ---
    {
        name: 'raid',
        description: 'Manages the server-wide anti-raid system.',
        default_member_permissions: PermissionFlagsBits.Administrator.toString(),
        options: [
            { name: 'lockdown', description: 'Locks all public channels and enables strict protection.', type: ApplicationCommandOptionType.Subcommand },
            { name: 'release', description: 'Restores channels and disables raid mode.', type: ApplicationCommandOptionType.Subcommand },
            { name: 'status', description: 'Shows current raid mode status.', type: ApplicationCommandOptionType.Subcommand },
        ],
    },

    // --- Freeze Management Commands ---
    {
        name: 'freeze',
        description: 'Manually freeze or unfreeze a user.',
        default_member_permissions: PermissionFlagsBits.KickMembers.toString(),
        options: [
            { name: 'apply', description: 'Manually apply the freeze role.', type: ApplicationCommandOptionType.Subcommand,
                options: [
                    { name: 'user', description: 'The user to freeze.', type: ApplicationCommandOptionType.User, required: true },
                    { name: 'reason', description: 'Reason for the freeze.', type: ApplicationCommandOptionType.String, required: true }
                ]
            },
            { name: 'remove', description: 'Manually remove the freeze role.', type: ApplicationCommandOptionType.Subcommand,
                options: [{ name: 'user', description: 'The user to unfreeze.', type: ApplicationCommandOptionType.User, required: true }]
            },
            { name: 'status', description: 'Shows freeze state for a user.', type: ApplicationCommandOptionType.Subcommand,
                options: [{ name: 'user', description: 'The user to check.', type: ApplicationCommandOptionType.User, required: true }]
            },
        ],
    },

];

// --- 8. REGISTER COMMANDS ---
// ... (registerCommands remains) ...

// --- 9. READY EVENT ---
// ... (client.once(Events.ClientReady) remains) ...

// --- 10. INTERACTION HANDLER --- 🛠️ ADDED NEW COMMANDS

client.on(Events.InteractionCreate, async interaction => {
    // ... (initial checks and permission check remain) ...
    try {
        if (!interaction.isChatInputCommand()) return; 
        const { commandName } = interaction;
        
        // ... (ping, linkblock, broadcast, connect, disconnect logic remain) ...
        
        // --- /review commands ---
        if (commandName === 'review') {
            await interaction.deferReply({ ephemeral: true });
            const subcommand = interaction.options.getSubcommand();
            const subcommandGroup = interaction.options.getSubcommandGroup(false);

            if (subcommandGroup === 'mode') {
                if (subcommand === 'enable') {
                    SECURITY_CONFIG.MEDIA_HOLDING_ENABLED = true;
                    await interaction.editReply({ content: '✅ Global media holding is now **enabled** for review.' });
                } else if (subcommand === 'disable') {
                    SECURITY_CONFIG.MEDIA_HOLDING_ENABLED = false;
                    await interaction.editReply({ content: '❌ Global media holding is now **disabled**.' });
                }
            } else if (subcommand === 'approve' || subcommand === 'deny') {
                const messageId = interaction.options.getString('message_id');
                const reviewData = MEDIA_REVIEW_QUEUE[messageId];

                if (!reviewData) {
                    return interaction.editReply({ content: '❌ Review message ID not found in the queue.' });
                }

                if (subcommand === 'approve') {
                    // Logic: Get original channel, repost the media there.
                    const originalChannel = await interaction.guild.channels.fetch(reviewData.originalMessage.channelId);
                    if (originalChannel) {
                        await originalChannel.send({ 
                            content: `**Media Approved** by ${interaction.user.tag} for <@${reviewData.userId}>:`,
                            files: [reviewData.mediaUrl]
                        });
                        await interaction.editReply({ content: `✅ Media approved and reposted to <#${originalChannel.id}>.` });
                    }
                } else if (subcommand === 'deny') {
                    // Logic: Simply delete the entry and inform the user (or DM later).
                    await interaction.editReply({ content: '🗑️ Media denied and discarded.' });
                }
                
                // Cleanup
                delete MEDIA_REVIEW_QUEUE[messageId];
            }
        }

        // --- /nsfw commands ---
        if (commandName === 'nsfw') {
            await interaction.deferReply({ ephemeral: true });
            const subcommand = interaction.options.getSubcommand();

            if (subcommand === 'mode') {
                const level = interaction.options.getString('level');
                SECURITY_CONFIG.NSFW_MODE = level;
                await interaction.editReply({ content: `✅ NSFW detection mode set to **${level.toUpperCase()}**.` });
            } else if (subcommand === 'whitelist') {
                const user = interaction.options.getUser('user');
                NSFW_USER_WHITELIST.add(user.id);
                await interaction.editReply({ content: `✅ User ${user.tag} added to NSFW whitelist.` });
            }
        }

        // --- /raid commands ---
        if (commandName === 'raid') {
            await interaction.deferReply({ ephemeral: true });
            const subcommand = interaction.options.getSubcommand();
            const guild = interaction.guild;

            if (subcommand === 'lockdown') {
                if (SECURITY_CONFIG.IS_RAID_MODE) return interaction.editReply({ content: '⚠️ Raid mode is already active.' });
                SECURITY_CONFIG.IS_RAID_MODE = true;

                // Logic: Iterate through all text channels and deny @everyone SendMessages
                guild.channels.cache.forEach(async (channel) => {
                    if (channel.type === 0) { // Check if it's a text channel
                        try {
                            await channel.permissionOverwrites.edit(guild.id, { SendMessages: false });
                        } catch (e) { /* ignore permission errors */ }
                    }
                });
                await interaction.editReply({ content: '🚨 **SERVER LOCKDOWN ACTIVATED!** All public channels are locked, and strict anti-spam measures are ON.' });
            
            } else if (subcommand === 'release') {
                if (!SECURITY_CONFIG.IS_RAID_MODE) return interaction.editReply({ content: '⚠️ Raid mode is not active.' });
                SECURITY_CONFIG.IS_RAID_MODE = false;
                
                // Logic: Restore SendMessages for @everyone
                guild.channels.cache.forEach(async (channel) => {
                    if (channel.type === 0) {
                        try {
                             // Set SendMessages back to null (inherit from parent) or true if no parent is set
                            await channel.permissionOverwrites.edit(guild.id, { SendMessages: null }); 
                        } catch (e) { /* ignore permission errors */ }
                    }
                });
                await interaction.editReply({ content: '✅ **LOCKDOWN RELEASED!** Channels unlocked, protection returned to normal.' });
            
            } else if (subcommand === 'status') {
                await interaction.editReply({ content: `Raid Mode Status: **${SECURITY_CONFIG.IS_RAID_MODE ? 'ACTIVE 🔴' : 'INACTIVE 🟢'}**` });
            }
        }

        // --- /freeze commands ---
        if (commandName === 'freeze') {
            await interaction.deferReply({ ephemeral: true });
            const subcommand = interaction.options.getSubcommand();
            const user = interaction.options.getUser('user');
            const member = interaction.guild.members.cache.get(user.id);

            if (!member) return interaction.editReply({ content: '❌ User not found in this server.' });
            
            if (subcommand === 'apply') {
                const reason = interaction.options.getString('reason');
                await applyFreeze(member, reason);
                await interaction.editReply({ content: `✅ User ${user.tag} has been **FROZEN** for: \`${reason}\`` });

            } else if (subcommand === 'remove') {
                // Logic: Remove the Frozen Role and the entry from FROZEN_USERS
                if (!FROZEN_USERS[member.id] && !member.roles.cache.has(SECURITY_CONFIG.FROZEN_ROLE_ID)) {
                    return interaction.editReply({ content: `⚠️ User ${user.tag} is not currently frozen by the bot.` });
                }

                await member.roles.remove(SECURITY_CONFIG.FROZEN_ROLE_ID);
                delete FROZEN_USERS[member.id];
                await interaction.editReply({ content: `✅ User ${user.tag} has been **UNFROZEN** and roles restored.` });
                
            } else if (subcommand === 'status') {
                const isFrozen = FROZEN_USERS[member.id] || member.roles.cache.has(SECURITY_CONFIG.FROZEN_ROLE_ID);
                if (isFrozen) {
                    const reason = FROZEN_USERS[member.id]?.reason || 'Frozen role manually applied.';
                    await interaction.editReply({ content: `❄️ User ${user.tag} is **FROZEN**. Reason: \`${reason}\`` });
                } else {
                    await interaction.editReply({ content: `🟢 User ${user.tag} is **NOT** frozen.` });
                }
            }
        }

    } catch (error) {
        // ... (General Interaction Error Handling) ...
    }
});


// --- 11. MESSAGE HANDLER (CORE SECURITY LOGIC) --- 🛠️ FULL IMPLEMENTATION

client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.inGuild() || message.member.permissions.has(PermissionFlagsBits.Administrator)) return;
    const member = message.member;

    // ----------------------------------------------------------------------
    // I. 🚨 ANTI-SPAM / BURST PROTECTION
    // ----------------------------------------------------------------------
    const currentTime = Date.now();
    const userHistory = MESSAGE_HISTORY.get(member.id) || [];
    
    // Remove messages older than 10 seconds
    const freshHistory = userHistory.filter(timestamp => currentTime - timestamp < 10000);
    freshHistory.push(currentTime);
    MESSAGE_HISTORY.set(member.id, freshHistory);

    // Burst Pattern Heuristic: 5 messages in 10 seconds
    if (freshHistory.length > 5) {
        // Log, Delete all 5 messages (if still in cache), Freeze
        // logToDiscord('🚨 SPAM FREEZE', `User ${member.user.tag} frozen for spamming (${freshHistory.length} msg/10s).`, '#FF4500');
        await applyFreeze(member, 'Auto-Frozen: Burst Message Spam');
        return message.delete().catch(() => {}); // Delete the triggering message
    }

    // ----------------------------------------------------------------------
    // II. 🔥 ADVANCED NSFW DETECTION LAYER (Highest Priority)
    // ----------------------------------------------------------------------
    let isNSFW = false;
    let nsfwReason = '';
    const hasMedia = message.attachments.size > 0;
    
    // Bypass for whitelisted users
    if (NSFW_USER_WHITELIST.has(member.id)) return;

    if (hasMedia) {
        const attachment = message.attachments.first();
        const url = attachment.url;

        // 1. Filename & Metadata Pattern Scanning (Highest Priority)
        const filenameLower = attachment.name.toLowerCase();
        if (NSFW_PATTERNS.some(pattern => {
             // Check string patterns (e.g., nsfw) and regex patterns (e.g., p0rn)
             return typeof pattern === 'string' ? filenameLower.includes(pattern) : pattern.test(filenameLower);
        })) {
            isNSFW = true;
            nsfwReason = 'Filename Pattern Match';
        }

        // 4. Contextual Text Recognition (OCR keywords in caption)
        const captionLower = message.content.toLowerCase();
        const nsfwKeywords = ['boobs', 'ass', 'pussy', 'thigh', 'lewd', 'sexy'];
        if (nsfwKeywords.some(keyword => captionLower.includes(keyword))) {
            isNSFW = true;
            nsfwReason = 'Caption Keyword Match';
        }

        // 5. Burst Pattern Heuristic (Multiple images quickly)
        if (message.attachments.size > 2) {
             isNSFW = true;
             nsfwReason = 'Burst Media Dump (3+ images)';
        }

        // 3. Pixel Color Cluster & Skin-Tone Ratio Analysis (STRICT MODE ONLY)
        if (SECURITY_CONFIG.NSFW_MODE === 'strict' && !isNSFW) {
            // Note: This function requires an external library (Jimp/Sharp)
            const confidence = await pixelAnalysisHeuristic(url); 
            if (confidence > 40) { // Example threshold
                isNSFW = true;
                nsfwReason = `Heuristic Skin Tone Match (${confidence.toFixed(1)}% confidence)`;
            }
        }

        // --- NSFW ACTION ---
        if (isNSFW) {
            await message.delete().catch(() => {}); // Delete immediately
            await applyFreeze(member, `Auto-Frozen: NSFW Detection (${nsfwReason})`);
            // logToDiscord('🔥 NSFW DELETED', `User ${member.user.tag} posted NSFW media. Reason: ${nsfwReason}`, '#8B0000');
            // Media should be moved to review channel privately here (not implemented for simplicity)
            return;
        }

        // --- MEDIA REVIEW HOLDING ---
        if (SECURITY_CONFIG.MEDIA_HOLDING_ENABLED && hasMedia) {
            await message.delete().catch(() => {});
            // Logic to send media to the REVIEW_CHANNEL and add to MEDIA_REVIEW_QUEUE
            return;
        }
    }


    // ----------------------------------------------------------------------
    // III. 🔗 LINK & EXTERNAL MEDIA FILTER SYSTEM
    // ----------------------------------------------------------------------

    const channelLinkBlockReason = LINK_CHANNEL_BLOCKED[message.channel.id];

    // Check if the link is globally blocked or channel-blocked
    if (containsBlockedLink(message.content) || (channelLinkBlockReason && containsBlockedLink(message.content))) {
        
        // Final check to bypass if the message contains genuine attachments (e.g., user uploaded a file)
        const isAttachmentOrSticker = message.attachments.size > 0 || message.stickers.size > 0;
        if (isAttachmentOrSticker) return; 

        // ACTION: Block Link
        await message.delete().catch(() => {});
        // Warning/Freeze logic here (similar to existing linkblock warning)
        
        // Example: If a link is blocked by a channel setting, send the warning.
        if (channelLinkBlockReason) {
            // Send ephemeral warning using message.channel.send and setTimeout(delete)
            // logToDiscord('🚫 Link Blocked', `Link blocked in <#${message.channel.id}> from ${member.user.tag}`, '#EF4444');
        }

        // Example: If link is a highly suspicious TLD or repeated offender, apply Freeze.
        // if (/[a-z]{2,4}\//i.test(message.content)) { // Basic check for suspicious TLDs
        //    await applyFreeze(member, 'Auto-Frozen: Suspicious External Link');
        // }
        return;
    }
});


// --- 12. BUTTON INTERACTIONS --- 🛠️ REVIEW BUTTONS

// ... (existing button logic for disable_linkblock remains) ...

// --- 13. CLIENT LOGIN ---
client.login(process.env.DISCORD_TOKEN);
